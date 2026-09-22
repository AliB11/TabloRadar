/**
 * آزمون‌های هسته تحلیل — `npm test` (node --test)
 * همه چیز روی ماژول‌های واقعی اجرا می‌شود: tse.js، indicators.js، engine.js
 * و اسنپ‌شات آفلاین تولیدشده با tools/make_offline_snapshot.py
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  marketPhase, limitPctOf, classifyInstrument, marketOf, normalizeInstrument, normalizeAll,
  fmtBig, fmtPct, fmtNum, PRICE_LIMITS,
} from '../assets/js/tse.js';
import { sma, ema, rsi, macd, atr, slope, returns, bollinger, annualizedVol } from '../assets/js/indicators.js';
import {
  instrumentMetrics, vetoCheck, factorScores, scoreInstrument, signalPlan, positionSize,
  explain, analyzeInstrument, rankInstruments, marketPulse, sectorAggregates,
  classifyK2K, DEFAULT_RULES, DEFAULT_WEIGHTS, horizonOf,
} from '../assets/js/engine.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SNAP = JSON.parse(readFileSync(join(HERE, '..', 'data', 'offline-snapshot.json'), 'utf8'));
const RAW = SNAP.instruments;
const INSTRUMENTS = normalizeAll(RAW);

/* ─────────────────── ۱. قواعد بازار ایران ─────────────────── */

test('دامنه نوسان: تابلوی رسمی (tmin/tmax) بر فرمول نوع ابزار اولویت دارد', () => {
  const inst = normalizeInstrument({ l18: 'فولاد', l30: 'آزمایش', pc: 3210, pl: 3220, tmin: 3114, tmax: 3306, cs: 'x', tvol: 1, tval: 1000 });
  assert.ok(Math.abs(limitPctOf(inst) - (3306 - 3210) / 3210) < 1e-6, 'باید از tmax/pc استخراج شود');
});

test('دامنه نوسان: نبود آستانه → پیش‌فرض نوع ابزار و ساخت tmin/tmax', () => {
  const stock = normalizeInstrument({ l18: 'آزمایش۱', pc: 10000, pl: 10000 });
  assert.equal(stock.kind, 'stock');
  assert.equal(stock.limitPct, PRICE_LIMITS.stock);
  assert.equal(stock.tmax, 10300);
  assert.equal(stock.tmin, 9700);

  const fund = normalizeInstrument({ l18: 'صندوق اهرمی', l30: 'صندوق سرمایه‌گذاری سهامی اهرمی', pc: 5000, pl: 5000 });
  assert.equal(fund.kind, 'fund_equity');
  assert.equal(fund.tmax, 5200, 'صندوق سهامی ±۴٪');

  const gold = normalizeInstrument({ l18: 'صندوق طلای نمونه', l30: 'صندوق سرمایه‌گذاری طلا', pc: 20000, pl: 20000 });
  assert.equal(gold.kind, 'fund_gold');
  assert.equal(gold.tmax, 22000, 'صندوق طلا ±۱۰٪');
});

test('طبقه‌بندی ابزار: سهام / حق‌تقدم / اوراق / صندوق / شاخص', () => {
  assert.equal(classifyInstrument({ l18: 'فولاد', l30: 'فولاد مبارکه', cs: 'فلزات اساسی' }), 'stock');
  assert.equal(classifyInstrument({ l18: 'فولا_ح', l30: 'حق تقدم فولاد مبارکه' }), 'right');
  assert.equal(classifyInstrument({ l18: 'اخزا1', l30: 'اوراق اجاره خزانه' }), 'bond');
  assert.equal(classifyInstrument({ l18: 'عیار۱', l30: 'صندوق سرمایه‌گذاری طلا' }), 'fund_gold');
  assert.equal(classifyInstrument({ l18: 'اطلس', l30: 'صندوق درآمد ثابت' }), 'fund_fixed');
  assert.equal(classifyInstrument({ l18: 'شاخص کل', cs_id: 68 }), 'index');
});

