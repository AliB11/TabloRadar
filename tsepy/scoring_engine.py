"""scoring_engine.py — وتوها، امتیاز پنج‌عاملی، اطمینان، نقشه معامله و رتبه‌بندی

این فایل «برادر پایتونى» هسته جاوااسکریپت (assets/js/engine.js) است و با همان
فرمول‌ها کار می‌کند؛ آزمون `tools/parity_check.py` خروجی دو پیاده‌سازی را روی
یک داده مقایسه می‌کند تا رندر مرورگر و اجرای Cron/CLI واگرا نشوند.
"""
from __future__ import annotations

import math
from typing import Any

from . import config as C
from .tablokhani import clamp, metrics, sig
from .technical import fin, mean

NAN = float("nan")


# ───────────────────────── وتوها ─────────────────────────
def veto_check(inst, m: dict, rules: C.Rules) -> tuple[bool, list[str], list[str]]:
    codes: list[str] = []
    fa: list[str] = []

    if inst.halted or (inst.state and not re_ok_state(inst.state)):
        codes.append("state"); fa.append(f"وضعیت: {inst.state}")

    is_base, is_fund = inst.kind.startswith("base_"), inst.kind.startswith("fund_")
    is_right, is_bond = inst.kind == "right", inst.kind == "bond"
    if ((is_base and not rules.include_base) or ((is_fund or is_bond) and not rules.include_funds)
            or (is_right and not rules.include_rights) or inst.kind in ("index", "other")):
        codes.append("universe")
        fa.append(f"{inst.board if inst.kind.startswith('stock') else inst.kind} · {inst.sector}")

    if fin(inst.tval) and inst.tval < rules.min_value:
        codes.append("liq")
        fa.append(f"ارزش معاملات {inst.tval / 1e9:,.1f} میلیارد ریال < {rules.min_value / 1e9:,.0f} میلیارد")

    if m.get("sell_queue_locked"):
        codes.append("sellQueue")
        fa.append(f"صف فروش {m['sell_queue']:,.0f} برگه در کف مجاز")

    if fin(m.get("free_float")) and m["free_float"] < rules.min_float:
        codes.append("data"); fa.append(f"شناوری آزاد {m['free_float']:.1f}٪ کمتر از آستانه")
    if rules.require_history and not m.get("has_history"):
        codes.append("data"); fa.append("تاریخچه قیمت موجود نیست")
    if not fin(inst.pl) or inst.pl <= 0:
        codes.append("data"); fa.append("قیمت معتبر دریافت نشد")

    return bool(codes), codes, fa


def re_ok_state(state: str) -> bool:
    return state in ("", "مجاز") or state.startswith("مجاز")


# ───────────────────────── عوامل پنج‌گانه ─────────────────────────
def _weighted(parts: list[tuple[float, float]]) -> float:
    sw = sx = 0.0
    for v, w in parts:
        if not fin(v):
            continue
        sw += w
        sx += w * v
    return sx / sw if sw > 0 else NAN


def rsi_score(v: float) -> float:
    if not fin(v):
        return NAN
    if v >= 80:
        return 25.0
    if v >= 70:
        return 62.0
    if v >= 55:
        return 100.0
    if v >= 45:
        return 78.0
    if v >= 35:
        return 55.0
    return 40.0


