#!/usr/bin/env python3
"""
check_wiring.py — آزمون ایستای اتصال UI به DOM

چهار چیز را بررسی می‌کند (همه در CI قابل اجرا، بدون مرورگر):
  ۱) هر `#id` که JS به آن ارجاع می‌دهد در index.html وجود دارد
  ۲) هر ماژول import شده در assets/js وجود دارد
  ۳) هر فایل list‌شده در inline_code.py موجود است (نمایشگر «کد منبع»)
  ۴) هر نام کلاس CSS که در HTML استفاده شده، در theme.css تعریف شده
     (کلاس‌های Tailwind باقی‌مانده → خطا؛ ما عمداً از Tailwind CDN خارج شدیم)

    python3 tools/check_wiring.py
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT / "index.html").read_text(encoding="utf-8")
JS_DIR = ROOT / "assets" / "js"
CSS = (ROOT / "assets" / "css" / "theme.css").read_text(encoding="utf-8")
js_files = sorted(JS_DIR.glob("*.js"))
JS = "\n".join(p.read_text(encoding="utf-8") for p in js_files if p.name != "code-bundle.js")

errors: list[str] = []
warn: list[str] = []

# ── ۱. ارجاع‌های id ───────────────────────────────────────────────────
html_ids = set(re.findall(r'\bid="([^"]+)"', HTML))
# id های ساخته‌شده در زمان اجرا (template های JS) — از خود قالب‌ها استخراج می‌شوند
dynamic_ids = set(re.findall(r'id="([\w-]+)"', JS))
refd = set(re.findall(r"""[$]\(\s*['"]#([\w-]+)['"]""", JS)) | set(re.findall(r"""getElementById\(\s*['"]([\w-]+)['"]""", JS))
for ref in sorted(refd):
    if ref not in html_ids and ref not in dynamic_ids and not ref.startswith("ct-"):
        errors.append(f"id گم‌شده: JS به #{ref} ارجاع می‌دهد اما در HTML نیست")

#selectorهای کلاسی عمومی در JS (.$$('.x'))
for sel in set(re.findall(r"""\$\$?\(\s*['"]\.([\w-]+)['"]""", JS)):
    if f".{sel}" not in CSS:
        warn.append(f"کلاس {sel} در JS استفاده شده ولی در CSS تعریف نشده")

# ── ۲. import های ماژول‌ها ────────────────────────────────────────────
for p in js_files:
    if p.name == "code-bundle.js":
        continue
    src = p.read_text(encoding="utf-8")
    for imp in re.findall(r"""from\s+['"](\./[^'"]+)['"]""", src):
        target = (p.parent / imp).resolve()
        if not target.exists():
            errors.append(f"{p.name}: import «{imp}» وجود ندارد")

# ── ۳. فایل‌های باندل کد ──────────────────────────────────────────────
bundle_py = (ROOT / "tools" / "inline_code.py").read_text(encoding="utf-8")
for rel in re.findall(r'\("([^"]+\.(?:js|py|css))",\s*"(?:javascript|python|css)"\)', bundle_py):
    if not (ROOT / rel).exists():
        warn.append(f"inline_code.py فایل {rel} را فهرست کرده اما موجود نیست")

# ── ۴. کلاس‌های HTML در CSS ───────────────────────────────────────────
used = set()
for cls in re.findall(r'\bclass="([^"]+)"', HTML):
    used |= {c for c in cls.split() if c and not c.startswith(("!", "[", "]"))}
defined = set(re.findall(r"\.([a-zA-Z][\w-]*)", CSS))
TW = re.compile(r"^(text-\[|bg-\[|p-\[|m-\[|gap-\[|w-\[|h-\[|max-w-\[|min-w-\[|!|sm:|md:|lg:)")
tailwind_left = {c for c in used if TW.match(c) and c not in defined}
if tailwind_left:
    errors.append(f"کلاس Tailwind (ارbitrary) در HTML باقی مانده است ({len(tailwind_left)}): {', '.join(sorted(tailwind_left)[:8])}")
missing = {c for c in used if c not in defined and not c.startswith(("data-", "language-"))}
for c in sorted(missing):
    warn.append(f"کلاس «{c}» در HTML استفاده شده ولی در theme.css تعریف نشده")

# ── ۵. توازن تگ‌ها، ماژول بودن اسکریپت و نشت کلید ────────────
for tag in ("section", "div", "table", "aside", "nav", "footer"):
    o = len(re.findall(rf"<{tag}[\s>]", HTML))
    c = len(re.findall(rf"</{tag}>", HTML))
    if o != c:
        errors.append(f"تگ <{tag}> نامتوازن: {o} باز، {c} بسته")
if 'type="module"' not in HTML:
    errors.append('اسکریپت ماژول (<script type="module">) در HTML نیست')
if "cdn.jsdelivr.net/npm/@tailwindcss" in HTML:
    errors.append("Tailwind CDN هنوز در HTML بارگذاری می‌شود")

LEAK = re.compile(r"key=([A-Za-z0-9]{24,})")
leaks = []
for f in ROOT.rglob("*"):
    if not f.is_file() or f == Path(__file__).resolve() or any(
            part in f.parts for part in (".git", "node_modules", "out")):
        continue
    if f.suffix not in {".js", ".py", ".html", ".css", ".json", ".md", ".mjs"}:
        continue
    for m in LEAK.finditer(f.read_text(encoding="utf-8", errors="ignore")):
        leaks.append(f"{f.relative_to(ROOT)} → key={m.group(1)[:6]}…")
if leaks:
    errors.append("کلید API هاردکد شده یافت شد: " + ", ".join(leaks))

print(f"بررسی اتصال UI · {len(js_files)} ماژول JS · {len(html_ids)} id در HTML · {len(refd)} ارجاع JS")
for w in sorted(warn):
    print("  ⚠", w)
if errors:
    for e in errors:
        print("  ✗", e)
    print(f"\n✗ {len(errors)} خطای اتصال")
    sys.exit(1)
print("✓ همه ارجاع‌های DOM، import ها و توازن تگ‌ها سالم است")
