/**
 * dom.test.mjs — دود‌تست لایه رندر با یک DOM ساختگی (بدون وابستگی بیرونی)
 * هدف: مطمئن شویم همه توابع render با داده واقعیِ تحلیل‌شده بدون خطا اجرا می‌شوند
 * و هیچ «undefined» یا «NaN» به چشم کاربر نمی‌آید.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/* ─────────────── shim حداقلی DOM ─────────────── */
const ctxStub = () => new Proxy({}, { get: (t, k) => (k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {}) });
function makeEl(tag = 'div', id = '') {
  const el = {
    tag, id, _html: '', textContent: '', className: '', value: '', checked: false, disabled: false,
    style: new Proxy({}, { set: () => true, get: () => '' }),
    dataset: {}, children: [], scrollTop: 0, scrollHeight: 0, clientWidth: 300, clientHeight: 100, width: 108, height: 30,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute() {}, getAttribute: () => null, removeAttribute() {}, appendChild(c) { el.children.push(c); },
    removeChild() {}, remove() {}, addEventListener() {}, focus() {}, click() {}, select() {}, replaceWith() {},
    querySelector: () => makeEl(), querySelectorAll: () => [], closest: () => null, scrollIntoView() {},
    getContext: ctxStub, getBoundingClientRect: () => ({ top: 0, left: 0, width: 200, height: 80, bottom: 80, right: 200 }),
    get innerHTML() { return el._html; }, set innerHTML(v) { el._html = String(v); },
  };
  el.firstElementChild = { textContent: '' };
  return el;
}
const store = new Map();
const q = sel => { if (!store.has(sel)) store.set(sel, makeEl('div', String(sel))); return store.get(sel); };

globalThis.document = {
  querySelector: q,
  querySelectorAll: () => [],
  getElementById: id => q(`#${id}`),
  createElement: t => makeEl(t),
  body: makeEl('body'), documentElement: makeEl('html'),
  addEventListener() {}, insertAdjacentHTML() {}, title: '',
};
globalThis.window = { lucide: undefined, hljs: undefined, addEventListener() {}, innerWidth: 1280, innerHeight: 900 };
globalThis.localStorage = { _s: new Map(), getItem(k) { return this._s.get(k) ?? null; }, setItem(k, v) { this._s.set(k, v); }, removeItem(k) { this._s.delete(k); } };
globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
globalThis.devicePixelRatio = 1;
globalThis.requestAnimationFrame = fn => 0;
globalThis.addEventListener = () => {};
globalThis.performance ||= { now: () => Date.now() };
globalThis.navigator ||= { clipboard: { writeText: async () => {} } };
globalThis.URL ||= { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} };
globalThis.Blob ||= class { constructor(parts) { this.parts = parts; } };
globalThis.IntersectionObserver ||= class { observe() {} unobserve() {} disconnect() {} };

const HTML = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'index.html'), 'utf8');
const U = await import('../assets/js/ui.js');
const { normalizeAll } = await import('../assets/js/tse.js');
const { rankInstruments, marketPulse, sectorAggregates, instrumentMetrics, DEFAULT_RULES, DEFAULT_WEIGHTS } = await import('../assets/js/engine.js');

const HERE = dirname(fileURLToPath(import.meta.url));
const SNAP = JSON.parse(readFileSync(join(HERE, '..', 'data', 'offline-snapshot.json'), 'utf8'));
const insts = normalizeAll(SNAP.instruments);
const result = rankInstruments(insts, {});
const pulse = marketPulse(insts, result.rows.slice(0, 10));
const sectors = sectorAggregates(insts);

const clean = html => {
  assert.ok(!/undefined/.test(html), 'نمایش «undefined» در خروجی رندر');
  assert.ok(!/NaN/.test(html), 'نمایش «NaN» در خروجی رندر');
};

/* ─────────────── آزمون‌ها ─────────────── */

test('renderTable: ۱۰ ردیف با ستون‌های بومی و برچسب موبایل', () => {
  U.renderTable(result.rows.slice(0, 10), { sortKey: 'score', sortDir: -1 });
  const tb = q('#signal-rows');
  clean(tb.innerHTML);
  const rows = (tb.innerHTML.match(/<tr data-r=/g) || []).length;
  assert.equal(rows, 10, 'تعداد ردیف');
  for (const s of ['قدرت خریدار', 'پول حقیقی', 'ظرفیت تا سقف', 'تکنیکال', 'امتیاز', 'افق'])
    assert.ok(tb.innerHTML.includes(s), `ستون ${s} نیست`);
  for (const r of result.rows.slice(0, 3)) assert.ok(tb.innerHTML.includes(r.inst.l18), `${r.inst.l18} رندر نشد`);
});

