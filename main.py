#!/usr/bin/env python3
"""
main.py — ارکستراتور پایپ‌لاین تابلورادار

    python3 main.py                      # یک اجرای کامل (زنده، با fallback آفلاین)
    python3 main.py --offline --top 10    # فقط با اسنپ‌شات آفلاین برچسب‌دار
    python3 main.py --explain فملی         # دلیل فارسی امتیاز یک نماد
    python3 main.py --loop                 # زمان‌بندی روزانه ۱۲:۳۵ (ساعت تهران)
    python3 main.py --weights 40 15 15 15 15 --minval 120

وابستگی: کتابخانه استاندارد پایتون. `rich` اختیاری است (جدول رنگی).
"""
from __future__ import annotations

import argparse
import sys
import time
from datetime import datetime, timedelta, timezone

from tsepy import config as C
from tsepy import cli_dashboard as cli
from tsepy import data_provider as dp
from tsepy import scoring_engine as se
from tsepy import backtest as bt

TEHRAN = timezone(timedelta(hours=3, minutes=30))


def parse_args(argv=None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="TabloRadar — quant scanner for TSE/Fara Bourse")
    p.add_argument("--offline", action="store_true", help="بدون شبکه، از اسنپ‌شات آفلاین")
    p.add_argument("--snapshot", default=C.OFFLINE_SNAPSHOT, help="مسیر فایل اسنپ‌شات")
    p.add_argument("--top", type=int, default=10, help="تعداد نماد در فهرست برتر")
    p.add_argument("--minval", type=float, default=C.Rules().min_value / 1e9,
                   help="آستانه وتوی نقدشوندگی (میلیارد ریال)")
    p.add_argument("--weights", nargs=5, type=float, metavar=("T", "S", "M", "L", "R"),
                   help="وزن پنج عامل (تابلو/کوتاه/میان/بلند/ریسک)")
    p.add_argument("--include-base", action="store_true", help="نمادهای بازار پایه هم اسکن شوند")
    p.add_argument("--include-funds", action="store_true", help="صندوق‌ها و اوراق هم اسکن شوند")
    p.add_argument("--require-history", action="store_true", help="فقط نمادهای دارای تاریخچه")
    p.add_argument("--history", type=int, default=0, help="واکشی تاریخچه برای N نماد پرحجم (حالت زنده)")
    p.add_argument("--json", dest="json_path", default="out/signals.json", help="خروجی JSON")
    p.add_argument("--no-files", action="store_true", help="فقط چاپ جدول، بدون نوشتن فایل")
    p.add_argument("--explain", metavar="L18", help="چاپ دلایل امتیاز یک نماد")
    p.add_argument("--backtest", action="store_true",
                   help="واکشی تاریخچه‌محور + کارنامۀ مدل (data/model-report.json)")
    p.add_argument("--runs-dir", default="out/runs", help="محل دفتر ثبت اسکن‌ها")
    p.add_argument("--no-journal", action="store_true", help="ثبت اسکن در out/runs انجام نشود")
    p.add_argument("--quiet", action="store_true")
    p.add_argument("--loop", action="store_true", help="اجرای روزانه در ساعت تعیین‌شده")
    return p.parse_args(argv)


def build_rules(a: argparse.Namespace) -> C.Rules:
    return C.Rules(min_value=a.minval * 1e9, include_base=a.include_base,
                   include_funds=a.include_funds, require_history=a.require_history)


def build_weights(a: argparse.Namespace) -> dict[str, float]:
    if not a.weights:
        return dict(C.WEIGHTS)
    w = dict(zip(C.FACTOR_KEYS, a.weights))
    total = sum(w.values()) or 1
    return {k: v / total * 100 for k, v in w.items()}   # نرمال‌سازی به جمع ۱۰۰


