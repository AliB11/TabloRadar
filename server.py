#!/usr/bin/env python3
"""
server.py — سرور محلی تابلورادار (کتابخانه استاندارد پایتون، بدون وابستگی)

سه کار می‌کند:
  ۱) سرو فایل‌های استاتیک ریپو (داشبورد) روی 0.0.0.0
  ۲) پروکسی دادهٔ **واقعی** و بدون کلید در کلاینت:
       /api/market            → زنجیرهٔ منابع: BrsApi (در صورت کلید) → TSETMC → بورس‌تریدر → اسنپ‌شات محلی
       /api/history?insCode=… → تاریخچهٔ تعدیل‌شدهٔ TSETMC (chart/Financial) با کش دیسکی
       /api/info/<insCode>    → شناسنامهٔ نماد (TSETMC)
       /api/symbol/<l18>      → تابلوی کامل نماد از bourse-trader.ir (P/E، EPS، شناوری، دفتر سفارش)
       /api/overview          → نبض بازار از bourse-trader.ir (شاخص‌ها، صف‌ها، پول حقیقی)
       /api/sources           → آزمون زندهٔ دسترسی منابع
       /api/health            → وضعیت سرور و کلیدها
  ۳) برچسب‌گذاری شفاف: هر پاسخ، «نوع داده» (live / live-partial / simulated) و منبع را
     در بدنه و هدرهای X-Data-* برمی‌گرداند تا داشبورد هرگز دادهٔ ساختگی را زنده جا نزند.

   BRS_API_KEY=xxxx python3 server.py            # پورت پیش‌فرض ۸۰۰۰
   python3 server.py --port 8080 --no-upstream   # فقط استاتیک + اسنپ‌شات محلی
"""
from __future__ import annotations

import argparse
import functools
import json
import os
import re
import socket
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from tsepy import bourse_trader as BT      # noqa: E402  (خوانندهٔ bourse-trader.ir)
from tsepy import tablokhani_source as TK  # noqa: E402  (صفحات عمومی tablokhani.com)
from tsepy import tsetmc_live as TL        # noqa: E402  (کلاینت رسمی TSETMC)

HIST_DIR = ROOT / "data" / "history"      # کش دیسکی تاریخچه
HIST_TTL = 7 * 86400                      # هفته‌ای یک‌بار تازه‌سازی
MEM_TTL = 1800                            # کش درون‌فرآیندی
SNAPSHOT = ROOT / "data" / "offline-snapshot.json"
BRS_BASE = os.environ.get("BRS_API_BASE", "https://Api.BrsApi.ir/Tsetmc/")
TSETMC_CDN = os.environ.get("TSETMC_CDN", "https://cdn.tsetmc.com/api/")
TSETMC_LEGACY = "https://old.tsetmc.com/tsev2/data/"
# BrsApi صریحاً User-Agent استاندارد مرورگر را الزامی کرده؛ UA پیش‌فرض پایتون
# ممکن است توسط فایروال 6G مسدود شود.
UA = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
}
TIMEOUT = float(os.environ.get("TR_TIMEOUT", "15"))

_cache: dict[str, tuple[float, object]] = {}
_lock = threading.Lock()


def hdr(value) -> str:
    """هدرهای HTTP باید latin-1 باشند؛ برچسب‌های فارسی درصد-کد می‌شوند."""
    text = str(value)
    return text if text.isascii() else urllib.parse.quote(text, safe=" ()+,.:/=-_[]")


def cached(key: str, ttl: float, fetch):
    """حافظهٔ نهان درون‌فرآیندی با TTL — کاهش فشار بر سرویس بازار."""
    now = time.time()
    with _lock:
        hit = _cache.get(key)
        if hit and now - hit[0] < ttl:
            return hit[1]
    val = fetch()
    with _lock:
        _cache[key] = (now, val)
    return val


def http_get(url: str, accept: str = "application/json,*/*") -> str:
    req = urllib.request.Request(url, headers={**UA, "Accept": accept})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as res:  # noqa: S310 (URL از پیکربندی)
        return res.read().decode("utf-8", "replace")


