#!/usr/bin/env python3
"""
make_offline_snapshot.py — سازنده اسنپ‌شات آفلاین تابلورادار

خروجی: data/offline-snapshot.json
  - قیمت‌ها و ارزش معاملات نمادهای مرجع از گزارش‌های رسمی/خبری ۲۸ تا ۳۰ شهریور ۱۴۰۵ گرفته شده‌اند.
  - تفکیک حقیقی/حقوقی، دفتر سفارش و تاریخچه ۲۶۰ جلسه‌ای «شبیه‌سازی قطعی» (seed ثابت) است
    و در فایل با پرچم synthetic برچسب خورده است — صرفاً برای اجرای آفلاین/تست رابط کاربری.

اجرا:  python3 tools/make_offline_snapshot.py
"""
from __future__ import annotations

import json
import math
import random
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "offline-snapshot.json"
SESSIONS = 260
SEED = 14050630

# ── لنگرهای واقعی: (ل18, نام, صنعت, cs_id, بازار/تابلو, py, pc, tval_ریال, tno, zTitad, eps, profile)
# profile: accumulation | distribution | neutral | panic | quiet
ANCHORS = [
    ("فولاد", "فولاد مبارکه اصفهان", "فلزات اساسی", 27, "بازار اول", 3300, 3210, 1_831_000_000_000, 5773, 46_000_000_000, 419, "distribution"),
    ("فملی", "ملی صنایع مس ایران", "فرآورده‌های نفتی، کک و سوخت هسته‌ای", 35, "بازار اول", 26310, 25530, 1_209_000_000_000, 4124, 24_000_000_000, 2520, "distribution"),
    ("وبملت", "بانک ملت", "بانک‌ها و مؤسسات اعتباری", 6, "بازار اول", 7165, 7382, 12_150_000_000_000, 16_727, 16_260_000_000, None, "accumulation"),
    ("وپاسار", "بانک پاسارگاد", "بانک‌ها و مؤسسات اعتباری", 6, "بازار اول", 10200, 9900, 2_529_000_000_000, 5754, 16_000_000_000, None, "distribution"),
    ("نوری", "پتروشیمی نوری", "محصولات شیمیایی", 2, "بازار اول", 47790, 48590, 4_080_000_000_000, 8948, 1_400_000_000, 6300, "accumulation"),
    ("تابان", "گروه پتروشیمی تابان فردا", "محصولات شیمیایی", 2, "بازار دوم", 18710, 19270, 12_541_000_000_000, 90_970, 5_900_000_000, None, "accumulation"),
    ("شپنا", "پالایش نفت اصفهان", "فرآورده‌های نفتی، کک و سوخت هسته‌ای", 35, "بازار اول", 5300, 5420, 9_750_000_000_000, 3210, 3_500_000_000, 980, "accumulation"),
    ("شبندر", "پالایش نفت بندرعباس", "فرآورده‌های نفتی، کک و سوخت هسته‌ای", 35, "بازار اول", 6280, 6345, 4_950_000_000_000, 7420, 4_200_000_000, 1120, "neutral"),
    ("شتران", "پالایش نفت تهران", "فرآورده‌های نفتی، کک و سوخت هسته‌ای", 35, "بازار اول", 3050, 3115, 3_410_000_000_000, 6310, 4_400_000_000, 690, "neutral"),
    ("خودرو", "ایران خودرو", "خودرو و ساخت قطعات", 34, "بازار اول", 3200, 3284, 5_640_000_000_000, 12_400, 16_000_000_000, None, "accumulation"),
    ("خساپا", "سایپا", "خودرو و ساخت قطعات", 34, "بازار اول", 3426, 3568, 4_820_000_000_000, 9_850, 12_000_000_000, None, "accumulation"),
    ("فارس", "هلدینگ نفت و گاز و پتروشیمی تأمین", "محصولات شیمیایی", 2, "بازار اول", 8650, 8815, 3_820_000_000_000, 8120, 8_000_000_000, None, "neutral"),
    ("کگل", "سنگ‌آهن گل‌گهر", "استخراج کانه‌های فلزی", 5, "بازار اول", 8840, 8940, 6_240_000_000_000, 4210, 4_000_000_000, 1240, "accumulation"),
    ("فزر", "پویا زرکان آق‌دره", "استخراج کانه‌های فلزی", 5, "بازار دوم فرابورس", 292400, 283700, 899_000_000_000, 14_947, 560_000_000, 41_000, "panic"),
    ("شستا", "سرمایه‌گذاری تأمین اجتماعی", "سرمایه‌گذاری‌ها", 3, "بازار اول", 5834, 5925, 8_420_000_000_000, 11_300, 40_000_000_000, None, "neutral"),
    ("وغدیر", "سرمایه‌گذاری غدیر", "سرمایه‌گذاری‌ها", 3, "بازار اول", 2210, 2265, 1_420_000_000_000, 5210, 8_000_000_000, None, "accumulation"),
    ("خذوب", "ذوب آهن اصفهان", "فلزات اساسی", 27, "بازار اول", 1450, 1489, 2_160_000_000_000, 9820, 12_000_000_000, None, "accumulation"),
    ("اخابر", "مخابرات ایران", "مخابرات", 7, "بازار اول", 2980, 3040, 1_180_000_000_000, 6410, 18_000_000_000, 210, "neutral"),
    ("حکشتی", "کشتیرانی جمهوری اسلامی ایران", "حمل و نقل، انبارداری و ارتباطات", 31, "بازار اول", 6690, 6780, 3_820_000_000_000, 4120, 4_800_000_000, 980, "accumulation"),
    ("رمپنا", "سپاهان رامپنا", "ماشین‌آلات و دستگاه‌های برقی", 19, "بازار اول", 4810, 4955, 2_140_000_000_000, 7310, 2_000_000_000, 1130, "accumulation"),
    ("وتجارت", "بانک تجارت", "بانک‌ها و مؤسسات اعتباری", 6, "بازار اول", 1276, 1286, 7_120_000_000_000, 5120, 40_000_000_000, None, "quiet"),
    ("غزنجان", "شیر پاستوریزه پگاه زنجان", "محصولات لبنی", 32, "بازار دوم", 6144, 6320, 420_000_000_000, 2240, 1_200_000_000, 240, "accumulation"),
    ("شپدیس", "پتروشیمی پارس", "محصولات شیمیایی", 2, "بازار اول", 13850, 13420, 1_960_000_000_000, 3820, 3_050_000_000, 2450, "distribution"),
    ("پارس", "گروه گسترش نفت و گاز پارسیان", "محصولات شیمیایی", 2, "بازار اول", 9120, 9330, 2_280_000_000_000, 5410, 11_500_000_000, None, "neutral"),
    ("زغال‌سنگ", "صندوق نمونه طلا (قابل معامله)", "صندوق‌ها", 26, "بازار اول", 18400, 18620, 610_000_000_000, 1810, None, None, "quiet"),
    ("نمادپایه‌قرمز", "نماد نمونه بازار پایه قرمز", "سیمان، آهک و گچ", 16, "بازار پایه", 940, 931, 24_000_000_000, 620, 900_000_000, None, "panic"),
    ("نمادمتوقف", "نماد نمونه متوقف (در ناظر)", "انبوه‌سازی، املاک و مستغلات", 21, "بازار دوم", 4100, 4100, 0, 0, 600_000_000, None, "quiet"),
]

