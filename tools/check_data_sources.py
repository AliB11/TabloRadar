#!/usr/bin/env python3
"""check_data_sources.py — آزمون زندهٔ دسترسی به منابع دادهٔ بازار

روی ماشینی اجرا کنید که به اینترنت دسترسی دارد (سرور/سیستم خودتان یا جایی که فیلتر نیست):

    python3 tools/check_data_sources.py
    BRS_API_KEY=… python3 tools/check_data_sources.py     # اگر کلید BrsApi دارید

برای هر منبع: ✓/✗، زمان پاسخ و تعداد رکورد/فیلد خوانده‌شده. کد خروج صفر یعنی حداقل یک
منبع زنده در دسترس است. این ابزار هیچ فایلی را تغییر نمی‌دهد.
"""
from __future__ import annotations

import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from tsepy import bourse_trader as BT      # noqa: E402
from tsepy import tsetmc_live as TL        # noqa: E402

OK = "✓"
NO = "✗"


def timed(fn):
    t0 = time.time()
    try:
        val = fn()
        return True, val, (time.time() - t0) * 1000
    except Exception as e:  # noqa: BLE001
        return False, f"{type(e).__name__}: {e}", (time.time() - t0) * 1000


def main() -> int:
    print("\nبررسی منابع دادهٔ تابلورادار (همه درخواست‌ها واقعی‌اند)\n" + "─" * 68)
    alive = 0

    ok, val, ms = timed(TL.market_watch_init)
    if ok:
        alive += 1
        st = val.get("market_state", {})
        print(f"{OK} TSETMC MarketWatchInit  ({ms:5.0f} ms)  "
              f"{len(val['prices']):,} نماد | شاخص کل: {st.get('index_total')} | {st.get('datetime_raw')}")
        codes = [p.get('insCode') for p in val['prices'][:1]]
        ok2, bar, ms2 = timed(lambda: TL.daily_history(codes[0], 30))
        if ok2:
            print(f"{OK} TSETMC تاریخچه           ({ms2:5.0f} ms)  {len(bar)} کندل (نمونهٔ {codes[0]})")
        else:
            print(f"{NO} TSETMC تاریخچه           ({ms2:5.0f} ms)  {bar}")
    else:
        print(f"{NO} TSETMC MarketWatchInit  ({ms:5.0f} ms)  {val}")

    ok, val, ms = timed(TL.client_type_all)
    if ok:
        alive += 1
        print(f"{OK} TSETMC ClientTypeAll     ({ms:5.0f} ms)  {len(val):,} ردیف حقیقی/حقوقی")
    else:
        print(f"{NO} TSETMC ClientTypeAll     ({ms:5.0f} ms)  {val}")

    ok, val, ms = timed(BT.market_overview)
    if ok:
        alive += 1
        print(f"{OK} بورس‌تریدر — نبض بازار    ({ms:5.0f} ms)  شاخص کل: {val.get('index_total')} | "
              f"ارزش بازار: {val.get('market_cap')} | {len(val.get('top_inflow', []))} سطر ورود پول")
    else:
        print(f"{NO} بورس‌تریدر — نبض بازار    ({ms:5.0f} ms)  {val}")

    ok, val, ms = timed(lambda: BT.fetch_symbol("فولاد", ttl=0.0))
    if ok:
        alive += 1
        print(f"{OK} بورس‌تریدر — صفحهٔ نماد   ({ms:5.0f} ms)  آخرین={val.get('pl')} "
              f"پایانی={val.get('pc')} P/E={val.get('pe')} EPS={val.get('eps')} "
              f"دفتر={len(val.get('book', []))} سطح | مبهم: {val.get('ambiguous')}")
    else:
        print(f"{NO} بورس‌تریدر — صفحهٔ نماد   ({ms:5.0f} ms)  {val}")

    key = os.environ.get("BRS_API_KEY", "").strip()
    if key:
        import json
        import urllib.request

        url = f"https://Api.BrsApi.ir/Tsetmc/AllSymbols.php?key={key}&type=1"
        def probe():
            req = urllib.request.Request(url, headers={"User-Agent": "TabloRadar/3.2"})
            with urllib.request.urlopen(req, timeout=20) as res:  # noqa: S310
                data = json.loads(res.read().decode("utf-8", "replace"))
            return data if isinstance(data, list) else data.get("data") or data.get("result") or []
        ok, val, ms = timed(probe)
        if ok:
            alive += 1
            print(f"{OK} BrsApi (کلید محیطی)      ({ms:5.0f} ms)  {len(val):,} نماد")
        else:
            print(f"{NO} BrsApi (کلید محیطی)      ({ms:5.0f} ms)  {val}")
    else:
        print("·  BrsApi                  (کلید تنظیم نشده — اختیاری: BRS_API_KEY=…)")

    print("─" * 68)
    if alive:
        print(f"{alive} منبع زنده در دسترس است.\n"
              "گام بعدی برای داشتن دادهٔ واقعی در داشبورد:\n"
              "    python3 tools/fetch_live_snapshot.py --history 120 --enrich 60 --bt 15\n"
              "و برای دادهٔ لحظه‌ای هنگام اجرا:\n"
              "    python3 server.py          # سپس داشبورد روی /api/market")
        return 0
    print("هیچ منبعی پاسخ نداد. اگر این ماشین در ایران نیست، سرویس‌های TSETMC معمولاً "
          "در دسترس نیستند؛ اسنپ‌شات زنده را روی سرور داخل ایران بسازید یا BrsApi را امتحان کنید.")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