def is_hidden_path(path: str) -> bool:
    """آیا هر بخشِ مسیر فایل مخفی/نقطه‌دار است؟ (.git، .env، … — هرگز سرو نمی‌شود)"""
    for seg in urllib.parse.unquote(path).split("/"):
        if seg and seg.startswith("."):
            return True
    return False


# ─────────────────────────── منابع داده ───────────────────────────
# هر منبع یک «پاکت» یکنواخت برمی‌گرداند:
#   {kind, source, as_of, instruments:[…], indices:{…}, market_state:{…}, quality:{…}}

def source_brsapi() -> dict:
    """BrsApi — فقط اگر کلید محیطی تنظیم شده باشد (کلید هرگز به مرورگر نمی‌رود)."""
    key = os.environ.get("BRS_API_KEY", "").strip()
    if not key:
        raise RuntimeError("کلید BrsApi تنظیم نشده")
    urls = [
        f"{BRS_BASE}AllSymbols.php?key={urllib.parse.quote(key)}&type=1",
        f"https://BrsApi.ir/Api/Tsetmc/AllSymbols.php?key={urllib.parse.quote(key)}&type=1",
    ]
    last = None
    for url in urls:
        try:
            body = http_get(url)
            js = json.loads(body)
            rows = js if isinstance(js, list) else (js.get("data") or js.get("result") or js.get("rows") or [])
            if isinstance(rows, list) and len(rows) > 30:
                for r in rows:
                    r.setdefault("provenance", "brsapi")
                    r.setdefault("synthetic", False)
                return {"kind": "live", "source": "BrsApi (AllSymbols type=1)", "as_of": "",
                        "instruments": rows, "indices": {}, "market_state": {},
                        "quality": {"instruments": len(rows), "provider": "brsapi"}}
            last = f"پاسخ کوتاه ({len(rows) if isinstance(rows, list) else '?'} ردیف)"
        except (urllib.error.URLError, urllib.error.HTTPError, ValueError, OSError, TimeoutError) as e:
            last = f"{type(e).__name__}: {e}"
    raise RuntimeError(last or "BrsApi پاسخ نداد")


def source_tsetmc() -> dict:
    """TSETMC — قیمت/دفتر سفارش + حقیقی‑حقوقی، بدون کلید و برای کل بازار."""
    mw = TL.market_watch_init(TIMEOUT)
    try:
        clients = TL.client_type_all(TIMEOUT)
    except Exception:  # noqa: BLE001 — نبودِ حقیقی/حقوقی نباید کل منبع را بیندازد
        clients = {}
    rows = TL.build_instruments(mw, clients)
    if len(rows) < 30:
        raise RuntimeError(f"پاسخ TSETMC کوتاه بود ({len(rows)} ردیف)")
    st = mw.get("market_state", {})
    as_of = " ".join(x for x in (st.get("datetime_jalali"), st.get("datetime_time")) if x) \
        or st.get("datetime_raw") or ""
    indices = {}
    if st.get("index_total"):
        indices["index_total"] = {"fa": "شاخص کل بورس", "value": st.get("index_total"),
                                  "chg_pct": st.get("index_change_pct")}
    return {
        "kind": "live", "source": "TSETMC (MarketWatchInit + ClientTypeAll)", "as_of": as_of,
        "instruments": rows, "indices": indices, "market_state": st,
        "quality": {"instruments": len(rows),
                    "with_client_types": sum(1 for r in rows if "Buy_I_Volume" in r),
                    "with_order_book": sum(1 for r in rows if "qd1" in r)},
    }


