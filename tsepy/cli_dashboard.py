"""cli_dashboard.py — رندر جدول کنسول و نوشتن خروجی JSON/CSV

اگر کتابخانه `rich` نصب باشد، جدول رنگی؛ در غیر آن جدول متنی خالص (بدون وابستگی).
"""
from __future__ import annotations

import csv
import io
import json
from datetime import datetime, timezone
from pathlib import Path

try:  # pragma: no cover - انتخاب اختیاری بسته نمایشی
    from rich.console import Console
    from rich.table import Table
    _RICH = True
except Exception:  # noqa: BLE001
    _RICH = False


def _fmt(v, d=0):
    try:
        return f"{v:,.{d}f}" if isinstance(v, (int, float)) and v == v else "—"
    except Exception:  # noqa: BLE001
        return "—"


COLUMNS = [
    ("#", None), ("نماد", None), ("آخرین(ریال)", 0), ("تغییر٪", 2), ("قدرت‌خریدار", 2),
    ("پول‌حقیقی(م.ر)", 1), ("حجم‌مشکوک", 1), ("ظرفیت٪", 0), ("OBI", 2),
    ("امتیاز", 1), ("اطمینان", 0), ("درجه", None), ("افق", None), ("حدضرر", 0),
]
HORIZON_FA = {"short": "کوتاه", "mid": "میان", "long": "بلند"}


def render(rows: list[dict], title: str = "تابلورادار — Top-N") -> str:
    if not _RICH:
        return _plain(rows, title)
    console = Console(record=True, width=120)
    table = Table(title=title, header_style="bold cyan", border_style="dim")
    for name, _ in COLUMNS:
        table.add_column(name, justify="left" if name in ("#", "نماد", "درجه", "افق") else "right")
    for i, r in enumerate(rows, 1):
        inst, m, sc, plan = r["inst"], r["metrics"], r["score"], r.get("plan") or {}
        table.add_row(
            str(i), inst.l18, _fmt(inst.pl), _fmt(m["chg_last"], 2), _fmt(m["buyer_power"], 2),
            _fmt((m["net_real_money"] or 0) / 1e9 if m["net_real_money"] == m["net_real_money"] else None, 1),
            _fmt(m["volume_shock"], 1), _fmt((m["capacity"] or 0) * 100 if m["capacity"] == m["capacity"] else None, 0),
            _fmt(m["obi"], 2), _fmt(sc["total"], 1), _fmt(sc["confidence"], 0),
            sc["grade"], HORIZON_FA.get(plan.get("horizon"), "—"), _fmt(plan.get("stop")),
        )
    console.print(table)
    return console.export_text()


def _cells(r: dict, i: int) -> list[str]:
    inst, m, sc, plan = r["inst"], r["metrics"], r["score"], r.get("plan") or {}
    net = m["net_real_money"] / 1e9 if m["net_real_money"] == m["net_real_money"] else None
    cap = (m["capacity"] or 0) * 100 if m["capacity"] == m["capacity"] else None
    return [str(i), inst.l18, _fmt(inst.pl), _fmt(m["chg_last"], 2), _fmt(m["buyer_power"], 2),
            _fmt(net, 1), _fmt(m["volume_shock"], 1), _fmt(cap, 0), _fmt(m["obi"], 2),
            _fmt(sc["total"], 1), _fmt(sc["confidence"], 0), sc["grade"],
            HORIZON_FA.get(plan.get("horizon"), "—"), _fmt(plan.get("stop"))]


def _plain(rows, title) -> str:
    heads = [h for h, _ in COLUMNS]
    body = [_cells(r, i) for i, r in enumerate(rows, 1)]
    widths = [max(len(h), *(len(c) for c in (col[i] for col in body))) if body else len(h)
              for i, h in enumerate(heads)]
    lines = [title, "─" * (sum(widths) + 2 * len(widths))]
    lines.append("  ".join(h.rjust(w) for h, w in zip(heads, widths)))
    lines += ["  ".join(c.rjust(w) for c, w in zip(row, widths)) for row in body]
    return "\n".join(lines)


