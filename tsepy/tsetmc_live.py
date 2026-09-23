"""tsetmc_live.py — کلاینت زندهٔ TSETMC (کتابخانهٔ استاندارد پایتون، بدون وابستگی)

این ماژول **دادهٔ واقعی** بازار را از سرویس‌های عمومی رسمی TSETMC می‌خواند؛ هیچ عددی
ساخته نمی‌شود. قالب هر endpoint بر پایهٔ قرارداد مستندشدهٔ همان سرویس پارس می‌شود:

  old.tsetmc.com/tsev2/data/MarketWatchInit.aspx?h=0&r=0
      پاسخ: «پیام‌ها@وضعیت‌بازار@سطرهای‌قیمت@سطرهای‌دفتر‌سفارش@refid»
      سطرهای قیمت (با , و ;): ins_code,isin,l18,l30,heven,pf,pc,pl,tno,tvol,tval,
          pmin,pmax,py,eps,bvol,visitcount,flow,cs,tmax,tmin,z,yval,predtran,buyop
      سطرهای دفتر سفارش: ins_code,number,zo,zd,pd,po,qd,qo   (number = عمق ۱..۵)
  old.tsetmc.com/tsev2/data/ClientTypeAll.aspx
      ins_code,n_buy_count,l_buy_count,n_buy_vol,l_buy_vol,
              n_sell_count,l_sell_count,n_sell_vol,l_sell_vol
      (n_ = حقیقی، l_ = حقوقی)
  old.tsetmc.com/tsev2/data/ClosingPriceAll.aspx
      ins_code,n,pc,pl,tno,tvol,tval,pmin,pmax,py,pf      (n = شمارهٔ جلسه)
  members.tsetmc.com/tsev2/chart/data/Financial.aspx?i=<insCode>&t=ph&a=1
      date,pmax,pmin,pf,pl,tvol,pc                            (تاریخچهٔ تعدیل‌شده)
  cdn.tsetmc.com/api/Instrument/GetInstrumentInfo/<insCode>
      شناسنامهٔ نماد (تابلو/صنعت/EPS و…) — چند کلید به‌صورت دفاعی خوانده می‌شود.

وضعیت بازار (شاخص کل، ارزش/حجم معاملات) هم از همان پاسخ MarketWatchInit استخراج می‌شود:
«datetime,tse_status,tse_index,tse_index_change,tse_value,tse_tvol,tse_tval,tse_tno,
  fb_status,fb_tvol,fb_tval,fb_tno,derivatives_status,…,»
"""
from __future__ import annotations

import json
import re
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Iterable

LEGACY = "https://old.tsetmc.com/tsev2/data/"
CDN = "https://cdn.tsetmc.com/api/"
CHART = "https://members.tsetmc.com/tsev2/chart/data/Financial.aspx"
UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/124.0 Safari/537.36 TabloRadar/3.2")
TIMEOUT = 15.0

# ستون‌های سطر قیمت در MarketWatchInit (ترتیب قراردادی سرویس؛ اگر ستون‌های انتهایی
# کمتر بود، فقط همان تعداد نگاشت می‌شود).
PRICE_COLS = ("insCode", "isin", "l18", "l30", "heven", "pf", "pc", "pl", "tno", "tvol",
              "tval", "pmin", "pmax", "py", "eps", "bvol", "visitcount", "flow", "cs",
              "tmax", "tmin", "z", "yval", "predtran", "buyop")

# نگاشت flow → بازار/تابلو (منبع: مستندات فیلترنویسی TSETMC)
FLOW_MARKET = {
    0: ("عمومی", "—"),
    1: ("بورس", "بازار اول"),
    2: ("فرابورس", "بازار اول"),
    3: ("مشتقه", "—"),
    4: ("پایه", "زرد"),
    5: ("پایه", "زرد"),
    6: ("بورس انرژی", "—"),
    7: ("بورس کالا", "—"),
}

_FA = re.compile(r"[۰-۹]")
_AR = re.compile(r"[٠-٩]")


