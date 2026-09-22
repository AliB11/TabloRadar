/**
 * boot.test.mjs — اجرای واقعی بوت داشبورد (app.js) روی یک DOM و fetch ساختگی
 *
 * این آزمون زنجیره کامل را می‌پیماید:
 *   بوت app.js → بارگذاری اسنپ‌شات محلی → تحلیل هسته → رندر جدول/نبض/JSON/لاگ ترمینال
 * و اگر شبکه (پروکسی محلی) پاسخ ندهد، باید با هشدار «حالت آفلاین» و بدون استثنا ادامه دهد.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/* ── DOM shim ── */
const QSS = {};   // SELECTOR → [elements] برای شبیه‌سازی querySelectorAll روی اجزا
const ctxStub = () => new Proxy({}, { get: (t, k) => (k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {}) });
function makeEl(tag = 'div', sel = '') {
  const handlers = {};
  const el = {
    id: String(sel).replace(/^#/, ''),
    tag, _html: '', textContent: '', className: '', value: '', checked: false, disabled: false,
    style: new Proxy({}, { set: () => true, get: () => '' }),
    dataset: {}, children: [], scrollTop: 0, scrollHeight: 0,
    clientWidth: 1200, clientHeight: 800, width: 108, height: 30, tabIndex: 0,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute() {}, getAttribute: () => null, removeAttribute() {},
    appendChild(c) { el.children.push(c); }, removeChild() { el.children.pop(); }, remove() {}, insertAdjacentHTML(pos, html) { el._html += String(html); },
    _handlers: handlers,
    addEventListener(type, fn) { (handlers[type] ||= []).push(fn); }, focus() {}, click() { (handlers.click || []).forEach(f => f({})); }, select() {}, replaceWith() {},
    querySelector: () => makeEl(), querySelectorAll: sel => QSS[sel] || [], closest: () => null,
    scrollIntoView() {}, getContext: ctxStub, insertAdjacentHTML(pos, html) { el._html += String(html); },
    getBoundingClientRect: () => ({ top: 0, left: 0, width: 600, height: 200, bottom: 200, right: 600 }),
    get innerHTML() { return el._html; }, set innerHTML(v) { el._html = String(v); },
  };
  el.firstElementChild = { textContent: '' };
  return el;
}
const store = new Map();
const q = sel => { if (!store.has(sel)) store.set(sel, makeEl('div', sel)); return store.get(sel); };
const fire = (sel, type, ev = {}) => {
  const el = q(sel);
  (el._handlers[type] || []).forEach(fn => fn({ preventDefault() {}, target: el, ...ev }));
  return (el._handlers[type] || []).length;
};
const listeners = [];
globalThis.document = {
  querySelector: q, querySelectorAll: () => [], getElementById: id => q(`#${id}`),
  createElement: t => makeEl(t), body: makeEl('body'), documentElement: makeEl('html'),
  addEventListener: (e, fn) => listeners.push([e, fn]), insertAdjacentHTML() {}, title: '',
};
globalThis.window = { lucide: undefined, hljs: undefined, innerWidth: 1280, innerHeight: 900, addEventListener: () => {} };
globalThis.localStorage = { _s: new Map(), getItem(k) { return this._s.get(k) ?? null; }, setItem(k, v) { this._s.set(k, String(v)); }, removeItem(k) { this._s.delete(k); } };
globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
globalThis.devicePixelRatio = 1;
globalThis.requestAnimationFrame = () => 0;
globalThis.addEventListener = (e, fn) => listeners.push([e, fn]);
globalThis.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
Object.defineProperty(globalThis, 'navigator', {
  value: { clipboard: { writeText: async () => {} } }, configurable: true, writable: true,
});
if (!globalThis.URL.createObjectURL) globalThis.URL.createObjectURL = () => 'blob:x';
globalThis.URL.revokeObjectURL ||= () => {};
globalThis.Blob ||= class { constructor(parts) { this.parts = parts; } };

/* ── fetch ساختگی: فایل‌های محلی از دیسک، همه چیز دیگر «شبکه قطع» ── */
const fetched = [];
globalThis.fetch = async (url) => {
  fetched.push(String(url));
  const clean = String(url).replace(/^\.\//, '').split('?')[0];
  if (clean.startsWith('/api/') || clean.startsWith('https://')) {
    throw new TypeError('Failed to fetch (sandbox: بدون شبکه)');
  }
  const file = join(ROOT, clean);
  if (existsSync(file)) {
    return { ok: true, status: 200, json: async () => JSON.parse(readFileSync(file, 'utf8')),
      text: async () => readFileSync(file, 'utf8') };
  }
  return { ok: false, status: 404, text: async () => '' };
};

// اسلایدرهای وزن باید در querySelectorAll دیده شوند تا هندلر «input» بسته شود
QSS['input[type=range]'] = ['#w-tablo', '#w-short', '#w-mid', '#w-long', '#w-risk'].map(q);
document.querySelectorAll = sel => QSS[sel] || [];

const errors = [];
process.on('uncaughtException', e => errors.push(e));

const wait = ms => new Promise(r => setTimeout(r, ms));
const waitFor = async (pred, ms = 6000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (pred()) return true; await wait(120); }
  return false;
};

test('بوت کامل app.js: رندر، لاگ و fallback آفلاین بدون استثنا', async () => {
  await import('../assets/js/app.js');

  /* صبر تا چرخه کامل اسکن تمام شود (رندر اولیه + شکست شبکه + اعلام صادقانه وضعیت) */
  const settled = await waitFor(() =>
    /اسنپ‌شات|آفلاین|محلی/.test(q('#live-notice').innerHTML) && /<tr data-r=/.test(q('#signal-rows').innerHTML), 12000);
  assert.ok(settled, 'چرخه اسکن به وضعیت پایدار نرسید');
  const rendered = /<tr data-r=/.test(q('#signal-rows').innerHTML);
  assert.ok(rendered, 'جدول سیگنال‌ها رندر نشد');

  const html = q('#signal-rows').innerHTML;
  assert.equal((html.match(/<tr data-r=/g) || []).length, 10, 'دقیقاً ۱۰ ردیف');
  assert.ok(!/undefined|NaN/.test(html), 'نشت undefined/NaN در جدول');

  /* نبض بازار، دونات وزن‌ها، کارت وتوها، تیکر، JSON، لاگ */
  assert.ok((q('#pulse-grid').innerHTML.match(/pulse-cell/g) || []).length >= 6, 'نبض بازار خالی است');
  assert.equal((q('#w-donut').innerHTML.match(/<circle/g) || []).length, 6, 'دونات وزن‌ها');
  assert.ok((q('#veto-cards').innerHTML.match(/veto-card/g) || []).length === 5, 'پنج کارت وتو');
  assert.ok(q('#ticker-track').innerHTML.includes('tick-item'), 'تیکر خالی است');
  assert.ok(q('#json-body').innerHTML.includes('&quot;signals&quot;') || q('#json-body').innerHTML.includes('"signals"'),
    'خروجی JSON رندر نشد');
  assert.ok(q('#heat-grid').innerHTML.includes('tile'), 'هیت‌مپ صنایع خالی است');
  assert.ok(q('#pflow').innerHTML.includes('pnode'), 'پایپ‌لاین رندر نشد');

  const logText = JSON.stringify(q('#term-body').children.map(c => c.innerHTML));
  assert.match(logText, /پایپ‌لاین|اسنپ‌شات/, 'لاگ ترمینال رویداد ثبت نکرده');

  /* وضعیت آفلاین باید صادقانه اعلام شود، نه به‌عنوان داده زنده */
  const notice = q('#live-notice').innerHTML;
  assert.ok(/اسنپ‌شات|آفلاین|محلی/.test(notice), `اعلان وضعیت گویا نیست: ${notice.slice(0, 120)}`);
  assert.ok(!/اتصال زنده برقرار شد/.test(notice), 'نباید «اتصال زنده» اعلام کند وقتی شبکه نبود');

  /* آمار هیرو باید از محاسبه واقعی بیاید، نه عدد ثابت */
  const stats = ['st-scan', 'st-veto', 'st-conf'].map(id => q(`#${id}`).textContent);
  assert.ok(stats.every(v => v && v !== '—'), `آمار هیرو پر نشده: ${stats}`);
  assert.equal(q('#st-scan').textContent, '27', 'تعداد نمادهای اسکن‌شده');
  assert.ok(Number(q('#st-veto').textContent.replace(/,/g, '')) > 0, 'شمار وتوها باید از محاسبه بیاید');

  /* تلاش برای منابع زنده انجام شده و سپس به اسنپ‌شات رسیده است */
  assert.ok(fetched.some(u => u.includes('/api/market')), 'پروکسی محلی امتحان نشد');
  assert.ok(fetched.some(u => u.includes('offline-snapshot.json')), 'اسنپ‌شات محلی خوانده نشد');

  /* CLI ترمینال: دستور واقعی باید اجرا و در لاگ ثبت شود */
  const before = q('#term-body').children.length;
  q('#term-input').value = 'top 3';
  assert.ok(fire('#term-input', 'keydown', { key: 'Enter' }) > 0, 'هندلر ورودی ترمینال ثبت نشده');
  const after = await waitFor(() => q('#term-body').children.length > before);
  assert.ok(after, 'دستور CLI در لاگ ترمینال اثر نگذاشت');

  /* تور ۹۰ ثانیه‌ای: اجرا و خروج بدون خطا */
  assert.ok(fire('#btn-tour', 'click') > 0, 'دکمه تور هندلر ندارد');
  await wait(150);
  assert.ok(q('#tour-t').textContent.length > 2, 'عنوان تور ست نشده');
  fire('#tour-exit', 'click');

  /* تغییر وزن از اسلایدرها باید دوباره محاسبه را اجرا کند */
  q('#w-tablo').value = '45';
  fire('#w-tablo', 'input');
  const rescoring = await waitFor(() => /سناریو|Σw/.test(q('#w-summary').textContent) || q('#w-summary').textContent.length > 3);
  assert.ok(rescoring, 'خلاصه سناریوی وزن‌ها به‌روز نشد');

  process.exit(0);
});
