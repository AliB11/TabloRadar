"""config.py — ثوابت، قواعد بازار ایران و پیکربندی تابلورادار.

هیچ کلید API در این فایل نیست؛ از متغیرهای محیطی خوانده می‌شود:
    BRS_API_KEY   کلید BrsApi (اختیاری)
    BRS_API_BASE  پایه آدرس BrsApi
    TSETMC_CDN    پایه آدرس API رسمی TSETMC
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field

# ── منابع داده ────────────────────────────────────────────────────────────
BRS_API_KEY = os.environ.get("BRS_API_KEY", "")
BRS_API_BASE = os.environ.get("BRS_API_BASE", "https://Api.BrsApi.ir/Tsetmc/")
BRS_API_ALT = os.environ.get("BRS_API_ALT", "https://BrsApi.ir/Api/Tsetmc/")
TSETMC_CDN = os.environ.get("TSETMC_CDN", "https://cdn.tsetmc.com/api/")
TSETMC_LEGACY = os.environ.get("TSETMC_LEGACY", "https://service.tsetmc.com/tsev2/data/")
MARKET_URL = f"{BRS_API_BASE}AllSymbols.php?key={{key}}&type=1"
HISTORY_URL = f"{BRS_API_BASE}History.php?key={{key}}&type=0&l18={{l18}}"
OFFLINE_SNAPSHOT = os.environ.get("TR_SNAPSHOT", "data/offline-snapshot.json")

HTTP_TIMEOUT = float(os.environ.get("TR_TIMEOUT", "10"))
HTTP_RETRIES = 4                      # تلاش مجدد با وقفه نمایی
BACKOFF_BASE = 0.8

# ── قواعد بازار (مصوبات ۱۴۰۵) ─────────────────────────────────────────────
PRICE_LIMITS = {
    "stock": 0.03, "right": 0.03, "fund_equity": 0.04, "fund_fixed": 0.03,
    "fund_gold": 0.10, "base_yellow": 0.03, "base_orange": 0.02, "base_red": 0.01,
    "bond": 0.0,
}
DEFAULT_LIMIT = 0.03
BASE_VOLUME = 1                       # از ۱ دی ۱۴۰۴ (حذف گره معاملاتی)
WORKING_DAYS = (0, 1, 2, 5, 6)        # یکشنبه، دوشنبه، سه‌شنبه، شنبه، چهارشنبه (python: Mon=0)
SESSIONS = (("pre", "08:30", "09:00"), ("open", "09:00", "12:30"), ("tal", "12:45", "13:00"))

# ── موتور امتیاز ──────────────────────────────────────────────────────────
WEIGHTS = {"tablo": 30, "short": 20, "mid": 20, "long": 15, "risk": 15}
FACTOR_KEYS = ("tablo", "short", "mid", "long", "risk")
SUBWEIGHTS = {
    "tablo": {"buyer_power": 0.30, "net_real": 0.25, "obi": 0.15, "shock": 0.15, "k2k": 0.15},
    "mid": {"sma_gap": 0.30, "macd": 0.25, "vs_sma20": 0.25, "slope": 0.20},
    "long": {"vs_sma200": 0.35, "slope200": 0.20, "pe": 0.25, "turnover": 0.20},
    "risk": {"liquidity": 0.35, "queue": 0.25, "float": 0.20, "vol": 0.20},
    "short": {"rsi": 0.30, "ema": 0.25, "range": 0.15, "ret5": 0.30},
}
K2K_SCORE = {"legal2real": 100.0, "realCollect": 78.0, "none": 50.0, "realExit": 22.0, "real2legal": 5.0}


@dataclass
class Rules:
    """قوانین قابل‌تنظیم اسکن — همان چیزی که در UI هم قابل تغییر است."""
    min_value: float = 50_000_000_000      # حداقل ارزش معاملات روز (ریال)
    include_base: bool = False             # نمادهای بازار پایه
    include_funds: bool = False            # صندوق‌ها و اوراق
    include_rights: bool = False           # حق‌تقدم
    require_history: bool = False          # فقط نماد با تاریخچه
    min_float: float = 0.0                 # حداقل سهام شناور آزاد (٪)
    pe_penalty: float = 2.5                # ضریب جریمه P/E نسبت به میانگین صنعت
    stop_atr_mult: float = 1.6
    target_atr_mults: tuple[float, float, float] = (1.2, 2.2, 3.4)


@dataclass
class Settings:
    rules: Rules = field(default_factory=Rules)
    weights: dict[str, float] = field(default_factory=lambda: dict(WEIGHTS))
    top: int = 10
    history_for: int = 40                  # تعداد نماد برای واکشی تاریخچه (حالت زنده)
    loop_at: str = "12:35"                 # اجرای زمان‌بندی‌شده (ساعت تهران)