def factor_scores(inst, m: dict, rules: C.Rules) -> dict[str, Any]:
    f: dict[str, Any] = {"detail": {}}
    w = C.SUBWEIGHTS

    k2k = C.K2K_SCORE.get(m["k2k"]["code"], NAN)
    f["tablo"] = _weighted([
        (sig(m["buyer_power"], 1.0, 2.4), w["tablo"]["buyer_power"]),
        (sig(m["net_real_share"], 0.0, 7.0), w["tablo"]["net_real"]),
        (sig(m["obi"], 0.0, 5.0), w["tablo"]["obi"]),
        (sig(m["volume_shock"], 1.5, 1.3), w["tablo"]["shock"]),
        (k2k, w["tablo"]["k2k"]),
    ])
    f["detail"]["tablo"] = {"buyer_power": m["buyer_power"], "net_real_share": m["net_real_share"],
                            "obi": m["obi"], "volume_shock": m["volume_shock"], "k2k": m["k2k"]["fa"]}

    ema_gap = ((m["ema9"] - m["ema21"]) / m["ema21"] * 100) if (fin(m["ema9"]) and fin(m["ema21"]) and m["ema21"]) else NAN
    short_raw = _weighted([
        (rsi_score(m["rsi"]), w["short"]["rsi"]),
        (sig(ema_gap, 0.0, 3.2), w["short"]["ema"]),
        (m["day_range_pos"] * 100 if fin(m["day_range_pos"]) else NAN, w["short"]["range"]),
        (sig(m["ret5"], 0.0, 0.55), w["short"]["ret5"]),
    ])
    if fin(short_raw) and fin(m["capacity"]):
        short_raw *= 0.55 + 0.45 * m["capacity"]
    f["short"] = clamp(short_raw) if fin(short_raw) else NAN
    f["detail"]["short"] = {"rsi": m["rsi"], "ema_gap": ema_gap, "day_range_pos": m["day_range_pos"],
                            "ret5": m["ret5"], "capacity": m["capacity"]}

    sma_gap = ((m["sma20"] - m["sma50"]) / m["sma50"] * 100) if (fin(m["sma20"]) and fin(m["sma50"]) and m["sma50"]) else NAN
    price_vs_sma = ((inst.pl - m["sma20"]) / m["sma20"] * 100) if (fin(inst.pl) and fin(m["sma20"]) and m["sma20"]) else NAN
    f["mid"] = _weighted([
        (sig(sma_gap, 0.0, 2.2), w["mid"]["sma_gap"]),
        (sig(m["macd_hist"] / inst.pl * 100, 0.0, 3.5) if (fin(m["macd_hist"]) and inst.pl) else NAN, w["mid"]["macd"]),
        (sig(price_vs_sma, 0.0, 1.6), w["mid"]["vs_sma20"]),
        (sig(m["slope20"], 0.0, 9.0), w["mid"]["slope"]),
    ])
    f["detail"]["mid"] = {"sma_gap": sma_gap, "macd_hist": m["macd_hist"], "price_vs_sma": price_vs_sma,
                          "slope20": m["slope20"]}

    vs200 = ((inst.pl - m["sma200"]) / m["sma200"] * 100) if (fin(inst.pl) and fin(m["sma200"]) and m["sma200"]) else NAN
    slope200 = ((m["sma200"] - m["sma200_prev"]) / m["sma200_prev"] * 100) if (
        fin(m["sma200"]) and fin(m["sma200_prev"]) and m["sma200_prev"]) else NAN
    if fin(m["pe_vs_sector"]):
        pe_score = 40.0 if m["pe_vs_sector"] <= 0 else clamp(sig(-m["pe_vs_sector"], -1.0, 2.4))
    elif fin(m["pe_ratio"]):
        pe_score = clamp(sig(-m["pe_ratio"], -12.0, 0.25))
    else:
        pe_score = None
    f["long"] = _weighted([
        (sig(vs200, 0.0, 0.55), w["long"]["vs_sma200"]),
        (sig(slope200, 0.0, 1.2), w["long"]["slope200"]),
        (pe_score, w["long"]["pe"]),
        (sig(m["turnover"] * 100, 0.4, 2.6) if fin(m["turnover"]) else NAN, w["long"]["turnover"]),
    ])
    f["detail"]["long"] = {"vs200": vs200, "slope200": slope200, "pe": m["pe_ratio"],
                           "pe_vs_sector": m["pe_vs_sector"], "turnover": m["turnover"]}

    liq = sig(inst.tval / 1e9, 250.0, 0.02) if fin(inst.tval) else NAN
    if m["sell_queue_locked"]:
        queue = 0.0
    elif m["buy_queue_locked"]:
        queue = 62.0
    else:
        queue = sig(m["queue_ratio"], 0.0, 6.0) if fin(m["queue_ratio"]) else NAN
    flt = sig(m["free_float"], 15.0, 0.35) if fin(m["free_float"]) else None
    vol_limit = (clamp(sig(-(m["vol60"] / (m["limit_pct"] * 100 * math.sqrt(252))), -2.2, 2.4))
                 if (fin(m["vol60"]) and m["limit_pct"]) else None)
    risk_raw = _weighted([
        (liq, w["risk"]["liquidity"]),
        (queue, w["risk"]["queue"]),
        (flt, w["risk"]["float"]),
        (vol_limit, w["risk"]["vol"]),
    ])
    if fin(risk_raw) and fin(m["pe_vs_sector"]) and m["pe_vs_sector"] > rules.pe_penalty:
        risk_raw *= 0.8
    if fin(risk_raw) and inst.market == "پایه":
        risk_raw *= 0.6
    f["risk"] = clamp(risk_raw) if fin(risk_raw) else NAN
    f["detail"]["risk"] = {"tval": inst.tval, "queue_ratio": m["queue_ratio"],
                           "free_float": m["free_float"], "vol60": m["vol60"]}

    f["coverage"] = sum(1 for k in C.FACTOR_KEYS if fin(f.get(k))) / len(C.FACTOR_KEYS)
    return f