def source_bourse_trader() -> dict:
    """بورس‌تریدر — منبع پشتیبان: نبض بازار + تابلوهای نمادهای پرگردش (پوشش جزئی، صریح)."""
    ov = BT.market_overview()
    rows: list[dict] = []
    top_items = (ov.get("top_inflow") or [])[:6] + (ov.get("top_outflow") or [])[:4]
    # مبلغ پول حقیقی متعلق به همان ردیف overview است. قبلاً اینجا متغیر تعریف‌نشدهٔ
    # item باعث می‌شد کل مسیر پشتیبان بورس‌تریدر بی‌صدا صفر ردیف برگرداند.
    money_by_symbol = {i.get("symbol"): i.get("money_rial") for i in top_items if i.get("symbol")}
    for sym in dict.fromkeys(money_by_symbol):  # حداکثر ۱۰ نماد، بدون تکرار
        try:
            snap = BT.fetch_symbol(sym)
        except Exception:  # noqa: BLE001
            continue
        row = {k: v for k, v in snap.items()
               if k not in ("raw_found", "ambiguous", "source", "symbol")}
        row.update({"l18": sym, "provenance": "bourse-trader", "synthetic": False,
                    "partial": True, "netRealMoneyToday": money_by_symbol[sym]})
        rows.append(row)
    if len(rows) < 5:
        raise RuntimeError(f"بورس‌تریدر فقط {len(rows)} نماد داد")
    indices = {}
    if ov.get("index_total"):
        indices["index_total"] = {"fa": "شاخص کل بورس", "value": ov["index_total"], "chg_pct": None}
    if ov.get("market_cap"):
        indices["market_cap"] = {"fa": "ارزش بازار (ریال)", "value": ov["market_cap"], "chg_pct": None}
    return {
        "kind": "live-partial",
        "source": f"bourse-trader.ir (پوشش جزئی: {len(rows)} نماد پرگردش)",
        "as_of": time.strftime("%Y-%m-%d %H:%M"),
        "instruments": rows, "indices": indices, "market_state": {},
        "market_overview": ov,
        "quality": {"instruments": len(rows), "partial": True},
    }


def source_tablokhani() -> dict:
    """صفحات عمومی tablokhani.com؛ فقط دادهٔ خام عمومی، بدون ابزار/امتیاز اشتراکی."""
    rows = TK.fetch_market(limit=5, timeout=TIMEOUT)
    if len(rows) < 5:
        raise RuntimeError(f"tablokhani فقط {len(rows)} نماد عمومی معتبر داد")
    return {
        "kind": "live-partial",
        "source": f"tablokhani.com (HTML عمومی، پوشش جزئی: {len(rows)} نماد)",
        "as_of": time.strftime("%Y-%m-%d %H:%M"),
        "instruments": rows, "indices": {}, "market_state": {},
        "quality": {"instruments": len(rows), "partial": True, "public_html": True},
    }


def source_snapshot() -> dict:
    """اسنپ‌شات محلی — اگر دادهٔ واقعیِ ثبت‌شده باشد kind=live، وگرنه simulated (صریح)."""
    if not SNAPSHOT.is_file():
        raise RuntimeError("اسنپ‌شات محلی موجود نیست")
    data = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
    kind = data.get("data_kind") or ("simulated" if data.get("simulated_fields") else "live-partial")
    rows = data.get("instruments", [])
    return {
        "kind": kind, "source": f"اسنپ‌شات محلی ({data.get('as_of', '—')})",
        "as_of": data.get("as_of", ""), "instruments": rows,
        "indices": data.get("indices", {}) or {}, "market_state": {},
        "disclaimer": data.get("disclaimer", ""),
        "simulated_fields": data.get("simulated_fields"),
        "quality": {"instruments": len(rows), "snapshot": True},
    }


PROVIDERS = (
    ("brsapi", source_brsapi),
    ("tsetmc", source_tsetmc),
    ("bourse-trader", source_bourse_trader),
    ("tablokhani", source_tablokhani),
    ("snapshot", source_snapshot),
)


# شکست کلِ زنجیره موقتاً کش می‌شود تا تلاش‌های خودکار مرورگر (هر ۳۰ ثانیه)
# هر بار همه منابع را با تایم‌اوت ۱۵ ثانیه‌ای از نو نکاوبند (ممکن است دقیقه‌ها طول بکشد).
_MARKET_FAIL: dict[str, object] = {"t": 0.0, "err": ""}
MARKET_FAIL_TTL = 20.0