def to_num(v: Any) -> float:
    """تبدیل امن به عدد؛ مقدار نامعتبر → NaN (هیچ‌وقت صفر ساختگی نمی‌سازیم)."""
    if v is None or v == "" or isinstance(v, bool):
        return float("nan")
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip()
    s = _FA.sub(lambda m: str("۰۱۲۳۴۵۶۷۸۹".index(m.group())), s)
    s = _AR.sub(lambda m: str("٠١٢٣٤٥٦٧٨٩".index(m.group())), s)
    s = re.sub(r"[,\s٬]", "", s)
    if s in ("", "-", "—"):
        return float("nan")
    try:
        return float(s)
    except ValueError:
        return float("nan")


def _clean(v: Any) -> Any:
    if isinstance(v, str):
        v = v.strip()
        return v if v else None
    return v


def http_get(url: str, timeout: float = TIMEOUT, *, referer: str = "https://old.tsetmc.com/") -> str:
    req = urllib.request.Request(url, headers={
        "User-Agent": UA,
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "fa-IR,fa;q=0.9,en;q=0.6",
        "Referer": referer,
    })
    with urllib.request.urlopen(req, timeout=timeout) as res:  # noqa: S310 (URL از پیکربندی)
        return res.read().decode("utf-8", "replace")


def _rows(text: str, sep: str, ncols: int, splitter: str = ";") -> list[list[str]]:
    """سطرهای «فشرده» TSETMC را به سطرهای هم‌عرض تبدیل می‌کند.

    TSETMC در برخی پاسخ‌ها شناسهٔ تکراری را حذف می‌کند (سطر کوتاه‌تر)؛ آن‌جا شناسهٔ
    سطر قبل بازاستفاده می‌شود — همان قراردادی که کلاینت‌های رسمی به‌کار می‌برند.
    """
    out: list[list[str]] = []
    last_id: str | None = None
    for chunk in text.split(splitter):
        items = [c for c in chunk.split(sep)]
        if not any(items):
            continue
        if len(items) < ncols and last_id is not None:
            items = [last_id, *items]
        if len(items) > ncols:
            items = items[:ncols]
        if not items or not items[0]:
            continue
        last_id = items[0]
        out.append(items)
    return out


# ─────────────────────────── اسنپ‌شات کل بازار ───────────────────────────

def market_watch_init(timeout: float = TIMEOUT) -> dict:
    """قیمت‌ها + دفتر سفارش ۵ سطحی + وضعیت بازار، همه در یک درخواست واقعی."""
    text = http_get(f"{LEGACY}MarketWatchInit.aspx?h=0&r=0", timeout)
    parts = text.split("@")
    if len(parts) < 5:
        raise RuntimeError(f"قالب پاسخ MarketWatchInit ناشناخته بود ({len(parts)} بخش)")
    messages, state_raw, prices_csv, limits_csv, refid = parts[:5]

    prices: list[dict] = []
    for items in _rows(prices_csv, ",", len(PRICE_COLS)):
        row = {PRICE_COLS[i]: _clean(items[i]) for i in range(min(len(items), len(PRICE_COLS)))}
        code = row.get("insCode")
        if not code:
            continue
        row["insCode"] = str(code)
        prices.append(row)

    limits: dict[str, dict[int, dict]] = {}
    for items in _rows(limits_csv, ",", 8):
        code = str(items[0] or "")
        depth = int(to_num(items[1]) or 0)
        if not code or not 1 <= depth <= 5:
            continue
        limits.setdefault(code, {})[depth] = {
            "zo": to_num(items[2]), "zd": to_num(items[3]),
            "pd": to_num(items[4]), "po": to_num(items[5]),
            "qd": to_num(items[6]), "qo": to_num(items[7]),
        }

    return {
        "messages": messages,
        "market_state": parse_market_state(state_raw),
        "refid": to_num(refid),
        "prices": prices,
        "limits": limits,
    }


def parse_market_state(raw: str) -> dict:
    """وضعیت بازار: شاخص کل، تغییر، ارزش/حجم/تعداد معاملات بورس و فرابورس."""
    if not raw or raw.count(",") < 10:
        return {}
    f = raw.split(",")
    dt = parse_state_datetime(f[0])
    return {
        "datetime_raw": f[0],
        "datetime_jalali": dt.get("jalali"),
        "datetime_time": dt.get("time"),
        "tse_status": f[1],
        "index_total": to_num(f[2]),
        "index_change": parse_change(f[3])[0],
        "index_change_pct": parse_change(f[3])[1],
        "market_value_cap": to_num(f[4]),
        "tse_volume": to_num(f[5]),
        "tse_value": to_num(f[6]),
        "tse_trades": to_num(f[7]),
        "fara_status": f[8] if len(f) > 8 else None,
        "fara_volume": to_num(f[9]) if len(f) > 9 else float("nan"),
        "fara_value": to_num(f[10]) if len(f) > 10 else float("nan"),
        "fara_trades": to_num(f[11]) if len(f) > 11 else float("nan"),
    }


