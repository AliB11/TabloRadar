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

test('بوت app.js: در قطع شبکه دادهٔ شبیه‌سازی‌شده را نمایش نمی‌دهد', async () => {
  await import('../assets/js/app.js');

  const settled = await waitFor(() => /هیچ منبعی|پاسخ نداد/.test(q('#live-notice').innerHTML), 12000);
  assert.ok(settled, 'چرخه اسکن به وضعیت fail-closed نرسید');
  assert.equal((q('#signal-rows').innerHTML.match(/<tr data-r=/g) || []).length, 0,
    'در قطع منابع واقعی نباید سیگنال ساختگی رندر شود');
  assert.ok(!q('#json-body').innerHTML.includes('signals'), 'خروجی تحلیلی ساختگی نباید تولید شود');

  const notice = q('#live-notice').innerHTML;
  assert.match(notice, /هیچ منبعی|پاسخ نداد/, 'خطای منبع واقعی باید صریح باشد');
  assert.ok(!/اتصال زنده برقرار شد/.test(notice), 'اعلان زندهٔ جعلی ممنوع است');
  assert.ok(fetched.some(u => u.includes('/api/market')), 'پروکسی محلی امتحان نشد');
  assert.ok(fetched.some(u => u.includes('offline-snapshot.json')), 'اسنپ‌شات محلی برای تشخیص نوع بررسی نشد');

  const logText = JSON.stringify(q('#term-body').children.map(c => c.innerHTML));
  assert.match(logText, /شکست|ERROR|منبع/, 'شکست منبع باید در ترمینال ثبت شود');
  assert.equal(errors.length, 0, `استثنای کنترل‌نشده: ${errors.map(String).join(' | ')}`);
});
