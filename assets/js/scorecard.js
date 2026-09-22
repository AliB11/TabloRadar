/**
 * scorecard.js — کارت «کارنامۀ مدل» (هفتۀ ۱ نقشه راه — سمت UI)
 *
 * این ماژول هیچ عددی تولید نمی‌کند: فقط `data/model-report.json` را که
 * `python3 main.py --backtest` می‌سازد می‌خواند، قالب‌بندی و رندر می‌کند.
 * اگر فایل نبود، خودآزمون‌ساز هشدار می‌دهد — نه دادهٔ ساختگی.
 */

import { fmtNum, fmtPct } from './tse.js';
import { esc } from './ui.js';

export async function loadModelReport(url = './data/model-report.json') {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return { rep: null, err: `HTTP ${res.status}` };
    return { rep: await res.json(), err: null };
  } catch (e) {
    return { rep: null, err: String(e && e.message || e) };
  }
}

/** آرایهٔ ردیف‌های جدول افق‌ها — قابل آزمون در Node */
export function horizonRows(rep) {
  const out = [];
  for (const h of ['1', '3', '5']) {
    const r = rep?.horizons?.[h];
    if (!r || !r.n) continue;
    out.push({
      h: +h, n: r.n, hit: r.hit_rate, loss: r.loss_rate, tout: r.timeout_rate,
      avg: r.avg_ret, bench: r.benchmark?.avg_ret ?? null, excess: r.excess_ret ?? null,
      lift: r.hit_lift ?? null, payoff: r.payoff ?? null, ror: r.avg_ret_over_risk ?? null,
      hold: r.median_hold ?? null,
    });
  }
  return out;
}

/** پیشنهاد آستانه: بهترین hit-rate سه‌جلسه‌ای با n≥۱۰۰ از جاروبِ پایتون */
export function bestThreshold(rep) {
  const sweep = rep?.threshold_sweep || {};
  let best = null;
  for (const [t, hmap] of Object.entries(sweep)) {
    const r = hmap?.['3'];
    if (!r || r.n < 100 || r.hit_rate == null) continue;
    if (!best || r.hit_rate > best.hit) best = { t: +t, hit: r.hit_rate, n: r.n };
  }
  return best;
}

const VERDICT_META = {
  strong: { fa: 'پایدار', cls: 'up' }, ok: { fa: 'قابل قبول', cls: 'warn' },
  weak: { fa: 'نیازمند بازنگری', cls: 'down' }, pending: { fa: 'در انتظار داده', cls: '' },
};

export function scorecardHtml(rep, meta = {}) {
  if (!rep) {
    return `<div class="sc-empty">
      <b>کارنامۀ مدل هنوز ساخته نشده است.</b>
      <p class="small muted" style="margin-top:8px">در ترمینال اجرا کنید:
        <span class="mono" dir="ltr">python3 main.py --offline --backtest</span>
        — فایل <span class="mono" dir="ltr">data/model-report.json</span> ساخته می‌شود
        (${esc(meta.err || 'فایل یافت نشد')}).</p></div>`;
  }
  const v = VERDICT_META[rep.verdict?.state] || VERDICT_META.pending;
  const rows = horizonRows(rep).map(r => `<tr>
    <td data-l="افق"><span class="mono" dir="ltr">${r.h}</span> جلسه</td>
    <td data-l="تعداد سیگنال"><span class="num" dir="ltr">${fmtNum(r.n)}</span></td>
    <td data-l="خوردن هدف"><b class="num ${r.hit >= 55 ? 'up' : ''}" dir="ltr">${fmtNum(r.hit, 1)}٪</b></td>
    <td data-l="خوردن حدضرر"><span class="num down" dir="ltr">${fmtNum(r.loss, 1)}٪</span></td>
    <td data-l="بی‌نتیجه"><span class="num faint" dir="ltr">${fmtNum(r.tout, 1)}٪</span></td>
    <td data-l="میانگین بازده"><span class="num ${r.avg >= 0 ? 'up' : 'down'}" dir="ltr">${fmtPct(r.avg, 2)}</span></td>
    <td data-l="مازاد بر بازار"><span class="num ${r.excess >= 0 ? 'up' : 'down'}" dir="ltr">${fmtPct(r.excess, 2)}</span></td>
    <td data-l="بازده/ریسک"><span class="num" dir="ltr">${r.ror == null ? '—' : fmtNum(r.ror, 2)}</span></td>
  </tr>`).join('');

  const bt = bestThreshold(rep);
  const sim = rep.mode !== 'live';
  const j = rep.journal || {};
  return `
  <div class="sc-verdict ${v.cls}">
    <span class="sc-state">${esc(v.fa)}</span>
    <span class="sc-note">${esc(rep.verdict?.fa || '')}</span>
    ${sim ? `<span class="chip" title="سنجش روی تاریخچۀ شبیه‌سازی‌شدهٔ برچسب‌دار است — ادعای عملکرد واقعی نیست">شبیه‌سازی·برچسب‌دار</span>` : ''}
  </div>
  <div class="sc-kpis">
    <div class="kpi"><div class="v" dir="ltr">${fmtNum(rep.universe?.symbols_with_history ?? 0)}</div><div class="l">نماد دارای تاریخچه</div></div>
    <div class="kpi"><div class="v" dir="ltr">${fmtNum(rep.universe?.eval_bars ?? 0)}</div><div class="l">رابطِ ارزیابی‌شده</div></div>
    <div class="kpi"><div class="v up" dir="ltr">${fmtNum(rep.universe?.signals_total ?? 0)}</div><div class="l">سیگنال ثبت‌شده</div></div>
    <div class="kpi"><div class="v" dir="ltr">${bt ? `≥ ${fmtNum(bt.t, 0)}` : '—'}</div>
      <div class="l">آستانۀ پیشنهادیِ جاروب${bt ? ` (hit ${fmtNum(bt.hit, 1)}٪)` : ''}</div></div>
  </div>
  <div class="table-wrap"><table class="sc-tbl"><thead><tr>
    <th>افق</th><th>n</th><th>هدف</th><th>حدضرر</th><th>بی‌نتیجه</th><th>میانگین بازده</th><th>مازاد</th><th>بازده/ریسک</th>
  </tr></thead><tbody>${rows || '<tr><td colspan="8" class="faint center" style="padding:14px">سیگنالی در این افق‌ها ثبت نشده</td></tr>'}</tbody></table></div>
  <div class="sc-foot">
    <span class="tiny faint">${esc(rep.method?.fa || '')}</span>
    <p class="tiny faint" style="margin-top:8px">
      دفتر ثبت اسکن‌ها: <b class="mono" dir="ltr">${fmtNum(j.runs ?? 0)}</b> اجرا ·
      <b class="mono" dir="ltr">${fmtNum(j.evaluated ?? 0)}</b> ارزیابی‌شده ·
      <b class="mono" dir="ltr">${fmtNum(j.pending ?? 0)}</b> در انتظارِ جلسات بعدی
      · تولید: <span class="mono" dir="ltr">${esc(rep.generated_at || '—')}</span>
    </p>
    <p class="tiny warn" style="margin-top:6px">${esc(rep.provenance || '')}</p>
  </div>`;
}

export function renderScorecard(rep, meta = {}) {
  const el = document.getElementById('sc-body');
  if (!el) return;
  el.innerHTML = scorecardHtml(rep, meta);
}
