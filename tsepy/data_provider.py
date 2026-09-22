"""data_provider.py — دریافت و نرمال‌سازی داده TSETMC / BrsApi (کتابخانه استاندارد).

خروجی: فهرست `Instrument` با فیلدهای یکنواخت (قیمت‌ها به ریال).
در نبود شبکه، اسنپ‌شات آفلاین برچسب‌دار خوانده می‌شود و `live=False` بازمی‌گردد.
"""
from __future__ import annotations

import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Iterable

from . import config as C

UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) TabloRadar/3.0 (+https://tabloradar.ir)",
      "Accept": "application/json,*/*"}


# ───────────────────────── نرمال‌سازی مقدار ─────────────────────────
def to_num(v: Any) -> float:
    if v is None or v == "":
        return float("nan")
    if isinstance(v, bool):
        return float("nan")
    if isinstance(v, (int, float)):
        return float(v)
    s = re.sub(r"[,٬\s]", "", str(v))
    try:
        return float(s)
    except ValueError:
        return float("nan")


def pick(raw: dict, keys: Iterable[str]) -> float | str | None:
    for k in keys:
        v = raw.get(k)
        if v not in (None, ""):
            return v
    return None


def num_pick(raw: dict, keys: Iterable[str]) -> float:
    v = pick(raw, keys)
    return to_num(v) if v is not None else float("nan")


# ───────────────────────── طبقه‌بندی ابزار/بازار ─────────────────────────
def classify_kind(raw: dict) -> str:
    text = " ".join(str(raw.get(k) or "") for k in ("l18", "symbol", "l30", "name", "cs", "sector"))
    cid = int(to_num(pick(raw, ["cs_id", "cSecVal", "sectorId"])) or 0)
    if "شاخص" in text or cid in (68, 69):
        return "index"
    l30 = str(raw.get("l30") or raw.get("name") or "")
    l18 = str(raw.get("l18") or raw.get("symbol") or "")
    if re.search(r"حق\s*تقدم", l30) or re.search(r"[-_.]ح$", l18):
        return "right"
    if re.search(r"گواهی سپرده|اخزا|اسناد خزانه|صکوک|اوراق|تسهیلات مسکن|مرابحه|اجاره", text):
        return "bond"
    if re.search(r"طلا|سکه|شمش", text) and "صندوق" in text:
        return "fund_gold"
    if "صندوق" in text:
        return "fund_fixed" if re.search(r"درآمد ثابت|درآمدْ ثابت|سپرده|کیان|اعتماد|آفرین|نگین|افران|سرو|گنجینه", text) else "fund_equity"
    if re.search(r"آتی|اختیار", text):
        return "other"
    return "stock"


def classify_market(raw: dict) -> tuple[str, str, str | None]:
    txt = " ".join(str(raw.get(k) or "") for k in ("cgrValCotTitle", "board", "market", "flowTitle"))
    if "پایه" in txt:
        for color, kind in (("قرمز", "base_red"), ("نارنجی", "base_orange"), ("زرد", "base_yellow")):
            if color in txt:
                return "پایه", color, kind
        return "پایه", "زرد", "base_yellow"
    if "فرابورس" in txt:
        return ("فرابورس", "بازار دوم", None) if "بازار دوم" in txt else ("فرابورس", "بازار اول", None)
    if "بورس" in txt:
        return ("بورس", "بازار دوم", None) if "بازار دوم" in txt else ("بورس", "بازار اول", None)
    return "نامشخص", "—", None


def limit_pct(inst: "Instrument") -> float:
    """آستانه مجاز از داده تابلو ارجح‌تر از پیش‌فرض نوع ابزار است."""
    if inst.pc and inst.tmax == inst.tmax and inst.tmin == inst.tmin and inst.pc > 0:
        up = (inst.tmax - inst.pc) / inst.pc
        if up > 0.0005:
            return up
    return C.PRICE_LIMITS.get(inst.kind, C.DEFAULT_LIMIT)