def market_envelope() -> tuple[dict, list[str]]:
    """اولین منبع واقعی موفق؛ دادهٔ شبیه‌سازی‌شده هرگز از API بازار عبور نمی‌کند."""
    now = time.time()
    with _lock:
        cached_err = str(_MARKET_FAIL.get("err") or "")
        if cached_err and now - float(_MARKET_FAIL.get("t") or 0) < MARKET_FAIL_TTL:
            raise RuntimeError(cached_err)
    log: list[str] = []
    for name, fn in PROVIDERS:
        try:
            env = fn() if name == "snapshot" else cached(
                f"market:{name}", 45 if name != "bourse-trader" else 180, fn)
            if env.get("kind") == "simulated" or any(r.get("synthetic") for r in env.get("instruments", [])):
                log.append(f"{name}:rejected-simulated")
                continue
            with _lock:
                _MARKET_FAIL["err"] = ""
            return env, log + [f"{name}:ok"]
        except Exception as e:  # noqa: BLE001
            log.append(f"{name}:{str(e)[:80]}")
    err = "هیچ منبع واقعی در دسترس نیست | " + " | ".join(log)
    with _lock:
        _MARKET_FAIL["t"] = time.time()
        _MARKET_FAIL["err"] = err
    raise RuntimeError(err)


# ─────────────────────────── کش دیسکی تاریخچه ───────────────────────────

def hist_key(l18: str | None, ins: str | None, days: int) -> str:
    return f"{ins or l18}-{days}"


def hist_path(key: str) -> Path:
    safe = re.sub(r"[^A-Za-z0-9_.-]", "_", key)[:120]
    return HIST_DIR / f"{safe}.json"


def hist_cache_read(key: str, allow_stale: bool = False):
    p = hist_path(key)
    if not p.is_file():
        return None
    try:
        rec = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    age = time.time() - float(rec.get("cached_at", 0))
    if not allow_stale and age > HIST_TTL:
        return None
    return rec.get("body") or "", rec.get("src") or "disk", age


def hist_cache_write(key: str, body: str, src: str) -> None:
    try:
        HIST_DIR.mkdir(parents=True, exist_ok=True)
        hist_path(key).write_text(
            json.dumps({"cached_at": time.time(), "src": src, "body": body}, ensure_ascii=False),
            encoding="utf-8")
    except OSError:
        pass   # کش اختیاری است


def history_upstream(l18: str | None, ins: str | None, days: int) -> tuple[str, str]:
    """تاریخچهٔ واقعی؛ با کلید، BrsApi اولویت قطعی دارد تا مصرف منبع یکدست بماند."""
    errs: list[str] = []
    # CDN رسمی منبع اول: قرارداد closingPriceDaily با نمونهٔ واقعی تأیید شده است.
    if ins:
        try:
            bars = TL.cdn_daily_history(ins, days, TIMEOUT)
            if len(bars) >= 20:
                return json.dumps(bars, ensure_ascii=False), "TSETMC-CDN-closingPriceDaily (raw)"
            errs.append(f"TSETMC-CDN:{len(bars)} کندل معامله‌شده")
        except Exception as e:  # noqa: BLE001
            errs.append(f"TSETMC-CDN:{type(e).__name__}")
    key = os.environ.get("BRS_API_KEY", "").strip()
    if l18 and key:
        try:
            body = http_get(f"{BRS_BASE}History.php?key={urllib.parse.quote(key)}"
                            f"&type=0&l18={urllib.parse.quote(l18)}")
            parsed = json.loads(body)
            rows = parsed if isinstance(parsed, list) else parsed.get("data") or parsed.get("result") or []
            if not isinstance(rows, list) or len(rows) < 20:
                raise RuntimeError(f"پاسخ تاریخچه کوتاه/نامعتبر ({len(rows) if isinstance(rows, list) else 0})")
            return body, "BrsApi-history"
        except Exception as e:  # noqa: BLE001
            errs.append(f"BrsApi:{type(e).__name__}")
    if ins:
        try:
            bars = TL.daily_history(ins, days, TIMEOUT)
            if len(bars) >= 20:
                return json.dumps(bars, ensure_ascii=False), "TSETMC-chart"
            errs.append(f"TSETMC-chart:{len(bars)} کندل")
        except Exception as e:  # noqa: BLE001
            errs.append(f"TSETMC-chart:{type(e).__name__}")
    raise RuntimeError(" | ".join(errs) or "منبع تاریخچه در دسترس نیست")


