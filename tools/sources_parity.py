#!/usr/bin/env python3
"""sources_parity.py — برابری پارسرهای JS و پایتون روی قطعه‌های واقعی

پارسرهای داده در دو زبان وجود دارند (مرورگر: assets/js/sources.js — سرور/ابزار:
tsepy/*.py). این ابزار هر دو را روی همان فایل‌های tests/fixtures اجرا می‌کند و
مقدار به مقدار مقایسه می‌کند تا «دو قرائت متفاوت از یک منبع» رخ ندهد.

    python3 tools/sources_parity.py
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from tsepy import bourse_trader as BT          # noqa: E402
from tsepy import tsetmc_live as TL            # noqa: E402

FIX = ROOT / "tests" / "fixtures"
TOL = 1e-6


def py_side() -> dict:
    sym = BT.symbol_from_text((FIX / "bourse_trader_symbol_folad.txt").read_text(encoding="utf-8"), "فولاد")
    ov = BT.overview_from_text((FIX / "bourse_trader_home.txt").read_text(encoding="utf-8"))
    raw = (FIX / "tsetmc_marketwatchinit.format-sample.txt").read_text(encoding="utf-8")
    parts = raw.split("@")
    prices = [dict(zip(TL.PRICE_COLS, r)) for r in TL._rows(parts[2], ",", len(TL.PRICE_COLS))]
    limits: dict[str, dict[int, dict]] = {}
    for row in TL._rows(parts[3], ",", 8):
        code, depth = str(row[0]), int(TL.to_num(row[1]) or 0)
        if not code or not 1 <= depth <= 5:
            continue
        limits.setdefault(code, {})[depth] = {
            "zo": TL.to_num(row[2]), "zd": TL.to_num(row[3]), "pd": TL.to_num(row[4]),
            "po": TL.to_num(row[5]), "qd": TL.to_num(row[6]), "qo": TL.to_num(row[7])}
    clients: dict[str, dict] = {}
    cols = ("insCode", "n_buy_count", "l_buy_count", "n_buy_vol", "l_buy_vol",
            "n_sell_count", "l_sell_count", "n_sell_vol", "l_sell_vol")
    for line in (FIX / "tsetmc_clienttypeall.format-sample.txt").read_text(encoding="utf-8").splitlines():
        if line.strip():
            cells = line.split(",")
            clients[cells[0]] = {cols[i]: TL.to_num(cells[i]) for i in range(len(cols))}
    rows = TL.build_instruments({"prices": prices, "limits": limits}, clients)
    first = rows[0] if rows else {}
    state = TL.parse_market_state(parts[1])

    def book_l1(sym_dict: dict) -> dict | None:
        book = sym_dict.get("book") or []
        if not book:
            return None
        l1 = book[0]
        return {"pd": l1.get("pd"), "qd": l1.get("qd"), "po": l1.get("po"), "qo": l1.get("qo")}

    def clean(d: dict, keys) -> dict:
        out = {}
        for k in keys:
            v = d.get(k)
            out[k] = float(v) if isinstance(v, (int, float)) and v == v else None
        return out

    return {
        "symbol": clean(sym, ["pl", "pc", "pf", "py", "pmin", "pmax", "tvol", "tval", "tno",
                              "netRealMoneyToday", "bvol", "zTitad", "marketCap", "pe", "sectorPE",
                              "eps", "psr", "freeFloatPct", "volToFloatPct", "volToSharesPct",
                              "buyPower", "avgVolMonth", "avgVolWeek"]),
        "symbol_book_l1": book_l1(sym),
        "symbol_ambiguous": sym.get("ambiguous", []),
        "overview": clean(ov, ["index_total", "index_equal", "index_fara", "market_cap",
                               "retail_trade_value", "retail_volume", "symbols_up", "symbols_down",
                               "per_capita_buy", "per_capita_sell", "orders_buy_value",
                               "orders_sell_value", "retail_money_inflow_rial"]),
        "top_inflow_first": (ov.get("top_inflow") or [None])[0],
        "top_inflow_len": len(ov.get("top_inflow") or []),
        "top_outflow_len": len(ov.get("top_outflow") or []),
        "tsetmc_first": ({
            "insCode": first.get("insCode"), "pc": first.get("pc"), "tval": first.get("tval"),
            "tno": first.get("tno"), "pe": first.get("pe"), "zTitad": first.get("zTitad"),
            "buy_i_vol": first.get("Buy_I_Volume"), "buy_n_vol": first.get("Buy_N_Volume"),
            "qd5": first.get("qd5"), "pd5": first.get("pd5"), "market": first.get("market"),
            "provenance": first.get("provenance"),
        } if first else None),
        "state": {"indexTotal": state.get("index_total"), "indexChange": state.get("index_change")},
    }


def js_side() -> dict:
    p = subprocess.run(["node", str(ROOT / "tools" / "sources_dump.mjs"), str(FIX)],
                       cwd=ROOT, capture_output=True, text=True, timeout=60)
    if p.returncode != 0:
        raise RuntimeError(f"node failed: {p.stderr.strip()[:300]}")
    return json.loads(p.stdout)


def diff(a, b, path: str = "") -> list[str]:
    out: list[str] = []
    if isinstance(a, dict) and isinstance(b, dict):
        for k in sorted(set(a) | set(b)):
            out += diff(a.get(k), b.get(k), f"{path}.{k}" if path else k)
    elif isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            out.append(f"{path}: طول {len(a)} ≠ {len(b)}")
        for i, (x, y) in enumerate(zip(a, b)):
            out += diff(x, y, f"{path}[{i}]")
    elif isinstance(a, (int, float)) and isinstance(b, (int, float)):
        if abs(a - b) > TOL * max(1.0, abs(a), abs(b)):
            out.append(f"{path}: پایتون={a} JS={b}")
    elif isinstance(a, (int, float)) != isinstance(b, (int, float)):
        out.append(f"{path}: پایتون={a!r} JS={b!r}")
    elif a != b:
        out.append(f"{path}: پایتون={a!r} JS={b!r}")
    return out


def main() -> int:
    print("\nبرابری پارسرهای داده — JS ↔ پایتون روی قطعه‌های واقعی\n" + "─" * 60)
    py, js = py_side(), js_side()
    problems = diff(py, js)
    if not problems:
        n_fields = sum(len(v) for v in (py["symbol"], py["overview"])) + 12
        print(f"✓ برابری کامل: {n_fields} مقدار کلید به کلید یکسان")
        print(f"  · نماد شاهد: pl={py['symbol']['pl']} pe={py['symbol']['pe']} eps={py['symbol']['eps']}")
        print(f"  · نبض بازار: شاخص={py['overview']['index_total']} "
              f"top_inflow={py['top_inflow_len']} ردیف")
        return 0
    print(f"✗ {len(problems)} اختلاف:")
    for p in problems[:25]:
        print(f"  · {p}")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
