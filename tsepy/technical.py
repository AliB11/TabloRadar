"""technical.py — اندیکاتورهای تکنیکال (کاملاًstdlib، بدون pandas)

قرارداد: ورودی‌ها آرایه‌ای از کندل (dict با کلیدهای c/v/h/l/o) هستند؛
قدیمی‌ترین در خانه ۰. در نبود داده، NaN برمی‌گردد — هیچ مقدار پیش‌فرض ساخته نمی‌شود.
"""
from __future__ import annotations

import math
from statistics import fmean

NAN = float("nan")


def is_num(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and v == v and abs(v) != float("inf")


fin = is_num   # نام کوتاه مورد استفاده سایر ماژول‌ها


def mean(a) -> float:
    a = list(a)
    return fmean(a) if a else NAN


def sma(values: list[float], period: int) -> float:
    if not values or len(values) < period:
        return NAN
    return mean(values[-period:])


def ema(values: list[float], period: int) -> float:
    if not values or len(values) < period:
        return NAN
    k = 2 / (period + 1)
    e = values[0]
    for v in values:
        e = k * v + (1 - k) * e
    return e


def ema_series(values: list[float], period: int) -> list[float]:
    if not values:
        return []
    k = 2 / (period + 1)
    out, e = [], values[0]
    for i, v in enumerate(values):
        e = values[0] if i == 0 else k * v + (1 - k) * e
        out.append(e)
    return out


def rsi_series(closes: list[float], period: int = 14) -> list[float]:
    if not closes or len(closes) <= period:
        return []
    gain = loss = 0.0
    for i in range(1, period + 1):
        d = closes[i] - closes[i - 1]
        gain += max(d, 0)
        loss += max(-d, 0)
    gain /= period
    loss /= period
    out = [NAN] * period
    out.append(100.0 if loss == 0 else 100 - 100 / (1 + gain / loss))
    for i in range(period + 1, len(closes)):
        d = closes[i] - closes[i - 1]
        gain = (gain * (period - 1) + max(d, 0)) / period
        loss = (loss * (period - 1) + max(-d, 0)) / period
        out.append(100.0 if loss == 0 else 100 - 100 / (1 + gain / loss))
    return out


def rsi(closes: list[float], period: int = 14) -> float:
    s = rsi_series(closes, period)
    return s[-1] if s else NAN


def macd(closes: list[float], fast: int = 12, slow: int = 26, signal_p: int = 9) -> dict:
    if not closes or len(closes) < slow + signal_p:
        return {"macd": NAN, "signal": NAN, "hist": NAN, "hist_prev": NAN}
    ef, es = ema_series(closes, fast), ema_series(closes, slow)
    line = [ef[i] - es[i] for i in range(len(closes))][slow - 1:]
    sig = ema_series(line, signal_p)
    hist = [line[i] - sig[i] for i in range(len(line))]
    return {"macd": line[-1], "signal": sig[-1], "hist": hist[-1],
            "hist_prev": hist[-2] if len(hist) > 1 else NAN}


def bollinger(closes: list[float], period: int = 20, mult: float = 2.0) -> dict:
    if not closes or len(closes) < period:
        return {"mid": NAN, "up": NAN, "lo": NAN, "pctb": NAN, "width": NAN}
    win = closes[-period:]
    mid = mean(win)
    sd = math.sqrt(mean([(v - mid) ** 2 for v in win]))
    up, lo = mid + mult * sd, mid - mult * sd
    last = closes[-1]
    return {"mid": mid, "up": up, "lo": lo,
            "pctb": NAN if up == lo else (last - lo) / (up - lo),
            "width": NAN if not mid else (up - lo) / mid}


def atr(bars: list[dict], period: int = 14) -> float:
    if not bars or len(bars) <= period:
        return NAN
    trs = []
    for i in range(1, len(bars)):
        h, l, pc = bars[i].get("h"), bars[i].get("l"), bars[i - 1].get("c")
        if not (is_num(h) and is_num(l) and is_num(pc)):
            continue
        trs.append(max(h - l, abs(h - pc), abs(l - pc)))
    if len(trs) < period:
        return NAN
    return mean(trs[-period:])


def returns(closes: list[float], n: int) -> float:
    if not closes or len(closes) <= n:
        return NAN
    a, b = closes[-1 - n], closes[-1]
    return NAN if not a else (b - a) / a * 100


def slope(values: list[float], period: int = 20) -> float:
    if not values or len(values) < period:
        return NAN
    y = values[-period:]
    nn = len(y)
    xm = (nn - 1) / 2
    ym = mean(y)
    num = sum((i - xm) * (y[i] - ym) for i in range(nn))
    den = sum((i - xm) ** 2 for i in range(nn))
    if not den or not ym:
        return NAN
    return (num / den) / ym * 100


def annualized_vol(closes: list[float]) -> float:
    if not closes or len(closes) < 21:
        return NAN
    r = [math.log(closes[i] / closes[i - 1]) for i in range(1, len(closes)) if closes[i - 1] > 0]
    if len(r) < 20:
        return NAN
    m = mean(r)
    sd = math.sqrt(mean([(v - m) ** 2 for v in r]))
    return sd * math.sqrt(252) * 100


def range_position(closes: list[float], n: int = 60) -> float:
    if not closes or len(closes) < 2:
        return NAN
    win = closes[-n:]
    lo, hi = min(win), max(win)
    return 0.5 if hi == lo else (closes[-1] - lo) / (hi - lo)


def max_drawdown(closes: list[float]) -> float:
    if not closes or len(closes) < 2:
        return NAN
    peak, dd = closes[0], 0.0
    for c in closes:
        peak = max(peak, c)
        dd = min(dd, (c - peak) / peak)
    return dd * 100


def series(bars: list[dict]) -> tuple[list[float], list[float]]:
    """تاریخچه → (closes, volumes) با حذف رکوردهای نامعتبر"""
    clean = [b for b in (bars or []) if is_num(b.get("c")) and b["c"] > 0]
    closes = [b["c"] for b in clean]
    vols = [b.get("v") for b in clean if is_num(b.get("v")) and b.get("v") > 0]
    return closes, vols