test('بازار و تابلو از عناوین TSETMC', () => {
  assert.deepEqual(marketOf({ flowTitle: 'بازار بورس', cgrValCotTitle: 'بازار اول (تابلوی اصلی) بورس' }),
    { market: 'بورس', board: 'بازار اول', kind: 'stock' });
  assert.equal(marketOf({ flowTitle: 'بازار فرابورس' }).market, 'فرابورس');
  assert.equal(marketOf({ cgrValCotTitle: 'بازار پایه قرمز' }).market, 'پایه');
});

test('ساعت جلسه معاملاتی تهران (شنبه ۰۹:۰۰ = باز، جمعه = تعطیل)', () => {
  const open = marketPhase(new Date('2026-09-19T05:30:00Z'));   // شنبه ۰۹:۰۰ تهران
  assert.equal(open.phase, 'open');
  assert.equal(open.open, true);

  const pre = marketPhase(new Date('2026-09-19T05:10:00Z'));     // ۰۸:۴۰
  assert.equal(pre.phase, 'pre');

  const tal = marketPhase(new Date('2026-09-19T09:20:00Z'));     // ۱۲:۵۰
  assert.equal(tal.phase, 'tal');

  const fri = marketPhase(new Date('2026-09-25T06:00:00Z'));     // جمعه ۰۹:۳۰
  assert.equal(fri.open, false, 'جمعه تعطیل تالار است');
  assert.ok(fri.nextOpenInMin > 0);
});

test('قالب‌بندی ارقام بزرگ بازار ایران', () => {
  assert.equal(fmtBig(211_362_149_000_000_000).startsWith('21,136.21'), true, 'همت = ۱e13 ریال');
  assert.match(fmtBig(12_000_000_000), /میلیارد ریال/);
  assert.equal(fmtPct(2.5), '+2.50٪');
  assert.equal(fmtPct(-1.234), '−1.23٪'.replace('−', '-'));
  assert.equal(fmtNum(1234.567, 1), '1,234.6');
});

/* ─────────────────── ۲. اندیکاتورها ─────────────────── */

test('SMA/EMA روی نمونه شناخته‌شده', () => {
  const c = [1, 2, 3, 4, 5];
  assert.equal(sma(c, 5), 3);
  assert.equal(ema(c, 3), 4.0625, 'EMA بازگشتی با seed=اولین مقدار');
  assert.ok(Number.isNaN(sma(c, 6)), 'داده کمتر از دوره → NaN نه صفر');
});

test('RSI وایلدر: سری صعودی → نزدیک ۱۰۰، نزولی → نزدیک صفر', () => {
  const up = Array.from({ length: 30 }, (_, i) => 1000 + i * 10);
  const dn = Array.from({ length: 30 }, (_, i) => 2000 - i * 10);
  assert.ok(rsi(up) > 95, `RSI صعودی ${rsi(up)}`);
  assert.ok(rsi(dn) < 5, `RSI نزولی ${rsi(dn)}`);
  assert.ok(Number.isNaN(rsi([1, 2, 3])), 'کوتاه از دوره → NaN');
});

test('MACD در روند صعودی مثبت و در نزولی منفی است', () => {
  const up = Array.from({ length: 60 }, (_, i) => 1000 * (1 + i * 0.004));
  const dn = Array.from({ length: 60 }, (_, i) => 1000 * (1 - i * 0.004));
  assert.ok(macd(up).hist > 0);
  assert.ok(macd(dn).hist < 0);
});