def parse_state_datetime(field: str) -> dict:
    """تاریخ/ساعت وضعیت بازار با هر دو قالب رایج: «YY/MM/DD HH:MM:SS» و «YYYYMMDD».

    خروجی فقط برای نمایش است (`as_of`)؛ مقدار خام هم همیشه حفظ می‌شود.
    """
    if not field:
        return {}
    m = re.fullmatch(r"(\d{4})(\d{2})(\d{2})", field.strip())
    if m:
        return {"jalali": f"{m.group(1)}-{m.group(2)}-{m.group(3)}", "time": None}
    m = re.search(r"(\d{1,2})/(\d{1,2})/(\d{4})(?:[ T](\d{2}:\d{2}(?::\d{2})?))?", field)
    if m:                                   # dd/mm/yyyy (یا mm/dd/yyyy)
        a, b, y, t = m.groups()
        mo, d = int(a), int(b)
        if mo > 12:
            mo, d = d, mo
        return {"jalali": f"{int(y):04d}-{mo:02d}-{d:02d}", "time": t}
    m = re.search(r"(\d{2})/(\d{1,2})/(\d{1,2})(?:[ T](\d{2}:\d{2}(?::\d{2})?))?", field)
    if m:                                   # yy/mm/dd  (yy = 1400+yy)
        yy, mo, d, t = m.groups()
        y, mo, d = 1400 + int(yy), int(mo), int(d)
        if mo > 12:                          # در صورت جابه‌جایی قرارداد
            mo, d = d, mo
        return {"jalali": f"{y:04d}-{mo:02d}-{d:02d}", "time": t}
    return {}


def parse_change(field: str) -> tuple[float, float]:
    """تغییر شاخص از رشته‌هایی مثل «(113024)-1.5524%» یا «-113024 -1.55%».

    قرارداد TSETMC: مقدار منفی داخل پرانتز یا با علامت منفی می‌آید.
    """
    if not field:
        return float("nan"), float("nan")
    delta = float("nan")
    neg = False
    m = re.search(r"\(([\d,.]+)\)", field)          # داخل پرانتز ⇒ منفی
    if m:
        delta, neg = to_num(m.group(1)), True
    else:
        m2 = re.search(r"-?[\d,.]+", field)
        if m2:
            delta = to_num(m2.group(0))
            neg = delta == delta and delta < 0
    if delta == delta:
        delta = -abs(delta) if neg else abs(delta)
    mp = re.search(r"(-?[\d.]+)\s*%", field)
    return delta, (to_num(mp.group(1)) if mp else float("nan"))


def client_type_all(timeout: float = TIMEOUT) -> dict[str, dict]:
    """حقیقی/حقوقی کل بازار (حجم و تعداد خرید/فروش) — یک درخواست، همهٔ نمادها."""
    text = http_get(f"{LEGACY}ClientTypeAll.aspx", timeout)
    cols = ("insCode", "n_buy_count", "l_buy_count", "n_buy_vol", "l_buy_vol",
            "n_sell_count", "l_sell_count", "n_sell_vol", "l_sell_vol")
    out: dict[str, dict] = {}
    for items in _rows(text, ",", len(cols)):
        if len(items) < len(cols):
            continue
        row = {cols[i]: to_num(items[i]) for i in range(len(cols))}
        out[str(items[0])] = row
    return out


def closing_price_all(timeout: float = TIMEOUT) -> dict[str, list[dict]]:
    """تاریخچهٔ فشردهٔ همهٔ نمادها: insCode,n,pc,pl,tno,tvol,tval,pmin,pmax,py,pf."""
    text = http_get(f"{LEGACY}ClosingPriceAll.aspx", timeout)
    cols = ("insCode", "n", "pc", "pl", "tno", "tvol", "tval", "pmin", "pmax", "py", "pf")
    out: dict[str, list[dict]] = {}
    for items in _rows(text, ",", len(cols)):
        if len(items) < len(cols):
            continue
        code = str(items[0])
        rec = {cols[i]: to_num(items[i]) for i in range(1, len(cols))}
        out.setdefault(code, []).append(rec)
    return out