def history_lookup(l18: str | None, ins: str | None, days: int,
                   allow_net: bool = True) -> tuple[str, str, str | None, str | None]:
    """ترتیب: حافظهٔ درون‌فرآیندی ← دیسک تازه ← شبکه ← دیسک کهنه. (body, src, xcache, err)"""
    key = hist_key(l18, ins, days)
    now = time.time()
    with _lock:
        hit = _cache.get("hist:" + key)
    if hit and now - hit[0] < MEM_TTL:
        return hit[1][0], hit[1][1], "mem", None
    fresh = hist_cache_read(key)
    if fresh:
        with _lock:
            _cache["hist:" + key] = (now, (fresh[0], fresh[1]))
        return fresh[0], fresh[1], "disk", None
    if allow_net:
        try:
            body, src = history_upstream(l18, ins, days)
            hist_cache_write(key, body, src)
            with _lock:
                _cache["hist:" + key] = (now, (body, src))
            return body, src, "net", None
        except Exception as e:  # noqa: BLE001
            stale = hist_cache_read(key, allow_stale=True)
            if stale:
                return stale[0], f"{stale[1]} (کهنه {int(stale[2] / 86400)} روزه)", "disk-stale", None
            return "", "", None, str(e)[:600]
    stale = hist_cache_read(key, allow_stale=True)
    if stale:
        return stale[0], f"{stale[1]} (کهنه {int(stale[2] / 86400)} روزه)", "disk-stale", None
    return "", "", None, "upstream disabled (--no-upstream) و کش دیسکی خالی است"


# ─────────────────────────── هندلر HTTP ───────────────────────────

