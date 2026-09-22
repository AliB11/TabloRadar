"""bourse_trader.py — خوانندهٔ دادهٔ واقعی از bourse-trader.ir (فقط کتابخانهٔ استاندارد)

صفحات عمومی سایت (بدون ورود) که این ماژول می‌خواند:

  • «/»               → نبض بازار: شاخص‌ها، ارزش بازار، ارزش معاملات خرد، صف‌ها،
                        سرانه‌های حقیقی، بیشترین ورود/خروج پول حقیقی
  • «/symbol/<نماد>»  → تابلوی کامل نماد: قیمت‌ها، حجم/ارزش/تعداد معاملات، ورود پول،
                        قدرت خرید، P/E، Group P/E، EPS، P/S، شناوری، حجم مبنا،
                        میانگین و حجم مشکوک، و دفتر سفارش ۵ سطحی

نکات پیاده‌سازی
  • واحد سایت «تومان» است؛ تابلورادار «ریال» کار می‌کند ⇒ قیمت/ارزش ×۱۰.
  • اعداد با پسوند K/M/B/T یا واژه‌های هزار/میلیون/میلیارد/همت و ارقام فارسی/عربی خوانده
    می‌شوند. «4780-» یعنی ‎−۴۷۸۰ (قرارداد سایت برای منفی).
  • هر فیلدی که مبهم باشد در `ambiguous` گزارش می‌شود و هیچ مقداری حدس زده نمی‌شود.
  • robots.txt سایت فقط Sitemap دارد؛ فاصلهٔ درخواست‌ها با MIN_INTERVAL محدود می‌شود.
"""
from __future__ import annotations

import re
import time
import urllib.parse
import urllib.request
from html.parser import HTMLParser
from typing import Any

BASE = "https://bourse-trader.ir"
UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/124.0 Safari/537.36 TabloRadar/3.2")
TIMEOUT = 15.0
MIN_INTERVAL = 0.7          # فاصلهٔ احترام‌آمیز بین درخواست‌ها (ثانیه)
CACHE_TTL = 90.0

_last_call = 0.0
_cache: dict[str, tuple[float, str]] = {}


# ─────────────────────────── شبکه ───────────────────────────

def http_get(path_or_url: str, timeout: float = TIMEOUT) -> str:
    """دریافت صفحه با محدودیت نرخ درون‌فرآیندی (مسیر نسبی → دامنهٔ بورس‌تریدر)."""
    global _last_call
    url = path_or_url if path_or_url.startswith("http") else BASE + path_or_url
    wait = MIN_INTERVAL - (time.time() - _last_call)
    if wait > 0:
        time.sleep(wait)
    req = urllib.request.Request(url, headers={
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "fa-IR,fa;q=0.9",
    })
    with urllib.request.urlopen(req, timeout=timeout) as res:  # noqa: S310
        _last_call = time.time()
        return res.read().decode("utf-8", "replace")


def page(path: str, ttl: float = CACHE_TTL) -> str:
    hit = _cache.get(path)
    if hit and time.time() - hit[0] < ttl:
        return hit[1]
    html = http_get(path)
    _cache[path] = (time.time(), html)
    return html


# ─────────────────────────── HTML → متن ───────────────────────────

