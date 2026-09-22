/**
 * lab.test.mjs — آزمون‌های میز پژوهش: هشدار شرطی، مقایسه، کارنامه، رویدادها
 * (توابع خالص؛ بدون DOM)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { parseAlert, evalAlert, checkAlerts, alertLabel, metricValue } from '../assets/js/alerts.js';
import { buildCompare, overlaySeries } from '../assets/js/compare.js';
import { horizonRows, bestThreshold, scorecardHtml } from '../assets/js/scorecard.js';
import { eventsFor, upcoming, daysLabel, eventsBadge } from '../assets/js/events.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SNAP = JSON.parse(readFileSync(join(HERE, '..', 'data', 'offline-snapshot.json'), 'utf8'));
const { normalizeAll } = await import('../assets/js/tse.js');
const { rankInstruments } = await import('../assets/js/engine.js');
const rows = rankInstruments(normalizeAll(SNAP.instruments), {}).rows;

/* ── ۱. پارسر هشدار ── */
test('parseAlert: فارسی، رقم فارسی، واپاس‌های ی/ك نرمال می‌شوند', () => {
  const c = parseAlert('وبملت قدرت خریدار > ۱.۴');
  assert.ok(c, 'پارس شد');
  assert.equal(c.sym, 'وبملت'); assert.equal(c.metric, 'buyerPower');
  assert.equal(c.op, '>'); assert.equal(c.value, 1.4); assert.equal(c.path, 'metrics');
});
test('parseAlert: «هر نماد» بدون نماد، ≥، منفی، و منبع امتیاز از score', () => {
  const g = parseAlert('هر نماد حجم مشکوک ≥ 2.5');
  assert.equal(g.global, true); assert.equal(g.metric, 'volumeShock');
  const s = parseAlert('فولاد امتیاز < 45');
  assert.equal(s.path, 'score'); assert.equal(s.metric, 'total');
  const n = parseAlert('خودرو تغییر < -1.5');
  assert.equal(n.value, -1.5);
});
test('parseAlert: جمله نامفهوم → null (حدس ممنوع)', () => {
  assert.equal(parseAlert('سلام'), null);
  assert.equal(parseAlert('فولاد > 3'), null);        // بدون سنجه
  assert.equal(parseAlert('فولاد قدرت خریدار >'), null);  // بدون عدد
});
test('evalAlert: سنجش روی ردیف واقعی؛ غیاب داده = false نه ترار', () => {
  const c = parseAlert('هر نماد قدرت خریدار > 1.3');
  assert.equal(c.global, true);
  const hit = rows.filter(r => evalAlert(c, r));
  assert.ok(hit.length >= 0);
  for (const r of hit) assert.ok(r.metrics.buyerPower > 1.3, `${r.inst.l18}: ارزش سنجه زیر آستانه ردیف شد`);
  const dead = { inst: { l18: 'x' }, metrics: { buyerPower: NaN }, score: {} };
  assert.equal(evalAlert(c, dead), false);
});
test('checkAlerts: نماد اختصاصی فقط همان نماد؛ مقیاس پول حقیقی در م.ریال', () => {
  const sym = rows[0].inst.l18;
  const v = metricValue({ path: 'metrics', metric: 'netRealMoney', scale: 1e-9 }, rows[0]);
  const c = parseAlert(`${sym} پول حقیقی > ${Math.ceil(v) - 1}`);
  const fired = checkAlerts([c], rows);
  assert.equal(fired.length, 1);
  assert.deepEqual([...new Set(fired[0].hits.map(h => h.inst.l18))], [sym]);
});
test('alertLabel: برچسب خوانا با واحد', () => {
  assert.match(alertLabel(parseAlert('فولاد ظرفیت > 60')), /ظرفیت.*60٪/);
});