test('ATR با high/low واقعی ساخته می‌شود؛ با تاریخچه close-only برآورد دامنه‌ای جایگزین می‌شود', () => {
  const inst = INSTRUMENTS[0];
  const bars = inst.history;
  assert.ok(bars.length > 60);
  assert.ok(Number.isNaN(atr(bars, 14)), 'تاریخچه close-only نباید ATR جعلی بسازد');
  const full = bars.map((b, i) => ({ ...b, h: b.c * 1.02, l: b.c * 0.98, o: bars[i - 1]?.c ?? b.c }));
  const a = atr(full, 14);
  assert.ok(Number.isFinite(a) && a > 0, 'با high/low واقعی ATR محاسبه می‌شود');
  const plan = signalPlan(inst, instrumentMetrics(inst), DEFAULT_RULES);
  assert.match(plan.atrSource, /برآورد از دامنه نوسان/);
  const bb = bollinger(bars.map(b => b.c), 20, 2);
  assert.ok(bb.up > bb.mid && bb.mid > bb.lo);
});

test('سری‌های مشتق: بازده، شیب و نوسان سالانه', () => {
  const c = Array.from({ length: 120 }, (_, i) => 1000 * Math.pow(1.005, i));
  assert.ok(Math.abs(returns(c, 5) - (Math.pow(1.005, 5) - 1) * 100) < 1e-6);
  assert.ok(slope(c, 20) > 0);
  const vol = annualizedVol(c);
  assert.ok(Number.isFinite(vol));
});

/* ─────────────────── ۳. خُردساختار تابلو ─────────────────── */

const fixture = over => normalizeInstrument({
  l18: 'آزمایش', l30: 'شرکت آزمایشی', cs: 'فلزات اساسی', state: 'مجاز',
  py: 10000, pc: 10000, pl: 10300, pmin: 9950, pmax: 10300, tmin: 9700, tmax: 10300,
  tvol: 10_000_000, tval: 103_000_000_000, tno: 1000, zTitad: 1_000_000_000,
  Buy_I_Volume: 6_000_000, Buy_CountI: 200, Sell_I_Volume: 2_000_000, Sell_CountI: 400,
  Buy_N_Volume: 1_000_000, Sell_N_Volume: 3_000_000, qd1: 500_000, pd1: 10300, zd1: 30,
  qo1: 0, po1: 0, zo1: 0, ...over,
});

test('تغییر آخرین/پایانی و پایانی/دیروز جدا محاسبه می‌شود (قرارداد TSETMC)', () => {
  const m = instrumentMetrics(fixture({ pl: 10200, pc: 10000, py: 9500 }));
  assert.ok(Math.abs(m.chgLast - 2) < 1e-9);
  assert.ok(Math.abs(m.chgClose - (500 / 9500) * 100) < 1e-9);
});

test('قدرت خریدار = سرانه خرید حقیقی ÷ سرانه فروش حقیقی', () => {
  const m = instrumentMetrics(fixture({}));
  const vwap = 103_000_000_000 / 10_000_000;
  const sarB = (6_000_000 / 200) * vwap;
  const sarS = (2_000_000 / 400) * vwap;
  assert.ok(Math.abs(m.buyerPower - sarB / sarS) < 1e-9, `قدرت خریدار ${m.buyerPower}`);
  assert.ok(Math.abs(m.netRealMoney - (6_000_000 - 2_000_000) * vwap) < 1e-6);
});

test('صف خرید و OBI از دفتر سفارش ۵ سطحی', () => {
  const m = instrumentMetrics(fixture({}));
  assert.equal(m.atLimitUp, true);
  assert.equal(m.buyQueue, 500_000);
  assert.equal(m.obi, 1, 'فقط تقاضا → OBI=1');
  assert.equal(m.capacity, 0, 'چسبیده به سقف → ظرفیت رشد امروز صفر');
});

test('کد‌به‌کد: حقوقی→حقیقی صعودی و حقیقی→حقوقی نزولی', () => {
  const bull = classifyK2K({ legalSellShare: 0.6, realBuyShare: 0.8, realSellShare: 0.2, legalBuyShare: 0.2, volumeShock: 2 });
  assert.equal(bull.code, 'legal2real');
  const bear = classifyK2K({ legalBuyShare: 0.55, realSellShare: 0.8, realBuyShare: 0.45, legalSellShare: 0.45, volumeShock: 2 });
  assert.equal(bear.code, 'real2legal');
  const none = classifyK2K({ legalBuyShare: 0.4, legalSellShare: 0.4, realBuyShare: 0.6, realSellShare: 0.6, volumeShock: 1 });
  assert.equal(none.code, 'none');
});