# شاخص‌های رسمی/خبری برای پنل «نبض بازار» (حالت آفلاین)
INDICES = {
    "index_total": {"fa": "شاخص کل بورس", "value": 7_288_699, "chg_pct": -2.15},
    "index_equal": {"fa": "شاخص کل هم‌وزن", "value": 1_946_611, "chg_pct": -2.02},
    "index_float": {"fa": "شاخص آزاد شناور", "value": 9_177_235, "chg_pct": -2.30},
    "index_fara": {"fa": "شاخص کل فرابورس", "value": 58_193.64, "chg_pct": -1.60},
    "market_cap": {"fa": "ارزش بازار بورس (ریال)", "value": 211_362_149_000_000_000, "chg_pct": None},
    "session_count": {"fa": "تعداد نمادهای اسکن‌شده", "value": 734, "chg_pct": None},
}

MACRO = {
    "as_of": "۱۴۰۵-۰۶-۳۰ (شروع هفته معاملاتی)",
    "usd_free": 230_920,
    "usd_exchange_center": 167_598,
    "inflation_yoy_pct": 69.9,
    "inflation_ptp_pct": 89.0,
    "deposit_1y_pct": 20.5,
    "deposit_3y_pct": 22.5,
    "price_limit_pct": 3.0,
    "base_volume": 1,
    "note": "دامنه نوسان سهام ۳٪، صندوق سهامی ۴٪، صندوق طلا ۱۰٪، بازار پایه ۱ تا ۳٪ — حجم مبنا از ۱ دی ۱۴۰۴ برابر یک سهم",
}