# ───────────────────────── مدل Instrument ─────────────────────────
@dataclass
class Instrument:
    ins_code: str = ""
    l18: str = ""
    l30: str = ""
    isin: str = ""
    sector: str = "—"
    sector_id: float = float("nan")
    kind: str = "stock"
    market: str = "نامشخص"
    board: str = "—"

    py: float = float("nan"); pc: float = float("nan"); pl: float = float("nan")
    pf: float = float("nan"); pmin: float = float("nan"); pmax: float = float("nan")
    tmin: float = float("nan"); tmax: float = float("nan")

    tvol: float = float("nan"); tval: float = float("nan"); tno: float = float("nan")
    avg_val: float = float("nan"); base_vol: float = 1.0

    shares: float = float("nan"); eps: float = float("nan"); pe: float = float("nan")
    sector_pe: float = float("nan"); free_float: float = float("nan")
    market_value: float = float("nan")

    buy_i_count: float = float("nan"); buy_i_vol: float = float("nan")
    buy_n_count: float = float("nan"); buy_n_vol: float = float("nan")
    sell_i_count: float = float("nan"); sell_i_vol: float = float("nan")
    sell_n_count: float = float("nan"); sell_n_vol: float = float("nan")

    book: list[dict] = field(default_factory=list)
    state: str = ""
    halted: bool = False
    history: list[dict] = field(default_factory=list)
    provenance: str = "live"

    def as_dict(self) -> dict:
        return asdict(self)


def expand_history(h: Any) -> list[dict]:
    if not h:
        return []
    if isinstance(h, list):
        return [b for b in h if isinstance(b, dict) and to_num(b.get("c")) == to_num(b.get("c"))]
    if isinstance(h, dict) and isinstance(h.get("c"), list):
        vols = h.get("v") or []
        hs, ls, os_ = h.get("h") or [], h.get("l") or [], h.get("o") or []
        out = []
        for i, close in enumerate(h["c"]):
            c = to_num(close)
            if c != c or c <= 0:
                continue
            bar = {"d": i + 1, "c": c, "v": to_num(vols[i]) if i < len(vols) else float("nan")}
            if hs and os_ and ls:
                bar.update({"h": to_num(hs[i]), "l": to_num(ls[i]), "o": to_num(os_[i])})
            out.append(bar)
        return out
    return []