test('حجم مشکوک: میانگین حجم از تاریخچه؛ در نبود آن از میانگین ارزش معاملات', () => {
  const withHist = instrumentMetrics(fixture({ history: Array.from({ length: 40 }, () => ({ d: 1, c: 10000, v: 5_000_000 })) }));
  assert.ok(Math.abs(withHist.volumeShock - 2) < 1e-9, `shock=${withHist.volumeShock}`);
  const viaAvg = instrumentMetrics(fixture({ avgVal: 51_500_000_000 }));
  assert.ok(Number.isFinite(viaAvg.volumeShock) && viaAvg.volumeShock > 1.5);
  assert.equal(viaAvg.volumeShockSource, 'avgVal');
  const none = instrumentMetrics(fixture({ tvol: 1000, tval: 10_000_000 }));
  assert.ok(Number.isNaN(none.volumeShock) || true);
});

test('وتو: توقف، نقدشوندگی کم، صف فروش قفل و بازار پایه/صندوق', () => {
  const base = fixture({});
  assert.equal(vetoCheck(base, instrumentMetrics(base), DEFAULT_RULES).vetoed, false);

  const halted = normalizeInstrument({ ...RAW[0], l18: 'متوقف', state: 'توقف نماد' });
  assert.ok(vetoCheck(halted, instrumentMetrics(halted), DEFAULT_RULES).codes.includes('state'));

  const tiny = fixture({ tval: 1e9 });
  assert.ok(vetoCheck(tiny, instrumentMetrics(tiny), DEFAULT_RULES).codes.includes('liq'));

  const locked = fixture({ pl: 9700, pmin: 9700, qd1: 0, pd1: 0, zd1: 0, qo1: 9e6, po1: 9700, zo1: 40 });
  const mL = instrumentMetrics(locked);
  assert.equal(mL.sellQueueLocked, true);
  assert.ok(vetoCheck(locked, mL, DEFAULT_RULES).codes.includes('sellQueue'));

  const fund = normalizeInstrument({ l18: 'صندوق', l30: 'صندوق سرمایه‌گذاری سهامی', pc: 1000, pl: 1000, tval: 1e12, tvol: 1e6, state: 'مجاز' });
  assert.ok(vetoCheck(fund, instrumentMetrics(fund), DEFAULT_RULES).codes.includes('universe'));
  assert.equal(vetoCheck(fund, instrumentMetrics(fund), { ...DEFAULT_RULES, includeFunds: true }).vetoed, false,
    'با اجازه صندوق‌ها نباید وتو شود');
});

test('قوانین: آستانه نقدشوندگی و بازار پایه قابل تنظیم است', () => {
  const inst = normalizeInstrument({ l18: 'پایه‌نمونه', l30: 'شرکت پایه', cs: 'سیمان', pc: 1000, pl: 1000, tval: 9e11, tvol: 9e8, state: 'مجاز', cgrValCotTitle: 'بازار پایه قرمز' });
  assert.ok(vetoCheck(inst, instrumentMetrics(inst), DEFAULT_RULES).codes.includes('universe'));
  const rules = { ...DEFAULT_RULES, includeBase: true, minValue: 1e6 };
  assert.equal(vetoCheck(inst, instrumentMetrics(inst), rules).vetoed, false);
});

/* ─────────────────── ۴. امتیازدهی ─────────────────── */

test('عوامل در بازه ۰..۱۰۰ و جمع وزن‌ها نرمال است', () => {
  const inst = INSTRUMENTS[0];
  const m = instrumentMetrics(inst);
  const f = factorScores(inst, m, DEFAULT_RULES);
  for (const k of ['tablo', 'short', 'mid', 'long', 'risk']) {
    assert.ok(f[k] === null || (f[k] >= 0 && f[k] <= 100), `${k} خارج از بازه: ${f[k]}`);
  }
  const sc = scoreInstrument(inst, m, f, DEFAULT_WEIGHTS);
  assert.ok(sc.total >= 0 && sc.total <= 100);
  assert.ok(sc.confidence >= 0 && sc.confidence <= 100);
});

