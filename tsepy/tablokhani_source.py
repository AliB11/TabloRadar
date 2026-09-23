"""خوانندهٔ محافظه‌کار صفحات عمومی tablokhani.com.

این وب‌سایت API عمومی مستندشده‌ای ارائه نکرده است. بنابراین فقط HTML عمومیِ مجاز در
robots.txt خوانده می‌شود؛ مسیرهای حساب، پرداخت، realtime و ابزارهای اشتراکی هرگز
فراخوانی نمی‌شوند. خروجی صرفاً منبع واقعیِ جزئی است و امتیازهای اختصاصی سایت را
کپی یا بازتولید نمی‌کند.
"""
from __future__ import annotations

import re
import time
import urllib.parse
import urllib.request
from html.parser import HTMLParser
from typing import Any

from .bourse_trader import fa_digits, parse_amount, strip_html, tokens

BASE = "https://tablokhani.com"
UA = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml",
}
BLOCKED_PREFIXES = (
    "/admin", "/auth", "/dashboard", "/app", "/purchase", "/checkout", "/gateway",
    "/realtime", "/raw-data-debug", "/user-account", "/symbol-management", "/telegram",
)
_cache: dict[str, tuple[float, str]] = {}


def fetch_html(path: str = "/", timeout: float = 15.0, ttl: float = 180.0) -> str:
    if not path.startswith("/") or any(path.startswith(p) for p in BLOCKED_PREFIXES):
        raise ValueError("مسیر عمومی مجاز نیست")
    hit = _cache.get(path)
    if hit and time.time() - hit[0] < ttl:
        return hit[1]
    req = urllib.request.Request(BASE + path, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as res:  # noqa: S310 — host ثابت است
        if "text/html" not in (res.headers.get("Content-Type") or ""):
            raise RuntimeError("پاسخ tablokhani از نوع HTML نیست")
        body = res.read(3_000_000).decode("utf-8", "replace")
    if len(body) < 1000:
        raise RuntimeError("پاسخ tablokhani کوتاه است")
    _cache[path] = (time.time(), body)
    return body


class _Links(HTMLParser):
    def __init__(self) -> None:
        super().__init__(); self.href = ""; self.buf: list[str] = []; self.links: list[tuple[str, str]] = []
    def handle_starttag(self, tag, attrs):
        if tag == "a": self.href = dict(attrs).get("href", ""); self.buf = []
    def handle_data(self, data):
        if self.href: self.buf.append(data)
    def handle_endtag(self, tag):
        if tag == "a" and self.href:
            self.links.append((self.href, " ".join(self.buf).strip())); self.href = ""; self.buf = []


def homepage_symbols(html: str, limit: int = 5) -> list[str]:
    """نمادهای جدول عمومی «بیشترین حجم معاملات»؛ حدس از URLهای داخلی ممنوع."""
    p = _Links(); p.feed(html)
    out: list[str] = []
    for href, label in p.links:
        path = urllib.parse.urlparse(href).path
        decoded = urllib.parse.unquote(path).strip("/")
        sym = re.sub(r"\s+", " ", label).strip()
        if not decoded or decoded != sym or "/" in decoded or not re.fullmatch(r"[آ-یئکگی‌ ]{1,18}", sym):
            continue
        if sym not in out: out.append(sym)
        if len(out) >= limit: break
    return out


def _after(words: list[str], label: str, count: int = 1) -> list[float]:
    lab = label.split()
    for i in range(len(words) - len(lab)):
        if words[i:i + len(lab)] != lab: continue
        vals = []
        for tok in words[i + len(lab):i + len(lab) + 5]:
            n = parse_amount(tok)
            if n is not None: vals.append(n)
            if len(vals) >= count: return vals
    return []


def parse_symbol(html: str, symbol: str) -> dict[str, Any]:
    text = fa_digits(strip_html(html))
    words = tokens(text)
    out: dict[str, Any] = {"l18": symbol, "provenance": "tablokhani.com-public",
                           "synthetic": False, "partial": True}
    fields = {
        # کارت «آخرین قیمت» درصد تغییر را هم کنار قیمت دارد؛ برای pl/pc فقط
        # برچسب‌های صریحِ بخش دامنه در پایین استفاده می‌شوند تا عدد اشتباه انتخاب نشود.
        "pf": "اولین قیمت", "tno": "تعداد معاملات", "tvol": "حجم معاملات",
        "tval": "ارزش معاملات", "bvol": "حجم مبنا", "zTitad": "تعداد سهم",
        "marketCap": "ارزش بازار",
    }
    for key, label in fields.items():
        vals = _after(words, label)
        if vals: out[key] = vals[0]
    # مقادیر صریح بخش دامنه، قابل اتکاتر از ترتیب کارت‌ها هستند.
    for key, label in (("pl", "آخرین معامله:"), ("pc", "پایانی:"), ("pmin", "کمترین:"),
                       ("pmax", "بیشترین:"), ("py", "دیروز:")):
        m = re.search(re.escape(label) + r"\s*([\d,٬]+)", text)
        if m:
            val = parse_amount(m.group(1))
            if val is not None: out[key] = val
    m = re.search(r"قیمت مجاز\s*([\d,٬]+)\s*[-–]\s*([\d,٬]+)", text)
    if m:
        a, b = parse_amount(m.group(1)), parse_amount(m.group(2))
        if a is not None and b is not None: out["tmax"], out["tmin"] = max(a, b), min(a, b)
    # نام شرکت از heading عمومی «نماد - نام».
    m = re.search(rf"(?:^|\n){re.escape(symbol)}\s*[-–]\s*([^\n]+)", text)
    if m: out["l30"] = m.group(1).strip()
    required = ("pl", "pc", "tvol", "tval")
    if not all(k in out for k in required):
        raise ValueError("فیلدهای پایه صفحه نماد tablokhani کامل نیست")
    return out


def fetch_market(limit: int = 5, timeout: float = 15.0) -> list[dict]:
    home = fetch_html("/", timeout)
    symbols = homepage_symbols(home, max(5, min(limit, 10)))
    rows = []
    for symbol in symbols:
        try:
            path = "/" + urllib.parse.quote(symbol, safe="")
            rows.append(parse_symbol(fetch_html(path, timeout), symbol))
        except Exception:  # یک نماد، کل fallback را از کار نیندازد
            continue
    return rows
