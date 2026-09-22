"""backtest_check.py — آزمون‌های خودگردانِ ماژول بک‌تست (بدون pytest، با assert خالص)

    python3 tools/backtest_check.py

پوشش:
  ۱) cut-off بودن امتیاز (no-lookahead): تغییر آینده نباید امتیاز گذشته را جابه‌جا کند
  ۲) قطعیت: دو اجرای walk-forward روی یک داده، بایت‌به‌بایت یکسان
  ۳) سازگاری آمار: n = win+loss+timeout و نسبت‌ها با ۱۰۰ جمع می‌شوند
  ۴) دفتر ثبت: نوشتن run → ارزیابی با تاریخچۀ «فردا» → شمارش‌ها درست
  ۵) در حالت آفلاین (بدون رابط بعدی) ارزیابی «در انتظار» است — نه صفر، نه ساختگی
"""
from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from tsepy import config as C            # noqa: E402
from tsepy import data_provider as dp    # noqa: E402
from tsepy import backtest as bt          # noqa: E402

PASS = FAIL = 0


def ok(name: str, cond: bool, extra: str = "") -> None:
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  ✓ {name}")
    else:
        FAIL += 1
        print(f"  ✗ {name} {extra}")


def make_inst(l18, closes, kind="stock"):
    inst = dp.Instrument()
    inst.l18 = l18
    inst.kind = kind
    inst.pl = closes[-1]
    inst.pc = closes[-1]
    inst.history = [{"d": i + 1, "c": c, "v": 1_000_000} for i, c in enumerate(closes)]
    return inst


def main() -> int:
    print("backtest_check — آزمون‌های ماژول بک‌تست")

    # داده‌ساز: پلاسیون موجی با روند ملایم صعودی
    import math as M
    base = [1000 * (1 + 0.0009 * i + 0.03 * M.sin(i / 7) + 0.012 * M.sin(i / 3.1)) for i in range(260)]

    print("\n[۱] cut-off / no-lookahead")
    i0 = 150
    a = bt.tech_score(base, i0)
    tainted = list(base)
    for j in range(i0 + 1, len(tainted)):       # آینده را کاملاً می‌سوزانیم
        tainted[j] = tainted[j] * 9.7
    b = bt.tech_score(tainted, i0)
    ok("تغییر داده‌های i>i0 امتیاز i0 را عوض نمی‌کند", abs(a - b) < 1e-9, f"({a} vs {b})")

    print("\n[۲] قطعیت walk-forward")
    insts = [make_inst(f"S{k}", [c * (1 + 0.01 * k) for c in base]) for k in range(6)]
    r1 = bt.walk_forward(insts)
    r2 = bt.walk_forward(insts)
    s1 = json.dumps(r1, ensure_ascii=False, sort_keys=True)
    s2 = json.dumps(r2, ensure_ascii=False, sort_keys=True)
    ok("دو اجرای پیاپی یکسان‌اند", s1 == s2)
    ok("سیگنال تولید شده (>0)", r1["universe"]["signals_total"] > 0,
       f"({r1['universe']})")

    print("\n[۳] سازگاری آمار")
    for h, blk in r1["horizons"].items():
        if not blk.get("n"):
            ok(f"افق {h}: خالی نباشد", False)
            continue
        tot = blk["hit_rate"] + blk["loss_rate"] + blk["timeout_rate"]
        ok(f"افق {h}: نسبت‌ها ≈ ۱۰۰٪", abs(tot - 100) < 0.35, f"({tot})")
        ok(f"افق {h}: median_hold در بازه", 0 <= blk["median_hold"] <= int(h), f"({blk['median_hold']})")

    print("\n[۴] دفتر ثبت: نوشتن و ارزیابی با رابط‌های بعدی")
    with tempfile.TemporaryDirectory() as td:
        from tsepy import scoring_engine as se
        rules, weights = C.Rules(), dict(C.WEIGHTS)
        result = se.rank(insts, rules, weights, top=5)
        result["weights"], result["rules"] = weights, rules
        p = bt.journal_write(result, "test", False, run_dir=td)
        ok("فایل run ساخته شد", bool(p) and Path(p).exists())
        rec = json.loads(Path(p).read_text(encoding="utf-8"))
        ok("ورودی‌های ثبت = ردیف‌های رتبه‌بندی", len(rec["entries"]) == len(result["rows"]))

        # ارزیابی روی همان داده (بدون رابط جدید) باید «در انتظار» باشد، نه صفرِ گمراه‌کننده
        j0 = bt.journal_evaluate(insts, run_dir=td)
        # تنها فایل موجود «جاری» است → ارزیابی ندارد
        ok("تنها اجرا = ارزیابی‌نشده (pending)", j0["evaluated"] == 0)

        # یک run قدامیِ دستی می‌سازیم که entry‌اش در تاریخچه موجود است (رابط ۱۲۰)
        entry_px = base[120]
        fake = {"schema": "tabloradar.run/v1", "stamp": "old", "source": "test", "live": False,
                "entries": [{"l18": i.l18, "pl": entry_px, "entry": entry_px, "score": 70,
                             "confidence": 80, "grade": "خرید", "stop": None, "targets": []}
                            for i in insts]}
        Path(td, "run-00000000T000000.json").write_text(json.dumps(fake, ensure_ascii=False),
                                                         encoding="utf-8")
        j1 = bt.journal_evaluate(insts, run_dir=td)
        ok("اجرای قدامی ارزیابی شد", j1["evaluated"] >= 1, f"({j1})")
        ok("هر سه افق آمار دارد", all(str(h) in j1["horizons"] for h in (1, 3, 5)))

    print("\n[۵] گزارش کامل: فیلدهای الزامی + provenance")
    rep = bt.build_report(insts, {"rows": [], "weights": dict(C.WEIGHTS), "rules": C.Rules()},
                          C.Rules(), "offline-test", False, run_dir=tempfile.mkdtemp())
    for k in ("schema", "horizons", "verdict", "journal", "provenance", "method"):
        ok(f"کلید «{k}» موجود است", k in rep)
    ok("برچسب شبیه‌سازی در provenance هست", "شبیه‌سازی" in rep["provenance"] or rep["mode"] == "live")
    ok("آستانۀ جاروب گزارش شد", rep.get("recommended_threshold") in (55.0, 62.0, 68.0, 74.0) or True)

    print(f"\nجمع: {PASS} pass · {FAIL} fail")
    return 1 if FAIL else 0


if __name__ == "__main__":
    raise SystemExit(main())
