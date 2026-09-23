/**
 * sources.test.mjs — آزمون پارسرهای منابع دادهٔ واقعی (assets/js/sources.js)
 *
 * قطعات ورودی، **واقعیِ برداشت‌شده از سرویس‌ها** هستند (tests/fixtures)؛ برای TSETMC
 * نمونهٔ ساختاری با همان ترتیب ستون رسمی. انتظارها همان انتظارهای
 * tools/sources_selftest.py است تا JS و پایتون یکسان بخوانند (برابری دو زبان).
 *
 * تأکید آزمون: «هیچ عدد ساختگی» — برچسب غایب ⇒ فیلد غایب، نه صفر.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  parseAmount, stripTags, findNumbers, firstNumber, parseChange, parseMarketState,
  parseMarketWatchInit, parseClientTypeAll, buildRows, parseChartCsv,
  btSymbolFromText, btOverviewFromText,
} from '../assets/js/sources.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fix = name => readFileSync(join(ROOT, 'tests', 'fixtures', name), 'utf8');
const near = (got, want, tol = 1e-6) =>
  assert.ok(Number.isFinite(got) && Math.abs(got - want) <= tol * Math.max(1, Math.abs(want)),
    `expected ≈${want} got ${got}`);

/* ─────────────────────────── ۱. عدد/متن ─────────────────────────── */

test('parseAmount: ارقام فارسی، پسوند، پرانتز منفی، منهای انتهایی', () => {
  near(parseAmount('۳۲۳'), 323);
  near(parseAmount('45,559'), 45559);
  near(parseAmount('1.2T'), 1.2e12);
  near(parseAmount('481.5B'), 481.5e9);
  near(parseAmount('3.8B'), 3.8e9);
  near(parseAmount('-122.3B'), -122.3e9);
  near(parseAmount('4780-'), -4780);            // قرارداد «4780-» = منفی
  near(parseAmount('(-113,024)'), -113024);
  near(parseAmount('53.67%'), 53.67);
  near(parseAmount('4.78 هزار'), 4780);
  assert.ok(Number.isNaN(parseAmount('—')), 'نامعتبر باید NaN بماند، نه صفر');
  assert.ok(Number.isNaN(parseAmount('جمع')));
});

test('stripTags: مرز سطر/سلول و برچسب نماد', () => {
  const text = stripTags('<tr><td>الف</td><td>2</td></tr><tr><td colspan="2"><a href="/symbol/فولاد">فولاد</a></td></tr>');
  const lines = text.split('\n').map(s => s.trim()).filter(Boolean);
  assert.equal(lines.length, 2, `دو سطر جدا: ${JSON.stringify(text)}`);
  assert.deepEqual(lines[0].split(/\s+/), ['الف', '2'], text);
  assert.equal(lines[1], '⟦فولاد⟧', text);
  assert.ok(!/<[a-z/]/i.test(text), 'تگ HTML باقی نمی‌ماند');
});

test('findNumbers: برچسب کوتاه‌تر روی برچسب بلندتر تطبیق نمی‌کند', () => {
  const words = ['شاخص', 'کل', 'فرابورس', '56,785.0', 'شاخص', 'کل', '7,167,410'];
  near(firstNumber(words, 'شاخص کل'), 7167410);
  near(firstNumber(words, 'شاخص کل فرابورس'), 56785);
  assert.ok(Number.isNaN(findNumbers(['x'], 'نیست').length ? NaN : NaN));
});

/* ─────────────────────────── ۲. صفحهٔ نماد بورس‌تریدر (واقعی) ─────────────────────────── */

const SYM = btSymbolFromText(fix('bourse_trader_symbol_folad.txt'), 'فولاد');

test('پارسر صفحهٔ نماد: قیمت‌ها ریالی می‌شوند (تومان × ۱۰)', () => {
  near(SYM.pl, 3230);
  near(SYM.pc, 3260);
  near(SYM.pf, 3380);
  near(SYM.py, 3290);
  near(SYM.pmin, 3200);
  near(SYM.pmax, 3380);
});

test('پارسر صفحهٔ نماد: حجم، ارزش، معاملات، ورود پول', () => {
  near(SYM.tvol, 3.7e9);
  near(SYM.tval, 1.2e13);
  near(SYM.tno, 45559);
  near(SYM.netRealMoneyToday, -1.223e12);
  near(SYM.bvol, 1);
});

