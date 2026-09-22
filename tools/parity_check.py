#!/usr/bin/env python3
"""
parity_check.py — برابری هسته JS و پایپ‌لاین پایتون

دو پیاده‌سازی باید روی یک داده، یک خروجی بدهند؛ در غیر آن رندر مرورگر
با خروجی Cron/CLI واگرا می‌شود. این اسکریپت در CI هم قابل استفاده است.

    python3 tools/parity_check.py [data/offline-snapshot.json]
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SNAP = ROOT / (sys.argv[1] if len(sys.argv) > 1 else "data/offline-snapshot.json")

TOL = {"score": 0.15, "confidence": 1.0, "factor": 0.6, "price": 1.0, "ratio": 0.02}


def js_payload() -> dict:
    out = subprocess.run(["node", "tools/score_dump.mjs", str(SNAP)], cwd=ROOT,
                         capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def py_payload() -> dict:
    sys.path.insert(0, str(ROOT))
    from tsepy import config as C
    from tsepy import data_provider as dp
    from tsepy import scoring_engine as se
    rows, _src, _live = dp.load_offline(str(SNAP))
    insts = dp.normalize_all(rows)
    res = se.rank(insts, C.Rules(), dict(C.WEIGHTS), top=10)
    res["pulse"] = se.market_pulse(insts)
    pulses = res["pulse"]
    sectors = se.sector_aggregates(insts)[:5]
    top = []
    for r in res["top"]:
        m, f, sc, pl = r["metrics"], r["factors"], r["score"], r["plan"] or {}

        def num(v):
            return None if not isinstance(v, (int, float)) or v != v else float(v)
        top.append({
            "symbol": r["inst"].l18, "score": sc["total"], "confidence": sc["confidence"],
            "grade": sc["grade"],
            "factors": {k: num(f[k]) for k in C.FACTOR_KEYS},
            "metrics": {"chgLast": num(m["chg_last"]), "chgClose": num(m["chg_close"]),
                        "buyerPower": num(m["buyer_power"]), "netReal": num(m["net_real_money"]),
                        "shock": num(m["volume_shock"]), "obi": num(m["obi"]),
                        "capacity": num(m["capacity"]), "rsi": num(m["rsi"]), "k2k": m["k2k"]["code"]},
            "plan": None if not pl else {"entry": num(pl["entry"]), "stop": num(pl["stop"]),
                                        "atr": num(pl["atr"]), "atrSource": pl["atr_source"],
                                        "targets": [num(x) for x in pl["targets"]], "rr": pl["rr"],
                                        "sessions": pl["sessions"], "horizon": pl["horizon"]},
        })
    return {"engine": "py", "scanned": len(insts), "top": top, "vetoCounts": res["veto_counts"],
            "vetoed": [r["inst"].l18 for r in res["vetoed"]],
            "pulse": {"count": pulses["count"], "up": pulses["up"], "down": pulses["down"],
                      "flat": pulses["flat"], "value": round(pulses["value"]),
                      "netReal": round(pulses["net_real"], 4), "limitUp": pulses["limit_up"],
                      "limitDown": pulses["limit_down"]},
            "sectors": [{"sector": s["sector"], "count": s["count"], "value": round(s["value"])} for s in sectors]}


def cmp_num(label, a, b, tol, diffs):
    if a is None and b is None:
        return
    if (a is None) != (b is None):
        diffs.append(f"{label}: یکی None و دیگری نه ({a} ≠ {b})")
        return
    if abs(a - b) > tol:
        diffs.append(f"{label}: {a} ≠ {b} (Δ{abs(a - b):.4g} > {tol})")


def main() -> int:
    js, py = js_payload(), py_payload()
    diffs: list[str] = []

    if [x["symbol"] for x in js["top"]] != [x["symbol"] for x in py["top"]]:
        diffs.append(f"ترتیب Top-10 متفاوت است:\n  js={ [x['symbol'] for x in js['top']] }\n  py={ [x['symbol'] for x in py['top']] }")
    if sorted(js["vetoed"]) != sorted(py["vetoed"]):
        diffs.append(f"فهرست وتوها متفاوت است: js-only={set(js['vetoed']) - set(py['vetoed'])} py-only={set(py['vetoed']) - set(js['vetoed'])}")
    if js["vetoCounts"] != py["vetoCounts"]:
        diffs.append(f"شمارش وتوها: {js['vetoCounts']} ≠ {py['vetoCounts']}")
    for k in ("count", "up", "down", "flat", "limitUp", "limitDown"):
        if js["pulse"][k] != py["pulse"][k]:
            diffs.append(f"pulse.{k}: {js['pulse'][k]} ≠ {py['pulse'][k]}")
    cmp_num("pulse.value", js["pulse"]["value"], py["pulse"]["value"], 1, diffs)
    cmp_num("pulse.netReal", js["pulse"]["netReal"], py["pulse"]["netReal"], 1, diffs)
    for a, b in zip(js["sectors"], py["sectors"]):
        if a["sector"] != b["sector"] or a["count"] != b["count"]:
            diffs.append(f"sector: {a} ≠ {b}")
        cmp_num(f"sector[{a['sector']}].value", a["value"], b["value"], 1, diffs)

    for a, b in zip(js["top"], py["top"]):
        tag = a["symbol"]
        cmp_num(f"{tag}.score", a["score"], b["score"], TOL["score"], diffs)
        cmp_num(f"{tag}.confidence", a["confidence"], b["confidence"], TOL["confidence"], diffs)
        if a["grade"] != b["grade"]:
            diffs.append(f"{tag}.grade: {a['grade']} ≠ {b['grade']}")
        for k in a["factors"]:
            cmp_num(f"{tag}.factors.{k}", a["factors"][k], b["factors"][k], TOL["factor"], diffs)
        if a["metrics"]["k2k"] != b["metrics"]["k2k"]:
            diffs.append(f"{tag}.k2k: {a['metrics']['k2k']} ≠ {b['metrics']['k2k']}")
        for k in ("chgLast", "chgClose", "buyerPower", "netReal", "shock", "obi", "capacity", "rsi"):
            tol = 1.0 if k == "netReal" else 0.02
            cmp_num(f"{tag}.metrics.{k}", a["metrics"][k], b["metrics"][k], tol, diffs)
        if (a["plan"] is None) != (b["plan"] is None):
            diffs.append(f"{tag}.plan: یکی None است")
        elif a["plan"]:
            for k in ("entry", "stop", "atr"):
                cmp_num(f"{tag}.plan.{k}", a["plan"][k], b["plan"][k], TOL["price"], diffs)
            for i, (x, y) in enumerate(zip(a["plan"]["targets"], b["plan"]["targets"])):
                cmp_num(f"{tag}.plan.target{i+1}", x, y, TOL["price"], diffs)
            if a["plan"]["sessions"] != b["plan"]["sessions"]:
                diffs.append(f"{tag}.plan.sessions: {a['plan']['sessions']} ≠ {b['plan']['sessions']}")
            if a["plan"]["horizon"] != b["plan"]["horizon"]:
                diffs.append(f"{tag}.plan.horizon: {a['plan']['horizon']} ≠ {b['plan']['horizon']}")
            if a["plan"]["rr"] != b["plan"]["rr"]:
                diffs.append(f"{tag}.plan.rr: {a['plan']['rr']} ≠ {b['plan']['rr']}")

    n = len(js["top"])
    if diffs:
        print(f"✗ واگرایی JS/Python ({len(diffs)} مورد از {n} نماد):")
        for d in diffs[:25]:
            print("   -", d)
        return 1
    print(f"✓ برابری کامل: {n} نماد برتر، وتوها، نبض بازار و صنایع بین هسته JS و پایپ‌لاین پایتون یکسان است")
    print(f"  · Top-3: {', '.join(x['symbol'] for x in js['top'][:3])} · "
          f"امتیاز اول: {js['top'][0]['score']} · وتوشده: {len(js['vetoed'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