def run_once(a: argparse.Namespace) -> dict:
    log = (lambda *x: None) if a.quiet else (lambda *x: print(*x))

    log("① دریافت داده بازار …")
    t0 = time.perf_counter()
    if a.offline:
        rows, source, live = dp.load_offline(a.snapshot)
    else:
        rows, source, live = dp.fetch_snapshot(log=log, offline_fallback=True)
    insts = dp.normalize_all(rows)
    log(f"   {len(insts)} نماد · منبع: {source} · {'زنده' if live else 'آفلاین/برچسب‌دار'}")

    if a.history and live and C.BRS_API_KEY:
        log(f"② واکشی تاریخچه برای {a.history} نماد پرحجم …")
        heavy = sorted((i for i in insts if not i.history), key=lambda i: -(i.tval if i.tval == i.tval else 0))
        for inst in heavy[: a.history]:
            inst.history = dp.fetch_history(inst.l18)

    log("③ تابلوخوانی، وتوها و امتیازدهی …")
    rules, weights = build_rules(a), build_weights(a)
    result = se.rank(insts, rules, weights, top=a.top)
    result["pulse"] = se.market_pulse(insts)
    result["elapsed"] = time.perf_counter() - t0
    result["source"], result["live"] = source, live
    result["insts"] = insts
    log(f"   رتبه‌بندی: {len(result['rows'])} · وتو: {len(result['vetoed'])} "
        f"({result['veto_counts']}) · زمان: {result['elapsed']:.2f}s")
    return result


def print_explain(result: dict, l18: str) -> None:
    pool = {r["inst"].l18: r for r in result["rows"] + result["vetoed"]}
    r = pool.get(l18)
    if not r:
        print(f"نماد «{l18}» در اسکن امروز نیست.")
        return
    inst, m, sc = r["inst"], r["metrics"], r["score"]
    print(f"\n{inst.l18} — {inst.l30}\n{inst.sector} · {inst.market} {inst.board}")
    print(f"امتیاز {sc['total']} · اطمینان {sc['confidence']}٪ · درجه: {sc['grade']}")
    print(f"عوامل: " + " · ".join(f"{k}={None if r['factors'][k] != r['factors'][k] else round(r['factors'][k])}"
                                  for k in C.FACTOR_KEYS))
    if r["plan"]:
        p = r["plan"]
        print(f"ورود {p['entry']:,.0f} · حد ضرر {p['stop']:,.0f} · اهداف "
              + " / ".join(f"{t:,.0f}" for t in p["targets"]) + f" · R/R {p['rr']} · افق {p['horizon']}")
    if r["veto"]["vetoed"]:
        print("وتو: " + " • ".join(r["veto"]["fa"]))
    for line in r["reasons"]:
        print(f"  • {line['text']}")


def next_run_at(loop_at: str) -> datetime:
    now = datetime.now(TEHRAN)
    hh, mm = (int(x) for x in loop_at.split(":"))
    target = now.replace(hour=hh, minute=mm, second=0, microsecond=0)
    if target <= now:
        target += timedelta(days=1)
        while target.weekday() not in C.WORKING_DAYS:   # شنبه–چهارشنبه (python: Mon=0)
            target += timedelta(days=1)
    return target


def main(argv=None) -> int:
    a = parse_args(argv)
    while True:
        try:
            result = run_once(a)
        except Exception as e:  # noqa: BLE001
            print(f"خطای پایپ‌لاین: {e}", file=sys.stderr)
            if not a.loop:
                return 1
            result = None
        if result:
            print("\n" + cli.render(result["top"], title=f"تابلورادار — Top {len(result['top'])} · "
                                                          f"{datetime.now(TEHRAN):%Y-%m-%d %H:%M} تهران"))
            if a.explain:
                print_explain(result, a.explain)
            if not a.no_files:
                payload = cli.payload_from(result, result["source"], result["live"], build_rules(a), build_weights(a))
                for path in cli.write_outputs(payload):
                    print(f"✓ نوشته شد: {path}")
            if not a.no_journal:
                jp = bt.journal_write(result, result["source"], result["live"], a.runs_dir)
                if not a.quiet and jp:
                    print(f"✓ ثبت در دفتر اسکن‌ها: {jp}")
            if a.backtest:
                report = bt.build_report(result["insts"], result, build_rules(a),
                                         result["source"], result["live"], a.runs_dir)
                rp = bt.write_report(report)
                print(bt.render_summary(report))
                print(f"✓ کارنامه نوشته شد: {rp}")
        if not a.loop:
            return 0
        nxt = next_run_at(C.Settings().loop_at)
        wait = max(1, (nxt - datetime.now(TEHRAN)).total_seconds())
        print(f"\n⟳ اجرای بعدی: {nxt:%Y-%m-%d %H:%M} تهران (حدود {wait / 3600:.1f} ساعت دیگر)")
        time.sleep(wait)


if __name__ == "__main__":
    raise SystemExit(main())