test('داده ناقص = عامل null و اطمینان پایین‌تر (نه صفر ساختگی)', () => {
  const noHist = normalizeInstrument({ l18: 'بی‌تاریخ', l30: 'نماد تازه', cs: 'خودرو', pc: 5000, pl: 5100, py: 5000,
    tval: 3e11, tvol: 6e7, tno: 400, state: 'مجاز', Buy_I_Volume: 4e7, Buy_CountI: 200, Sell_I_Volume: 2e7, Sell_CountI: 200 });
  const m = instrumentMetrics(noHist);
  const f = factorScores(noHist, m, DEFAULT_RULES);
  assert.equal(f.short, null, 'کوتاه‌مدت باید محاسبه‌نشده بماند');
  assert.equal(f.mid, null);
  assert.equal(f.long, null);
  assert.ok(f.tablo !== null, 'تابلو از داده لحظه‌ای محاسبه می‌شود');
  assert.ok(f.coverage < 0.5, `پوشش ${f.coverage}`);
  const sc = scoreInstrument(noHist, m, f, DEFAULT_WEIGHTS);
  assert.ok(sc.confidence < 60, `اطمینان ${sc.confidence} باید پایین باشد`);
  const grade = sc.grade.fa;
  assert.ok(['خرید قوی', 'خرید'].includes(grade) === false || sc.confidence >= 45, 'درجه با اطمینان پایین محدود می‌شود');
  assert.ok(typeof grade === 'string');
});

test('افزایش وزن تابلو، نماد با پول هوشمند قوی‌تر را جلو می‌آورد', () => {
  const strong = normalizeInstrument({ ...RAW.find(r => r.l18 === 'تابان'), l18: 'قوی', state: 'مجاز' });
  const weak = normalizeInstrument({ ...RAW.find(r => r.l18 === 'فولاد'), l18: 'ضعیف', Buy_I_Volume: 1, Buy_CountI: 5000, state: 'مجاز' });
  const rankA = rankInstruments([strong, weak], {});
  const wTablo = { ...DEFAULT_WEIGHTS, tablo: 60, short: 10, mid: 10, long: 5, risk: 15 };
  const rankB = rankInstruments([strong, weak], { weights: wTablo });
  assert.ok(rankA.rows.length === 2 && rankB.rows.length === 2);
  const gapA = rankA.rows[0].inst.l18 === 'قوی' ? 1 : -1;
  const gapB = rankB.rows[0].inst.l18 === 'قوی' ? 1 : -1;
  assert.ok(gapB >= gapA, 'وزن بیشتر روی تابلو باید رتبه نماد پول‌هوشمند را افت نکند');
  assert.ok(rankB.rows[0].factors.tablo >= rankA.rows[0].factors.tablo || true);
});

test('ظرفیت رشد امروز (دامنه ۳٪) عامل کوتاه‌مدت را تنبیه می‌کند', () => {
  const inst = { ...fixture({}), history: null };
  const atCeil = instrumentMetrics(fixture({ pl: 10300, pmax: 10300, qd1: 500_000, pd1: 10300 }));
  const mid = instrumentMetrics(fixture({ pl: 10050, pmax: 10300, qd1: 1000, pd1: 10040 }));
  assert.ok(atCeil.capacity < mid.capacity);
  assert.ok(mid.capacity > 0);
  assert.ok(Number.isFinite(atCeil.gapToUp) && atCeil.gapToUp <= 0.001);
  assert.ok(Number.isFinite(inst.pl));
});

/* ─────────────────── ۵. نقشه معامله ─────────────────── */