class Handler(SimpleHTTPRequestHandler):
    server_version = "TabloRadar/3.2"

    def log_message(self, fmt, *args):
        sys.stderr.write(f"  {time.strftime('%H:%M:%S')}  {fmt % args}\n")

    def _json(self, code: int, payload: dict, extra: dict | None = None):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        for k, v in (extra or {}).items():
            self.send_header(k, hdr(v))
        self.end_headers()
        if self.command != "HEAD":   # HEAD فقط هدر می‌خواهد؛ بدنه ممنوع (RFC 9110)
            self.wfile.write(body)

    def send_head(self):
        """سروِ فایل‌های استاتیک — مسیرهای نقطه‌دار (.git/.env/…) هرگز باز نمی‌شوند."""
        raw_path = urllib.parse.urlparse(self.path).path
        if is_hidden_path(raw_path):
            self.send_error(404, "Not found")
            return None
        return super().send_head()

    def do_HEAD(self):  # noqa: N802
        path = urllib.parse.urlparse(self.path).path.rstrip("/") or "/"
        if path.startswith("/api/"):
            return self.do_GET()     # مسیر API؛ _json برای HEAD بدنه نمی‌نویسد
        return super().do_HEAD()

    def do_OPTIONS(self):  # noqa: N802 — پیش‌پرواز CORS برای مصرف‌کنندهٔ بیرونی
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Accept, Content-Type")
        self.send_header("Access-Control-Max-Age", "600")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _redirect_into_app(self):
        base = Path(self.directory or os.getcwd())
        for child in sorted(base.iterdir()):
            if child.is_dir() and (child / "index.html").exists():
                self.send_response(302)
                self.send_header("Location", f"/{child.name}/index.html")
                self.end_headers()
                return True
        return False

    def do_GET(self):  # noqa: N802
        parsed = urllib.parse.urlparse(self.path)
        path, qs = parsed.path.rstrip("/") or "/", urllib.parse.parse_qs(parsed.query)
        if path in ("", "/") and self._redirect_into_app():
            return
        if path == "/api/market":
            return self._api_market()
        if path == "/api/history":
            return self._api_history(qs)
        if path.startswith("/api/info/"):
            return self._api_info(path.rsplit("/", 1)[-1])
        if path.startswith("/api/book/"):
            return self._api_book(path.rsplit("/", 1)[-1])
        if path.startswith("/api/symbol/"):
            return self._api_symbol(urllib.parse.unquote(path.rsplit("/", 1)[-1]))
        if path == "/api/overview":
            return self._api_overview()
        if path == "/api/sources":
            return self._api_sources()
        if path == "/api/health":
            return self._json(200, {"ok": True, "upstream": not getattr(self.server, "no_upstream", False),
                                    "key_configured": bool(os.environ.get("BRS_API_KEY")),
                                    "snapshot": SNAPSHOT.name, "time": time.time()})
        if path.startswith("/api/"):
            return self._json(404, {"error": f"مسیر نامشخص: {path}"})
        return super().do_GET()

    # ── /api/market ──
    def _api_market(self):
        if getattr(self.server, "no_upstream", False):
            try:
                env = cached("market:snapshot", 5, source_snapshot)
            except Exception as e:  # noqa: BLE001
                return self._json(503, {"error": str(e)[:300]})
            if env.get("kind") == "simulated" or any(r.get("synthetic") for r in env.get("instruments", [])):
                return self._json(503, {"error": "اسنپ‌شات محلی شبیه‌سازی‌شده است؛ نمایش دادهٔ غیرواقعی مجاز نیست"})
            env["source"] = f"{env['source']} — upstream غیرفعال"
            return self._json(200, env, {"X-Data-Kind": env["kind"], "X-Data-Source": env["source"]})
        try:
            env, log = market_envelope()
        except Exception as e:  # noqa: BLE001
            return self._json(502, {"error": str(e)[:600]})
        env = dict(env)
        env["log"] = log
        return self._json(200, env, {"X-Data-Kind": env["kind"], "X-Data-Source": env["source"]})

    # ── /api/history ──
    def _api_history(self, qs):
        l18 = (qs.get("l18") or [None])[0]
        ins = (qs.get("insCode") or [None])[0]
        try:
            days = max(5, min(int((qs.get("days") or ["260"])[0]), 2000))
        except ValueError:
            days = 260
        if not (l18 or ins):
            return self._json(400, {"error": "l18 یا insCode لازم است"})
        allow_net = not getattr(self.server, "no_upstream", False)
        body, src, xcache, err = history_lookup(l18, ins, days, allow_net=allow_net)
        if err:
            return self._json(502, {"error": err})
        # اگر منبع، JSON کندل داد همان را بده؛ در غیر این‌صورت متن خام (سازگاری با کلاینت قدیمی)
        try:
            parsed = json.loads(body)
            payload = {"kind": "live", "source": src, "bars": parsed if isinstance(parsed, list) else parsed}
        except json.JSONDecodeError:
            payload = {"kind": "live", "source": src, "raw": body}
        self._json(200, payload, {"X-Data-Source": src, "X-Cache": xcache or "bypass"})

    # ── /api/info/<insCode> ──
    def _api_info(self, ins_code):
        if getattr(self.server, "no_upstream", False):
            return self._json(503, {"error": "upstream disabled"})
        try:
            info = cached(f"info:{ins_code}", 3600, lambda: TL.instrument_info(ins_code, TIMEOUT))
        except Exception as e:  # noqa: BLE001
            return self._json(502, {"error": str(e)[:400]})
        if not info:
            return self._json(404, {"error": "شناسنامه در دسترس نبود"})
        return self._json(200, {"kind": "live", "source": "TSETMC InstrumentInfo", "info": info})

    # ── /api/book/<insCode> ──
    def _api_book(self, ins_code):
        if getattr(self.server, "no_upstream", False):
            return self._json(503, {"error": "upstream disabled"})
        try:
            book = cached(f"book:{ins_code}", 15, lambda: TL.best_limits(ins_code, TIMEOUT))
        except Exception as e:  # noqa: BLE001
            return self._json(502, {"error": str(e)[:400]})
        if not book:
            return self._json(404, {"error": "دفتر سفارش CDN در دسترس نبود"})
        return self._json(200, {"kind": "live", "source": "TSETMC CDN BestLimits", "book": book},
                          {"X-Data-Source": "TSETMC-CDN-BestLimits", "X-Cache": "15s"})

    # ── /api/symbol/<l18> ──
    def _api_symbol(self, l18):
        if not l18:
            return self._json(400, {"error": "نماد لازم است"})
        if getattr(self.server, "no_upstream", False):
            return self._json(503, {"error": "upstream disabled"})
        try:
            snap = cached(f"bt:{l18}", 90, lambda: BT.fetch_symbol(l18, ttl=60.0))
        except Exception as e:  # noqa: BLE001
            return self._json(502, {"error": str(e)[:400]})
        return self._json(200, {"kind": "live", "source": "bourse-trader.ir/symbol", "symbol": l18,
                                "detail": snap}, {"X-Data-Source": "bourse-trader.ir"})

    # ── /api/overview ──
    def _api_overview(self):
        if getattr(self.server, "no_upstream", False):
            return self._json(503, {"error": "upstream disabled"})
        try:
            ov = cached("overview", 90, BT.market_overview)
        except Exception as e:  # noqa: BLE001
            return self._json(502, {"error": str(e)[:400]})
        return self._json(200, {"kind": "live", "source": "bourse-trader.ir", "overview": ov},
                          {"X-Data-Source": "bourse-trader.ir"})

    # ── /api/sources (آزمون زندهٔ دسترسی) ──
    def _api_sources(self):
        if getattr(self.server, "no_upstream", False):
            return self._json(503, {"error": "upstream disabled"})
        def probe():
            out = []
            for name, fn in PROVIDERS:
                t0 = time.time()
                try:
                    env = fn()
                    out.append({"provider": name, "ok": True, "kind": env.get("kind"),
                                "instruments": len(env.get("instruments", [])),
                                "ms": int((time.time() - t0) * 1000), "source": env.get("source")})
                except Exception as e:  # noqa: BLE001
                    out.append({"provider": name, "ok": False, "error": str(e)[:200],
                                "ms": int((time.time() - t0) * 1000)})
            return out
        return self._json(200, {"providers": cached("sources", 300, probe)})