def grade_of(score: float, confidence: float) -> str:
    if not fin(score):
        return "بدون داده"
    low_conf = fin(confidence) and confidence < 45
    if score >= 80 and not low_conf:
        return "خرید قوی"
    if score >= 68 and not low_conf:
        return "خرید"
    if score >= 55:
        return "رصد (داده ناقص)" if low_conf else "خنثی مثبت"
    if score >= 42:
        return "احتیاط"
    return "ضعیف"


def score_instrument(f: dict, weights: dict[str, float]) -> dict[str, Any]:
    parts = [(f[k], weights.get(k, 0.0)) for k in C.FACTOR_KEYS if weights.get(k, 0)]
    total = _weighted(parts)
    present = [v for v, _ in parts if fin(v)]
    avg = mean(present) if present else NAN
    sd = math.sqrt(mean([(v - avg) ** 2 for v in present])) if len(present) > 1 else NAN
    agreement = clamp(100 - sd * 1.35) if fin(sd) else (55.0 if present else 0.0)
    confidence = clamp(f["coverage"] * 100 * (0.65 + 0.35 * (agreement / 100)))
    return {
        "total": round(total, 1) if fin(total) else None,
        "confidence": round(confidence),
        "dispersion": round(sd, 1) if fin(sd) else None,
        "grade": grade_of(total, confidence),
    }


def horizon_of(f: dict) -> str:
    s, t, l, md = (f.get("short") or -1), (f.get("tablo") or -1), (f.get("long") or -1), (f.get("mid") or -1)
    if s >= 68 and t >= 65:
        return "short"
    if l >= 70 and s < 60:
        return "long"
    if md >= 62 or t >= 70:
        return "mid"
    return "short"


def signal_plan(inst, m: dict, rules: C.Rules) -> dict | None:
    entry = inst.pl
    if not fin(entry):
        return None
    limit = m["limit_pct"] if (fin(m["limit_pct"]) and m["limit_pct"]) else 0.03
    atr_val = m["atr"] if (fin(m["atr"]) and m["atr"] > 0) else entry * limit * 0.75
    src = "ATR(14)" if (fin(m["atr"]) and m["atr"] > 0) else "برآورد از دامنه نوسان"
    stop = max(inst.tmin if fin(inst.tmin) else 0, entry - rules.stop_atr_mult * atr_val)
    targets = [entry + k * atr_val for k in rules.target_atr_mults]
    risk = entry - stop
    rr = (targets[1] - entry) / risk if risk > 0 else NAN
    sessions = [max(1, math.ceil(((t - entry) / entry) / limit)) for t in targets]
    return {
        "entry": entry, "stop": stop, "atr": atr_val, "atr_source": src, "targets": targets,
        "rr": round(rr, 2) if fin(rr) else None,
        "stop_pct": (-(risk / entry) * 100) if risk > 0 else NAN,
        "target_pct": [((t - entry) / entry) * 100 for t in targets],
        "sessions": sessions, "horizon": None,
    }


# ───────────────────────── توضیح فارسی ─────────────────────────
def _money(v: float) -> str:
    if not fin(v):
        return "—"
    return f"{v / 1e9:,.1f} میلیارد ریال"