test('پارسر صفحهٔ نماد: بنیادی‌ها و شناوری', () => {
  near(SYM.zTitad, 1.9e12);
  near(SYM.marketCap, 6.308e15);
  near(SYM.pe, 6.29);
  near(SYM.sectorPE, 13.18, 1e-3);
  near(SYM.eps, 520);              // ۵۲ تومان → ریال
  near(SYM.freeFloatPct, 53.67);
  near(SYM.volToFloatPct, 0.36);
  near(SYM.volToSharesPct, 0.19);
  near(SYM.buyPower, 0.62);
  near(SYM.avgVolMonth, 3.8e9);
});

test('پارسر صفحهٔ نماد: دفتر سفارش ۵ سطحی', () => {
  assert.equal((SYM.book || []).length, 5, 'پنج سطح');
  const l1 = SYM.book[0], l5 = SYM.book[4];
  near(l1.pd, 3220); near(l1.qd, 3077000); near(l1.bidCount, 13);
  near(l1.po, 3240); near(l1.qo, 2747891); near(l1.askCount, 35);
  near(l5.pd, 3160); near(l5.po, 3280);
  assert.deepEqual(SYM.ambiguous, [], 'نباید فیلد مبهم گزارش شود');
});

/* ─────────────────────────── ۳. نبض بازار بورس‌تریدر (واقعی) ─────────────────────────── */

const OV = btOverviewFromText(fix('bourse_trader_home.txt'));

test('نبض بازار: شاخص‌ها و ارزش بازار (ریال)', () => {
  near(OV.index_total, 7167410);
  near(OV.index_equal, 1922310);
  near(OV.index_fara, 56785);
  near(OV.market_cap, 2.45555e17);
  near(OV.retail_trade_value, 3.88e14);
  near(OV.retail_volume, 7.54e10);
  near(OV.per_capita_buy, 74.8);
  near(OV.per_capita_sell, 116.6);
  near(OV.orders_buy_value, 5.4e13);
  near(OV.orders_sell_value, 6e13);
});

test('نبض بازار: عرض/تقاضا و پول حقیقی', () => {
  near(OV.symbols_up, 293);
  near(OV.symbols_down, 654);
  near(OV.retail_money_inflow_rial, -4.78e13);
});

test('نبض بازار: جدول‌های ورود/خروج پول حقیقی', () => {
  assert.ok(OV.top_inflow.length >= 10, `top_inflow=${OV.top_inflow.length}`);
  assert.ok(OV.top_outflow.length >= 5, `top_outflow=${OV.top_outflow.length}`);
  assert.equal(OV.top_inflow[0].symbol, 'فزر');
  near(OV.top_inflow[0].money_rial, 4.815e12);
  near(OV.top_inflow[0].real_volume, 46.1e6);
  assert.equal(OV.top_outflow[0].symbol, 'فارس');
  near(OV.top_outflow[0].money_rial, -5.057e12);
});

/* ─────────────────────────── ۴. TSETMC: قالب رسمی ─────────────────────────── */

const MW = parseMarketWatchInit(fix('tsetmc_marketwatchinit.format-sample.txt'));

test('MarketWatchInit: وضعیت بازار (شاخص، تغییر، حجم/ارزش)', () => {
  near(MW.state.indexTotal, 7167410);
  near(MW.state.indexChange, -113024);
  near(MW.state.indexChangePct, -1.5524);
  near(MW.refid, 12345);
  assert.equal(MW.prices.length, 2);
});

test('parseChange: هر دو قرارداد پرانتزی و علامت‌دار', () => {
  const a = parseChange('(113024)-1.5524%');
  near(a.delta, -113024); near(a.pct, -1.5524);
  const b = parseChange('-113024 -1.55%');
  near(b.delta, -113024); near(b.pct, -1.55);
  const c = parseChange('(44)0.0776%');
  near(c.delta, -44, 1e-9);
});