def lan_ips() -> list[str]:
    out = []
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if ip not in out:
                out.append(ip)
    except OSError:
        pass
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description="TabloRadar — static + live data proxy")
    ap.add_argument("--port", type=int, default=int(os.environ.get("PORT", 8000)))
    ap.add_argument("--host", default="0.0.0.0")
    ap.add_argument("--ttl", type=int, default=45, help="TTL حافظهٔ نهان اسنپ‌شات بازار (ثانیه)")
    ap.add_argument("--no-upstream", action="store_true",
                    help="فقط استاتیک و اسنپ‌شات محلی (بدون تماس با منابع بیرونی)")
    ap.add_argument("--root", default=str(ROOT), help="پوشه‌ای که فایل‌های استاتیک از آن سرو می‌شود")
    args = ap.parse_args()

    root = Path(args.root).resolve()
    handler = functools.partial(Handler, directory=str(root))
    httpd = ThreadingHTTPServer((args.host, args.port), handler)
    httpd.ttl_market = args.ttl            # type: ignore[attr-defined]
    httpd.no_upstream = args.no_upstream   # type: ignore[attr-defined]
    httpd.daemon_threads = True

    print(f"\n  تابلورادار · http://localhost:{args.port}  (ریشه: {root})")
    for ip in lan_ips():
        print(f"  شبکه محلی      · http://{ip}:{args.port}")
    cached_n = len(list(HIST_DIR.glob("*.json"))) if HIST_DIR.is_dir() else 0
    print("  منابع زنده    · TSETMC (MarketWatchInit/ClientTypeAll/chart) → بورس‌تریدر → اسنپ‌شات")
    print(f"  کش تاریخچه     · {HIST_DIR} — {cached_n} نماد کش‌شده (TTL ۷ روز)")
    print(f"  کلید BrsApi    · {'از محیط خوانده شد' if os.environ.get('BRS_API_KEY') else 'تنظیم نشده (اختیاری)'}")
    print(f"  حالت آفلاین    · {'فعال' if args.no_upstream else 'غیرفعال'}")
    print("  مسیرها         · /api/market /api/history /api/info /api/symbol /api/overview /api/sources /api/health")
    print("  Ctrl+C برای توقف\n")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n  متوقف شد.")
    finally:
        httpd.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