class _Stripper(HTMLParser):
    """هر `</tr>` خط جدید، هر سلول با TAB و پیوند نماد به‌شکل ⟦نام⟧ (تا در متن بماند)."""

    SKIP = {"script", "style", "noscript", "svg"}
    BREAK = {"tr", "div", "p", "li", "h1", "h2", "h3", "h4", "section", "br"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self._skip = 0
        self._in_symbol_link = False

    def handle_starttag(self, tag: str, attrs) -> None:
        if tag in self.SKIP:
            self._skip += 1
            return
        if tag == "a":
            href = (dict(attrs).get("href") or "")
            self._in_symbol_link = "/symbol/" in href
        if tag in self.BREAK:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in self.SKIP:
            self._skip = max(0, self._skip - 1)
            return
        if tag in ("td", "th"):
            self.parts.append("\t")
        elif tag in self.BREAK:
            self.parts.append("\n")
        if tag == "a":
            self._in_symbol_link = False

    def handle_data(self, data: str) -> None:
        if self._skip:
            return
        text = data.strip()
        if not text:
            return
        self.parts.append(f"⟦{text}⟧ " if self._in_symbol_link else f"{text} ")


def strip_html(html: str) -> str:
    p = _Stripper()
    p.feed(html)
    text = "".join(p.parts)
    text = re.sub(r"[ \t]*\n[ \t\n]*", "\n", text)
    return re.sub(r"[ \t]{2,}", " ", text)


# ─────────────────────────── اعداد ───────────────────────────

_FA = re.compile(r"[۰-۹]")
_AR = re.compile(r"[٠-٩]")
_SUFFIX = {"k": 1e3, "m": 1e6, "b": 1e9, "t": 1e12,
           "هزار": 1e3, "میلیون": 1e6, "میلیارد": 1e9, "همت": 1e12}


def fa_digits(s: str) -> str:
    s = _FA.sub(lambda m: str("۰۱۲۳۴۵۶۷۸۹".index(m.group())), s)
    return _AR.sub(lambda m: str("٠١٢٣٤٥٦٧٨٩".index(m.group())), s)


def parse_amount(token: Any) -> float | None:
    """«1,234.5» «۳۲۳» «1.2T» «4780-» «(105.2B)» «-4.44%» → عدد؛ نامعتبر → None."""
    if token is None:
        return None
    s = fa_digits(str(token).strip()).replace("٬", ",").replace("\u200c", "").replace(" ", "")
    s = s.replace("−", "-").replace("–", "-")
    pct = bool(re.search(r"[%٪]", s))          # «(31%)» و «(53.67%)» درصدند، نه منفی
    neg = False
    if s.startswith("(") and s.endswith(")"):
        inner = s[1:-1]
        neg = (not pct) or inner.lstrip().startswith("-")
        s = inner
    if s.startswith("-"):
        neg, s = True, s[1:]
    if s.endswith("-"):
        neg, s = True, s[:-1]
    s = s.rstrip("٪%$")
    mult = 1.0
    low = s.lower()
    for suf in sorted(_SUFFIX, key=len, reverse=True):
        if low.endswith(suf.lower()) and len(s) > len(suf):
            body = s[: len(s) - len(suf)]
            if re.fullmatch(r"[\d.,]+", body):
                mult, s = _SUFFIX[suf], body
                break
    if not re.fullmatch(r"\d[\d,]*\.?\d*", s or ""):
        return None
    try:
        val = float(s.replace(",", ""))
    except ValueError:
        return None
    val *= mult
    return -val if neg else val


def _book_number(token: str) -> float | None:
    """عدد سلول دفتر سفارش؛ سلول‌های چسبیدهٔ «۳۲۲-2.1%» فقط عدد اول را می‌دهند."""
    core = fa_digits(token).replace(",", "")
    if not re.match(r"^\d", core):
        return None
    m = re.match(r"^(\d[\d.]*[KkMmBbTt]?)", core)
    return parse_amount(m.group(1)) if m else None


def tokens(text: str) -> list[str]:
    """متن → توکن‌ها (جداکننده: فاصله، TAB و «|» جدول‌ها)."""
    return [t for t in re.split(r"[\s|]+|\t+", text) if t]


_WORD_RE = re.compile(r"^[\u0600-\u06FFA-Za-zآ-ی]+$")


def find_numbers(words: list[str], label: str, *, window: int = 8, occurrences: int = 4,
                 allow_percent: bool = False, not_after: frozenset[str] = frozenset(),
                 max_word_gap: int = 0) -> list[list[float]]:
    """هر بار که «label» در متن می‌آید، اعداد بعدی (تا window توکن) را برمی‌گرداند.

    قواعد ضد‌خطا:
      • اگر توکن بعدی برچسب، «واژه» باشد آن تطبیق رد می‌شود (مثلاً «شاخص کل فرابورس»
        نباید مقدار «شاخص کل» را خراب کند).
      • توکن‌های درصدی («(31%)») به‌طور پیش‌فرض نادیده گرفته می‌شوند تا «تعداد نماد
        مثبت (31%) 293» عدد ۳۱ را به‌جای ۲۹۳ برنگرداند.
      • `not_after`: اگر واژهٔ قبل از برچسب در این مجموعه باشد تطبیق رد می‌شود
        (مثلاً «Group P/E» نباید «P/E» را آلوده کند).
    """
    lab = [w for w in re.split(r"\s+", label.strip()) if w]
    out: list[list[float]] = []
    for i in range(len(words) - len(lab) + 1):
        if words[i:i + len(lab)] != lab:
            continue
        if not_after and i > 0 and words[i - 1] in not_after:
            continue
        nxt = words[i + len(lab)] if i + len(lab) < len(words) else ""
        gap = 0
        if _WORD_RE.match(nxt or ""):
            # چند واژهٔ واسط مجاز است (مثل «… معاملات خرد | آخرین | 4780-»)
            while gap < max_word_gap and _WORD_RE.match(words[i + len(lab) + gap] or ""):
                gap += 1
            if gap >= max_word_gap:
                continue
        vals: list[float] = []
        for tok in words[i + len(lab) + gap: i + len(lab) + gap + window]:
            if not allow_percent and re.search(r"[%٪]", tok):
                continue
            n = parse_amount(tok)
            if n is not None:
                vals.append(n)
        out.append(vals)
        if len(out) >= occurrences:
            break
    return out


def first_number(words: list[str], label: str, **kw) -> float | None:
    for vals in find_numbers(words, label, **kw):
        if vals:
            return vals[0]
    return None


# ─────────────────────────── صفحهٔ نماد ───────────────────────────

#: فیلد تابلورادار ← (برچسب سایت، واحد منبع)
SYMBOL_FIELDS: dict[str, tuple[str, str]] = {
    "pl": ("قیمت آخرین", "price"),
    "pc": ("قیمت پایانی", "price"),
    "pf": ("قیمت اولین", "price"),
    "py": ("دیروز", "price"),
    "pmin": ("حداقل", "price"),
    "pmax": ("حداکثر", "price"),
    "tvol": ("حجم معاملات", "volume"),
    "tval": ("ارزش معاملات", "toman"),
    "tno": ("تعداد معاملات", "count"),
    "netRealMoneyToday": ("ورود پول", "toman_signed"),
    "bvol": ("حجم مبنا", "volume"),
    "zTitad": ("تعداد سهام", "volume"),
    "marketCap": ("ارزش بازار", "toman"),
    "pe": ("P/E", "ratio"),
    "sectorPE": ("Group P/E", "ratio"),
    "eps": ("EPS", "eps_auto"),
    "psr": ("P/S", "ratio"),
    "avgVolMonth": ("میانگین حجم ماه", "volume"),
    "avgVolWeek": ("میانگین حجم هفته", "volume"),
    "surplusVolMonth": ("حجم مشکوک ماه", "volume"),
    "surplusVolWeek": ("حجم مشکوک هفته", "volume"),
    "demandPerCapita": ("سرانه تقاضا", "eps_auto"),
    "supplyPerCapita": ("سرانه عرضه", "eps_auto"),
    "buyPower": ("قدرت خرید", "ratio"),
    "volToFloatPct": ("حجم به شناوری", "percent"),
    "volToSharesPct": ("حجم به کل شرکت", "percent"),
}

#: برچسب‌هایی که عدد اولشان تومان است و باید ×۱۰ شود
_TOMAN_UNITS = {"price", "toman", "toman_signed", "eps_auto"}

#: واژه‌های پیش از برچسب که آن تطبیق را بی‌اعتبار می‌کنند (جلوگیری از تطبیق اشتباه)
NOT_AFTER: dict[str, frozenset[str]] = {
    "pe": frozenset({"Group"}),                       # «Group P/E» ≠ P/E نماد
    "eps": frozenset({"Group"}),
    "pmin": frozenset({"میانگین"}),
}

BOOK_HEADER = ["تعداد", "ارزش", "حجم", "قیمت", "قیمت", "حجم", "ارزش", "تعداد"]


def symbol_from_text(text: str, symbol: str) -> dict:
    """متن صفحهٔ نماد → فیلدهای تابلورادار (ریال). ورودی: متن strip‌شده یا خام."""
    words = tokens(text)
    out: dict[str, Any] = {"symbol": symbol, "source": "bourse-trader.ir/symbol"}
    raw: dict[str, list[float]] = {}
    ambiguous: list[str] = []

    for field, (label, unit) in SYMBOL_FIELDS.items():
        groups = [g for g in find_numbers(words, label,
                                           allow_percent=(unit == "percent"),
                                           not_after=NOT_AFTER.get(field, frozenset())) if g]
        if not groups:
            continue
        val = groups[0][0]
        if unit in _TOMAN_UNITS:
            val *= 10.0
        if any(abs(v - val) > 1e-6 for g in groups[1:] for v in g[:1]):
            ambiguous.append(field)
        out[field] = val
        raw[field] = groups[0][:4]

    # «سهام شناور 1T (53.67%)» → تعداد سهام شناور + درصد
    ff = [g for g in find_numbers(words, "سهام شناور", allow_percent=True) if len(g) >= 2]
    if ff:
        out["freeFloatShares"] = ff[0][0]
        pct = next((v for v in ff[0][1:] if 0 < v <= 100), None)
        if pct is not None:
            out["freeFloatPct"] = pct
        raw["freeFloat"] = ff[0][:4]

    _reconcile_eps(out, ambiguous)

    book = _parse_book(words)
    if book:
        out["book"] = book

    if out.get("pl") and out.get("pmin") and out.get("pmax"):
        lo, hi = out["pmin"], out["pmax"]
        if out["pl"] < lo * 0.98 or out["pl"] > hi * 1.02:
            ambiguous.append("pl")

    out["raw_found"] = raw
    out["ambiguous"] = sorted(set(ambiguous))
    return out


def symbol_snapshot(html_or_text: str, symbol: str) -> dict:
    """نسخهٔ HTML (صفحهٔ واقعی) — در صورت متن خام، همان را پارس می‌کند."""
    text = strip_html(html_or_text) if "<" in html_or_text else html_or_text
    return symbol_from_text(text, symbol)


def _reconcile_eps(out: dict[str, Any], ambiguous: list[str]) -> None:
    """واحد EPS را با «قیمت ÷ P/E» صحت‌سنجی می‌کند؛ در ناسازگاری علامت می‌زند."""
    pc = out.get("pc") or out.get("pl")
    pe = out.get("pe")
    eps = out.get("eps")
    if not (pc and pe and eps):
        return
    for cand, label in ((eps, "toman"), (eps / 10.0, "rial")):
        if cand <= 0:
            continue
        if abs((pc / cand) - pe) / pe < 0.15:
            out["eps"] = round(cand)
            out["eps_unit"] = label
            return
    ambiguous.append("eps")


def _parse_book(words: list[str]) -> list[dict]:
    """دفتر سفارش ۵ سطحی: سرستون «تعداد ارزش حجم قیمت قیمت حجم ارزش تعداد» + ۵ سطر ۸ عددی."""
    for i in range(len(words) - len(BOOK_HEADER) + 1):
        if words[i:i + len(BOOK_HEADER)] != BOOK_HEADER:
            continue
        nums: list[float] = []
        scanned = 0
        j = i + len(BOOK_HEADER)
        while j < len(words) and len(nums) < 40 and scanned < 120:
            tok = words[j]
            v = _book_number(tok)
            if v is not None:
                nums.append(v)
            elif re.search(r"[%٪]", tok) or tok in ("|", "\t"):
                pass                                  # درصد تغییر قیمت → نادیده
            elif nums and re.match(r"^[\u0600-\u06FF]", tok):
                break                                 # «جمع» یا متن → پایان جدول
            j += 1
            scanned += 1
        if len(nums) < 40:
            continue
        levels: list[dict] = []
        for lvl in range(5):
            bid_cnt, bid_val, bid_vol, bid_px, ask_px, ask_vol, ask_val, ask_cnt = \
                nums[lvl * 8:(lvl + 1) * 8]
            levels.append({
                "i": lvl + 1,
                "bid_count": bid_cnt, "qd": bid_vol, "pd": bid_px * 10, "bid_val_toman": bid_val,
                "ask_count": ask_cnt, "qo": ask_vol, "po": ask_px * 10, "ask_val_toman": ask_val,
            })
        return levels
    return []


# ─────────────────────────── صفحهٔ اصلی: نبض بازار ───────────────────────────

OVERVIEW_FIELDS: dict[str, tuple[str, str]] = {
    "index_total": ("شاخص کل", "index"),
    "index_equal": ("شاخص هم وزن", "index"),
    "index_fara": ("شاخص کل فرابورس", "index"),
    "market_cap": ("ارزش بازار", "toman"),
    "retail_trade_value": ("معاملات خرد", "toman"),
    "fixed_income_trade_value": ("صندوق درآمدثابت", "toman"),
    "commodity_fund_trade_value": ("صندوق کالایی", "toman"),
    "option_trade_value": ("معاملات آپشن", "toman"),
    "block_stock_trade_value": ("معاملات بلوک سهام", "toman"),
    "tal_trade_value": ("معاملات پایانی TAL", "toman"),
    "retail_volume": ("حجم معاملات خرد", "volume"),
    "symbols_up": ("تعداد نماد مثبت", "count"),
    "symbols_down": ("تعداد نماد منفی", "count"),
    "per_capita_buy": ("سرانه خرید حقیقی", "ratio"),
    "per_capita_sell": ("سرانه فروش حقیقی", "ratio"),
    "orders_buy_value": ("ارزش سفارشات خرید", "toman"),
    "orders_sell_value": ("ارزش سفارشات فروش", "toman"),
}

OVERVIEW_NOT_AFTER: dict[str, frozenset[str]] = {
    "retail_trade_value": frozenset({"حجم"}),     # «حجم معاملات خرد» ارزش نیست
    "retail_volume": frozenset({"ارزش"}),
}

UNIT_FACTOR = {"index": 1.0, "toman": 10.0, "toman_signed": 10.0,
               "volume": 1.0, "count": 1.0, "ratio": 1.0}


def overview_from_text(text: str) -> dict:
    """متن صفحهٔ اصلی → نبض بازار (ریال)."""
    words = tokens(text)
    out: dict[str, Any] = {"source": "bourse-trader.ir (صفحهٔ اصلی)", "unit": "rial"}
    missing: list[str] = []
    for field, (label, unit) in OVERVIEW_FIELDS.items():
        val = first_number(words, label, allow_percent=False,
                            not_after=OVERVIEW_NOT_AFTER.get(field, frozenset()))
        if val is None:
            missing.append(field)
            continue
        out[field] = val * UNIT_FACTOR.get(unit, 1.0)

    # «ورود پول حقیقی به معاملات خرد — آخرین 4780- میلیارد تومان»
    inflow = find_numbers(words, "ورود پول حقیقی به معاملات خرد", window=12,
                          allow_percent=True, max_word_gap=2)
    if inflow:
        for vals in inflow:
            if vals:
                out["retail_money_inflow_rial"] = vals[0] * 1e9 * 10.0   # میلیارد تومان → ریال
                break

    out["missing"] = missing
    out["top_inflow"] = flow_table(words, "بیشترین ورود پول حقیقی",
                                   stop_heading="بیشترین خروج پول حقیقی")
    out["top_outflow"] = flow_table(words, "بیشترین خروج پول حقیقی",
                                    stop_heading="ورود پول حقیقی به معاملات خرد")
    return out


def market_overview(html_or_text: str | None = None) -> dict:
    if html_or_text is None:
        html_or_text = page("/")
    text = strip_html(html_or_text) if "<" in html_or_text else html_or_text
    return overview_from_text(text)


def flow_table(words: list[str], heading: str, stop_heading: str | None = None) -> list[dict]:
    """جدول‌های «بیشترین ورود/خروج پول»: ⟦نماد⟧، مبلغ، درصد، حجم خرید، حجم کل.

    هر سطر با ⟦نماد⟧ شروع می‌شود و اعداد تا سطر بعدی ادامه دارند؛ بنابراین طول سطر
    متغیر است و شمارش ثابت اشتباه می‌شود.
    """
    head = [w for w in re.split(r"\s+", heading) if w]
    stop = [w for w in re.split(r"\s+", stop_heading or "") if w]
    start = None
    for i in range(len(words) - len(head) + 1):
        if words[i:i + len(head)] == head:
            start = i + len(head)
            break
    if start is None:
        return []
    rows: list[dict] = []
    i = start
    while i < len(words) and len(rows) < 30:
        if stop and words[i:i + len(stop)] == stop:
            break
        sym = re.fullmatch(r"⟦([^⟧]+)⟧", words[i])
        if not sym:
            i += 1
            continue
        nums: list[float] = []
        j = i + 1
        while j < len(words) and j < i + 8 and not re.fullmatch(r"⟦[^⟧]+⟧", words[j]):
            v = parse_amount(words[j])
            if v is not None:
                nums.append(v)
            elif _WORD_RE.match(words[j]) and nums:
                break
            j += 1
        if len(nums) >= 3:
            rows.append({
                "symbol": sym.group(1),
                "money_toman": nums[0],
                "money_rial": nums[0] * 10.0,
                "last_change_pct": nums[1],
                "real_volume": nums[2],
                "volume": nums[3] if len(nums) > 3 else None,
            })
        i = j if j > i else i + 1
    return rows


def symbol_url(symbol: str) -> str:
    return f"{BASE}/symbol/{urllib.parse.quote(symbol)}"


def fetch_symbol(symbol: str, *, ttl: float = CACHE_TTL) -> dict:
    """دریافت و پارس تابلوی یک نماد (با کش). نام فارسی نماد درصد-کد می‌شود."""
    path = "/symbol/" + urllib.parse.quote(symbol)
    return symbol_snapshot(page(path, ttl), symbol)
