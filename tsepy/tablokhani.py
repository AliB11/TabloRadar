"""tablokhani.py — سنجه‌های خُردساختار تابلوی بورس ایران

هر سنجه که در ادامه برای امتیازدهی استفاده می‌شود، اینجا تعریف شده است:
  · قیمت: آخرین/پایانی/دیروز، فاصله تا سقف و کف مجاز، ظرفیت رشد امروز
  · صف‌ها: حجم و ارزش صف خرید/فروش، قفل بودن صف
  · جریان پول: سرانه خرید/فروش حقیقی، قدرت خریدار، پول حقیقی خالص، کد‌به‌کد
  · دفتر سفارش: OBI پنج سطحی
  · حجم: حجم مشکوک نسبت به میانگین ۳۰ جلسه (یا میانگین ارزش معاملات)
"""
from __future__ import annotations

import math
from typing import Any

from . import technical as T
from .data_provider import limit_pct

NAN = float("nan")
fin = T.is_num


def clamp(v: float, lo: float = 0.0, hi: float = 100.0) -> float:
    return max(lo, min(hi, v))


def sig(x: float, mid: float, k: float) -> float:
    """نگاشت نرم سیگموئیدی به ۰..۱۰۰"""
    if not fin(x):
        return NAN
    return 100.0 / (1.0 + math.exp(-k * (x - mid)))


def k2k_pattern(m: dict) -> dict:
    """تشخیص الگوی کد‌به‌کد/جمع‌آوری از عدم‌تقارن حقیقی و حقوقی."""
    ls, rb = m.get("legal_sell_share"), m.get("real_buy_share")
    rs, lb = m.get("real_sell_share"), m.get("legal_buy_share")
    shock = m.get("volume_shock")
    strong = (not fin(shock)) or shock >= 1.2
    if fin(ls) and fin(rb) and ls >= 0.25 and rb >= 0.5 and strong:
        return {"code": "legal2real", "fa": "کد‌به‌کد حقوقی → حقیقی", "bias": 1.0}
    if fin(lb) and fin(rs) and lb >= 0.25 and rs >= 0.5 and strong:
        return {"code": "real2legal", "fa": "کد‌به‌کد حقیقی → حقوقی", "bias": -1.0}
    if fin(rb) and fin(rs) and rb >= 0.7 and rs <= 0.25:
        return {"code": "realCollect", "fa": "جمع‌آوری توسط حقیقی‌ها", "bias": 0.5}
    if fin(rb) and fin(rs) and rb <= 0.3 and rs >= 0.7:
        return {"code": "realExit", "fa": "خروج حقیقی‌ها", "bias": -0.5}
    return {"code": "none", "fa": "الگوی خاص شناسایی نشد", "bias": 0.0}


