/**
 * sources_dump.mjs — خروجی JSON پارسرهای JS برای مقایسه با پایتون
 *
 *   node tools/sources_dump.mjs tests/fixtures
 *
 * همان قطعه‌هایی را می‌خواند که tools/sources_selftest.py و
 * tools/sources_parity.py استفاده می‌کنند.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { btSymbolFromText, btOverviewFromText, parseMarketWatchInit, parseClientTypeAll, buildRows }
  from '../assets/js/sources.js';

const dir = process.argv[2] || 'tests/fixtures';
const read = f => readFileSync(join(dir, f), 'utf8');
const num = v => (Number.isFinite(v) ? v : null);

const sym = btSymbolFromText(read('bourse_trader_symbol_folad.txt'), 'فولاد');
const ov = btOverviewFromText(read('bourse_trader_home.txt'));
const mw = parseMarketWatchInit(read('tsetmc_marketwatchinit.format-sample.txt'));
const rows = buildRows(mw, parseClientTypeAll(read('tsetmc_clienttypeall.format-sample.txt')));

const symbolFields = ['pl', 'pc', 'pf', 'py', 'pmin', 'pmax', 'tvol', 'tval', 'tno',
  'netRealMoneyToday', 'bvol', 'zTitad', 'marketCap', 'pe', 'sectorPE', 'eps', 'psr',
  'freeFloatPct', 'volToFloatPct', 'volToSharesPct', 'buyPower', 'avgVolMonth', 'avgVolWeek'];
const overviewFields = ['index_total', 'index_equal', 'index_fara', 'market_cap', 'retail_trade_value',
  'retail_volume', 'symbols_up', 'symbols_down', 'per_capita_buy', 'per_capita_sell',
  'orders_buy_value', 'orders_sell_value', 'retail_money_inflow_rial'];

const out = {
  symbol: Object.fromEntries(symbolFields.map(k => [k, num(sym[k])])),
  symbol_book_l1: sym.book?.[0]
    ? { pd: sym.book[0].pd, qd: sym.book[0].qd, po: sym.book[0].po, qo: sym.book[0].qo }
    : null,
  symbol_ambiguous: sym.ambiguous || [],
  overview: Object.fromEntries(overviewFields.map(k => [k, num(ov[k])])),
  top_inflow_first: ov.top_inflow?.[0] || null,
  top_inflow_len: (ov.top_inflow || []).length,
  top_outflow_len: (ov.top_outflow || []).length,
  tsetmc_first: rows[0] ? {
    insCode: rows[0].insCode, pc: num(rows[0].pc), tval: num(rows[0].tval), tno: num(rows[0].tno),
    pe: num(rows[0].pe), zTitad: num(rows[0].zTitad),
    buy_i_vol: num(rows[0].Buy_I_Volume), buy_n_vol: num(rows[0].Buy_N_Volume),
    qd5: num(rows[0].qd5), pd5: num(rows[0].pd5), market: rows[0].market,
    provenance: rows[0].provenance,
  } : null,
  state: { indexTotal: num(mw.state.indexTotal), indexChange: num(mw.state.indexChange) },
};
console.log(JSON.stringify(out, null, 1));