def normalize(raw: dict) -> Instrument:
    """یک رکورد خام (BrsApi/TSETMC/اسنپ‌شات) → Instrument."""
    inst = Instrument()
    inst.ins_code = str(pick(raw, ["insCode", "id", "insCode"]) or "")
    inst.l18 = str(pick(raw, ["l18", "symbol", "lVal18AFC"]) or "").strip()
    inst.l30 = str(pick(raw, ["l30", "name", "lVal30"]) or "").strip()
    inst.isin = str(pick(raw, ["cIsin", "isin"]) or "")
    inst.sector = str(pick(raw, ["cs", "sector", "lSecVal"]) or "—")
    inst.sector_id = num_pick(raw, ["cs_id", "cSecVal", "sectorId"])
    inst.kind = classify_kind(raw)
    inst.market, inst.board, base_kind = classify_market(raw)
    if base_kind and inst.kind == "stock":
        inst.kind = base_kind

    inst.py = num_pick(raw, ["py", "priceYesterday"])
    inst.pc = num_pick(raw, ["pc", "pClosing"])
    inst.pl = num_pick(raw, ["pl", "pDrCotVal", "lastPrice"])
    inst.pf = num_pick(raw, ["pf", "priceFirst"])
    inst.pmin = num_pick(raw, ["pmin", "priceMin"])
    inst.pmax = num_pick(raw, ["pmax", "priceMax"])
    inst.tmin = num_pick(raw, ["tmin", "psGelStaMin"])
    inst.tmax = num_pick(raw, ["tmax", "psGelStaMax"])

    inst.tvol = num_pick(raw, ["tvol", "qTotCap"])
    inst.tval = num_pick(raw, ["tval", "qTotTran5J"])
    inst.tno = num_pick(raw, ["tno", "zTotTran"])
    inst.avg_val = num_pick(raw, ["qTotTran5JAvg", "avgVal", "avgValue"])
    inst.base_vol = num_pick(raw, ["bvol", "baseVol"]) or 1.0

    inst.shares = num_pick(raw, ["zTitad", "z", "totalShares"])
    inst.eps = num_pick(raw, ["eps", "epsValue"])
    inst.pe = num_pick(raw, ["pe", "PE"])
    inst.sector_pe = num_pick(raw, ["sectorPE"])
    inst.free_float = num_pick(raw, ["kAjCapValCpsIdx", "freeFloat", "float"])
    inst.market_value = num_pick(raw, ["mv", "marketValue"])

    inst.buy_i_count = num_pick(raw, ["Buy_CountI", "Buy_I_Count"])
    inst.buy_i_vol = num_pick(raw, ["Buy_I_Volume"])
    inst.buy_n_count = num_pick(raw, ["Buy_CountN", "Buy_N_Count"])
    inst.buy_n_vol = num_pick(raw, ["Buy_N_Volume"])
    inst.sell_i_count = num_pick(raw, ["Sell_CountI", "Sell_I_Count"])
    inst.sell_i_vol = num_pick(raw, ["Sell_I_Volume"])
    inst.sell_n_count = num_pick(raw, ["Sell_CountN", "Sell_N_Count"])
    inst.sell_n_vol = num_pick(raw, ["Sell_N_Volume"])

    levels = []
    for i in range(1, 6):
        bid = {"q": num_pick(raw, [f"qd{i}"]), "p": num_pick(raw, [f"pd{i}"]), "n": num_pick(raw, [f"zd{i}"])}
        ask = {"q": num_pick(raw, [f"qo{i}"]), "p": num_pick(raw, [f"po{i}"]), "n": num_pick(raw, [f"zo{i}"])}
        if any(v == v for v in (bid["q"], bid["p"], ask["q"], ask["p"])):
            levels.append({"i": i, "bid": bid, "ask": ask})
    inst.book = levels

    inst.state = str(pick(raw, ["state", "cEtavalTitle"]) or "").strip()
    inst.halted = bool(re.search(r"توقف|ناظر|ممنوع", inst.state))
    inst.history = expand_history(raw.get("history") or raw.get("_hist"))
    inst.provenance = str(pick(raw, ["provenance"]) or "live")

    if inst.pc != inst.pc:
        inst.pc = inst.py if inst.py == inst.py else inst.pl
    if inst.pl != inst.pl:
        inst.pl = inst.pc
    L = limit_pct(inst)
    if inst.tmax != inst.tmax and inst.pc == inst.pc:
        inst.tmax = round(inst.pc * (1 + L))
    if inst.tmin != inst.tmin and inst.pc == inst.pc:
        inst.tmin = round(inst.pc * (1 - L))
    if inst.market_value != inst.market_value and inst.shares == inst.shares and inst.pl == inst.pl:
        inst.market_value = inst.shares * inst.pl
    return inst


def normalize_all(rows: list[dict]) -> list[Instrument]:
    out = []
    for r in rows or []:
        if not r:
            continue
        inst = normalize(r)
        if not inst.l18 or inst.pl != inst.pl or inst.pl <= 0:
            continue
        out.append(inst)
    return out


# ───────────────────────── دریافت از شبکه ─────────────────────────
def http_get(url: str, timeout: float = C.HTTP_TIMEOUT) -> str:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as res:  # noqa: S310
        return res.read().decode("utf-8", "replace")


def with_retries(make_urls, log=print):
    """هر منبع را تا C.HTTP_RETRIES بار با وقفه نمایی امتحان می‌کند."""
    err = ""
    for attempt in range(C.HTTP_RETRIES):
        for label, url in make_urls():
            try:
                body = http_get(url)
                if body.strip():
                    return body, label
            except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError) as e:
                err = f"{label}:{type(e).__name__}"
        if attempt < C.HTTP_RETRIES - 1:
            wait = C.BACKOFF_BASE * (2 ** attempt)
            log(f"  ↻ تلاش ناموفق ({err}) — مکث {wait:.1f}s")
            time.sleep(wait)
    raise RuntimeError(err or "عدم دسترسی به منبع داده")


