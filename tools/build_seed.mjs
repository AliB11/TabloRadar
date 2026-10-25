/**
 * build_seed.mjs — ساخت data/seed-symbols.json از MarketWatchInit رسمی TSETMC
 *
 * فهرست «نماد ↔ شناسه» ورودیِ اسکن بذری CDN (assets/js/cdn.js) است: ۴۲۰ نماد پرگردش
 * سهامِ بورس/فرابورس، مرتب بر اساس ارزش معاملات آخرین جلسه. شناسه‌ها از سرویس رسمی
 * خوانده می‌شود — هیچ شناسه‌ای حدس زده نمی‌شود.
 *
 *   node tools/build_seed.mjs [تعداد]
 *
 * نیازمند دسترسی شبکه به old.tsetmc.com (از بیرون ایران معمولاً مسدود است).
 */
import { parseMarketWatchInit, buildRows } from '../assets/js/sources.js';
import { classifyInstrument } from '../assets/js/tse.js';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LIMIT = Number(process.argv[2]) || 420;

const res = await fetch('https://old.tsetmc.com/tsev2/data/MarketWatchInit.aspx?h=0&r=0', {
  headers: { 'User-Agent': 'Mozilla/5.0', Accept: '*/*' },
});
if (!res.ok) throw new Error(`MarketWatchInit HTTP ${res.status}`);
const text = await res.text();
const mw = parseMarketWatchInit(text);
const rows = buildRows(mw, {});
const stocks = rows.filter(r => r.l18 && r.insCode && classifyInstrument(r) === 'stock');
stocks.sort((a, b) => (b.tval || 0) - (a.tval || 0));
const seed = stocks.slice(0, LIMIT).map(r => ({
  i: r.insCode, s: r.l18, n: r.l30, g: r.cs, m: r.market, b: r.board,
}));

writeFileSync(join(ROOT, 'data', 'seed-symbols.json'), JSON.stringify({
  generated: mw.state?.datetimeRaw || new Date().toISOString(),
  note: 'نقشهٔ واقعی نماد↔شناسهٔ سهام از MarketWatchInit رسمی TSETMC — ورودی اسکن بذری CDN؛ بازتولید: node tools/build_seed.mjs',
  count: seed.length,
  symbols: seed,
}));
console.log(`seed-symbols.json → ${seed.length} نماد (از ${stocks.length} سهام واقعی، ${mw.prices.length} سطر خام)`);