SECTOR_CHG = {   # میانگین تغییر شاخص صنعت در آخرین جلسه (منبع: گزارش ۳۱ شهریور ۱۴۰۵)
    "فلزات اساسی": -0.78, "محصولات شیمیایی": 2.24, "بانک‌ها و مؤسسات اعتباری": -0.87,
    "استخراج کانه‌های فلزی": 1.00, "فرآورده‌های نفتی، کک و سوخت هسته‌ای": -1.56,
    "خودرو و ساخت قطعات": -0.38, "سرمایه‌گذاری‌ها": 1.45, "حمل و نقل، انبارداری و ارتباطات": 0.20,
    "محصولات لبنی": 0.65, "مخابرات": 0.15, "سیمان، آهک و گچ": -1.24,
    "انبوه‌سازی، املاک و مستغلات": -1.53, "ماشین‌آلات و دستگاه‌های برقی": 0.50, "صندوق‌ها": 0.05,
}


def history(rng: random.Random, pc: int, profile: str, sector_chg: float,
            tvol_ref: int = 300_000_000, shock_ref: float = 1.6) -> tuple[list[int], list[int]]:
    """تاریخچه ۲۶۰ جلسه‌ای: روند بازار + آلفای صنعت + پروفایل جریان پول نماد."""
    drift_by_profile = {
        "accumulation": 0.0016, "distribution": -0.0006,
        "neutral": 0.0004, "panic": -0.0022, "quiet": 0.0001,
    }
    vol_by_profile = {"accumulation": 0.014, "distribution": 0.017, "neutral": 0.012,
                      "panic": 0.028, "quiet": 0.008}
    drift = drift_by_profile[profile] + sector_chg / 100 / 250
    vol = vol_by_profile[profile]

    closes = [pc]
    for _ in range(SESSIONS - 1):
        shock = rng.gauss(0, vol)
        cycle = 0.0035 * math.sin(len(closes) / 26.0)
        closes.append(closes[-1] * (1 + drift + shock + cycle))
    closes.reverse()

    closes = [max(1, round(c * (pc / closes[-1]))) for c in closes]
    base_v = max(1, int(25_000_000 + rng.random() * 120_000_000))
    vols = []
    for i in range(len(closes)):
        bump = 2.4 if i >= len(closes) - 3 else 1.0
        vols.append(int(base_v * (0.55 + abs(math.sin(i / 9.0)) * 0.9 + rng.random() * 0.35) * bump))
    # نرمال‌سازی حجم تاریخی تا «حجم مشکوک» امروز در بازوی منطقی ۱.۱ تا ۲.۴ بماند
    target = max(1.0, tvol_ref / max(0.4, shock_ref))
    cur = sum(vols[-30:]) / min(30, len(vols))
    vols = [max(1, int(v * target / cur)) for v in vols]
    return closes, vols


def flows(rng: random.Random, profile: str, tval: int, tno: int, tvol: int) -> dict:
    """تفکیک حقیقی/حقوقی و دفتر سفارش (شبیه‌سازی‌شده بر اساس پروفایل)."""
    real_buy_share = {"accumulation": 0.86, "distribution": 0.44, "neutral": 0.62,
                      "panic": 0.30, "quiet": 0.55}[profile]
    real_sell_share = {"accumulation": 0.55, "distribution": 0.74, "neutral": 0.60,
                       "panic": 0.78, "quiet": 0.52}[profile]
    buyIVol = int(tvol * real_buy_share * (0.9 + rng.random() * 0.15))
    sellIVol = int(tvol * real_sell_share * (0.9 + rng.random() * 0.15))
    buyNVol = max(0, tvol - buyIVol)
    sellNVol = max(0, tvol - sellIVol)

    buyICount = max(1, int(tno * real_buy_share * (0.75 + rng.random() * 0.35)))
    sellICount = max(1, int(tno * real_sell_share * (0.75 + rng.random() * 0.35)))
    buyNCount = max(1, int(tno * (1 - real_buy_share) * 0.02)) + 1
    sellNCount = max(1, int(tno * (1 - real_sell_share) * 0.02)) + 1

    vwap = tval / max(1, tvol)
    return {
        "Buy_CountI": buyICount, "Buy_I_Volume": buyIVol,
        "Sell_CountI": sellICount, "Sell_I_Volume": sellIVol,
        "Buy_CountN": buyNCount, "Buy_N_Volume": buyNVol,
        "Sell_CountN": sellNCount, "Sell_N_Volume": sellNVol,
        "vwap": round(vwap),
        "qTotTran5JAvg": round(tval * (0.65 + rng.random() * 0.6)),
    }