def explain(inst, m: dict) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    add = lambda t, tone="neutral": out.append({"text": t, "tone": tone})

    if fin(m["buyer_power"]):
        tone = "pos" if m["buyer_power"] >= 1.2 else ("neg" if m["buyer_power"] <= 0.85 else "neutral")
        add(f"سرانه خرید حقیقی {_money(m['sar_buy'])} در برابر سرانه فروش {_money(m['sar_sell'])} → قدرت خریدار {m['buyer_power']:.2f}", tone)
    if fin(m["net_real_money"]):
        pct = f" معادل {abs(m['net_real_share']) * 100:.1f}٪ ارزش معاملات روز" if fin(m.get("net_real_share")) else ""
        add(f"{'ورود' if m['net_real_money'] >= 0 else 'خروج'} پول حقیقی خالص {_money(abs(m['net_real_money']))}{pct}",
            "pos" if m["net_real_money"] >= 0 else "neg")
    if m["k2k"]["code"] != "none":
        extra = (f" — {m['legal_sell_share'] * 100:.0f}٪ حجم را حقوقی فروخت و {m['real_buy_share'] * 100:.0f}٪ را حقیقی خرید"
                 if fin(m.get("legal_sell_share")) and fin(m.get("real_buy_share")) else "")
        add(f"{m['k2k']['fa']}{extra}", "pos" if m["k2k"]["bias"] > 0 else "neg")
    if fin(m["obi"]):
        tag = "تقاضا غالب" if m["obi"] > 0.15 else ("عرضه غالب" if m["obi"] < -0.15 else "تعادل نسبی")
        add(f"عدم تعادل دفتر سفارش (OBI) {m['obi']:.2f} → {tag}",
            "pos" if m["obi"] > 0.15 else ("neg" if m["obi"] < -0.15 else "neutral"))
    if fin(m["volume_shock"]):
        add(f"حجم امروز {m['volume_shock']:.1f} برابر میانگین ۳۰ روز"
            + (" (از میانگین ارزش معاملات)" if m.get("volume_shock_source") == "avgVal" else ""),
            "pos" if m["volume_shock"] >= 1.8 else ("neg" if m["volume_shock"] <= 0.7 else "neutral"))
    if fin(m["gap_to_up"]):
        add(f"فاصله تا سقف مجاز {m['gap_to_up']:.2f}٪ (دامنه {m['limit_pct'] * 100:.0f}٪) → ظرفیت رشد امروز "
            f"{(m['capacity'] or 0) * 100:.0f}٪", "pos" if (m["capacity"] or 0) >= .5 else "neutral")
    if m["buy_queue_locked"]:
        add("صف خرید قفل در سقف مجاز — امکان خرید در قیمت جاری عملاً وجود ندارد؛ ریسک خرید در صف.")
    if m["sell_queue_locked"]:
        add("صف فروش قفل در کف مجاز — ریسک ادامه ریزش و ناتوانی در خروج.", "neg")
    if fin(m["rsi"]):
        add(f"RSI(14) = {m['rsi']:.0f} → "
            + ("اشباع خرید" if m["rsi"] >= 70 else "روند صعودی" if m["rsi"] >= 55 else "خنثی" if m["rsi"] >= 45 else "نزدیک اشباع فروش"),
            "pos" if 55 <= m["rsi"] < 72 else ("neg" if m["rsi"] >= 75 else "neutral"))
    if fin(m["sma200"]) and fin(inst.pl):
        d = (inst.pl - m["sma200"]) / m["sma200"] * 100
        add(f"قیمت {abs(d):.1f}٪ {'بالای' if d >= 0 else 'زیر'} میانگین ۲۰۰ روزه ({m['sma200']:,.0f})",
            "pos" if d >= 0 else "neg")
    if fin(m["pe_vs_sector"]) and m["pe_vs_sector"] > 0:
        add(f"P/E {m['pe_ratio']:.1f} در برابر میانگین صنعت {inst.sector_pe:.1f} → {m['pe_vs_sector']:.2f} برابر",
            "pos" if m["pe_vs_sector"] <= .85 else ("neg" if m["pe_vs_sector"] >= 1.6 else "neutral"))
    if fin(m["free_float"]) and m["free_float"] < 12:
        add(f"سهام شناور آزاد {m['free_float']:.1f}٪ — آسیب‌پذیر در برابر دستکاری قیمت", "neg")
    if fin(inst.tval):
        add(f"ارزش معاملات امروز {_money(inst.tval)} · {inst.tno:,.0f} معامله" if fin(inst.tno)
            else f"ارزش معاملات امروز {_money(inst.tval)}")
    return out


# ───────────────────────── سطح بازار ─────────────────────────
def analyze(inst, rules: C.Rules, weights: dict[str, float]) -> dict[str, Any]:
    m = metrics(inst)
    is_veto, codes, fa = veto_check(inst, m, rules)
    f = factor_scores(inst, m, rules)
    score = score_instrument(f, weights)
    plan = None
    if not is_veto:
        plan = signal_plan(inst, m, rules)
        plan["horizon"] = horizon_of(f)
    return {
        "inst": inst, "metrics": m, "veto": {"vetoed": is_veto, "codes": codes, "fa": fa},
        "factors": f, "score": score, "plan": plan,
        "reasons": [] if is_veto else explain(inst, m),
    }