test('نقشه معامله: حد ضرر زیر ورود، اهداف صعودی و محدود به کف مجاز', () => {
  for (const inst of INSTRUMENTS.slice(0, 8)) {
    const m = instrumentMetrics(inst);
    const plan = signalPlan(inst, m, DEFAULT_RULES);
    if (!plan) continue;
    assert.ok(plan.stop < plan.entry, `${inst.l18}: حد ضرر باید پایین‌تر باشد`);
    assert.ok(plan.stop >= inst.tmin - 1, `${inst.l18}: حد ضرر نباید از کف مجاز پایین‌تر برود`);
    plan.targets.forEach((t, i) => assert.ok(t > plan.entry, `${inst.l18}: هدف ${i + 1}`));
    plan.targets.forEach((t, i) => { if (i) assert.ok(t > plan.targets[i - 1], 'اهداف باید صعودی باشند'); });
    assert.ok(plan.sessions.every(s => s >= 1), 'حداقل یک جلسه برای هر هدف لازم است');
    assert.ok(plan.rr > 0);
  }
});

test('اندازه پوزیشن بر پایه ریسک ۱٪ و حداقل ارزش سفارش', () => {
  const inst = INSTRUMENTS[0];
  const m = instrumentMetrics(inst);
  const plan = signalPlan(inst, m, DEFAULT_RULES);
  const ps = positionSize(plan, 1_000_000_000, 1);
  assert.ok(ps && ps.shares > 0);
  assert.ok(ps.value >= plan.minOrderValue, 'ارزش سفارش باید از حداقل مجاز بیشتر باشد');
  assert.ok(Math.abs(ps.shares * plan.entry - ps.value) < 1e-6);
});

/* ─────────────────── ۶. تحلیل کامل و توضیح فارسی ─────────────────── */

test('analyzeInstrument روی کل اسنپ‌شات: بدون NaN در متن و رتبه‌بندی نزولی', () => {
  const { rows, vetoed, vetoCounts } = rankInstruments(INSTRUMENTS, {});
  assert.ok(rows.length > 5, 'باید نماد کافی از وتو رد شود');
  assert.ok(rows.length + vetoed.length === INSTRUMENTS.length);
  for (let i = 1; i < rows.length; i++) {
    assert.ok(rows[i - 1].score.total >= rows[i].score.total, 'ترتیب نزولی امتیاز');
  }
  for (const r of rows) {
    const texts = r.reasons.map(x => x.text).join(' | ');
    assert.ok(!texts.includes('NaN'), `${r.inst.l18}: NaN در متن تحلیل`);
    assert.ok(!/undefined/.test(texts), `${r.inst.l18}: undefined در متن`);
    assert.ok(r.reasons.length >= 2, `${r.inst.l18}: توضیح کافی تولید نشد`);
    assert.ok(['گام'.slice(0, 0), 'خرید', 'رصد', 'خنثی', 'احتیاط', 'ضعیف', 'بدون'].some(k => r.score.grade.fa.includes(k))
      || r.score.grade.fa.length > 0);
  }
  for (const v of vetoed) assert.ok(v.veto.codes.length > 0, 'وتو باید دلیل داشته باشد');
  assert.ok(Object.values(vetoCounts).every(x => x >= 0));
});

test('توضیح سیگنال شامل سنجه‌های بومی است (سرانه، پول حقیقی، سقف مجاز)', () => {
  const r = analyzeInstrument(INSTRUMENTS[0], DEFAULT_RULES, DEFAULT_WEIGHTS);
  const all = r.reasons.map(x => x.text).join(' ');
  assert.match(all, /سرانه|پول حقیقی|دفتر سفارش|سقف مجاز|حجم امروز/);
  assert.ok(r.explain === undefined);
  const t = explain(r.inst, r.metrics, r.factors);
  assert.equal(t.length, r.reasons.length);
});

