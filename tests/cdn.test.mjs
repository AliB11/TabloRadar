/**
 * cdn.test.mjs — آزمون کلاینت CDN رسمی TSETMC روی فیکسچرهای واقعی (بدون شبکه)
 *
 * فیکسچرها پاسخ‌های واقعی cdn.tsetmc.com برای نماد فولاد (46348559193224090)
 * در ۱۴۰۵/۰۸/۰۳ هستند: tests/fixtures/cdn_{instrument_info,bestlimits,daily_list}.json
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

import {
  mapInstrumentInfo, mapDailyList, mapBestLimits, dailyRowToRaw,
  applyCdnInfo, applyCdnBook, mergeSeedWithCodemap, sessionIsToday,
  readSeedCache, writeSeedCache,
} from '../assets/js/cdn.js';
import { normalizeInstrument } from '../assets/js/tse.js';

const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const info = () => JSON.parse(readFileSync(join(FIX, 'cdn_instrument_info.json'), 'utf8'));
const book = () => JSON.parse(readFileSync(join(FIX, 'cdn_bestlimits.json'), 'utf8'));
const daily = () => JSON.parse(readFileSync(join(FIX, 'cdn_daily_list.json'), 'utf8'));

test('CDN: شناسنامهٔ رسمی — EPS/صنعت/آستانه/۵۲هفته از پاسخ واقعی فولاد', () => {
  const o = mapInstrumentInfo(info());
  assert.equal(o.l18, 'فولاد');
  assert.equal(o.isin, 'IRO1FOLD0009');
  assert.equal(o.sectorName, 'فلزات اساسي');
  assert.equal(o.estimatedEPS, 693);
  assert.equal(o.eps, NaN);                  // epsValue=null یعنی «برآوردی»، نه صفر
  assert.equal(o.sectorPE, 10.98);
  assert.equal(o.tmax, 4230);
  assert.equal(o.tmin, 3990);
  assert.ok(o.maxYear >= o.maxWeek && o.maxWeek > 0);
  assert.equal(o.baseVol, 1);                // حجم مبنای یک (مصوب ۱ دی ۱۴۰۴)
  assert.ok(o.totalShares > 0);
});

test('CDN: دفتر سفارش — ۵ سطح با نگاشت تقاضا/عرضه و مرتب‌سازی', () => {
  const b = mapBestLimits(book());
  assert.equal(b.length, 5);
  assert.deepEqual(b.map(x => x.i), [1, 2, 3, 4, 5]);
  const l1 = b[0];
  assert.equal(l1.bid.p, 4110);
  assert.equal(l1.bid.q, 5000);
  assert.equal(l1.bid.n, 1);
  assert.equal(l1.ask.p, 4110);
  assert.equal(l1.ask.q, 300000);
  assert.ok(b[1].bid.p < b[0].bid.p || b[1].bid.p === b[0].bid.p);   // قیمت‌های خرید نزولی
  assert.ok(b[1].ask.p >= b[0].ask.p);                               // قیمت‌های فروش صعودی
});

test('CDN: دفتر سفارش ناقص — سطح بدون قیمت/حجم حذف می‌شود', () => {
  const b = mapBestLimits({ bestLimits: [
    { number: 1, qTitMeDem: 100, zOrdMeDem: 1, pMeDem: 1000, pMeOf: 1010, zOrdMeOf: 1, qTitMeOf: 200 },
    { number: 2, qTitMeDem: 0, zOrdMeDem: 0, pMeDem: 0, pMeOf: 0, zOrdMeOf: 0, qTitMeOf: 0 },
    { number: 9, qTitMeDem: 5, zOrdMeDem: 1, pMeDem: 900, pMeOf: 910, zOrdMeOf: 1, qTitMeOf: 5 },  // خارج از ۱..۵
  ] });
  assert.equal(b.length, 1);
  assert.equal(b[0].i, 1);
});

test('CDN: تاریخچهٔ روزانه — روزهای بدون معامله حذف و ترتیب صعودی است', () => {
  const bars = mapDailyList(daily());
  assert.ok(bars.length >= 20);
  for (const b of bars) {
    assert.ok(b.c > 0 && b.v > 0 && b.val > 0, 'کندل بی‌معامله نباید وارد شود');
    assert.ok(b.h >= b.l, 'بیشترین ≥ کمترین');
    assert.ok(b.h >= b.o && b.h >= b.c, 'بیشترین ≥ اولین/پایانی');
  }
  for (let i = 1; i < bars.length; i++) assert.ok(bars[i].d > bars[i - 1].d, 'تاریخ صعودی');
  const last = bars[bars.length - 1];
  assert.equal(last.d, 20261025);            // آخرین جلسهٔ واقعی فیکسچر
  assert.equal(last.pyRef, 4110);            // priceYesterday سطر واقعی
});

test('CDN: سطر بذری — DailyList به رکورد خام سازگار با normalizeInstrument تبدیل می‌شود', () => {
  const bars = mapDailyList(daily());
  const raw = dailyRowToRaw({ i: '46348559193224090', s: 'فولاد', n: 'فولاد مباركه اصفهان', g: 'فلزات اساسي', m: 'بورس', b: 'بازار اول' }, bars[bars.length - 1]);
  assert.equal(raw.insCode, '46348559193224090');
  assert.equal(raw.l18, 'فولاد');
  assert.equal(raw.provenance, 'tsetmc-cdn');
  assert.equal(raw.synthetic, false);
  assert.equal(typeof raw.lastSession, 'string');       // رشته — برای مقایسهٔ لغوی امن
  assert.match(raw.lastSession, /^\d{8}$/);
  const inst = normalizeInstrument(raw);
  assert.equal(inst.market, 'بورس');
  assert.equal(inst.board, 'بازار اول');
  assert.equal(inst.cs, 'فلزات اساسي');
  assert.ok(inst.pl > 0 && inst.pc > 0 && inst.py > 0);
  assert.ok(inst.tmax > inst.pc && inst.tmin < inst.pc);   // آستانهٔ برآوردشده از دامنهٔ ۳٪
  assert.ok(inst.tval > 1e12);                             // ارزش واقعی فولاد
  assert.equal(inst.kind, 'stock');
});

test('CDN: غنی‌سازی — آستانهٔ رسمی روی برآورد می‌نشیند و EPS برچسب درست می‌گیرد', () => {
  const o = mapInstrumentInfo(info());
  const raw = dailyRowToRaw({ i: '46348559193224090', s: 'فولاد', n: 'فولاد', g: 'فلزات', m: 'بورس', b: 'بازار اول' }, mapDailyList(daily()).at(-1));
  const inst = normalizeInstrument(raw);
  const before = { tmax: inst.tmax, tmin: inst.tmin };
  const touched = applyCdnInfo(inst, o);
  assert.ok(touched);
  assert.equal(inst.tmax, 4230);             // رسمی جایگزین برآورد ۴۲۳۳ شد
  assert.equal(inst.tmin, 3990);
  assert.notDeepEqual({ tmax: inst.tmax, tmin: inst.tmin }, before);
  assert.equal(inst.estimatedEps, true);     // epsValue=null ⇒ EPS برآوردی (۶۹۳)
  assert.equal(inst.eps, 693);
  assert.ok(inst.pe > 0);                    // پ/ای از آخرین قیمت و EPS برآوردی
  assert.ok(inst.cdnAt);
  assert.equal(inst.cdnSector, 'فلزات اساسي');
});

test('CDN: غنی‌سازی — EPS قطعی، برچسب «برآوردی» نمی‌گیرد؛ NaN ساختگی ساخته نمی‌شود', () => {
  const inst = normalizeInstrument({ l18: 'خودرو', insCode: '1', pc: 1000, pl: 1000, py: 990 });
  applyCdnInfo(inst, { eps: 250, estimatedEPS: 250, sectorPE: 8, tmax: 1030, tmin: 970 });
  assert.equal(inst.eps, 250);
  assert.equal(inst.estimatedEps, false);
  assert.equal(inst.sectorPE, 8);
  assert.equal(inst.freeFloat, NaN);         // دادهٔ غایب، صفر جعلی نمی‌شود
});

test('CDN: دفتر زندهٔ CDN جایگزین دفتر تابلو می‌شود و bookSource ثبت است', () => {
  const inst = normalizeInstrument({ l18: 'فولاد', insCode: 'x', pc: 4110, pl: 4100, py: 4220 });
  const b = mapBestLimits(book());
  assert.equal(applyCdnBook(inst, b), true);
  assert.equal(inst.bookSource, 'cdn');
  assert.equal(inst.book[0].bid.q, 5000);
  assert.equal(applyCdnBook(inst, []), false);   // خالی ⇒ دست نمی‌زند
});

test('CDN: کتابخانهٔ شناسه‌ها — ادغام بدون تکرار و حفظ فایل بذری', () => {
  const seed = [{ i: 'a1', s: 'فولاد', n: 'فولاد', g: 'فلزات', m: 'بورس', b: 'بازار اول' }];
  const merged = mergeSeedWithCodemap(seed, { 'وبملت': 'b2', 'فولاد': 'SHOULD-NOT-ADD' });
  assert.equal(merged.length, 2);
  assert.equal(merged[0].i, 'a1');
  assert.equal(merged[1].s, 'وبملت');
  assert.equal(merged[1].i, 'b2');
});

test('CDN: تشخیص جلسهٔ امروز تهران از تاریخ YYYYMMDD', () => {
  const now = new Date('2026-10-25T12:00:00Z');   // ۱۴۰۵/۰۸/۰۳ تهران
  assert.equal(sessionIsToday('20261025', now), true);
  assert.equal(sessionIsToday('20261024', now), false);
  assert.equal(sessionIsToday('', now), false);
});

test('CDN: کش نشست — ذخیره/خواندن ردیف‌های خام با TTL و گارد نبود sessionStorage', () => {
  const store = new Map();
  globalThis.sessionStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, v),
  };
  try {
    writeSeedCache([{ insCode: '46348559193224090', l18: 'فولاد', pl: 4110 }], '1405/08/03');
    const c = readSeedCache();
    assert.ok(c && c.rows.length === 1);
    assert.equal(c.rows[0].l18, 'فولاد');
    assert.equal(c.asOf, '1405/08/03');
    assert.ok(c.t <= Date.now() && Date.now() - c.t < 5_000);
    // منقضی: TTL گذشته ⇒ null
    const raw = JSON.parse(store.get('tr.seedscan.v1'));
    raw.t = Date.now() - 11 * 60_000;
    store.set('tr.seedscan.v1', JSON.stringify(raw));
    assert.equal(readSeedCache(), null);
    // دادهٔ خراب ⇒ null (نه استثنا)
    store.set('tr.seedscan.v1', '{broken');
    assert.equal(readSeedCache(), null);
  } finally {
    delete globalThis.sessionStorage;
  }
  // نبود sessionStorage (Node/محیط آزمون) ⇒ null، نه کرش
  assert.equal(readSeedCache(), null);
});

test('CDN: فایل بذری همراه ریپو واقعی و پر است (۴۲۰ نماد با شناسهٔ واقعی)', () => {
  const seed = JSON.parse(readFileSync(join(FIX, '..', '..', 'data', 'seed-symbols.json'), 'utf8'));
  assert.ok(seed.count >= 400, `باید ≥۴۰۰ نماد باشد — ${seed.count}`);
  assert.equal(seed.symbols.length, seed.count);
  const folad = seed.symbols.find(x => x.s === 'فولاد');
  assert.ok(folad, 'فولاد باید در بذری باشد');
  assert.equal(folad.i, '46348559193224090');    // مطابق قرارداد تأییدشدهٔ CDN
  for (const s of seed.symbols) assert.ok(/^\d{14,17}$/.test(String(s.i)), `شناسهٔ نامعتبر: ${s.i}`);
});