def book(rng: random.Random, pc: int, pl: int, tmin: int, tmax: int, profile: str, tick_size: int) -> dict:
    """دفتر ۵ سطحی؛ در نمادهای چسبیده به سقف/کف، سطح مربوطه قفل می‌شود."""
    out: dict = {}
    locked_up = pl >= tmax
    locked_dn = pl <= tmin
    for i in range(1, 6):
        bid_p = pl if (locked_up and i == 1) else pl - i * tick_size * rng.randint(1, 4)
        ask_p = pl if (locked_dn and i == 1) else pl + i * tick_size * rng.randint(1, 3)
        bid_p = max(tmin, int(round(bid_p / tick_size) * tick_size))
        ask_p = max(bid_p + tick_size, int(round(ask_p / tick_size) * tick_size))
        scale = 1_000_000 * (1 + i * 0.4)
        bid_q = int(scale * (0.4 + rng.random()))
        ask_q = int(scale * (0.4 + rng.random()))
        if locked_up and i == 1:
            bid_q = int(scale * (6 + rng.random() * 14))
            ask_q = 0
        if locked_dn and i == 1:
            ask_q = int(scale * (6 + rng.random() * 14))
            bid_q = 0
        if profile == "panic" and i == 1:
            ask_q = int(ask_q * 4.2)
        out[f"pd{i}"] = bid_p
        out[f"qd{i}"] = bid_q
        out[f"zd{i}"] = max(1, int(bid_q / (scale * 0.08)))
        out[f"po{i}"] = ask_p
        out[f"qo{i}"] = ask_q
        out[f"zo{i}"] = max(1, int(ask_q / (scale * 0.08))) if ask_q else 0
    return out