def daily_history(ins_code: str, days: int = 260, timeout: float = TIMEOUT) -> list[dict]:
    """تاریخچهٔ روزانهٔ تعدیل‌شده از chart/Financial → کندل‌های استاندارد تابلورادار."""
    url = f"{CHART}?i={urllib.parse.quote(str(ins_code))}&t=ph&a=1"
    text = http_get(url, timeout, referer="https://members.tsetmc.com/")
    bars: list[dict] = []
    for chunk in text.split(";"):
        items = [c for c in chunk.split(",") if c != ""]
        if len(items) < 7:
            continue
        d, pmax, pmin, pf, pl, tvol, pc = (to_num(x) for x in items[:7])
        close = pc if pc == pc and pc > 0 else pl
        if close != close or close <= 0:
            continue
        bars.append({"d": d, "o": pf, "h": pmax, "l": pmin, "c": close, "v": tvol})
    bars.sort(key=lambda b: b["d"])
    return bars[-days:] if days and days > 0 else bars


def cdn_daily_history(ins_code: str, days: int = 260, timeout: float = TIMEOUT) -> list[dict]:
    """OHLCV خام CDN؛ روزهای بدون معامله حذف و ترتیب زمانی صعودی می‌شود."""
    body = http_get(
        f"{CDN}ClosingPrice/GetClosingPriceDailyList/{urllib.parse.quote(str(ins_code))}/{int(days)}",
        timeout, referer="https://cdn.tsetmc.com/")
    js = json.loads(body)
    rows = js.get("closingPriceDaily") if isinstance(js, dict) else None
    if not isinstance(rows, list):
        raise ValueError("closingPriceDaily در پاسخ CDN نیست")
    bars = []
    for r in rows:
        d, o, h, l, c = (to_num(r.get(k)) for k in
                          ("dEven", "priceFirst", "priceMax", "priceMin", "pClosing"))
        volume, value, trades = (to_num(r.get(k)) for k in ("qTotTran5J", "qTotCap", "zTotTran"))
        if not all(x == x and x > 0 for x in (d, o, h, l, c, volume, value, trades)):
            continue
        bars.append({"d": d, "o": o, "h": h, "l": l, "c": c, "v": volume,
                     "val": value, "last": to_num(r.get("pDrCotVal")), "trades": trades,
                     "raw": True})
    bars.sort(key=lambda b: b["d"])
    return bars[-days:] if days > 0 else bars


def best_limits(ins_code: str, timeout: float = TIMEOUT) -> list[dict]:
    """پنج سطح سفارش CDN به مدل یکنواخت bid/ask؛ دادهٔ ناقص حدس زده نمی‌شود."""
    body = http_get(f"{CDN}BestLimits/{urllib.parse.quote(str(ins_code))}",
                    timeout, referer="https://cdn.tsetmc.com/")
    js = json.loads(body)
    rows = js.get("bestLimits") if isinstance(js, dict) else None
    if not isinstance(rows, list):
        raise ValueError("bestLimits در پاسخ CDN نیست")
    out = []
    for r in rows:
        level = int(to_num(r.get("number"))) if to_num(r.get("number")) == to_num(r.get("number")) else 0
        if not 1 <= level <= 5:
            continue
        out.append({"i": level,
                    "bid": {"q": to_num(r.get("qTitMeDem")), "p": to_num(r.get("pMeDem")),
                            "n": to_num(r.get("zOrdMeDem"))},
                    "ask": {"q": to_num(r.get("qTitMeOf")), "p": to_num(r.get("pMeOf")),
                            "n": to_num(r.get("zOrdMeOf"))}})
    return sorted(out, key=lambda x: x["i"])


