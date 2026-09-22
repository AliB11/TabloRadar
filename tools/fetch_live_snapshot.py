#!/usr/bin/env python3
"""fetch_live_snapshot.py — ساخت اسنپ‌شات **واقعی** از منابع زنده

این ابزار روی ماشینی اجرا می‌شود که به سرویس‌های بازار دسترسی دارد (سرور/سیستم خودتان).
خروجی، همان فایل `data/offline-snapshot.json` است اما این‌بار با دادهٔ واقعی و
`data_kind: "live"`؛ بنابراین داشبورد حتی در حالت بی‌شبکه هم عدد واقعی نشان می‌دهد —
و دیگر هیچ‌جا «شبیه‌سازی» نمایش داده نمی‌شود.

منابع (به ترتیب):
  ۱) TSETMC: MarketWatchInit (قیمت/دفتر سفارش/شاخص) + ClientTypeAll (حقیقی‑حقوقی)
  ۲) TSETMC: chart/Financial.aspx برای تاریخچهٔ تعدیل‌شدهٔ نمادهای برگزیده
  ۳) TSETMC: Instrument/GetInstrumentInfo برای شناسنامه (تابلو/صنعت/EPS/شناوری)
  ۴) bourse-trader.ir (اختیاری، --bt): ورود پول، P/E، Group P/E، EPS، شناوری،
     سرانه‌ها و میانگین حجم‌ها برای نمادهای برگزیده + نبض بازار (شاخص/ارزش بازار)

اجرا:
  python3 tools/fetch_live_snapshot.py                    # پیش‌فرض: ۸۰ تاریخچه، ۴۰ شناسنامه
  python3 tools/fetch_live_snapshot.py --history 200 --enrich 120 --bt 15
  python3 tools/fetch_live_snapshot.py --out /tmp/snap.json --dry-run
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from tsepy import bourse_trader as BT      # noqa: E402
from tsepy import tsetmc_live as TL        # noqa: E402

DEFAULT_OUT = ROOT / "data" / "offline-snapshot.json"
DEFAULT_RULES = {
    "as_of": "",
    "price_limit_pct": 3.0,
    "base_volume": 1,
    "note": "دامنه نوسان سهام ۳٪، صندوق سهامی ۴٪، صندوق طلا ۱۰٪، بازار پایه ۱ تا ۳٪ — "
            "حجم مبنا از ۱ دی ۱۴۰۴ برابر یک سهم",
}


def num(v) -> float | None:
    return float(v) if isinstance(v, (int, float)) and v == v else None


def main() -> int:
    ap = argparse.ArgumentParser(description="ساخت اسنپ‌شات زندهٔ تابلورادار")
    ap.add_argument("--out", default=str(DEFAULT_OUT), help="مسیر خروجی (پیش‌فرض: data/offline-snapshot.json)")
    ap.add_argument("--history", type=int, default=80, help="تعداد نمادهایی که تاریخچه می‌گیرند")
    ap.add_argument("--history-days", type=int, default=260, help="طول تاریخچه (جلسه)")
    ap.add_argument("--enrich", type=int, default=40, help="تعداد نمادهایی که شناسنامه می‌گیرند")
    ap.add_argument("--bt", type=int, default=0, help="تعداد نمادهایی که از بورس‌تریدر هم غنی می‌شوند")
    ap.add_argument("--timeout", type=float, default=20.0)
    ap.add_argument("--dry-run", action="store_true", help="فقط بساز و گزارش بده، ننویس")
    args = ap.parse_args()

    t0 = time.time()
    print("→ TSETMC: دریافت MarketWatchInit …")
    try:
        mw = TL.market_watch_init(args.timeout)
    except (urllib.error.URLError, OSError, TimeoutError, RuntimeError) as e:
        print(f"\n✗ دسترسی به TSETMC برقرار نشد ({type(e).__name__}: {e})")
        print("  این ابزار باید روی ماشینی اجرا شود که به سرویس‌های بازار دسترسی دارد.")
        print("  وضعیت همهٔ منابع:  python3 tools/check_data_sources.py")
        print("  خارج از ایران:  BRS_API_KEY=… python3 tools/fetch_live_snapshot.py")
        print("  (اسنپ‌شات فعلی دست‌نخورده ماند؛ هیچ داده‌ای بازنویسی نشد.)")
        return 3
    state = mw["market_state"]
    print(f"  ✓ {len(mw['prices']):,} نماد | وضعیت بازار: {state.get('datetime_raw')} "
          f"| شاخص کل: {state.get('index_total')}")

    print("→ TSETMC: دریافت ClientTypeAll (حقیقی/حقوقی) …")
    try:
        clients = TL.client_type_all(args.timeout)
        print(f"  ✓ {len(clients):,} ردیف حقیقی/حقوقی")
    except Exception as e:  # noqa: BLE001
        clients = {}
        print(f"  ⚠ دریافت نشد ({type(e).__name__}: {e}) — فیلدهای حقیقی/حقوقی خالی می‌مانند")

    rows = TL.build_instruments(mw, clients)
    if len(rows) < 30:
        print(f"✗ پاسخ بازار کوتاه بود ({len(rows)} ردیف) — احتمالاً سرویس در دسترس نیست.")
        return 2

    # اولویت‌بندی بر اساس ارزش معاملات (نمادهای پرگردش، تاریخچه/شناسنامه می‌گیرند)
    def tval_of(r: dict) -> float:
        return r.get("tval") or 0.0

    ranked = sorted(rows, key=tval_of, reverse=True)
    by_code = {r["insCode"]: r for r in rows}

    if args.enrich > 0:
        print(f"→ TSETMC: شناسنامهٔ {args.enrich} نماد پرگردش …")
        done = 0
        for row in ranked[:args.enrich]:
            info = TL.instrument_info(row["insCode"], args.timeout)
            if not info:
                continue
            merged = TL.merge_instrument(
                {"insCode": row["insCode"], "flow": 0, "l18": row.get("l18"), "l30": row.get("l30")},
                None, None, info)
            for k, v in merged.items():
                if k in ("provenance", "synthetic", "market", "board", "flowTitle", "cgrValCotTitle", "traded"):
                    continue
                if v not in (None, "") and k not in row:
                    row[k] = v
            if info.get("cgrValCotTitle"):
                row["cgrValCotTitle"] = info["cgrValCotTitle"]
            done += 1
        print(f"  ✓ {done} شناسنامه اضافه شد")

    if args.bt > 0:
        print(f"→ bourse-trader.ir: غنی‌سازی {args.bt} نماد پرگردش …")
        done = 0
        for row in ranked[:args.bt]:
            sym = row.get("l18")
            if not sym:
                continue
            try:
                bt = BT.fetch_symbol(sym, ttl=0.0)
            except Exception as e:  # noqa: BLE001
                print(f"  ⚠ {sym}: {type(e).__name__}")
                continue
            for k, v in bt.items():
                if k in ("symbol", "source", "raw_found", "ambiguous", "book", "fields"):
                    continue
                if v not in (None, "") and k not in row:
                    row[k] = v
            if bt.get("netRealMoneyToday") is not None:
                row["netRealMoneyToday"] = bt["netRealMoneyToday"]
            row["enriched_by"] = "bourse-trader.ir"
            done += 1
        print(f"  ✓ {done} نماد غنی شد")

    # تاریخچه‌ها (تعدیل‌شدهٔ واقعی)
    hist_targets = [r for r in ranked if r.get("insCode")][:args.history]
    print(f"→ TSETMC: تاریخچهٔ {len(hist_targets)} نماد …")
    got = 0
    for i, row in enumerate(hist_targets, 1):
        try:
            bars = TL.daily_history(row["insCode"], args.history_days, args.timeout)
        except Exception:  # noqa: BLE001
            continue
        if len(bars) >= 20:
            row["history"] = bars
            row["history_kind"] = "ohlcv-adjusted"
            got += 1
        if i % 20 == 0:
            print(f"    … {i}/{len(hist_targets)} ({got} موفق)")

    # نبض بازار (شاخص/ارزش بازار/سرانه‌ها) از بورس‌تریدر
    overview: dict = {}
    try:
        print("→ bourse-trader.ir: نبض بازار …")
        overview = BT.market_overview()
        print(f"  ✓ شاخص کل: {overview.get('index_total')} | ارزش بازار: {overview.get('market_cap')}")
    except Exception as e:  # noqa: BLE001
        print(f"  ⚠ نبض بازار دریافت نشد ({type(e).__name__}) — از وضعیت TSETMC استفاده می‌شود")

    st = state or {}
    as_of = " ".join(x for x in (st.get("datetime_jalali"), st.get("datetime_time")) if x) \
        or st.get("datetime_raw") or time.strftime("%Y-%m-%d")
    indices = {
        "index_total": {"fa": "شاخص کل بورس",
                        "value": overview.get("index_total") or num(st.get("index_total")) or 0,
                        "chg_pct": overview.get("index_change_pct") or num(st.get("index_change_pct"))},
        "index_equal": {"fa": "شاخص کل هم‌وزن", "value": overview.get("index_equal"), "chg_pct": None},
        "index_fara": {"fa": "شاخص کل فرابورس", "value": overview.get("index_fara"), "chg_pct": None},
        "market_cap": {"fa": "ارزش بازار (ریال)", "value": overview.get("market_cap"), "chg_pct": None},
        "session_count": {"fa": "تعداد نمادهای اسکن‌شده", "value": len(rows), "chg_pct": None},
    }
    # درست کردن نام و مقدار شاخص کل از منبع دوم اگر موجود بود
    if overview.get("index_total"):
        indices["index_total"]["value"] = overview["index_total"]
        if overview.get("market_cap"):
            indices["market_cap"]["value"] = overview["market_cap"]

    rules = dict(DEFAULT_RULES)
    rules["as_of"] = as_of
    rules["market_pulse"] = {k: overview.get(k) for k in
                             ("retail_trade_value", "retail_volume", "retail_money_inflow_rial",
                              "symbols_up", "symbols_down", "per_capita_buy", "per_capita_sell",
                              "orders_buy_value", "orders_sell_value") if overview.get(k) is not None}

    payload = {
        "schema": "tabloradar.offline-snapshot/v2",
        "data_kind": "live",
        "generated_by": "tools/fetch_live_snapshot.py",
        "generated_at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "as_of": as_of,
        "currency": "IRR (ریال)",
        "sources": [
            "TSETMC MarketWatchInit.aspx (قیمت، دفتر سفارش ۵ سطحی، وضعیت بازار)",
            "TSETMC ClientTypeAll.aspx (حقیقی/حقوقی)" if clients else "TSETMC ClientTypeAll (ناموفق)",
            "TSETMC chart/Financial.aspx (تاریخچهٔ تعدیل‌شده)" if got else "TSETMC history (ناموفق)",
            "bourse-trader.ir (نبض بازار + غنی‌سازی نمادهای پرگردش)" if overview else "bourse-trader.ir (ناموفق)",
        ],
        "disclaimer": (
            "این فایل از منابع زندهٔ TSETMC و bourse-trader.ir ساخته شده است (بدون شبیه‌سازی). "
            "داده‌ها لحظه‌ای نیستند؛ زمان برداشت در «as_of» ثبت شده است. "
            "بازگرداندن دادهٔ نمونه/آفلاین: python3 tools/make_offline_snapshot.py"
        ),
        "quality": {
            "instruments": len(rows),
            "with_client_types": sum(1 for r in rows if "Buy_I_Volume" in r),
            "with_order_book": sum(1 for r in rows if "qd1" in r),
            "with_history": sum(1 for r in rows if r.get("history")),
            "enriched_by_bourse_trader": sum(1 for r in rows if r.get("enriched_by")),
            "fetch_seconds": round(time.time() - t0, 1),
        },
        "rules": rules,
        "indices": indices,
        "market_overview": overview.get("top_inflow") and overview or {},
        "history_kind": "ohlcv adjusted (chart/Financial.aspx)",
        "instruments": rows,
    }

    print("\n— گزارش کیفیت —")
    for k, v in payload["quality"].items():
        print(f"  {k}: {v}")

    if args.dry_run:
        print("\n(dry-run) چیزی نوشته نشد.")
        return 0

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_suffix(out.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    tmp.replace(out)
    print(f"\n✓ {out} — {len(rows):,} نماد، {out.stat().st_size / 1024:.0f} KB، {payload['quality']['fetch_seconds']}s")
    print("  داشبورد اکنون همین دادهٔ واقعی را (حتی بدون شبکه) نمایش می‌دهد.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