def main() -> None:
    rng = random.Random(SEED)
    limit = 0.03
    instruments = []
    for idx, (l18, l30, cs, cs_id, board, py, pc, tval, tno, z, eps, profile) in enumerate(ANCHORS):
        tick = max(1, int(round(pc * 0.0005)))
        tmax = round(pc * (1 + limit))
        tmin = round(pc * (1 - limit))
        if profile == "accumulation" and idx % 3 == 0:
            pl = tmax                      # چسبیده به سقف
        elif profile == "panic":
            pl = tmin                       # چسبیده به کف
        else:
            pl = round(pc * (1 + rng.uniform(-0.004, 0.010)))
        pl = min(tmax, max(tmin, pl))
        pmax = max(pl, round(pc * (1 + rng.uniform(0.005, limit))))
        pmin = min(pl, round(pc * (1 - rng.uniform(0.005, limit))))
        pf = round((pmin + pmax) / 2 * (1 + rng.uniform(-0.002, 0.002)))
        tvol = int(tval / max(1, pc)) if tval else 0

        rec = {
            "l18": l18, "l30": l30, "cs": cs, "cs_id": cs_id,
            "insCode": str(60_000_000_000_00000 + idx * 7_111_711),
            "cgrValCotTitle": board,
            "flowTitle": "بازار فرابورس" if "فرابورس" in board else "بازار بورس",
            "py": py, "pc": pc, "pl": pl, "pf": pf, "pmin": pmin, "pmax": pmax,
            "tmax": tmax, "tmin": tmin,
            "tvol": tvol, "tval": tval, "tno": tno, "bvol": 1,
            "eps": eps, "pe": round(pc / eps) if eps else None,
            "sectorPE": round(rng.uniform(6, 16), 1),
            "zTitad": z, "kAjCapValCpsIdx": round(rng.uniform(6, 34), 1),
            "state": "توقف نماد" if tno == 0 else "مجاز",
            # ⚠ این اسنپ‌شات «شبیه‌سازی» است (نه دادهٔ زنده): لنگرهای واقعی فقط
            #   py/pc/tval/tno/zTitad/eps هستند؛ بقیه با seed ثابت ساخته می‌شوند.
            "provenance": "offline-simulated",
            "synthetic": True,
            "anchor_fields": ["py", "pc", "tval", "tno", "zTitad", "eps"],
            "simulated_fields": ["pl", "pf", "pmin", "pmax", "tmax", "tmin", "tvol", "bvol",
                                 "sectorPE", "kAjCapValCpsIdx", "Buy_CountI", "Buy_I_Volume",
                                 "Buy_CountN", "Buy_N_Volume", "Sell_CountI", "Sell_I_Volume",
                                 "Sell_CountN", "Sell_N_Volume", "vwap", "qTotTran5JAvg",
                                 "pd1", "qd1", "zd1", "po1", "qo1", "zo1", "history"],
        }
        if tno:
            rec.update(flows(rng, profile, tval, tno, tvol))
            rec.update(book(rng, pc, pl, tmin, tmax, profile, tick))
        closes, vols = history(rng, pc, profile, SECTOR_CHG.get(cs, 0.0), max(1, tvol), rng.uniform(1.1, 2.4))
        rec["history"] = {"c": closes, "v": vols}
        instruments.append(rec)

    payload = {
        "schema": "tabloradar.offline-snapshot/v2",
        "as_of": MACRO["as_of"],
        "currency": "IRR (ریال)",
        "data_kind": "simulated",
        "generated_by": "tools/make_offline_snapshot.py",
        "disclaimer": (
            "این فایل دادهٔ زنده نیست: صرفاً برای اجرای بدون شبکه/تست رابط ساخته شده است. "
            "از هر رکورد، فقط لنگرها (قیمت پایانی و دیروز، ارزش معاملات، تعداد معاملات، تعداد سهام، EPS) "
            "از گزارش‌های منتشرشده ۲۸ تا ۳۰ شهریور ۱۴۰۵ گرفته شده‌اند؛ نقدینگی حقیقی/حقوقی، دفتر سفارش ۵ سطحی "
            "و تاریخچهٔ ۲۶۰ جلسه‌ای با مولد قطعی (seed=14050630) شبیه‌سازی شده‌اند و مقدار واقعی ندارند. "
            "برای دادهٔ واقعی: python3 tools/fetch_live_snapshot.py (رونوشت زنده از TSETMC/بورس‌تریدر)."
        ),
        "simulated_fields": {
            "real_anchors": ["py", "pc", "tval", "tno", "zTitad", "eps"],
            "simulated": ["pl", "pf", "pmin", "pmax", "tmax", "tmin", "tvol", "bvol",
                          "sectorPE", "kAjCapValCpsIdx", "حقیقی/حقوقی (Buy/Sell_*)",
                          "دفتر سفارش ۵ سطحی (pd/qd/zd…)", "vwap", "qTotTran5JAvg",
                          "history (۲۶۰ جلسه)"],
            "seed": 14050630,
            "note": "سنجه‌های مشتق از فیلدهای شبیه‌سازی‌شده (قدرت خریدار، پول حقیقی خالص، صف، حجم مشکوک) "
                    "هم به‌تبع شبیه‌سازی‌شده‌اند؛ امتیاز/رتبه را به‌عنوان سیگنال واقعی نخوانید.",
        },
        "rules": MACRO,
        "indices": INDICES,
        "history_kind": "close+volume only (بدون high/low → ATR برآوردی از دامنه نوسان محاسبه می‌شود)",
        "instruments": instruments,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"✓ {OUT.relative_to(ROOT)} — {len(instruments)} نماد — {OUT.stat().st_size/1024:.1f} KB")
    n_ev = write_events(instruments)
    print(f"✓ {EV_OUT.relative_to(ROOT)} — {n_ev} رویداد (برچسب‌دار/شبیه‌سازی)")


