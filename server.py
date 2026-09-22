#!/usr/bin/env python3
"""
server.py — سرور محلی تابلورادار (کتابخانه استاندارد پایتون، بدون وابستگی)

دو کار می‌کند:
  ۱) سرو فایل‌های استاتیک ریپو (داشبورد) روی 0.0.0.0
  ۲) پروکسی امن داده:   /api/market   /api/history   /api/info/<insCode>
     کلید BrsApi از محیط خوانده می‌شود و **هرگز به مرورگر داده نمی‌شود**؛
     همچنین مشکل CORS مرورگر را حذف می‌کند.

   BRS_API_KEY=xxxx python3 server.py            # پورت پیش‌فرض ۸۰۰۰
   python3 server.py --port 8080 --no-upstream   # فقط استاتیک (حالت آفلاین)
"""
from __future__ import annotations

import argparse
import functools
import json
import os
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
BRS_BASE = os.environ.get("BRS_API_BASE", "https://Api.BrsApi.ir/Tsetmc/")
TSETMC_CDN = os.environ.get("TSETMC_CDN", "https://cdn.tsetmc.com/api/")
TSETMC_LEGACY = "https://service.tsetmc.com/tsev2/data/"
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 TabloRadar/3.0"}
TIMEOUT = float(os.environ.get("TR_TIMEOUT", "12"))

_cache: dict[str, tuple[float, object]] = {}
_lock = threading.Lock()


def cached(key: str, ttl: float, fetch):
    """حافظه نهان درون‌فرآیندی با TTL — کاهش فشار بر سرویس بازار."""
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


def try_sources(make_urls) -> tuple[str, str]:
    """اولین پاسخ موفق از میان چند URL را برمی‌گرداند: (متن, منبع)"""
    errs = []
    for url, label in make_urls():
        try:
            body = http_get(url)
            if body.strip():
                return body, label
            errs.append(f"{label}: empty")
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError) as e:
            errs.append(f"{label}: {type(e).__name__} {e}".strip()[:180])
    raise RuntimeError(" | ".join(errs) or "هیچ منبعی پاسخ نداد")


# ─────────────────────────── منابع داده ───────────────────────────


def upstream_market() -> tuple[str, str]:
    key = os.environ.get("BRS_API_KEY", "").strip()

    def urls():
        if key:
            yield f"{BRS_BASE}AllSymbols.php?key={urllib.parse.quote(key)}&type=1", "BrsApi"
            yield f"https://BrsApi.ir/Api/Tsetmc/AllSymbols.php?key={urllib.parse.quote(key)}&type=1", "BrsApi-alt"
        yield f"{TSETMC_LEGACY}instinfodata.aspx?t=PhantomTopsSet", "TSETMC-legacy"
        yield f"{TSETMC_CDN}MarketWatch/GetMarketWatchTables/0", "TSETMC-cdn"

    return try_sources(urls)


def upstream_history(l18: str | None, ins_code: str | None, days: int) -> tuple[str, str]:
    key = os.environ.get("BRS_API_KEY", "").strip()

    def urls():
        if ins_code:
            yield (f"{TSETMC_CDN}ClosingPrice/GetClosingPriceInfoList/{ins_code}/{days}", "TSETMC-history")
        if l18 and key:
            yield f"{BRS_BASE}History.php?key={urllib.parse.quote(key)}&type=0&l18={urllib.parse.quote(l18)}", "BrsApi-history"
        if l18:
            yield f"{TSETMC_LEGACY}InstrumentUse.aspx?method=OHLC2&instruments={urllib.parse.quote(l18)}&start={days}", "TSETMC-ohlc"

    return try_sources(urls)


# ─────────────────────────── هندلر HTTP ───────────────────────────