def instrument_info(ins_code: str, timeout: float = TIMEOUT) -> dict | None:
    """شناسنامهٔ نماد از API جدید TSETMC (کلیدها به‌صورت دفاعی خوانده می‌شوند)."""
    try:
        body = http_get(f"{CDN}Instrument/GetInstrumentInfo/{urllib.parse.quote(str(ins_code))}",
                        timeout, referer="https://cdn.tsetmc.com/")
        js = json.loads(body)
    except (urllib.error.URLError, ValueError, OSError, TimeoutError):
        return None
    info = js.get("instrumentInfo") if isinstance(js, dict) else None
    if not isinstance(info, dict):
        return None
    sector, eps, threshold = info.get("sector") or {}, info.get("eps") or {}, info.get("staticThreshold") or {}
    eps_value = eps.get("epsValue") if isinstance(eps, dict) else eps
    estimated = eps.get("estimatedEPS") if isinstance(eps, dict) else None
    return {
        "insCode": str(info.get("insCode") or ins_code),
        "l18": info.get("lVal18AFC") or info.get("l18"), "l30": info.get("lVal30") or info.get("l30"),
        "isin": info.get("cIsin"), "cs": sector.get("lSecVal") or sector.get("cSecVal"),
        "cs_id": to_num(str(sector.get("cSecVal") or "").strip()), "flow": info.get("flow"),
        "flowTitle": info.get("flowTitle"), "cgrValCotTitle": info.get("cgrValCotTitle"),
        "board": info.get("cgrValCotTitle"),
        # epsValue تهی است؛ estimatedEPS با برچسب مستقل نگه داشته می‌شود و جای EPS قطعی جا نمی‌زند.
        "eps": to_num(eps_value), "eps_estimated": to_num(estimated),
        "sectorPE": to_num(eps.get("sectorPE") if isinstance(eps, dict) else None),
        "psr": to_num(eps.get("psr") if isinstance(eps, dict) else info.get("psr")),
        "tmax": to_num(threshold.get("psGelStaMax")), "tmin": to_num(threshold.get("psGelStaMin")),
        "nav": to_num(info.get("nav")), "baseVol": to_num(info.get("baseVol")),
        "zTitad": to_num(info.get("zTitad")), "freeFloat": to_num(info.get("kAjCapValCpsIdx")),
        "avgVal": to_num(info.get("qTotTran5JAvg")), "minWeek": to_num(info.get("minWeek")),
        "maxWeek": to_num(info.get("maxWeek")), "minYear": to_num(info.get("minYear")),
        "maxYear": to_num(info.get("maxYear")), "dEven": to_num(info.get("dEven")),
        "_raw_keys": sorted(info.keys())[:40],
    }


# ─────────────────────────── ساخت رکورد یکنواخت ───────────────────────────