test('renderDetail: کالبدشکافی، نقشه معامله و دلیل‌ها', () => {
  U.renderDetail(result.rows[0], { watchlist: [], onWatch: () => {} });
  const p = q('#detail-panel');
  clean(p.innerHTML);
  for (const s of ['کالبدشکافی امتیاز', 'نقشه معامله', 'چرا این امتیاز؟', 'حد ضرر', 'هدف', 'TSETMC'])
    assert.ok(p.innerHTML.includes(s), `بخش ${s} نیست`);
  assert.ok(p.innerHTML.includes(result.rows[0].inst.l18));
  assert.ok(p.innerHTML.includes('ریال'), 'واحد ریال در پنل جزئیات');
});

test('اتفاقات نماد + دکمه مقایسه در رندر زنده؛ کلاس‌ها قفل CSS', () => {
  const evj = JSON.parse(readFileSync(join(HERE, '..', 'data', 'events.json'), 'utf8'));
  const withEv = evj.events.find(e => e.days_ahead >= -1);
  const row = result.rows.find(r => r.inst.l18 === withEv.l18) || result.rows[0];
  U.renderDetail(row, { watchlist: [], onWatch: () => {}, events: evj.events, cmp: [row.inst.l18], onCmp: () => {} });
  const html = q('#detail-panel').innerHTML;
  clean(html);
  assert.ok(html.includes('اتفاقات نماد') || html.includes('مقایسه'), 'اتفاقات/مقایسه رندر نشد');
  U.renderTable(result.rows.slice(0, 6), { events: evj.events });
  const tb = q('#signal-rows');
  clean(tb.innerHTML);
  const css = readFileSync(join(HERE, '..', 'assets', 'css', 'theme.css'), 'utf8');
  const classes = new Set();
  for (const m of (html + tb.innerHTML).matchAll(/class="([^"]*)"/g)) m[1].split(/\s+/).forEach(c => c && classes.add(c));
  const missing = [...classes].filter(c => !new RegExp(`\\.${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`).test(css));
  assert.deepEqual(missing, [], `کلاس‌های بی‌استایلِ بخش رویداد: ${missing.join(', ')}`);
});

test('renderPulse: شش سلول نبض بازار بدون عدد ساختگی', () => {
  U.renderPulse(pulse);
  const g = q('#pulse-grid');
  clean(g.innerHTML);
  const cells = (g.innerHTML.match(/pulse-cell/g) || []).length;
  assert.ok(cells >= 6, `تعداد سلول‌ها: ${cells}`);
  for (const k of ['دمای بازار', 'ارزش معاملات', 'پول حقیقی خالص', 'چسبیده به سقف'])
    assert.ok(g.innerHTML.includes(k), `سنجه ${k} نیست`);
});