def metrics(inst) -> dict[str, Any]:
    """همه سنجه‌های یک نماد (معادل instrumentMetrics در هسته JS)."""
    m: dict[str, Any] = {}
    pc, pl, py, pf = inst.pc, inst.pl, inst.py, inst.pf
    pmin, pmax, tmin, tmax = inst.pmin, inst.pmax, inst.tmin, inst.tmax
    tvol, tval = inst.tvol, inst.tval

    m["vwap"] = (tval / tvol) if (fin(tval) and fin(tvol) and tvol > 0) else (pl if fin(pl) else NAN)
    px = m["vwap"]

    m["chg_last"] = ((pl - pc) / pc * 100) if (fin(pl) and fin(pc) and pc) else NAN
    m["chg_close"] = ((pc - py) / py * 100) if (fin(pc) and fin(py) and py) else NAN
    m["chg_open"] = ((pf - pc) / pc * 100) if (fin(pf) and fin(pc) and pc) else NAN

    L = limit_pct(inst)
    m["limit_pct"] = L
    m["gap_to_up"] = ((tmax - pl) / pl * 100) if (fin(pl) and fin(tmax) and pl) else NAN
    m["gap_to_down"] = ((pl - tmin) / pl * 100) if (fin(pl) and fin(tmin) and pl) else NAN
    m["capacity"] = clamp(m["gap_to_up"] / (L * 100), 0.0, 1.0) if (fin(m["gap_to_up"]) and L) else NAN
    m["at_limit_up"] = bool(fin(tmax) and fin(pl) and pl >= tmax * 0.999)
    m["at_limit_down"] = bool(fin(tmin) and fin(pl) and pl <= tmin * 1.001)
    m["day_range_pos"] = ((pl - pmin) / (pmax - pmin)) if (fin(pl) and fin(pmin) and fin(pmax) and pmax > pmin) else NAN

    bid_q_sum = ask_q_sum = buy_q = sell_q = 0.0
    for lv in inst.book or []:
        bid, ask = lv["bid"], lv["ask"]
        if fin(bid["q"]):
            bid_q_sum += bid["q"]
            if fin(tmax) and fin(bid["p"]) and bid["p"] >= tmax * 0.999:
                buy_q += bid["q"]
        if fin(ask["q"]):
            ask_q_sum += ask["q"]
            if fin(tmin) and fin(ask["p"]) and ask["p"] <= tmin * 1.001:
                sell_q += ask["q"]
    if not buy_q and m["at_limit_up"] and inst.book and fin(inst.book[0]["bid"]["q"]):
        buy_q = inst.book[0]["bid"]["q"]
    if not sell_q and m["at_limit_down"] and inst.book and fin(inst.book[0]["ask"]["q"]):
        sell_q = inst.book[0]["ask"]["q"]

    m["buy_queue"] = buy_q
    m["sell_queue"] = sell_q
    m["buy_queue_value"] = buy_q * tmax if fin(tmax) else NAN
    m["sell_queue_value"] = sell_q * tmin if fin(tmin) else NAN
    if fin(tval) and tval > 0 and fin(m["buy_queue_value"]):
        m["queue_ratio"] = (m["buy_queue_value"] - (m["sell_queue_value"] if fin(m["sell_queue_value"]) else 0.0)) / tval
    else:
        m["queue_ratio"] = NAN
    m["sell_queue_locked"] = bool(m["at_limit_down"] and sell_q > 0 and bid_q_sum == 0)
    m["buy_queue_locked"] = bool(m["at_limit_up"] and buy_q > 0 and ask_q_sum == 0)
    m["obi"] = ((bid_q_sum - ask_q_sum) / (bid_q_sum + ask_q_sum)) if (bid_q_sum + ask_q_sum) > 0 else NAN
    m["bid_vol"], m["ask_vol"] = bid_q_sum, ask_q_sum

    m["sar_buy"] = (inst.buy_i_vol / inst.buy_i_count * px) if (
        fin(inst.buy_i_vol) and fin(inst.buy_i_count) and inst.buy_i_count > 0 and fin(px)) else NAN
    m["sar_sell"] = (inst.sell_i_vol / inst.sell_i_count * px) if (
        fin(inst.sell_i_vol) and fin(inst.sell_i_count) and inst.sell_i_count > 0 and fin(px)) else NAN
    m["buyer_power"] = (m["sar_buy"] / m["sar_sell"]) if (fin(m["sar_buy"]) and fin(m["sar_sell"]) and m["sar_sell"] > 0) else NAN

    m["net_real_money"] = ((inst.buy_i_vol - inst.sell_i_vol) * px) if (
        fin(inst.buy_i_vol) and fin(inst.sell_i_vol) and fin(px)) else NAN
    m["net_real_share"] = (m["net_real_money"] / tval) if (fin(m["net_real_money"]) and fin(tval) and tval > 0) else NAN

    def z(v):
        return v if fin(v) else 0.0

    total_buy = z(inst.buy_i_vol) + z(inst.buy_n_vol)
    total_sell = z(inst.sell_i_vol) + z(inst.sell_n_vol)
    m["real_buy_share"] = (inst.buy_i_vol / total_buy) if (total_buy > 0 and fin(inst.buy_i_vol)) else NAN
    m["legal_buy_share"] = (inst.buy_n_vol / total_buy) if (total_buy > 0 and fin(inst.buy_n_vol)) else NAN
    m["real_sell_share"] = (inst.sell_i_vol / total_sell) if (total_sell > 0 and fin(inst.sell_i_vol)) else NAN
    m["legal_sell_share"] = (inst.sell_n_vol / total_sell) if (total_sell > 0 and fin(inst.sell_n_vol)) else NAN

    bars = inst.history or []
    m["bars"] = bars
    vols = [b["v"] for b in bars if fin(b.get("v")) and b.get("v") > 0]
    ma_vol30 = mean30(vols)
    if fin(tvol) and fin(ma_vol30) and ma_vol30 > 0:
        m["volume_shock"] = tvol / ma_vol30
        m["volume_shock_source"] = "history"
    elif fin(tvol) and fin(inst.avg_val) and inst.avg_val > 0 and fin(px) and px > 0:
        m["volume_shock"] = tvol / (inst.avg_val / px)
        m["volume_shock_source"] = "avgVal"
    else:
        m["volume_shock"] = NAN
        m["volume_shock_source"] = None

    m["turnover"] = (tval / inst.market_value) if (fin(tval) and fin(inst.market_value) and inst.market_value > 0) else NAN
    m["pe_ratio"] = inst.pe if (fin(inst.pe) and inst.pe > 0) else (
        (pl / inst.eps) if (fin(inst.eps) and inst.eps > 0 and fin(pl)) else NAN)
    m["pe_vs_sector"] = (m["pe_ratio"] / inst.sector_pe) if (fin(m["pe_ratio"]) and fin(inst.sector_pe) and inst.sector_pe > 0) else NAN
    m["free_float"] = inst.free_float if fin(inst.free_float) else NAN

    closes = [b["c"] for b in bars if fin(b.get("c")) and b["c"] > 0]
    if fin(pl) and closes and abs(closes[-1] - pl) / pl > 0.005:
        closes = closes + [pl]
    m["has_history"] = len(closes) >= 30
    if m["has_history"]:
        m["rsi"] = T.rsi(closes, 14)
        m["ema9"] = T.ema(closes, 9)
        m["ema21"] = T.ema(closes, 21)
        m["sma20"] = T.sma(closes, 20)
        m["sma50"] = T.sma(closes, 50)
        m["sma200"] = T.sma(closes, 200) if len(closes) >= 200 else NAN
        m["sma200_prev"] = T.sma(closes[:-20], 200) if len(closes) >= 220 else NAN
        md = T.macd(closes)
        m["macd_hist"], m["macd_hist_prev"] = md["hist"], md["hist_prev"]
        bb = T.bollinger(closes, 20, 2.0)
        m["bb_pctb"], m["bb_mid"] = bb["pctb"], bb["mid"]
        m["atr"] = T.atr(bars, 14)
        m["ret5"], m["ret20"], m["ret60"] = T.returns(closes, 5), T.returns(closes, 20), T.returns(closes, 60)
        m["slope20"] = T.slope(closes, 20)
        m["vol60"] = T.annualized_vol(closes)
        m["range_pos60"] = T.range_position(closes, 60)
        m["mdd"] = T.max_drawdown(closes)
    else:
        for k in ("rsi", "ema9", "ema21", "sma20", "sma50", "sma200", "sma200_prev",
                  "macd_hist", "macd_hist_prev", "bb_pctb", "bb_mid", "atr", "ret5", "ret20",
                  "ret60", "slope20", "vol60", "range_pos60", "mdd"):
            m[k] = NAN

    m["k2k"] = k2k_pattern(m)
    return m


def mean30(vols: list[float]) -> float:
    return T.mean(vols[-30:]) if len(vols) >= 30 else NAN
