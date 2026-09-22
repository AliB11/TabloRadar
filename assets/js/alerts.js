/**
 * alerts.js — موتور «هشدار شرطی» (هفتۀ ۴ نقشه راه)
 *
 * دستورات به شکل زبان طبیعیِ فارسی نوشته می‌شوند:
 *   وبملت قدرت خریدار > 1.4
 *   هر نماد حجم مشکوک ≥ 2.5
 *   فولاد امتیاز < 50
 * و در localStorage می‌مانند؛ ارزیابی پس از هر اسکن انجام می‌شود و پیام
 * آمادهٔ اشتراک تلگرام ساخته می‌شود (ارسال مستقیم از مرورگر انجام نمی‌شود —
 * توکن بات هیچ‌جا ذخیره نمی‌شود؛ سیاست پروژهٔ بدون‌کلید).
 */

const FA_DIGITS = { '۰': 0, '۱': 1, '۲': 2, '۳': 3, '۴': 4, '۵': 5, '۶': 6, '۷': 7, '۸': 8, '۹': 9 };
const AR_MAP = { ي: 'ی', ك: 'ک', ء: 'ئ', ؤ: 'و', إ: 'ا', آ: 'آ' };

export const METRIC_DEFS = [
  { key: 'buyerPower', path: 'metrics', aliases: ['قدرت خریدار', 'قدرت‌خریدار', 'buyerpower', 'power'], dec: 2 },
  { key: 'netRealMoney', path: 'metrics', aliases: ['پول حقیقی', 'پول‌حقیقی', 'net real', 'inflow'], scale: 1e-9, dec: 1, unit: 'م.ریال' },
  { key: 'obi', path: 'metrics', aliases: ['obi', 'دفتر سفارش'], dec: 2 },
  { key: 'volumeShock', path: 'metrics', aliases: ['حجم مشکوک', 'shock'], dec: 2, unit: '×' },
  { key: 'capacity', path: 'metrics', aliases: ['ظرفیت', 'capacity'], scale: 100, dec: 0, unit: '٪' },
  { key: 'rsi', path: 'metrics', aliases: ['rsi'], dec: 1 },
  { key: 'chgLast', path: 'metrics', aliases: ['تغییر', 'chg', 'درصد قیمت'], dec: 2, unit: '٪' },
  { key: 'peVsSector', path: 'metrics', aliases: ['pe صنعت', 'pevs', 'p/e صنعت'], dec: 2, unit: '×' },
  { key: 'total', path: 'score', aliases: ['امتیاز', 'score'], dec: 1 },
  { key: 'confidence', path: 'score', aliases: ['اطمینان', 'conf'], dec: 0, unit: '٪' },
];

const OPS = { '>=': '≥', '<=': '≤', '>': '>', '<': '<', '==': '=', '=': '=', '!=': '≠', '≠': '≠', '≥': '≥', '≤': '≤' };

export function normalizeText(s) {
  let t = String(s ?? '');
  t = t.replace(/[يؤإ]/g, ch => AR_MAP[ch] || ch).replace(/ك/g, 'ک');
  t = t.replace(/[۰-۹]/g, d => String(FA_DIGITS[d]));
  return t.replace(/\u200c/g, ' ').replace(/\u060c/g, ',').replace(/٫/g, '.').toLowerCase().trim();
}

function findMetric(txt) {
  const n = normalizeText(txt).replace(/\s+/g, ' ');
  let best = null;
  for (const def of METRIC_DEFS) {
    for (const a of def.aliases) {
      const na = normalizeText(a).replace(/\s+/g, ' ');
      if (n.includes(na) && (!best || na.length > best.matchLen)) best = { def, alias: na, matchLen: na.length };
    }
  }
  return best ? { def: best.def, alias: best.alias } : null;
}

/**
 * «وبملت قدرت خریدار > 1.4» → {sym:'وبملت', metric:'buyerPower', op:'>', value:1.4, raw}
 * اگر جمله نخوانده شود: null — هیچ حدسی زده نمی‌شود.
 */
export function parseAlert(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const n = normalizeText(raw).replace(/\s+/g, ' ');
  const mOp = n.match(/>=|<=|!=|==|[><=≥≤≠]/);
  if (!mOp) return null;
  const op = OPS[mOp[0]];
  const before = n.slice(0, mOp.index).trim();
  const after = n.slice(mOp.index + mOp[0].length).trim();
  const mNum = after.match(/^(-?\d+(?:\.\d+)?)/);
  if (!mNum) return null;
  const value = Number(mNum[1]);
  const hit = findMetric(before);
  if (!hit) return null;
  const { def, alias } = hit;
  const sym = before.replace(alias, '').replace(/\s+/g, ' ').trim();
  const GLOBAL = /^(هر|همه|all|any)/.test(sym) || !sym;
  return { sym: GLOBAL ? null : sym, global: GLOBAL, metric: def.key, path: def.path,
    op, value, raw, label: def.aliases[0], dec: def.dec, scale: def.scale || 1, unit: def.unit || '' };
}

export function metricValue(cond, row) {
  const holder = row?.[cond.path] || {};
  const v = holder[cond.metric];
  return Number.isFinite(v) ? v * cond.scale : null;
}

export function evalAlert(cond, row) {
  const v = metricValue(cond, row);
  if (v == null) return false;
  if (cond.sym && normalizeText(row?.inst?.l18 || '') !== cond.sym) return false;

  switch (cond.op) {
    case '>': return v > cond.value;
    case '<': return v < cond.value;
    case '≥': return v >= cond.value;
    case '≤': return v <= cond.value;
    case '=': return Math.abs(v - cond.value) < 1e-9;
    case '≠': return Math.abs(v - cond.value) >= 1e-9;
    default: return false;
  }
}

/** کدام ردیف‌ها همین حالا شرط را دارند؟ برای «هر نماد» حداکثر ۵ مورد اول */
export function checkAlerts(conds, rows, cap = 5) {
  const fired = [];
  for (const c of conds || []) {
    const hits = (rows || []).filter(r => evalAlert(c, r)).slice(0, c.global ? cap : cap);
    if (hits.length) fired.push({ cond: c, hits });
  }
  return fired;
}

export function alertLabel(c) {
  const v = Number.isFinite(c.value) ? `${(+c.value.toFixed(4))}${c.unit || ''}` : '—';
  return `${c.sym || 'هر نماد'} ${c.label} ${c.op} ${v}`;
}

export function alertLine(row, c) {
  const v = metricValue(c, row);
  const shown = v == null ? '—' : `${(+v.toFixed(c.dec ?? 1))}${c.unit || ''}`;
  return `${row.inst.l18} — ${c.label} ${shown} · امتیاز ${row.score?.total ?? '—'}`;
}

export function fireText(firedList, stamp = '') {
  const L = [`🔔 تابلورادار — هشدار شرطی ${stamp}`];
  for (const f of firedList) {
    L.push(`» ${alertLabel(f.cond)}`);
    f.hits.slice(0, 5).forEach(r => L.push(`   ${alertLine(r, f.cond)}`));
  }
  L.push('', 'تحلیل داده، نه توصیهٔ سرمایه‌گذاری.', 'https://tabloradar.ir');
  return L.join('\n');
}

/* ── ماندگاری در localStorage (بدون سرور، بدون کلید) ── */
export function loadAlerts() {
  try { return JSON.parse(localStorage.getItem('tr.alerts') || '[]'); } catch { return []; }
}
export function saveAlerts(list) {
  try { localStorage.setItem('tr.alerts', JSON.stringify(list)); } catch { /* ناشناس/محدود */ }
}