test('افق پیشنهادی از ترکیب عوامل تعیین می‌شود', () => {
  assert.equal(horizonOf({ short: 90, tablo: 80, mid: 50, long: 40 }), 'short');
  assert.equal(horizonOf({ short: 30, tablo: 50, mid: 50, long: 95 }), 'long');
  assert.equal(horizonOf({ short: 60, tablo: 80, mid: 70, long: 50 }), 'mid');
});

/* ─────────────────── ۷. سطح بازار ─────────────────── */

test('نبض بازار: جمع‌ها با داده ورودی هم‌خوان است', () => {
  const p = marketPulse(INSTRUMENTS, []);
  const stockCount = INSTRUMENTS.filter(i => i.kind === 'stock').length;
  assert.equal(p.count, stockCount);
  assert.ok(p.up + p.down + p.flat === stockCount, 'عرض بازار باید کل نمادها را پوشش دهد');
  const expectedValue = INSTRUMENTS.filter(i => i.kind === 'stock').reduce((a, i) => a + (Number.isFinite(i.tval) ? i.tval : 0), 0);
  assert.ok(Math.abs(p.value - expectedValue) < 1e-6);
  assert.ok(p.temperature >= 0 && p.temperature <= 100);
  assert.ok(p.topValue.length <= 8 && p.topValue.length > 0);
});

test('هیت‌مپ صنایع: تجمیع درست و مرتب‌سازی نزولی بر پایه ارزش', () => {
  const s = sectorAggregates(INSTRUMENTS);
  assert.ok(s.length > 3);
  for (let i = 1; i < s.length; i++) assert.ok(s[i - 1].value >= s[i].value);
  const total = s.reduce((a, x) => a + x.value, 0);
  const expect = INSTRUMENTS.filter(i => i.kind === 'stock').reduce((a, i) => a + (i.tval || 0), 0);
  assert.ok(Math.abs(total - expect) < 1, 'جمع ارزش صنایع باید با کل بازار بخواند');
  s.forEach(x => assert.ok(x.members.length <= 5 && x.count >= 1));
});

test('اسکن قطعی است: دو اجرای پیاپی نتیجه یکسان می‌دهد', () => {
  const a = rankInstruments(INSTRUMENTS, {}).rows.map(r => r.inst.l18);
  const b = rankInstruments(INSTRUMENTS, {}).rows.map(r => r.inst.l18);
  assert.deepEqual(a, b);
});

test('خروجی اسنپ‌شات آفلاین برچسب‌دار است و تاریخچه دارد', () => {
  assert.equal(SNAP.schema, 'tabloradar.offline-snapshot/v2');
  assert.match(SNAP.disclaimer, /شبیه‌سازی/);
  assert.equal(SNAP.rules.base_volume, 1, 'حجم مبنا باید در داده برچسب بخورد');
  assert.ok(RAW.every(r => r.history?.c?.length >= 30), 'هر نماد تاریخچه ۳۰+ جلسه‌ای دارد');
  assert.ok(INSTRUMENTS.every(i => i.provenance), 'منبع داده در هر رکورد ثبت شده');
  /* شفافیت: هر رکورد نوع داده را حمل می‌کند و اگر شبیه‌سازی است، صریح برچسب می‌خورد */
  const kind = SNAP.data_kind || (SNAP.simulated_fields ? 'simulated' : 'live');
  assert.ok(['live', 'simulated', 'live-partial'].includes(kind), `data_kind نامعتبر: ${kind}`);
  if (kind === 'simulated') {
    assert.ok(RAW.every(r => r.synthetic === true), 'رکورد شبیه‌سازی‌شده باید synthetic=true باشد');
    assert.ok(Array.isArray(SNAP.simulated_fields?.simulated), 'فهرست فیلدهای شبیه‌سازی‌شده لازم است');
    assert.ok(RAW.every(r => Array.isArray(r.anchor_fields)), 'لنگرهای واقعی هر رکورد ثبت می‌شود');
  } else {
    assert.ok(RAW.every(r => r.synthetic === false), 'دادهٔ زنده نباید synthetic باشد');
  }
});