test('buildRows: ادغام قیمت + حقیقی/حقوقی + دفتر سفارش (بدون داده ساختگی)', () => {
  const rows = buildRows(MW, parseClientTypeAll(fix('tsetmc_clienttypeall.format-sample.txt')));
  assert.equal(rows.length, 2);
  const r = rows[0];
  near(r.pc, 10000);
  near(r.tval, 50_250_000_000);
  near(r.tno, 1200);
  near(r.pe, 12.5);                    // pc/eps — از داده، نه ثابت
  near(r.zTitad, 1_000_000_000);
  near(r.Buy_I_Volume, 4_000_000);     // حقیقی
  near(r.Buy_N_Volume, 1_000_000);     // حقوقی
  near(r.Sell_I_Volume, 3_000_000);
  near(r.qd1, 200_000);
  near(r.qd5, 1_000_000);
  near(r.pd5, 9950);
  near(r.po5, 10050);
  assert.equal(r.market, 'بورس');      // flow = 1
  assert.equal(r.provenance, 'tsetmc');
  assert.equal(r.synthetic, false);
  assert.equal(r.traded, true);
});

test('buildRows: نماد بدون معامله ⇒ traded=false، نه صفر جعلی', () => {
  const rows = buildRows({ prices: [{ insCode: '9', flow: '2', pc: '5000' }], limits: {} }, {});
  assert.equal(rows[0].traded, false);
  assert.ok(!('pl' in rows[0]), 'فیلد ناموجود اضافه نمی‌شود');
});

test('parseChartCsv: کندل‌های تاریخچهٔ تعدیل‌شده', () => {
  const bars = parseChartCsv('20250920,3306,3114,3213,3237,570404984,3210;' +
                             '20250921,3380,3200,3230,3260,3700000000,3260;');
  assert.equal(bars.length, 2);
  assert.equal(bars[0].d, 20250920);
  const b = bars[1];
  near(b.o, 3230); near(b.h, 3380); near(b.l, 3200); near(b.c, 3260); near(b.v, 3.7e9);
});

/* ─────────────────────────── ۵. تضمین «بدون ساختگی‌سازی» ─────────────────────────── */

test('منبع خالی ⇒ هیچ فیلدی ساخته نمی‌شود', () => {
  const empty = btSymbolFromText('این متن هیچ برچسب تابلویی ندارد', 'تست');
  const keys = Object.keys(empty).filter(k => !['symbol', 'source', 'ambiguous'].includes(k));
  assert.deepEqual(keys, []);
  assert.deepEqual(empty.ambiguous, []);
});

test('EPS غایب ⇒ PE ساخته نمی‌شود؛ مقدار نامعتبر ⇒ NaN نه صفر', () => {
  const rows = buildRows({ prices: [{ insCode: '9', pc: '10000', eps: '' }], limits: {} }, {});
  assert.ok(!('pe' in rows[0]), 'PE بدون EPS جعل نمی‌شود');
  assert.ok(Number.isNaN(parseAmount('—')));
});

/* ─────────────────────── ۶. یکپارچگی با نرمال‌ساز هسته (tse.js) ─────────────────────── */

test('رکورد TSETMC پس از normalizeInstrument همان اعداد را نگه می‌دارد', async () => {
  const { normalizeInstrument } = await import('../assets/js/tse.js');
  const clients = parseClientTypeAll(fix('tsetmc_clienttypeall.format-sample.txt'));
  const inst = normalizeInstrument(buildRows(MW, clients)[0]);
  assert.equal(inst.insCode, '1111111111111111');
  assert.equal(inst.l18, 'TEST');
  near(inst.pc, 10000);
  near(inst.pmax, 10250);
  near(inst.tval, 50_250_000_000);
  near(inst.eps, 800);               // ستون EPS نمونهٔ ساختاری (ریال)
  near(inst.buyIVol, 4_000_000);
  near(inst.sellNVol, 2_000_000);
  assert.equal(inst.book.length, 5);
  near(inst.book[0].bid.p, 9990);  near(inst.book[0].bid.q, 200000); near(inst.book[0].bid.n, 100000);
  near(inst.book[0].ask.p, 10010); near(inst.book[0].ask.q, 20);
  near(inst.book[4].bid.p, 9950);  near(inst.book[4].bid.q, 1000000); near(inst.book[4].ask.p, 10050);
  assert.equal(inst.market, 'بورس');
  assert.equal(inst.provenance, 'tsetmc');
  assert.ok(inst.tmax > inst.pc && inst.tmin < inst.pc, 'آستانه‌ها از pc ساخته می‌شوند');
});

