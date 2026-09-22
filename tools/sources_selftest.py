#!/usr/bin/env python3
"""sources_selftest.py — آزمون آفلاین پارسرهای منابع دادهٔ واقعی

بدون شبکه اجرا می‌شود و روی قطعات واقعیِ برداشت‌شده از سایت‌ها (tests/fixtures) بررسی
می‌کند که:
  • tsepy/bourse_trader.py اعداد صفحهٔ نماد و نبض بازار را درست (و ریالی) بخواند؛
  • tsepy/tsetmc_live.py قالب MarketWatchInit/ClientTypeAll را درست پارس کند؛
  • **هیچ مقدار ساختگی** ساخته نشود: برچسب غایب ⇒ فیلد غایب.

اجرا:  python3 tools/sources_selftest.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from tsepy import bourse_trader as BT          # noqa: E402
from tsepy import tsetmc_live as TL            # noqa: E402

FIX = ROOT / "tests" / "fixtures"
SNAP = ROOT / "data" / "offline-snapshot.json"

PASS = 0
FAIL = 0


def check(name: str, got, want, tol: float = 1e-6) -> None:
    global PASS, FAIL
    ok = False
    if isinstance(want, (int, float)) and isinstance(got, (int, float)):
        ok = got is not None and abs(float(got) - float(want)) <= tol * max(1.0, abs(float(want)))
    else:
        ok = got == want
    if ok:
        PASS += 1
        print(f"  ✓ {name}")
    else:
        FAIL += 1
        print(f"  ✗ {name}: got={got!r} want={want!r}")


def check_true(name: str, cond: bool, extra: str = "") -> None:
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  ✓ {name}")
    else:
        FAIL += 1
        print(f"  ✗ {name} {extra}")


# ─────────────────────────── ۱. صفحهٔ نماد (دادهٔ واقعی) ───────────────────────────
print("\n۱) صفحهٔ نماد bourse-trader.ir — قطعهٔ واقعی فولاد (۱۴۰۵-۰۶-۳۱)")
sym = BT.symbol_from_text((FIX / "bourse_trader_symbol_folad.txt").read_text(encoding="utf-8"), "فولاد")

check("قیمت آخرین (ریال)", sym.get("pl"), 3230)
check("قیمت پایانی (ریال)", sym.get("pc"), 3260)
check("قیمت دیروز (ریال)", sym.get("py"), 3290)
check("کف مجاز روز (ریال)", sym.get("pmin"), 3200)
check("سقف مجاز روز (ریال)", sym.get("pmax"), 3380)
check("حجم معاملات", sym.get("tvol"), 3.7e9)
check("ارزش معاملات (ریال)", sym.get("tval"), 1.2e13)
check("تعداد معاملات", sym.get("tno"), 45559)
check("ورود پول حقیقی (ریال)", sym.get("netRealMoneyToday"), -1.223e12)
check("حجم مبنا", sym.get("bvol"), 1)
check("تعداد سهام", sym.get("zTitad"), 1.9e12)
check("ارزش بازار (ریال)", sym.get("marketCap"), 6.308e15)
check("P/E", sym.get("pe"), 6.29)
check("Group P/E", sym.get("sectorPE"), 13.18)
check("EPS (ریال، واحد صحت‌سنجی‌شده)", sym.get("eps"), 520)
check("درصد شناوری", sym.get("freeFloatPct"), 53.67)
check("حجم به شناوری", sym.get("volToFloatPct"), 0.36)
check_true("دفتر سفارش ۵ سطحی", len(sym.get("book", [])) == 5, f"(len={len(sym.get('book', []))})")
lvl1 = (sym.get("book") or [{}])[0]
check("سطح ۱ خرید — حجم", lvl1.get("qd"), 3_077_000)
check("سطح ۱ خرید — قیمت (ریال)", lvl1.get("pd"), 3220)
check("سطح ۱ فروش — قیمت (ریال)", lvl1.get("po"), 3240)
check_true("فیلد مبهم گزارش شده", sym.get("ambiguous") == [], f"ambiguous={sym.get('ambiguous')}")

# ─────────────────────────── ۲. نبض بازار (دادهٔ واقعی) ───────────────────────────
print("\n۲) صفحهٔ اصلی bourse-trader.ir — برش واقعی گزارش بازار (۱۴۰۵-۰۶-۳۱)")
ov = BT.overview_from_text((FIX / "bourse_trader_home.txt").read_text(encoding="utf-8"))
check("شاخص کل", ov.get("index_total"), 7_167_410)
check("شاخص هم‌وزن", ov.get("index_equal"), 1_922_310)
check("شاخص فرابورس", ov.get("index_fara"), 56785.0)
check("ارزش بازار (ریال)", ov.get("market_cap"), 2.45555e17)
check("ارزش معاملات خرد (ریال)", ov.get("retail_trade_value"), 3.88e14)
check("حجم معاملات خرد", ov.get("retail_volume"), 7.54e10)
check("نمادهای مثبت", ov.get("symbols_up"), 293)
check("نمادهای منفی", ov.get("symbols_down"), 654)
check("سرانه خرید حقیقی", ov.get("per_capita_buy"), 74.8)
check("ورود پول حقیقی معاملات خرد (ریال)", ov.get("retail_money_inflow_rial"), -4.78e13)
check_true("جدول بیشترین ورود پول", len(ov.get("top_inflow", [])) >= 10, f"(len={len(ov.get('top_inflow', []))})")
check_true("جدول بیشترین خروج پول", len(ov.get("top_outflow", [])) >= 5, f"(len={len(ov.get('top_outflow', []))})")
top1 = (ov.get("top_inflow") or [{}])[0]
check("نماد اول ورود پول", top1.get("symbol"), "فزر")
check("مبلغ ورود پول نماد اول (ریال)", top1.get("money_rial"), 4.815e12)

# ─────────────────────────── ۳. TSETMC (نمونهٔ ساختاری) ───────────────────────────
print("\n۳) TSETMC — نمونهٔ ساختاری MarketWatchInit/ClientTypeAll")
raw = (FIX / "tsetmc_marketwatchinit.format-sample.txt").read_text(encoding="utf-8")
parts = raw.split("@")
check_true("۵ بخشی بودن پاسخ (پیام/وضعیت/قیمت/دفتر/refid)", len(parts) == 5)
state = TL.parse_market_state(parts[1])
check("شاخص کل از وضعیت بازار", state.get("index_total"), 7_167_410)
check("تغییر شاخص (منفی داخل پرانتز)", state.get("index_change"), -113_024)
check("درصد تغییر شاخص", state.get("index_change_pct"), -1.5524)
prices = TL._rows(parts[2], ",", len(TL.PRICE_COLS))
limits = TL._rows(parts[3], ",", 8)
check_true("۲ سطر قیمت", len(prices) == 2)
check_true("۱۰ سطر دفتر سفارش (۲ نماد × ۵ عمق)", len(limits) == 10)

cols = ("insCode", "n_buy_count", "l_buy_count", "n_buy_vol", "l_buy_vol",
        "n_sell_count", "l_sell_count", "n_sell_vol", "l_sell_vol")
clients = {}
for line in (FIX / "tsetmc_clienttypeall.format-sample.txt").read_text(encoding="utf-8").splitlines():
    if line.strip():
        cells = line.split(",")
        clients[cells[0]] = {cols[i]: TL.to_num(cells[i]) for i in range(len(cols))}

mw = {"prices": [dict(zip(TL.PRICE_COLS, r)) for r in prices], "limits": {}}
for row in limits:
    code, depth = row[0], int(TL.to_num(row[1]))
    mw["limits"].setdefault(code, {})[depth] = {
        "zo": TL.to_num(row[2]), "zd": TL.to_num(row[3]), "pd": TL.to_num(row[4]),
        "po": TL.to_num(row[5]), "qd": TL.to_num(row[6]), "qo": TL.to_num(row[7])}
insts = TL.build_instruments(mw, clients)
check_true("ادغام قیمت+حقیقی/حقوقی+دفتر سفارش", len(insts) == 2)
first = insts[0]
check("قیمت پایانی نماد نمونه", first.get("pc"), 10000)
check("ارزش معاملات نماد نمونه", first.get("tval"), 50_250_000_000)
check("PE محاسبه‌شده (pc/eps)", first.get("pe"), 12.5)
check("خرید حقیقی — حجم", first.get("Buy_I_Volume"), 4_000_000)
check("خرید حقوقی — حجم", first.get("Buy_N_Volume"), 1_000_000)
check("دفتر سفارش عمق ۵ (خرید)", first.get("qd5"), 1_000_000)
check("بازار از flow=1", first.get("market"), "بورس")
check_true("provenance=tsetmc و synthetic=False",
           first.get("provenance") == "tsetmc" and first.get("synthetic") is False)

# ─────────────────────────── ۴. تضمین «بدون ساختگی‌سازی» ───────────────────────────
print("\n۴) تضمین نبود داده ساختگی در پارسرها")
empty = BT.symbol_from_text("این متن هیچ برچسب تابلویی ندارد", "تست")
check_true("متن بی‌برچسب ⇒ هیچ فیلدی", not any(k for k in empty if k not in
           ("symbol", "source", "raw_found", "ambiguous")))
check_true("EPS غایب ⇒ PE ساخته نمی‌شود",
           "pe" not in TL.merge_instrument({"insCode": "1", "eps": ""}))
check_true("مقدار نامعتبر ⇒ NaN (نه صفر)", TL.to_num("—") != TL.to_num("—"))

# ─────────────────────────── ۵. اسنپ‌شات همراه ریپو صادق باشد ───────────────────────────
print("\n۵) اسنپ‌شات آفلاین — برچسب‌گذاری صادقانه")
snap = json.loads(SNAP.read_text(encoding="utf-8"))
kind = snap.get("data_kind") or ("simulated" if snap.get("simulated_fields") else snap.get("kind"))
check_true("schema نسخهٔ ۲", snap.get("schema") == "tabloradar.offline-snapshot/v2")
check_true("نوع داده مشخص است (live|simulated)",
           kind in ("live", "simulated", "live-partial"), f"kind={kind!r}")
if kind == "simulated":
    bad = [r.get("l18") for r in snap.get("instruments", []) if r.get("synthetic") is not True]
    check_true("همهٔ رکوردهای شبیه‌سازی‌شده synthetic=True", not bad, f"(نمونه: {bad[:3]})")
    check_true("فهرست فیلدهای شبیه‌سازی‌شده اعلام شده",
               bool(snap.get("simulated_fields")))
else:
    check_true("رکوردهای زنده synthetic=False",
               all(r.get("synthetic") is False for r in snap.get("instruments", [])))

print(f"\nنتیجه: {PASS} قبول، {FAIL} رد")
raise SystemExit(1 if FAIL else 0)