class Handler(SimpleHTTPRequestHandler):
    server_version = "TabloRadar/3.0"

    def log_message(self, fmt, *args):  # لاگ کوتاه‌تر و خوانا
        sys.stderr.write(f"  {time.strftime('%H:%M:%S')}  {fmt % args}\n")

    def _json(self, code: int, payload: dict):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _redirect_into_app(self):
        """وقتی ریشه سرو از بالای پوشه کاری است، «/» را به اپلیکیشن می‌فرستد.

        در پیش‌نمایش Arena مسیرها با پیشوند پوشه ریپو می‌آیند
        (example.preview/TabloRadar/index.html)؛ این کمک کاربر را به همان‌جا می‌رساند.
        """
        base = Path(self.directory or os.getcwd())
        for child in sorted(base.iterdir()):
            if child.is_dir() and (child / "index.html").exists():
                self.send_response(302)
                self.send_header("Location", f"/{child.name}/index.html")
                self.end_headers()
                return True
        return False

    def do_GET(self):  # noqa: N802 (امضای کتابخانه استاندارد)
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
        if path == "/api/health":
            return self._json(200, {"ok": True, "upstream": not getattr(self.server, "no_upstream", False),
                                    "key_configured": bool(os.environ.get("BRS_API_KEY")), "time": time.time()})
        return super().do_GET()

    # ── /api/market ──
    def _api_market(self):
        if getattr(self.server, "no_upstream", False):
            return self._json(503, {"error": "upstream disabled (--no-upstream)"})
        try:
            body, src = cached("market", self.server.ttl_market, upstream_market)
        except Exception as e:  # هر خطای شبکه → ۵۰۲ با پیام قابل‌دیباگ
            return self._json(502, {"error": str(e)[:600]})
        try:
            json.loads(body)
            ctype = "application/json; charset=utf-8"
        except json.JSONDecodeError:
            ctype = "text/plain; charset=utf-8"  # خروجی JS سرویس قدیمی TSETMC
        payload = body.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", f"public, max-age={int(self.server.ttl_market)}")
        self.send_header("X-Data-Source", src)
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    # ── /api/history ──
    def _api_history(self, qs):
        if getattr(self.server, "no_upstream", False):
            return self._json(503, {"error": "upstream disabled"})
        l18 = (qs.get("l18") or [None])[0]
        ins = (qs.get("insCode") or [None])[0]
        days = max(5, min(int((qs.get("days") or ["260"])[0]), 500))
        if not (l18 or ins):
            return self._json(400, {"error": "l18 یا insCode لازم است"})
        try:
            body, src = cached(f"hist:{l18 or ins}:{days}", 1800, lambda: upstream_history(l18, ins, days))
        except Exception as e:
            return self._json(502, {"error": str(e)[:600]})
        payload = body.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("X-Data-Source", src)
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    # ── /api/info/<insCode> ──
    def _api_info(self, ins_code):
        if getattr(self.server, "no_upstream", False):
            return self._json(503, {"error": "upstream disabled"})
        try:
            body, _ = cached(f"info:{ins_code}", 3600,
                             lambda: try_sources(lambda: [(f"{TSETMC_CDN}Instrument/GetInstrumentInfo/{ins_code}", "TSETMC")]))
        except Exception as e:
            return self._json(502, {"error": str(e)[:400]})
        payload = body.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


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
    ap = argparse.ArgumentParser(description="TabloRadar — static + safe data proxy")
    ap.add_argument("--port", type=int, default=int(os.environ.get("PORT", 8000)))
    ap.add_argument("--host", default="0.0.0.0")
    ap.add_argument("--ttl", type=int, default=45, help="TTL حافظه نهان اسنپ‌شات بازار (ثانیه)")
    ap.add_argument("--no-upstream", action="store_true", help="فقط استاتیک؛ داده از اسنپ‌شات آفلاین مرورگر")
    ap.add_argument("--root", default=str(ROOT), help="پوشه‌ای که فایل‌های استاتیک از آن سرو می‌شود")
    args = ap.parse_args()

    root = Path(args.root).resolve()
    handler = functools.partial(Handler, directory=str(root))
    httpd = ThreadingHTTPServer((args.host, args.port), handler)
    httpd.ttl_market = args.ttl          # type: ignore[attr-defined]
    httpd.no_upstream = args.no_upstream  # type: ignore[attr-defined]
    httpd.daemon_threads = True

    print(f"\n  تابلورادار · http://localhost:{args.port}  (ریشه: {root})")
    for ip in lan_ips():
        print(f"  شبکه محلی      · http://{ip}:{args.port}")
    print(f"  پروکسی داده    · /api/market /api/history /api/info/<insCode> /api/health")
    print(f"  کلید BrsApi    · {'از محیط خوانده شد' if os.environ.get('BRS_API_KEY') else 'تنظیم نشده (BRS_API_KEY)'}")
    print(f"  حالت آفلاین    · {'فعال' if args.no_upstream else 'غیرفعال'}")
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