def merge_instrument(price: dict, limits: dict[int, dict] | None = None,
                     client: dict | None = None, info: dict | None = None) -> dict:
    """(قیمت + دفتر سفارش + حقیقی/حقوقی + شناسنامه) → رکورد یکنواخت تابلورادار.

    همهٔ قیمت‌ها ریال‌اند و **هیچ فیلدی مقدار ساختگی نمی‌گیرد**؛ نبودِ داده یعنی
    کلید غایب/تهی تا موتور، اطمینان را پایین بیاورد نه اینکه عدد جعل کند.
    """
    out: dict[str, Any] = {}

    def put(key: str, val: Any, *, keep_zero: bool = False) -> None:
        if val is None:
            return
        if isinstance(val, float) and val != val:      # NaN
            return
        if val == "" and not keep_zero:
            return
        out[key] = val

    flow_raw = to_num(price.get("flow"))
    flow = int(flow_raw) if flow_raw == flow_raw else 0
    market, board = FLOW_MARKET.get(flow, ("نامشخص", "—"))

    put("insCode", str(price.get("insCode") or ""))
    put("l18", price.get("l18"))
    put("l30", price.get("l30"))
    put("isin", price.get("isin"))
    put("cs_id", to_num(price.get("cs")))
    put("flowTitle", f"بازار {market}" if market in ("بورس", "فرابورس") else market)
    put("cgrValCotTitle", board)
    put("market", market)
    put("board", board)

    for src, dst in (("py", "py"), ("pc", "pc"), ("pl", "pl"), ("pf", "pf"),
                     ("pmin", "pmin"), ("pmax", "pmax"), ("tmax", "tmax"), ("tmin", "tmin"),
                     ("tvol", "tvol"), ("tval", "tval"), ("tno", "tno"),
                     ("eps", "eps"), ("bvol", "bvol"), ("z", "zTitad")):
        put(dst, to_num(price.get(src)))

    pe = _safe_div(to_num(price.get("pc")), to_num(price.get("eps")))
    if pe == pe and pe > 0:
        put("pe", round(pe, 2))

    if limits:
        for depth, lv in sorted(limits.items()):
            for k in ("pd", "qd", "zd", "po", "qo", "zo"):
                put(f"{k}{depth}", lv.get(k))

    if client:
        # n_ = حقیقی (I) ، l_ = حقوقی (N) — همان نام‌گذاری BrsApi که موتور می‌شناسد
        put("Buy_CountI", client.get("n_buy_count"), keep_zero=True)
        put("Buy_I_Volume", client.get("n_buy_vol"), keep_zero=True)
        put("Buy_CountN", client.get("l_buy_count"), keep_zero=True)
        put("Buy_N_Volume", client.get("l_buy_vol"), keep_zero=True)
        put("Sell_CountI", client.get("n_sell_count"), keep_zero=True)
        put("Sell_I_Volume", client.get("n_sell_vol"), keep_zero=True)
        put("Sell_CountN", client.get("l_sell_count"), keep_zero=True)
        put("Sell_N_Volume", client.get("l_sell_vol"), keep_zero=True)

    if info:
        for k_src, k_dst in (("eps", "eps"), ("pe", "pe"), ("sectorPE", "sectorPE"),
                             ("psr", "psr"), ("nav", "nav"), ("baseVol", "bvol"),
                             ("zTitad", "zTitad"), ("freeFloat", "kAjCapValCpsIdx"),
                             ("minWeek", "minWeek"), ("maxWeek", "maxWeek"),
                             ("minYear", "minYear"), ("maxYear", "maxYear")):
            v = info.get(k_src)
            if isinstance(v, (int, float)) and v == v and v != 0 and k_dst not in out:
                put(k_dst, v)
        if info.get("cs") and "cs" not in out:
            put("cs", info["cs"])
        if info.get("cs_id") and info["cs_id"] == info["cs_id"]:
            out["cs_id"] = info["cs_id"]
        if info.get("cgrValCotTitle"):
            out["cgrValCotTitle"] = info["cgrValCotTitle"]
        if info.get("l30") and not out.get("l30"):
            out["l30"] = info["l30"]

    trades = to_num(price.get("tno"))
    out["traded"] = bool(trades == trades and trades > 0)   # نماد معامله‌نشده/متوقف
    out["provenance"] = "tsetmc"
    out["synthetic"] = False
    return out


def _safe_div(a: float, b: float) -> float:
    if a != a or b != b or b == 0:
        return float("nan")
    return a / b


def build_instruments(mw: dict, client_types: dict[str, dict] | None = None,
                      infos: dict[str, dict] | None = None) -> list[dict]:
    client_types = client_types or {}
    infos = infos or {}
    out = []
    for price in mw.get("prices", []):
        code = str(price.get("insCode") or "")
        out.append(merge_instrument(price, mw.get("limits", {}).get(code),
                                    client_types.get(code), infos.get(code)))
    return out


def market_snapshot(history_codes: Iterable[str] = (), history_days: int = 260,
                    enrich_codes: Iterable[str] = (), timeout: float = TIMEOUT) -> dict:
    """اسنپ‌شات کامل بازار از منابع واقعی + وضعیت بازار (شاخص کل/ارزش معاملات)."""
    mw = market_watch_init(timeout)
    try:
        clients = client_type_all(timeout)
    except (urllib.error.URLError, OSError, TimeoutError):
        clients = {}
    infos: dict[str, dict] = {}
    for code in enrich_codes:
        info = instrument_info(code, timeout)
        if info:
            infos[str(code)] = info
    rows = build_instruments(mw, clients, infos)
    if history_codes:
        by_code = {r["insCode"]: r for r in rows}
        for code in history_codes:
            row = by_code.get(str(code))
            if row is None:
                continue
            try:
                bars = daily_history(str(code), history_days, timeout)
            except (urllib.error.URLError, OSError, TimeoutError):
                continue
            if len(bars) >= 20:
                row["history"] = bars
    st = mw["market_state"]
    as_of = " ".join(x for x in (st.get("datetime_jalali"), st.get("datetime_time")) if x) \
        or st.get("datetime_raw") or ""
    return {
        "kind": "live",
        "source": "TSETMC (MarketWatchInit + ClientTypeAll)",
        "as_of": as_of,
        "market_state": mw["market_state"],
        "instruments": rows,
    }