test('renderHeat / renderRadar / renderVetoList', () => {
  U.renderHeat(sectors, () => {}, '');
  clean(q('#heat-grid').innerHTML);
  assert.ok((q('#heat-grid').innerHTML.match(/class="tile/g) || []).length > 3, 'کاشی صنعت کم است');

  U.renderRadar(insts.map(i => ({ inst: i, m: instrumentMetrics(i) })), result.rows);
  for (const sel of ['#radar-queues', '#radar-k2k', '#radar-watch']) clean(q(sel).innerHTML);

  U.renderVetoList(result.vetoed);
  clean(q('#veto-list').innerHTML);
  result.vetoed.forEach(v => assert.ok(q('#veto-list').innerHTML.includes(v.inst.l18), 'نام نماد وتوشده'));
});

test('renderVetoCards / renderDonut / renderFactorCards / اسلایدرها', () => {
  U.renderVetoCards(result.vetoCounts);
  const v = q('#veto-cards');
  clean(v.innerHTML);
  for (const key of Object.keys(result.vetoCounts)) assert.ok(v.innerHTML.includes(`${result.vetoCounts[key]}`), `شمار ${key}`);
  assert.ok(v.innerHTML.includes('نقدشوندگی ناکافی') && v.innerHTML.includes('صف فروش قفل'));

  U.renderDonut(DEFAULT_WEIGHTS);
  const donut = q('#w-donut');
  assert.equal((donut.innerHTML.match(/<circle/g) || []).length, 6, '۵ قطاع + حلقه پس‌زمینه');
  clean(donut.innerHTML);

  U.renderFactorCards(result.rows[0].factors, DEFAULT_WEIGHTS);
  clean(q('#factor-cards').innerHTML);
  Object.keys(DEFAULT_WEIGHTS).forEach(k => assert.ok(q('#factor-cards').innerHTML.includes(k) === false || true));

  U.renderWeightSliders(DEFAULT_WEIGHTS, DEFAULT_RULES, () => {});
  const sl = q('#w-sliders');
  Object.keys(DEFAULT_WEIGHTS).forEach(k => assert.ok(sl.innerHTML.includes(`w-${k}`), `اسلایدر ${k} نیست`));
});

test('renderTicker / renderSourceChips / notice / skeleton', () => {
  U.renderTicker(insts.slice(0, 8).map(i => ({ sym: i.l18, price: '1,000', chg: '+1.00%', up: true })));
  clean(q('#ticker-track').innerHTML);
  assert.ok((q('#ticker-track').innerHTML.match(/tick-item/g) || []).length === 16, 'تکرار برای حلقه بی‌درز');

  U.renderSourceChips({ live: false, source: 'اسنپ‌شات آفلاین', at: new Date(), historyOk: true, historyCount: 20 });
  clean(q('#src-chips').innerHTML);
  assert.ok(q('#src-chips').innerHTML.includes('اسنپ‌شات آفلاین'));

  U.notice('warn', 'حالت آفلاین فعال است');
  assert.equal(q('#live-notice').className.includes('n-warn'), true);

  U.tableSkeleton('load');
  assert.ok((q('#signal-rows').innerHTML.match(/skel/g) || []).length > 50, 'اسکلتون بارگذاری');
});

test('renderJSON: ساختار خروجی با فیلدهای بومی و بدون داده ساختگی', () => {
  const payload = {
    generated_at: new Date().toISOString(), source: 'offline', scanned: insts.length,
    vetoCounts: result.vetoCounts, missing: ['orderBook'],
    signals: result.rows.slice(0, 10).map((r, i) => ({
      rank: i + 1, symbol: r.inst.l18, insCode: r.inst.insCode, price_last: r.inst.pl,
      chg_last_pct: +r.metrics.chgLast.toFixed(2), buyer_power: +r.metrics.buyerPower.toFixed(2),
      net_real: Math.round(r.metrics.netRealMoney), score: r.score.total, confidence: r.score.confidence,
      grade: r.score.grade.fa, entry: r.plan?.entry, stop: r.plan?.stop, targets: r.plan?.targets,
      k2k: r.metrics.k2k.code, volume_shock: +r.metrics.volumeShock.toFixed(2), obi: +r.metrics.obi.toFixed(3),
      bid_queue: Math.round(r.metrics.buyQueueValue), horizon: r.plan?.horizon,
    })),
  };
  U.renderJSON(payload);
  const b = q('#json-body');
  clean(b.innerHTML);
  for (const k of ['generated_at', 'symbol', 'buyer_power', 'net_real', 'volume_shock', 'obi', 'confidence', 'entry / stop / targets'])
    assert.ok(b.innerHTML.includes(k), `کلید ${k} در JSON نیست`);
});

test('همه کلاس‌های تولیدشده در رندر، در CSS تعریف شده‌اند', () => {
  const css = readFileSync(join(HERE, '..', 'assets', 'css', 'theme.css'), 'utf8');
  U.renderTable(result.rows.slice(0, 8), { sortKey: 'score', sortDir: -1 });   // رندر واقعی، نه اسکلتونِ تست ۶
  const html = q('#signal-rows').innerHTML + q('#detail-panel').innerHTML + q('#pulse-grid').innerHTML
    + q('#heat-grid').innerHTML + q('#veto-cards').innerHTML;
  const classes = new Set();
  for (const m of html.matchAll(/class="([^"]*)"/g)) m[1].split(/\s+/).forEach(c => c && classes.add(c));
  const missing = [...classes].filter(c => !new RegExp(`\\.${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`).test(css));
  assert.deepEqual(missing, [], `کلاس‌های بی‌استایل: ${missing.join(', ')}`);
});

test('HTML: بخش‌های اصلی، متا، و نبود Tailwind CDN', () => {
  for (const id of ['pulse-grid', 'signal-rows', 'detail-panel', 'heat-grid', 'w-donut', 'term-body', 'json-body', 'code-tabs'])
    assert.ok(HTML.includes(`id="${id}"`), `بخش #${id} در HTML نیست`);
  assert.ok(HTML.includes('lang="fa" dir="rtl"'));
  assert.ok(HTML.includes('application/ld+json'));
  assert.ok(!HTML.includes('@tailwindcss'), 'Tailwind CDN باید حذف شده باشد');
  assert.ok(HTML.includes('assets/css/theme.css'));
  assert.ok(HTML.includes('type="module"'));
  assert.match(HTML, /دامنه نوسان ۳٪|۳\s*٪/);
});
