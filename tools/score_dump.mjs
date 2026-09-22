/**
 * score_dump.mjs — خروجی JSON هسته JS برای آزمون برابری (parity) با پایپ‌لاین پایتون
 *   node tools/score_dump.mjs [data/offline-snapshot.json] [--weights 30 20 20 15 15] [--minval 50]
 */
import { readFileSync } from 'node:fs';
import { normalizeAll } from '../assets/js/tse.js';
import { rankInstruments, marketPulse, sectorAggregates, DEFAULT_WEIGHTS, DEFAULT_RULES } from '../assets/js/engine.js';

const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith('--')) || 'data/offline-snapshot.json';
const num = flag => (args.includes(flag) ? Number(args[args.indexOf(flag) + 1]) : null);

const weights = args.includes('--weights')
  ? Object.fromEntries(['tablo', 'short', 'mid', 'long', 'risk'].map((k, i) => [k, Number(args[args.indexOf('--weights') + 1 + i])]))
  : { ...DEFAULT_WEIGHTS };
const rules = { ...DEFAULT_RULES };
const mv = num('--minval'); if (mv !== null) rules.minValue = mv * 1e9;
if (args.includes('--include-base')) rules.includeBase = true;
if (args.includes('--include-funds')) rules.includeFunds = true;

const snap = JSON.parse(readFileSync(file, 'utf8'));
const insts = normalizeAll(snap.instruments);
const out = rankInstruments(insts, { rules, weights });
const pulse = marketPulse(insts, out.rows.slice(0, 10));

const num0 = v => (Number.isFinite(v) ? +v : null);
console.log(JSON.stringify({
  engine: 'js', scanned: insts.length,
  top: out.rows.slice(0, 10).map(r => ({
    symbol: r.inst.l18, score: r.score.total, confidence: r.score.confidence, grade: r.score.grade.fa,
    factors: Object.fromEntries(['tablo', 'short', 'mid', 'long', 'risk'].map(k => [k, num0(r.factors[k])])),
    metrics: { chgLast: num0(r.metrics.chgLast), chgClose: num0(r.metrics.chgClose),
      buyerPower: num0(r.metrics.buyerPower), netReal: num0(r.metrics.netRealMoney),
      shock: num0(r.metrics.volumeShock), obi: num0(r.metrics.obi), capacity: num0(r.metrics.capacity),
      rsi: num0(r.metrics.rsi), k2k: r.metrics.k2k.code },
    plan: r.plan ? { entry: num0(r.plan.entry), stop: num0(r.plan.stop), atr: num0(r.plan.atr),
      atrSource: r.plan.atrSource, targets: r.plan.targets.map(num0), rr: r.plan.rr,
      sessions: r.plan.sessions, horizon: r.plan.horizon } : null,
  })),
  vetoCounts: out.vetoCounts, vetoed: out.vetoed.map(v => v.inst.l18),
  pulse: { count: pulse.count, up: pulse.up, down: pulse.down, flat: pulse.flat,
    value: +pulse.value.toFixed(0), netReal: num0(pulse.netReal), limitUp: pulse.limitUp, limitDown: pulse.limitDown },
  sectors: sectorAggregates(insts).slice(0, 5).map(s => ({ sector: s.sector, count: s.count, value: +s.value.toFixed(0) })),
}));