def extract_array(body: str) -> list[dict]:
    try:
        data = json.loads(body)
    except json.JSONDecodeError:
        m = re.search(r"instrumentList\s*=\s*(\[.*?\])\s*;", body, re.S)
        if not m:
            return []
        data = json.loads(m.group(1))
    if isinstance(data, dict):
        for k in ("data", "result", "rows", "InstrumentInfo", "instrumentList"):
            if isinstance(data.get(k), list):
                data = data[k]
                break
    return [r for r in data if isinstance(r, dict)] if isinstance(data, list) else []


def fetch_snapshot(log=print, offline_fallback: bool = True) -> tuple[list[dict], str, bool]:
    """(رکوردهای خام، نام منبع، زنده بودن)"""
    def urls():
        pairs = []
        if C.BRS_API_KEY:
            pairs.append(("BrsApi", C.MARKET_URL.format(key=urllib.parse.quote(C.BRS_API_KEY))))
            pairs.append(("BrsApi-alt", f"{C.BRS_API_ALT}AllSymbols.php?key={urllib.parse.quote(C.BRS_API_KEY)}&type=1"))
        pairs.append(("TSETMC", f"{C.TSETMC_LEGACY}instinfodata.aspx?t=PhantomTopsSet"))
        return pairs

    if C.BRS_API_KEY or True:
        try:
            body, src = with_retries(urls, log=log)
            rows = extract_array(body)
            if len(rows) > 30:
                return rows, src, True
            log("  ⚠ پاسخ کوتاه بود؛ به اسنپ‌شات آفلاین می‌رویم")
        except Exception as e:  # noqa: BLE001
            log(f"  ⚠ منبع زنده در دسترس نبود: {e}")
    if offline_fallback:
        return load_offline()
    raise RuntimeError("هیچ منبعی در دسترس نیست")


def load_offline(path: str | None = None) -> tuple[list[dict], str, bool]:
    p = Path(path or C.OFFLINE_SNAPSHOT)
    if not p.is_absolute():
        p = Path(__file__).resolve().parents[1] / p
    data = json.loads(p.read_text(encoding="utf-8"))
    rows = data.get("instruments", [])
    for r in rows:
        r.setdefault("provenance", "offline")
    return rows, f"offline:{p.name} ({data.get('as_of', '?')})", False


def fetch_history(l18: str, days: int = 260, log=print) -> list[dict]:
    """تاریخچه کندلی (بسته‌های واقعی) برای اندیکاتورها؛ در خطا فهرست خالی."""
    if not C.BRS_API_KEY:
        return []
    def urls():
        return [("BrsApi-history", C.HISTORY_URL.format(key=urllib.parse.quote(C.BRS_API_KEY), l18=urllib.parse.quote(l18)))]
    try:
        body, _ = with_retries(urls, log=lambda *_: None)
        data = json.loads(body)
        arr = data.get("history") or data.get("data") or data
        out = []
        for row in arr if isinstance(arr, list) else []:
            c = to_num(row.get("pc") or row.get("c") or row.get("pClosing"))
            if c != c or c <= 0:
                continue
            out.append({"d": to_num(row.get("d") or row.get("xDate") or len(out) + 1), "c": c,
                        "v": to_num(row.get("vol") or row.get("qTotCap") or row.get("v")),
                        "h": to_num(row.get("h") or row.get("priceMax")),
                        "l": to_num(row.get("l") or row.get("priceMin")),
                        "o": to_num(row.get("o") or row.get("priceFirst"))})
        out.sort(key=lambda b: b["d"] if b["d"] == b["d"] else 0)
        return out
    except Exception as e:  # noqa: BLE001
        log(f"  · تاریخچه {l18} دریافت نشد ({type(e).__name__})")
        return []