def payload_from(result: dict, source: str, live: bool, rules, weights) -> dict:
    """ساختار signals.json — همان چیزی که داشبورد هم مصرف می‌کند."""
    top = result["top"]
    return {
        "tool": "TabloRadar 3.0 (python)",
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": source,
        "live": live,
        "currency": "IRR (ریال)",
        "market_rules": {"price_limit_pct": 3.0, "base_volume": 1,
                         "session": "پیش‌گشایش 08:30-09:00 · پیوسته 09:00-12:30 · TAL 12:45-13:00"},
        "weights": weights,
        "rules": {"min_value_rial": rules.min_value, "include_base": rules.include_base,
                  "include_funds": rules.include_funds, "require_history": rules.require_history},
        "scanned": result["scanned"],
        "vetoed_count": len(result["vetoed"]),
        "veto_counts": result["veto_counts"],
        "pulse": {k: (round(v, 2) if isinstance(v, float) and v == v else v)
                  for k, v in result["pulse"].items() if k not in ("topGainers", "topLosers", "topValue", "signals")},
        "signals": [{
            "rank": i + 1,
            "symbol": r["inst"].l18, "name": r["inst"].l30, "ins_code": r["inst"].ins_code,
            "sector": r["inst"].sector, "market": f"{r['inst'].market} {r['inst'].board}",
            "price_last": _num(r["inst"].pl), "price_closing": _num(r["inst"].pc),
            "price_yesterday": _num(r["inst"].py),
            "chg_last_vs_closing_pct": _num(r["metrics"]["chg_last"], 2),
            "chg_closing_pct": _num(r["metrics"]["chg_close"], 2),
            "buyer_power": _num(r["metrics"]["buyer_power"], 2),
            "sar_buy_rial": _num(r["metrics"]["sar_buy"]),
            "net_real_money_rial": _num(r["metrics"]["net_real_money"]),
            "bid_queue_rial": _num(r["metrics"]["buy_queue_value"]),
            "ask_queue_rial": _num(r["metrics"]["sell_queue_value"]),
            "queue_locked": bool(r["metrics"]["buy_queue_locked"] or r["metrics"]["sell_queue_locked"]),
            "volume_shock": _num(r["metrics"]["volume_shock"], 2),
            "volume_shock_source": r["metrics"].get("volume_shock_source"),
            "obi": _num(r["metrics"]["obi"], 3),
            "capacity_to_ceiling_pct": _num((r["metrics"]["capacity"] or 0) * 100, 1),
            "k2k": r["metrics"]["k2k"]["code"], "k2k_fa": r["metrics"]["k2k"]["fa"],
            "pe": _num(r["metrics"]["pe_ratio"], 1), "pe_vs_sector": _num(r["metrics"]["pe_vs_sector"], 2),
            "rsi14": _num(r["metrics"]["rsi"], 1), "free_float_pct": _num(r["metrics"]["free_float"], 1),
            "score": r["score"]["total"], "confidence": r["score"]["confidence"], "grade": r["score"]["grade"],
            "factors": {k: _num(r["factors"][k], 1) for k in ("tablo", "short", "mid", "long", "risk")},
            "horizon": (r["plan"] or {}).get("horizon"),
            "entry": _num((r["plan"] or {}).get("entry")), "stop": _num((r["plan"] or {}).get("stop")),
            "targets": [_num(x) for x in (r["plan"] or {}).get("targets", [])],
            "risk_reward": (r["plan"] or {}).get("rr"),
            "why": [x["text"] for x in r["reasons"]],
            "vetoed": False,
        } for i, r in enumerate(top)],
        "vetoed": [{
            "symbol": r["inst"].l18, "codes": r["veto"]["codes"], "reasons": r["veto"]["fa"],
        } for r in result["vetoed"]][:60],
        "disclaimer": "صرفاً تحلیل داده است؛ توصیه سرمایه‌گذاری نیست.",
    }


def _num(v, d=0):
    if isinstance(v, (int, float)) and v == v and abs(v) != float("inf"):
        return round(float(v), d) if d else int(round(float(v)))
    return None


def write_outputs(payload: dict, out_dir: str = "out") -> list[Path]:
    d = Path(out_dir)
    d.mkdir(parents=True, exist_ok=True)
    paths = []
    jp = d / "signals.json"
    jp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    paths.append(jp)

    cp = d / "signals.csv"
    buf = io.StringIO()
    sig = payload["signals"]
    if sig:
        w = csv.DictWriter(buf, fieldnames=list(sig[0].keys()))
        w.writeheader()
        for row in sig:
            w.writerow({k: ("|".join(str(x) for x in v) if isinstance(v, list) else v) for k, v in row.items()})
    cp.write_text(buf.getvalue(), encoding="utf-8-sig")
    paths.append(cp)
    return paths
