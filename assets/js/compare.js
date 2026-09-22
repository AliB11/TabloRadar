/**
 * compare.js — حالت مقایسۀ دو نماد (هفتۀ ۴ نقشه راه)
 *
 * `buildCompare` خلص است و در Node آزمون می‌شود؛ رندرکننده فقط جدول می‌سازد.
 * «برندهٔ» هر سطر بر پایهٔ جهتِ معناداریِ سنجه انتخاب می‌شود (بزرگ‌تر=بهتر یا
 * کوچک‌تر=بهتر)؛ برای سطرهای بی‌جهت (مثل قیمت) برنده‌ای علامت نمی‌خورد.
 */

import { fmtNum, fmtPct } from './tse.js';
import { esc } from './ui.js';

const num = v => (Number.isFinite(v) ? v : null);

export const COMPARE_ROWS = [
  { k: 'score.total', fa: 'امتیاز جامع', better: 'high', dec: 1 },
  { k: 'score.confidence', fa: 'ضریب اطمینان', better: 'high', dec: 0, unit: '٪' },
  { k: 'grade', fa: 'درجه', kind: 'grade' },
  { k: 'metrics.chgLast', fa: 'تغییر آخرین/پایانی', better: 'high', pct: true },
  { k: 'metrics.buyerPower', fa: 'قدرت خریدار حقیقی', better: 'high', dec: 2 },
  { k: 'metrics.netRealMoney', fa: 'پول حقیقی خالص (م.ریال)', better: 'high', div: 1e9, dec: 1 },
  { k: 'metrics.obi', fa: 'عدم‌تعادل دفتر سفارش', better: 'high', dec: 2 },
  { k: 'metrics.volumeShock', fa: 'حجم مشکوک', better: 'high', dec: 2, unit: '×' },
  { k: 'metrics.capacity', fa: 'ظرفیت تا سقف (٪)', better: 'high', mul: 100, dec: 0 },
  { k: 'metrics.rsi', fa: 'RSI(14)', better: 'none', dec: 1 },
  { k: 'metrics.peVsSector', fa: 'P/E نسبت به صنعت', better: 'low', dec: 2, unit: '×' },
  { k: 'metrics.freeFloat', fa: 'شناور آزاد (٪)', better: 'high', dec: 1 },
  { k: 'factors.tablo', fa: 'عامل تابلوخوانی', better: 'high', dec: 0 },
  { k: 'factors.short', fa: 'عامل کوتاه‌مدت', better: 'high', dec: 0 },
  { k: 'factors.mid', fa: 'عامل میان‌مدت', better: 'high', dec: 0 },
  { k: 'factors.long', fa: 'عامل بلندمدت', better: 'high', dec: 0 },
  { k: 'factors.risk', fa: 'سنجش ریسک', better: 'high', dec: 0 },
  { k: 'plan.entry', fa: 'ورود (ریال)', better: 'none', money: true },
  { k: 'plan.stop', fa: 'حد ضرر (ریال)', better: 'none', money: true },
  { k: 'plan.rr', fa: 'نسبت سود به زیان', better: 'high', dec: 2 },
];

const dig = (obj, path) => path.split('.').reduce((o, p) => (o == null ? o : o[p]), obj);

export function buildCompare(a, b) {
  if (!a || !b) return [];
  const out = [];
  for (const def of COMPARE_ROWS) {
    let va = dig(a, def.k), vb = dig(b, def.k);
    if (def.kind === 'grade') {
      out.push({ fa: def.fa, ta: a.score?.grade?.fa ?? '—', tb: b.score?.grade?.fa ?? '—', winner: 0,
        raw_a: a.score?.total, raw_b: b.score?.total });
      continue;
    }
    va = num(va); vb = num(vb);
    if (def.div) { if (va != null) va /= def.div; if (vb != null) vb /= def.div; }
    if (def.mul) { if (va != null) va *= def.mul; if (vb != null) vb *= def.mul; }
    const fmt = v => v == null ? '—' : def.pct ? fmtPct(v, 2)
      : def.money ? fmtNum(v) : `${fmtNum(v, def.dec ?? 1)}${def.unit || ''}`;
    let winner = 0;
    if (def.better !== 'none' && va != null && vb != null && va !== vb) {
      winner = def.better === 'high' ? (va > vb ? 1 : 2) : (va < vb ? 1 : 2);
    }
    const gap = va != null && vb != null ? vb - va : null;
    out.push({ fa: def.fa, ta: fmt(va), tb: fmt(vb), winner, gap,
      raw_a: va, raw_b: vb });
  }
  return out;
}

/** دو تاریخچه به منحنی نرمال‌شدهٔ هم‌مقیاس (۰..۱۰۰) برای نمودار روی‌هم */
export function overlaySeries(histA, histB, n = 60) {
  const norm = h => {
    const c = (h || []).map(b => b.c).filter(v => Number.isFinite(v)).slice(-n);
    if (c.length < 2) return [];
    const lo = Math.min(...c), hi = Math.max(...c), sp = hi - lo || 1;
    return c.map(v => (v - lo) / sp * 100);
  };
  return { a: norm(histA), b: norm(histB) };
}

export function compareHtml(a, b, rows) {
  const head = (r) => `<div class="cmp-side"><b>${esc(r.inst.l18)}</b>
    <span class="tiny faint">${esc(r.inst.cs || '')}</span>
    <span class="grade ${r.score.grade?.cls || 'g-na'}">${esc(r.score.grade?.fa || '—')}</span></div>`;
  const body = rows.map(x => `<tr>
    <td class="cmp-k">${esc(x.fa)}</td>
    <td class="cmp-v ${x.winner === 1 ? 'win' : ''}" dir="ltr">${x.ta ?? '—'}</td>
    <td class="cmp-v ${x.winner === 2 ? 'win' : ''}" dir="ltr">${x.tb ?? '—'}</td></tr>`).join('');
  return `<div class="cmp-head">${head(a)}<span class="cmp-vs">در برابر</span>${head(b)}</div>
    <div class="table-wrap"><table class="cmp-tbl"><tbody>${body}</tbody></table></div>
    <canvas class="cmp-spark" id="cmp-spark" width="640" height="90" aria-label="منحنی مقایسۀ ۶۰ جلسه"></canvas>`;
}

export function drawCompareSpark(canvas, rows) {
  if (!canvas || !canvas.getContext) return;
  const ctx = canvas.getContext('2d');
  const { a, b } = overlaySeries(rows[0]?.inst?.history, rows[1]?.inst?.history);
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  if (a.length < 2 && b.length < 2) return;
  const line = (arr, color) => {
    if (arr.length < 2) return;
    ctx.strokeStyle = color; ctx.lineWidth = 1.6; ctx.beginPath();
    arr.forEach((v, i) => {
      const x = i / (arr.length - 1) * (W - 8) + 4;
      const y = H - 4 - (v / 100) * (H - 8);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.stroke();
  };
  ctx.globalAlpha = .9;
  line(a, '#16e08c'); line(b, '#4cc9ff');
  ctx.globalAlpha = 1;
}
