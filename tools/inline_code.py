#!/usr/bin/env python3
"""
inline_code.py — ساخت باندل کد منبع برای بخش «کد منبع» داشبورد

فایل‌های واقعی ریپو را می‌خواند و به‌صورت رشته در
`assets/js/code-bundle.js` می‌نویسد تا نمایشگر کد بدون سرور هم کار کند.
هر تغییر در کد → با اجرای این اسکریپت باندل بازتولید می‌شود (در CI هم قابل استفاده).

    python3 tools/inline_code.py
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets" / "js" / "code-bundle.js"

FILES = [
    ("assets/js/tse.js", "javascript"),
    ("assets/js/indicators.js", "javascript"),
    ("assets/js/engine.js", "javascript"),
    ("assets/js/data.js", "javascript"),
    ("assets/js/ui.js", "javascript"),
    ("assets/js/app.js", "javascript"),
    ("server.py", "python"),
    ("main.py", "python"),
    ("tsepy/config.py", "python"),
    ("tsepy/data_provider.py", "python"),
    ("tsepy/tablokhani.py", "python"),
    ("tsepy/technical.py", "python"),
    ("tsepy/scoring_engine.py", "python"),
    ("tsepy/cli_dashboard.py", "python"),
]


def main() -> int:
    items = []
    for rel, lang in FILES:
        p = ROOT / rel
        if not p.exists():
            print(f"  ⚠ نادیده‌گرفته شد (موجود نیست): {rel}")
            continue
        items.append({"name": rel, "lang": lang, "src": p.read_text(encoding="utf-8")})
    banner = ("/* ساخته‌شده با tools/inline_code.py — دستی ویرایش نکنید.\n"
              "   حاوی متن واقعی فایل‌های ریپو برای نمایشگر «کد منبع». */\n")
    body = "window.__TR_CODE = " + json.dumps(items, ensure_ascii=False) + ";\n"
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(banner + body, encoding="utf-8")
    size = OUT.stat().st_size / 1024
    print(f"✓ {OUT.relative_to(ROOT)} — {len(items)} فایل — {size:.1f} KB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