/* ── ۲. مقایسه ── */
test('buildCompare: ۲۰ سطر، برنده‌دار، بدون NaN خام', () => {
  const [a, b] = [rows[0], rows[1]];
  const cmp = buildCompare(a, b);
  assert.equal(cmp.length, 20);
  const text = JSON.stringify(cmp);
  assert.ok(!text.includes('NaN'), 'NaN در خروجی مقایسه');
  assert.ok(cmp.some(x => x.winner !== 0), 'حداقل یک سطر برنده دارد');
  const g = cmp.find(x => x.fa === 'امتیاز جامع');
  assert.equal(g.winner, a.score.total > b.score.total ? 1 : 2);
});
test('buildCompare: ورودی ناقص → [] (نه خطا)', () => {
  assert.deepEqual(buildCompare(null, rows[0]), []);
});
test('overlaySeries: نرمال‌سازی ۰..۱۰۰ و برش ۶۰ جلسه', () => {
  const o = overlaySeries(rows[0].inst.history, rows[1].inst.history);
  assert.ok(o.a.length <= 60 && o.a.length >= 2);
  assert.ok(Math.min(...o.a) >= 0 && Math.max(...o.a) <= 100);
});

/* ── ۳. کارنامۀ مدل ── */
test('scorecard: فایل کارنامۀ واقعی ریپو را رندر می‌کند و اعدادش با JSON می‌خواند', () => {
  const rep = JSON.parse(readFileSync(join(HERE, '..', 'data', 'model-report.json'), 'utf8'));
  const html = scorecardHtml(rep);
  for (const s of ['افق', 'دفتر ثبت', 'شبیه‌سازی', 'آستانۀ پیشنهادی', 'Hit-rate', 'بازده/ریسک'])
    assert.ok(html.includes(s), `بخش ${s}`);
  assert.ok(!/NaN|undefined/.test(html), 'NaN/undefined در رندر کارنامه');
  const r3 = horizonRows(rep).find(r => r.h === 3);
  assert.equal(r3.n, rep.horizons['3'].n);
  assert.equal(r3.hit, rep.horizons['3'].hit_rate);
});
test('scorecardHtml: نبود فایل → پیام صادقانه، نه دادهٔ ساختگی', () => {
  const html = scorecardHtml(null, { err: 'HTTP 404' });
  assert.match(html, /ساخته نشده/);
  assert.match(html, /main\.py --offline --backtest/);
});
test('bestThreshold: از جاروبِ خود گزارش انتخاب می‌کند', () => {
  const rep = JSON.parse(readFileSync(join(HERE, '..', 'data', 'model-report.json'), 'utf8'));
  const bt = bestThreshold(rep);
  assert.ok(bt && [55, 62, 68, 74].includes(bt.t));
  assert.equal(bt.hit, rep.threshold_sweep[String(bt.t)]['3'].hit_rate);
});

/* ── ۴. رویدادها ── */
test('events: فایل برچسب‌دار بارگذاری می‌شود؛ فیلتر نماد و پیش‌رو درست', () => {
  const j = JSON.parse(readFileSync(join(HERE, '..', 'data', 'events.json'), 'utf8'));
  assert.ok(j.events.length > 0 && j.disclaimer.includes('شبیه‌سازی'));
  const sym = j.events[0].l18;
  const mine = eventsFor(j.events, sym);
  assert.ok(mine.every(e => e.l18 === sym));
  const up = upcoming(j.events, 99);
  assert.ok(up.every(e => e.days_ahead >= 0));
  for (let i = 1; i < up.length; i++) assert.ok(up[i].days_ahead >= up[i - 1].days_ahead, 'مرتب بر اساس نزدیکی');
});
test('daysLabel و eventsBadge', () => {
  assert.equal(daysLabel(0), 'امروز');
  assert.equal(daysLabel(1), 'فردا');
  assert.equal(daysLabel(-2), '2 روز پیش');
  const j = JSON.parse(readFileSync(join(HERE, '..', 'data', 'events.json'), 'utf8'));
  const withEv = j.events.find(e => e.days_ahead >= 0);
  assert.match(eventsBadge(j.events, withEv.l18), /⚑/);
  assert.equal(eventsBadge(j.events, 'بی‌نام'), '');
});