def chg_of(inst) -> float:
    ref = inst.pc if (fin(inst.pc) and inst.pc) else inst.py
    return ((inst.pl - ref) / ref * 100) if (fin(ref) and ref and fin(inst.pl)) else -math.inf


def rank(instruments, rules: C.Rules | None = None, weights: dict | None = None, top: int = 10) -> dict:
    rules = rules or C.Rules()
    weights = weights or dict(C.WEIGHTS)
    rows, vetoed = [], []
    counts = {c: 0 for c in ("liq", "sellQueue", "state", "universe", "data")}
    for inst in instruments:
        r = analyze(inst, rules, weights)
        for c in r["veto"]["codes"]:
            if c in counts:
                counts[c] += 1
        (vetoed if r["veto"]["vetoed"] else rows).append(r)
    rows.sort(key=lambda r: (-(r["score"]["total"] if r["score"]["total"] is not None else -1),
                             -(r["score"]["confidence"] or 0)))
    return {"rows": rows, "top": rows[:top], "vetoed": vetoed, "veto_counts": counts,
            "scanned": len(instruments), "rules": rules, "weights": weights}


def market_pulse(instruments) -> dict[str, Any]:
    stocks = [i for i in instruments if i.kind == "stock"]
    up = down = flat = lim_up = lim_down = 0
    value = volume = net_real = buy_q = sell_q = 0.0
    sum_chg, n_chg = 0.0, 0
    for inst in stocks:
        m = metrics(inst)
        c = chg_of(inst)
        if fin(c) and c > -math.inf:
            sum_chg += c
            n_chg += 1
            if c > 0.05:
                up += 1
            elif c < -0.05:
                down += 1
            else:
                flat += 1
        if m["at_limit_up"]:
            lim_up += 1
        if m["at_limit_down"]:
            lim_down += 1
        value += inst.tval if fin(inst.tval) else 0
        volume += inst.tvol if fin(inst.tvol) else 0
        net_real += m["net_real_money"] if fin(m["net_real_money"]) else 0
        buy_q += m["buy_queue_value"] if fin(m["buy_queue_value"]) else 0
        sell_q += m["sell_queue_value"] if fin(m["sell_queue_value"]) else 0
    breadth = up / (up + down) if (up + down) else NAN
    temperature = clamp(
        34 * (breadth if fin(breadth) else .5)
        + 26 * .5
        + 22 * (1 / (1 + math.exp(-(sum_chg / n_chg) * 1.4)) if n_chg else .5)
        + 18 * (buy_q / (buy_q + sell_q) if (buy_q + sell_q) > 0 else .5))
    return {"count": len(stocks), "up": up, "down": down, "flat": flat,
            "limit_up": lim_up, "limit_down": lim_down, "value": value, "volume": volume,
            "net_real": net_real, "buy_queue_value": buy_q, "sell_queue_value": sell_q,
            "breadth": breadth, "equal_chg": (sum_chg / n_chg) if n_chg else NAN,
            "temperature": round(temperature)}


def sector_aggregates(instruments) -> list[dict]:
    agg: dict[str, dict] = {}
    for inst in instruments:
        if inst.kind != "stock":
            continue
        key = inst.sector or "—"
        rec = agg.setdefault(key, {"sector": key, "count": 0, "value": 0.0, "up": 0, "down": 0,
                                   "net_real": 0.0, "chg_sum": 0.0, "chg_n": 0, "members": []})
        rec["count"] += 1
        if fin(inst.tval):
            rec["value"] += inst.tval
        m = metrics(inst)
        if fin(m["net_real_money"]):
            rec["net_real"] += m["net_real_money"]
        c = chg_of(inst)
        if fin(c) and c > -math.inf:
            rec["chg_sum"] += c
            rec["chg_n"] += 1
            if c > 0.05:
                rec["up"] += 1
            elif c < -0.05:
                rec["down"] += 1
        rec["members"].append({"l18": inst.l18, "chg": c, "value": inst.tval if fin(inst.tval) else 0.0})
    out = []
    for r in agg.values():
        r = dict(r)
        r["avg_chg"] = (r["chg_sum"] / r["chg_n"]) if r["chg_n"] else NAN
        r["members"] = sorted(r["members"], key=lambda x: -x["value"])[:5]
        out.append(r)
    return sorted(out, key=lambda r: -r["value"])