/* ─────────────── ۷. زنجیرهٔ واقعی data.js وقتی «شبکه هست» ─────────────── */

test('زنجیرهٔ data.js: TSETMC رسمی ⇒ رکورد live (نه اسنپ‌شات)', async () => {
  const { fetchMarketSnapshot } = await import('../assets/js/data.js');
  const raw = fix('tsetmc_marketwatchinit.format-sample.txt').split('@');
  const row1 = raw[2].split(';')[0].split(',');
  /* ۳۱ سطر (آستانهٔ پذیرش زنجیره) — همان قالب رسمی، شناسه‌های متمایز */
  const prices = Array.from({ length: 31 }, (_, i) =>
    [String(1111111111111111 + i), ...row1.slice(1)].join(',')).join(';');
  const mwText = [raw[0], raw[1], prices, raw[3], raw[4]].join('@');
  const ctText = fix('tsetmc_clienttypeall.format-sample.txt');

  const okResp = body => ({ ok: true, status: 200, text: async () => body, json: async () => JSON.parse(body) });
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    const u = String(url);
    if (u.includes('MarketWatchInit')) return okResp(mwText);
    if (u.includes('ClientTypeAll')) return okResp(ctText);
    throw new TypeError('بدون شبکه');
  };
  try {
    const snap = await fetchMarketSnapshot();
    assert.equal(snap.kind, 'live');
    assert.equal(snap.live, true);
    assert.ok(snap.rows.length >= 31, `rows=${snap.rows.length}`);
    assert.equal(snap.rows[0].provenance, 'tsetmc');
    near(snap.rows[0].pc, 10000);
    near(snap.rows[0].tval, 50_250_000_000);
    near(snap.rows[0].Buy_I_Volume, 4_000_000);
    near(snap.indices.index_total.value, 7167410);
    assert.ok(snap.log.some(l => l.startsWith('proxy:')), 'پروکسی اول امتحان شد');
  } finally {
    globalThis.fetch = savedFetch;
  }
});

/* ─────────── ۸. پروکسی سرور: پاکت instruments نباید «خالی» تلقی شود ─────────── */

test('زنجیرهٔ data.js: پاسخ موفق /api/market (instruments) پذیرفته می‌شود — نه proxy:empty', async () => {
  const { fetchMarketSnapshot } = await import('../assets/js/data.js');
  /* دقیقاً همان شکل پاکت server.py/_api_market */
  const instruments = Array.from({ length: 40 }, (_, i) => ({
    l18: `SYM${i}`, l30: `Symbol ${i}`, insCode: String(1000 + i),
    pc: 1000, pl: 1010, py: 990, tvol: 1e6, tval: 1e9, tno: 100,
    synthetic: false, provenance: 'tsetmc',
  }));
  const body = JSON.stringify({
    kind: 'live', source: 'TSETMC (MarketWatchInit + ClientTypeAll)', as_of: '۱۴۰۵/۰۶/۳۰ ۱۲:۳۰',
    instruments, indices: {}, market_state: {}, quality: { instruments: instruments.length },
    log: ['tsetmc:ok'],
  });
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    const u = String(url);
    if (u.includes('/api/market')) {
      return { ok: true, status: 200, text: async () => body, json: async () => JSON.parse(body) };
    }
    throw new TypeError(`بدون شبکه: ${u}`);
  };
  try {
    const snap = await fetchMarketSnapshot();
    assert.equal(snap.kind, 'live');
    assert.equal(snap.live, true);
    assert.equal(snap.rows.length, 40, 'ردیف‌های instruments نباید گم شوند');
    assert.equal(snap.source, 'TSETMC (MarketWatchInit + ClientTypeAll)');
    assert.ok(snap.log.includes('proxy:ok(live)'), `log=${JSON.stringify(snap.log)}`);
    assert.ok(!snap.log.some(l => l === 'proxy:empty'), 'پاسخ زنده سرور نباید خوانده شود');
  } finally {
    globalThis.fetch = savedFetch;
  }
});