# ── رویدادهای نماد (هفتۀ ۲ نقشه راه) — فایل جدا، seed مستقل، بدون تغییر در اسنپ‌شات ──
EV_OUT = ROOT / "data" / "events.json"

EVENT_KINDS = (
    ("assembly", "مجمع", "رأی‌گیری دربارهٔ {detail}"),
    ("capincrease", "افزایش سرمایه", "افزایش {p}٪ سرمایه از محل {src}"),
    ("reopen", "بازگشایی", "بازگشایی پس از رفع توقف؛ حد سفارش روزِ اول {lim}٪"),
    ("dividend", "سود نقدی", "سود {dps} ریال به ازای هر سهم؛ شروع پرداخت"),
    ("offer", "عرضه اولیه", "{lots} میلیون سهم در قیمت هر سهم {px} ریال"),
    ("profit", "افصاری کدال", "افصاری {span}ماهه منتشر می‌شود"),
)
SOURCES = ("اندوزی سود گذشته", "آوردهٔ سهامداران", "سود انباشته", "ماده ۱۲۵ قانون معادن")
CAPS = (30, 40, 50, 60, 100, 120)


def jalali_plus(day: int, offset: int) -> tuple[int, int]:
    """(ماه ۶=تیر … ۷=مرداد) سرانهٔ تقویمِ نمایشی: ۳۱ روزه؛ فقط همین دو ماهِ اطراف as_of."""
    m, d = 6, day + offset
    while d > 31:
        d -= 31
        m += 1
    return m, d


def write_events(instruments: list[dict]) -> int:
    ev_rng = random.Random(SEED ^ 0x5EED)      # جریان مستقل — اسنپ‌شات دست‌نخورده می‌ماند
    events = []
    for rec in instruments:
        if rec.get("tno", 0) == 0:
            continue
        if ev_rng.random() > 0.62:
            continue                            # همه نمادها رویداد ندارند — واقعی‌تر
        while True:
            kind, fa, tmpl = EVENT_KINDS[ev_rng.randrange(len(EVENT_KINDS))]
            if kind != "offer" or rec["l18"].startswith("نماد"):
                break   # «عرضه اولیه» فقط برای نمادهای تازه‌پذیره‌شدهٔ فهرست منطقی است
        off = int(ev_rng.uniform(-4, 25))       # گذشته و پیش‌رو
        m, d = jalali_plus(30, off)
        if kind == "assembly":
            body = {"detail": f"افزایش سرمایهٔ {ev_rng.choice(CAPS)}٪ و {ev_rng.choice(SOURCES)}"}
        elif kind == "capincrease":
            body = {"p": ev_rng.choice(CAPS), "src": ev_rng.choice(SOURCES)}
        elif kind == "reopen":
            body = {"lim": ev_rng.choice((3, 5, 7)) * 10}
        elif kind == "dividend":
            body = {"dps": int(rec["pc"] * ev_rng.uniform(0.05, 0.35)) * 10}
        elif kind == "offer":
            body = {"lots": ev_rng.choice((120, 300, 450, 800)),
                    "px": int(rec["pc"] * ev_rng.uniform(0.85, 1.0))}
        else:
            body = {"span": ev_rng.choice(("یکم", "دوم", "سوم"))}
        detail = tmpl.format(**body)
        events.append({
            "l18": rec["l18"], "l30": rec["l30"], "type": kind, "type_fa": fa,
            "days_ahead": off, "date": f"1405-{m:02d}-{d:02d}",
            "title": f"{fa} — {rec['l18']}", "detail": detail,
            "provenance": "simulated",
        })
    events.sort(key=lambda e: e["days_ahead"])
    payload = {
        "schema": "tabloradar.events/v1",
        "as_of": MACRO["as_of"],
        "disclaimer": ("این فایل نمایش رابط «کارت اتفاقات نماد» است؛ رویدادها شبیه‌سازیِ قطعی "
                       "(seed=14050630^0x5EED)‌اند و ادعای واقعیت ندارند. در نسخۀ متصل، خواننده از "
                       "کدال/TSETMC جایگزین می‌شود (پیکربندی: منبع دوم در README § API‌ها)."),
        "events": events,
    }
    EV_OUT.parent.mkdir(parents=True, exist_ok=True)
    EV_OUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return len(events)


if __name__ == "__main__":
    main()
