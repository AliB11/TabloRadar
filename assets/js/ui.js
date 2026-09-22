/**
 * ui.js — لایه رندر تابلورادار
 * هیچ محاسبه‌ای اینجا انجام نمی‌شود؛ فقط تبدیل داده تحلیل‌شده به DOM.
 */

import { fmtNum, fmtPct, fmtBig, fmtPrice, fmtOpts, tehranTime } from './tse.js';
import { FACTOR_META, VETO_META, DEFAULT_WEIGHTS } from './engine.js';
import { eventsBadge, eventsFor, eventItemHtml } from './events.js';

export const $ = s => document.querySelector(s);
export const $$ = s => [...document.querySelectorAll(s)];
export const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function icons() { if (window.lucide && !window.__noIcons) { try { window.lucide.createIcons(); } catch { /* noop */ } } }

export function toast(msg, ms = 2400) {
  const t = $('#toast'); if (!t) return;
  t.firstElementChild.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), ms);
}

const DASH = '<span class="faint">—</span>';
const n = (v, d = 0) => (Number.isFinite(v) ? `<span class="num">${fmtNum(v, d)}</span>` : DASH);
const pct = (v, d = 2) => {
  if (!Number.isFinite(v)) return DASH;
  const cls = v > 0.05 ? 'up' : v < -0.05 ? 'down' : 'muted';
  return `<span class="num ${cls}">${fmtPct(v, d)}</span>`;
};
const ico = (name, size = 13, color = '') =>
  `<i data-lucide="${name}" style="width:${size}px;height:${size}px;${color ? `color:${color};` : ''}flex:none"></i>`;

/* ═════════════════۱. نوار وضعیت و نبض بازار ═════════════════ */

export function renderSourceChips(meta) {
  const box = $('#src-chips'); if (!box) return;
  const live = meta.live;
  box.innerHTML = [
    `<span class="chip ${live ? 'c-green' : 'c-amber'}">${ico(live ? 'radio-tower' : 'hard-drive', 11)} منبع: ${esc(meta.source)}</span>`,
    `<span class="chip c-cyan mono" dir="ltr">${ico('clock', 11)} ${esc(tehranStampShort(meta.at))}</span>`,
    meta.route ? `<span class="chip">${ico('route', 11)} ${esc(meta.route)}</span>` : '',
    meta.historyOk
      ? `<span class="chip c-violet">${ico('line-chart', 11)} تاریخچه واقعی: ${meta.historyCount} نماد</span>`
      : `<span class="chip c-red">${ico('triangle-alert', 11)} بدون تاریخچه — تکنیکال محاسبه‌نشده</span>`,
  ].join('');
  icons();
}
const tehranStampShort = at => (at ? `${tehranTime(at)}` : '—');

export function renderPulse(p) {
  const grid = $('#pulse-grid'); if (!grid) return;
  const t = p.temperature;
  const breadth = Number.isFinite(p.breadth) ? p.breadth * 100 : NaN;
  const cells = [
    { k: 'دمای بازار', icon: 'thermometer', v: `${fmtNum(t, 0)}<span style="font-size:11px;color:var(--faint)">/۱۰۰</span>`,
      s: gaugeHtml(t), beat: true },
    { k: 'عرض بازار (مثبت/منفی)', icon: 'bar-chart-3', v: `${fmtNum(p.up)}/${fmtNum(p.down)}`,
      s: Number.isFinite(breadth) ? `${ico('percent', 10)} ${fmtNum(breadth, 0)}٪ نمادها صعودی` : '—' },
    { k: 'ارزش معاملات', icon: 'coins', v: fmtBig(p.value), s: `${n(p.volume)} برگه معامله` },
    { k: 'پول حقیقی خالص', icon: 'banknote-arrow-up', v: `${p.netReal >= 0 ? '+' : '−'}${fmtBig(Math.abs(p.netReal || 0))}`,
      s: Number.isFinite(p.realPower) ? `قدرت خرید کل بازار ${fmtNum(p.realPower, 2)}` : '—' },
    { k: 'چسبیده به سقف / کف', icon: 'lock', v: `${fmtNum(p.limitUp)} / ${fmtNum(p.limitDown)}`,
      s: `صف خرید ${fmtBig(p.buyQueueValue)} · صف فروش ${fmtBig(p.sellQueueValue)}` },
    { k: 'میانگین تغییر (هم‌وزن)', icon: 'activity', v: fmtPct(p.equalChg), s: `وزنی-ارزشی ${fmtPct(p.capChg)}` },
  ];
  grid.innerHTML = cells.map(c => `
    <div class="pulse-cell ${c.beat ? 'beating' : ''}">
      <span class="k">${ico(c.icon, 12, 'var(--faint)')}${c.k}</span>
      <span class="v" dir="ltr">${c.v}</span>
      <span class="s">${c.s}</span>
    </div>`).join('');
  icons();
}
const gaugeHtml = t => Number.isFinite(t)
  ? `<span class="gauge-wrap" style="width:100%"><span class="gauge"><i style="inset-inline-start:${Math.max(0, Math.min(100, t))}%"></i></span></span>` : '';

export function renderTicker(items) {
  const tr = $('#ticker-track'); if (!tr) return;
  const half = items.length
    ? items.map(s => `<span class="tick-item"><b style="font-size:13px">${esc(s.sym)}</b>
        <span class="mono muted" style="font-size:12px" dir="ltr">${s.price}</span>
        <span class="mono ${s.up ? 'up' : 'down'}" style="font-size:11.5px" dir="ltr">${s.chg}</span></span>`).join('')
    : `<span class="tick-item">${ico('unplug', 13, 'var(--red)')}<span class="muted">داده‌ای دریافت نشد — تلاش مجدد خودکار</span></span>`;
  tr.innerHTML = half + half;
  icons();
}

/* ═════════════════۲. جدول دیده‌بان ═════════════════ */

const HORIZON = {
  short: { fa: 'نوسانی · ۱ تا ۵ جلسه', cls: 'c-green', icon: 'zap' },
  mid: { fa: 'میان‌مدت · ۲ تا ۶ هفته', cls: 'c-cyan', icon: 'trending-up' },
  long: { fa: 'سرمایه‌ای · ۳ تا ۹ ماه', cls: 'c-violet', icon: 'layers' },
};

export function renderTable(rows, { sortKey, sortDir, onSort, events = [] } = {}) {
  const tb = $('#signal-rows'); if (!tb) return;
  if (!rows.length) {
    tb.innerHTML = `<tr><td colspan="12" style="text-align:center;padding:34px;color:var(--faint)">نمادی با این فیلترها باقی نماند — «پاک‌سازی فیلتر» را بزنید.</td></tr>`;
    return;
  }
  $$('#sig-table th.sortable').forEach(th => {
    th.setAttribute('aria-sort', th.dataset.sort === sortKey ? (sortDir > 0 ? 'ascending' : 'descending') : 'none');
    if (!th.dataset.wired && onSort) {
      th.dataset.wired = '1';
      th.tabIndex = 0;
      th.addEventListener('click', () => onSort(th.dataset.sort));
      th.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSort(th.dataset.sort); } });
    }
  });

  tb.innerHTML = rows.map((r, i) => {
    const { inst: s, metrics: m, score, plan } = r;
    const tech = techDots(r.tech);
    const h = plan?.horizon ? HORIZON[plan.horizon] : null;
    const cap = Number.isFinite(m.capacity) ? `<span class="num ${m.capacity < .25 ? 'warn' : ''}">${fmtNum(m.capacity * 100, 0)}٪</span>` : DASH;
    const risk = Number.isFinite(score.confidence) ? score.confidence : 0;
    return `<tr data-r="${i}">
      <td data-l="رتبه"><span class="rank ${i < 3 ? 'top' : ''}">${i + 1}</span></td>
      <td data-l="نماد"><span class="sym"><b>${esc(s.l18)}${events.length ? eventsBadge(events, s.l18) : ''}</b><span>${esc(s.cs)} · ${esc(s.board)}</span></span></td>
      <td data-l="آخرین (ریال)"><span class="row" style="gap:8px;justify-content:flex-end">${n(fmtOpts.unit === 'toman' ? s.pl / 10 : s.pl)} ${pct(m.chgLast)}</span></td>
      <td data-l="پایانی/دیروز" class="hide-sm">${pct(m.chgClose)}</td>
      <td data-l="قدرت خریدار">${powerCell(m.buyerPower)}</td>
      <td data-l="پول حقیقی" class="hide-sm">${moneyCell(m.netRealMoney)}</td>
      <td data-l="حجم مشکوک" class="hide-sm">${Number.isFinite(m.volumeShock) ? `<span class="num ${m.volumeShock >= 2 ? 'up' : ''}">×${fmtNum(m.volumeShock, 1)}</span>` : DASH}</td>
      <td data-l="ظرفیت تا سقف" class="hide-sm">${cap}</td>
      <td data-l="روند ۳۰ جلسه" class="hide-sm">${s.l18 ? `<canvas class="spark" width="108" height="30" style="width:108px;height:30px" data-i="${i}"></canvas>` : DASH}</td>
      <td data-l="تکنیکال"><span class="row" style="gap:5px;justify-content:flex-end" dir="ltr">${tech}</span></td>
      <td data-l="امتیاز">${scoreBadge(score)}</td>
      <td data-l="افق / ریسک">${horizonCell(m, h, risk, s, plan)}</td>
    </tr>`;
  }).join('');
  icons();
  drawSparks(rows);
}

const scoreBadge = score => {
  if (!Number.isFinite(score.total)) return DASH;
  const cls = score.total >= 80 ? 'a' : score.total >= 68 ? 'b' : score.total >= 55 ? 'c' : score.total >= 42 ? 'd' : 'e';
  return `<span class="score-badge score-${cls}" title="امتیاز جامع ۰ تا ۱۰۰" dir="ltr">${fmtNum(score.total, 1)}
    <span class="conf" title="ضریب اطمینان: پوشش داده × هم‌راستایی عوامل">${fmtNum(score.confidence, 0)}٪</span></span>`;
};

const powerCell = v => !Number.isFinite(v) ? DASH : `<span class="row" style="gap:7px;justify-content:flex-end">
  <span class="num ${v >= 1.25 ? 'up' : v <= 0.8 ? 'down' : ''}">${fmtNum(v, 2)}</span>
  <span class="bar-mini ${v < 1 ? 'neg' : ''}"><i style="width:${Math.min(v / 2.4, 1) * 100}%"></i></span></span>`;

const moneyCell = v => !Number.isFinite(v) ? DASH :
  `<span class="num ${v >= 0 ? 'up' : 'down'}">${v >= 0 ? '+' : '−'}${fmtNum(Math.abs(v) / 1e9, 1)} م.ر</span>`;

function techDots(t = {}) {
  const labels = ['کوتاه‌مدت', 'میان‌مدت', 'بلندمدت'];
  const vals = [t.short, t.mid, t.long];
  return vals.map((v, i) => {
    const cls = !Number.isFinite(v) ? 'neutral' : v >= 65 ? 'bull' : v >= 45 ? 'neutral' : 'bear';
    const txt = !Number.isFinite(v) ? 'داده تاریخچه موجود نیست' : v >= 65 ? 'صعودی و پرقدرت' : v >= 45 ? 'خنثی/تایید' : 'نزولی';
    return `<span class="tdot ${cls}" title="${labels[i]}: ${txt}"></span>`;
  }).join('');
}

function horizonCell(m, h, conf, s, plan) {
  const q = m.sellQueueLocked ? ['q-dn', 'صف فروش'] : m.buyQueueLocked ? ['q-up', 'صف خرید'] : null;
  const k2k = m.k2k && m.k2k.code !== 'none'
    ? `<span class="tiny ${m.k2k.bias > 0 ? 'k2k-up' : 'k2k-dn'}">${esc(m.k2k.fa)}</span>` : '';
  return `<span class="col" style="gap:5px;align-items:flex-end">
    ${h ? `<span class="chip ${h.cls}" style="font-size:10.5px">${ico(h.icon, 10)}${h.fa}</span>` : `<span class="tiny faint">بدون نقشه (وتو)</span>`}
    <span class="row" style="gap:6px;justify-content:flex-end">
      ${q ? `<span class="qbadge ${q[0]}">${q[1]}</span>` : ''}
      ${plan && Number.isFinite(plan.rr) ? `<span class="tiny faint mono" dir="ltr">R/R ${fmtNum(plan.rr, 2)}</span>` : ''}
      ${Number.isFinite(conf) ? `<span class="tiny ${conf >= 60 ? 'up' : conf >= 40 ? 'warn' : 'down'}" title="ضریب اطمینان">اطمینان ${fmtNum(conf, 0)}</span>` : ''}
    </span>${k2k}</span>`;
}

export function drawSparks(rows) {
  $$('#signal-rows canvas.spark').forEach(cv => {
    const r = rows[+cv.dataset.i]; if (!r) return;
    const closes = (r.metrics.bars ? r.metrics.bars.map(b => b.c) : []).concat(
      Number.isFinite(r.inst.pl) ? [r.inst.pl] : []).slice(-30);
    if (closes.length < 2) { cv.replaceWith(Object.assign(document.createElement('span'), { className: 'tiny faint', textContent: 'بدون تاریخچه' })); return; }
    const ctx = cv.getContext('2d'); const W = cv.width, H = cv.height;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    cv.width = W * dpr; cv.height = H * dpr; ctx.scale(dpr, dpr);
    const lo = Math.min(...closes), hi = Math.max(...closes), pad = (hi - lo) * .12 + 1e-9;
    const x = i => i * (W - 6) / (closes.length - 1) + 3;
    const y = p => H - 4 - ((p - lo + pad) / (hi - lo + 2 * pad)) * (H - 9);
    const rising = closes[closes.length - 1] >= closes[0];
    const col = rising ? '#16e08c' : '#ff5470';
    const grd = ctx.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, rising ? 'rgba(22,224,140,.34)' : 'rgba(255,84,112,.28)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.beginPath(); ctx.moveTo(x(0), y(closes[0]));
    closes.forEach((p, i) => ctx.lineTo(x(i), y(p)));
    ctx.lineTo(x(closes.length - 1), H); ctx.lineTo(x(0), H); ctx.closePath();
    ctx.fillStyle = grd; ctx.fill();
    ctx.beginPath(); ctx.moveTo(x(0), y(closes[0]));
    closes.forEach((p, i) => ctx.lineTo(x(i), y(p)));
    ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.lineJoin = 'round'; ctx.stroke();
    ctx.beginPath(); ctx.arc(x(closes.length - 1), y(closes[closes.length - 1]), 2.3, 0, 7);
    ctx.fillStyle = rising ? '#6cf2c0' : '#ff8fab'; ctx.fill();
  });
}

export function tableSkeleton(mode) {
  const tb = $('#signal-rows'); if (!tb) return;
  const cell = w => `<span class="skel" style="width:${w}px"></span>`;
  tb.innerHTML = Array.from({ length: mode === 'load' ? 10 : 1 }, (_, i) =>
    `<tr>${Array.from({ length: 12 }, (_, c) => `<td>${mode === 'load' ? cell(30 + ((i * 7 + c * 11) % 70)) : DASH}</td>`).join('')}</tr>`).join('');
}

/* ═════════════════۳. پنل جزئیات ═════════════════ */

export function renderDetail(r, { watchlist, onWatch, events = [], cmp = [], onCmp = null } = {}) {
  const p = $('#detail-panel'); if (!p) return;
  if (!r) {
    p.innerHTML = `<div class="glass detail"><div class="center" style="padding:22px 0">
      ${ico('mouse-pointer-click', 22, 'var(--faint)')}
      <p class="small muted" style="margin-top:12px">یک ردیف انتخاب کنید تا کالبدشکافی امتیاز، جریان پول و نقشه معامله نمایش داده شود.</p></div></div>`;
    icons(); return;
  }
  const { inst: s, metrics: m, factors: f, score, plan, reasons, veto } = r;
  const inWatch = watchlist?.includes(s.l18);
  const bars = FACTOR_META.map(fc => {
    const v = f[fc.key];
    return `<div class="frow">
      <span class="lbl"><span style="color:${fc.color}">${fc.fa}</span>
        <span class="mono faint" dir="ltr">${Number.isFinite(v) ? fmtNum(v, 0) : 'n/a'}</span></span>
      <span class="fbar"><i class="fill" style="width:${Number.isFinite(v) ? v : 0}%;background:${fc.color}"></i></span>
      <span class="tiny faint">${subline(fc.key, f.detail[fc.key] || {})}</span>
    </div>`;
  }).join('');

  const stat = (k, v, cls = '') => `<div class="stat-mini"><span class="k">${k}</span><span class="v ${cls}">${v}</span></div>`;
  const unit = fmtOpts.unit === 'toman' ? 'تومان' : 'ریال';
  const px = v => Number.isFinite(v) ? fmtNum(fmtOpts.unit === 'toman' ? v / 10 : v) : '—';

  p.innerHTML = `<div class="glass detail">
    <div class="head">
      <div class="row" style="gap:10px;align-items:flex-start">
        <div><b style="font-size:19px">${esc(s.l18)}</b>
          <p class="tiny faint" style="margin:3px 0 0">${esc(s.l30)}<br/>${esc(s.cs)} · ${esc(s.market)} ${esc(s.board)}</p></div>
      </div>
      <span class="grade ${score.grade.cls}">${esc(score.grade.fa)}</span>
    </div>

    <div class="grid" style="grid-template-columns:repeat(2,1fr);gap:8px">
      ${stat(`آخرین (${unit})`, px(s.pl))}
      ${stat('تغییر آخرین/پایانی', fmtPct(m.chgLast), m.chgLast > 0 ? 'up' : m.chgLast < 0 ? 'down' : '')}
      ${stat(`قیمت پایانی`, px(s.pc))}
      ${stat('تغییر پایانی/دیروز', fmtPct(m.chgClose), m.chgClose > 0 ? 'up' : m.chgClose < 0 ? 'down' : '')}
      ${stat('سقف / کف مجاز امروز', `${px(s.tmax)} / ${px(s.tmin)}`)}
      ${stat('دامنه نوسان', `${fmtNum((m.limitPct || 0) * 100, 0)}٪`)}
    </div>

    ${veto?.vetoed ? `<div class="n-fail notice" style="margin:0">
        <b>این نماد وتو شد:</b> ${veto.fa.map(esc).join(' • ')}</div>` : ''}

    <div>
      <div class="row-between" style="margin-bottom:9px">
        <b style="font-size:13.5px">کالبدشکافی امتیاز</b>
        ${scoreBadge(score)}
      </div>
      <div class="col" style="gap:11px">${bars}</div>
    </div>

    ${plan ? `<div>
      <b style="font-size:13.5px">نقشه معامله (پیشنهاد مدل، نه سیگنال قطعی)</b>
      <div class="plan" style="margin-top:9px">
        <div class="box"><div class="k">محدوده ورود</div><div class="v">${px(plan.entry)}</div></div>
        <div class="box stop"><div class="k">حد ضرر (${fmtPct(plan.stopPct, 1)})</div><div class="v">${px(plan.stop)}</div></div>
        ${plan.targets.map((t, i) => `<div class="box ${i === 0 ? 't1' : ''}"><div class="k">هدف ${i + 1} · ${fmtPct(plan.targetPct[i], 1)} · ≈${plan.sessions[i]} جلسه</div><div class="v">${px(t)}</div></div>`).join('')}
      </div>
      <p class="tiny faint" style="margin:8px 0 0">مبتنی بر <b>${esc(plan.atrSource)}</b> · نسبت سود به زیان هدف دوم: <b class="mono" dir="ltr">${fmtNum(plan.rr, 2)}</b>
      ${Number.isFinite(m.capacity) && m.capacity < .3 ? ' · <span class="warn">ظرفیت حرکت امروز کم است؛ ورود به جلسه بعد موکول شود.</span>' : ''}</p>
    </div>` : ''}

    ${reasons && reasons.length ? `<div><b style="font-size:13.5px">چرا این امتیاز؟</b>
      <ul class="why" style="margin-top:9px">${reasons.slice(0, 7).map(x => `<li class="${x.tone}">${esc(x.text)}</li>`).join('')}</ul></div>` : ''}

    ${(() => { const mine = eventsFor(events, s.l18).filter(e => e.days_ahead >= -1).slice(0, 3); return mine.length
      ? `<div><b style="font-size:13.5px">اتفاقات نماد</b>
          <div class="col" style="gap:6px;margin-top:8px">${mine.map(eventItemHtml).join('')}</div></div>` : ''; })()}

    <div class="row" style="gap:8px;justify-content:space-between">
      <span class="row" style="gap:7px">
        <a class="btn-mini" target="_blank" rel="noopener" href="https://www.tsetmc.com/ins/${esc(s.insCode)}">${ico('external-link', 12)}TSETMC</a>
        <a class="btn-mini" target="_blank" rel="noopener" href="https://tablokhani.com/">${ico('eye', 12)}تحلیل تابلو</a>
      </span>
      <span class="row" style="gap:7px">
        <button class="btn-mini ${cmp.includes(s.l18) ? 'is-on' : ''}" id="dp-cmp">${ico('columns-2', 12)}${cmp.includes(s.l18) ? 'حذف از مقایسه' : 'مقایسه'}</button>
        <button class="btn-mini" id="dp-watch">${ico(inWatch ? 'star' : 'star-off', 12)}${inWatch ? 'حذف از دیده‌بان' : 'به دیده‌بان'}</button>
        <button class="btn-mini" id="dp-copy">${ico('clipboard-copy', 12)}کپی تحلیل</button>
      </span>
    </div>
  </div>`;
  icons();
  const cm = $('#dp-cmp'); if (cm && onCmp) cm.addEventListener('click', () => onCmp(s.l18));
  const wc = $('#dp-watch'); if (wc && onWatch) wc.addEventListener('click', () => onWatch(s.l18));
  const cc = $('#dp-copy');
  if (cc) cc.addEventListener('click', async () => {
    const txt = detailText(r);
    try { await navigator.clipboard.writeText(txt); toast('متن تحلیل کپی شد'); }
    catch { toast('کپی ناموفق بود — متن را انتخاب کنید'); }
  });
}

const subline = (key, d) => {
  const f = (v, mul = 1, suf = '') => Number.isFinite(v) ? `${fmtNum(v * mul, 2)}${suf}` : '—';
  if (key === 'tablo') return `قدرت خریدار ${f(d.buyerPower)} · سهم پول حقیقی ${f(d.netRealShare, 100, '٪')} · OBI ${f(d.obi)} · حجم ${f(d.volumeShock, 1, '×')} · ${esc(d.k2k || '')}`;
  if (key === 'short') return `RSI ${f(d.rsi, 1, '')} · اختلاف EMA ${f(d.emaGap, 1, '٪')} · موقعیت در بازه روز ${f(d.dayRangePos, 100, '٪')} · مومنتوم ۵r ${f(d.ret5, 1, '٪')}`;
  if (key === 'mid') return `SMA20−SMA50 ${f(d.smaGap, 1, '٪')} · MACD-Hist ${f(d.macdHist)} · قیمت/SMA20 ${f(d.priceVsSma, 1, '٪')} · شیب ${f(d.slope20, 1, '٪')}`;
  if (key === 'long') return `فاصله از SMA200 ${f(d.vs200, 1, '٪')} · P/E ${f(d.pe)} · نسبت به صنعت ${f(d.peVsSector, 1, '×')} · گردش ${f(d.turnover, 100, '٪')}`;
  return `ارزش روز ${Number.isFinite(d.tval) ? fmtNum(d.tval / 1e9, 1) + ' م.ریال' : '—'} · شناوری ${f(d.freeFloat, 1, '٪')} · نوسان سالانه ${f(d.vol60, 1, '٪')}`;
};

export function detailText(r) {
  const { inst: s, metrics: m, score, reasons = [], plan } = r;
  const L = [
    `تابلورادار — ${s.l18} (${s.l30})`,
    `بازار: ${s.market} ${s.board} · صنعت: ${s.cs}`,
    `آخرین ${fmtNum(s.pl)} ریال · تغییر ${fmtPct(m.chgLast)} · پایانی/دیروز ${fmtPct(m.chgClose)}`,
    `امتیاز مدل ${fmtNum(score.total, 1)}/100 · اطمینان ${fmtNum(score.confidence, 0)}٪ · درجه: ${score.grade.fa}`,
    plan ? `نقشه: ورود ${fmtNum(plan.entry)} · حد ضرر ${fmtNum(plan.stop)} · اهداف ${plan.targets.map(t => fmtNum(t)).join(' / ')}` : '',
    'دلایل:', ...reasons.map(x => `• ${x.text}`),
    '— این تحلیل داده است، نه توصیه سرمایه‌گذاری.',
  ].filter(Boolean);
  return L.join('\n');
}

export function renderNone(kind, reason) {
  const p = $('#detail-panel'); if (!p) return;
  p.innerHTML = kind === 'load'
    ? `<div class="glass detail center" style="padding:34px"><span class="spin" style="width:20px;height:20px"></span>
       <p class="small muted" style="margin-top:14px">در حال دریافت داده از تابلوی بازار …</p></div>`
    : `<div class="glass detail center" style="padding:28px">
        ${ico('satellite', 26, 'var(--red)')}
        <b style="display:block;margin-top:10px">داده‌ای دریافت نشد</b>
        <p class="small faint" style="margin-top:8px">${esc(reason || 'ارتباط با سرور بازار برقرار نشد.')}</p>
        <button class="btn btn-sm" id="dp-retry" style="margin-top:14px">${ico('rotate-cw', 13)}تلاش مجدد</button></div>`;
  icons();
}

/* ═════════════════۴. هیت‌مپ، رادار، وتوها ═════════════════ */

const heatColor = v => {
  if (!Number.isFinite(v)) return 'rgba(148,163,184,.07)';
  const t = Math.max(-3, Math.min(3, v)) / 3;
  return t >= 0 ? `rgba(22,224,140,${0.08 + t * 0.42})` : `rgba(255,84,112,${0.08 + -t * 0.42})`;
};

export function renderHeat(sectors, onSelect, selected) {
  const grid = $('#heat-grid'); if (!grid) return;
  const maxV = Math.max(1, ...sectors.map(s => s.value || 0));
  grid.innerHTML = sectors.slice(0, 24).map(s => `
    <button class="tile ${selected === s.sector ? 'sel' : ''}" data-s="${esc(s.sector)}"
      style="background:${heatColor(s.avgChg)};grid-row:span ${1 + Math.round((s.value / maxV) * 2)}"
      title="${esc(s.sector)} — ${fmtNum(s.count)} نماد · ارزش ${fmtBig(s.value)}">
      <span class="n">${esc(s.sector)}</span>
      <span class="p" style="color:${s.avgChg > 0 ? '#eafff5' : s.avgChg < 0 ? '#ffe9ee' : 'var(--ink)'}">${fmtPct(s.avgChg, 2)}</span>
      <span class="m">${fmtNum(s.up)}/${fmtNum(s.down)} مثبت·منفی</span>
      <span class="m">معاملات: ${fmtBig(s.value)}</span>
      <span class="sub">${esc(s.members.slice(0, 2).map(x => x.l18).join(' · '))}</span>
    </button>`).join('');
  grid.querySelectorAll('.tile').forEach(b => b.addEventListener('click', () => onSelect(b.dataset.s)));
}

export function renderRadar(metricsAll, rows) {
  const bySym = new Map(rows.map(r => [r.inst.l18, r]));

  const q = $('#radar-queues');
  if (q) {
    const items = metricsAll.filter(x => x.m && Number.isFinite(x.m.buyQueueValue) && x.m.buyQueueValue > 0)
      .sort((a, b) => b.m.buyQueueValue - a.m.buyQueueValue).slice(0, 8);
    q.innerHTML = items.length ? items.map(x => `
      <div class="mini-row"><span class="l"><b>${esc(x.inst.l18)}</b><span class="tiny faint">${esc(x.inst.cs)}</span></span>
        <span class="r up">${fmtBig(x.m.buyQueueValue)} · ${fmtNum(x.m.buyQueue)} برگه</span></div>`).join('')
      : `<p class="small faint">امروز صف خرید معناداری در داده دریافتی ثبت نشده است.</p>`;
  }

  const k = $('#radar-k2k');
  if (k) {
    const items = rows.filter(r => r.metrics.k2k && r.metrics.k2k.code !== 'none')
      .sort((a, b) => Math.abs(b.metrics.k2k.bias) - Math.abs(a.metrics.k2k.bias)).slice(0, 8);
    k.innerHTML = items.length ? items.map(r => `
      <div class="mini-row"><span class="l"><b>${esc(r.inst.l18)}</b>
        <span class="tiny ${r.metrics.k2k.bias > 0 ? 'up' : 'down'}">${esc(r.metrics.k2k.fa)}</span></span>
        <span class="r">${moneyCell(r.metrics.netRealMoney)}</span></div>`).join('')
      : `<p class="small faint">الگوی کد‌به‌کد یا جمع‌آوری/خروج محسوس در این اسکن شناسایی نشد.</p>`;
  }

  const w = $('#radar-watch');
  if (w) {
    const near = rows.filter(r => Number.isFinite(r.metrics.capacity) && r.metrics.capacity < .35).slice(0, 4);
    const rest = rows.filter(r => !near.includes(r)).slice(0, 4);
    const items = [...near.map(r => ({ r, tag: 'سقف صف امروز' })), ...rest.map(r => ({ r, tag: 'منتظر تایید فردا' }))];
    w.innerHTML = items.length ? items.map(({ r, tag }) => `
      <div class="mini-row"><span class="l"><b>${esc(r.inst.l18)}</b>
        <span class="tiny faint">${esc(tag)}</span>
        ${bySym.has(r.inst.l18) ? '<span class="pill">ستاره‌دار</span>' : ''}</span>
        <span class="r">${Number.isFinite(r.score.total) ? fmtNum(r.score.total, 1) : '—'}</span></div>`).join('')
      : `<p class="small faint">موردی برای رصد جلسه بعد نیست.</p>`;
  }
  icons();
}

export function renderVetoList(vetoed) {
  const box = $('#veto-list'); if (!box) return;
  const count = $('#veto-n'); if (count) count.textContent = fmtNum(vetoed.length);
  if (!vetoed.length) { box.innerHTML = `<p class="small faint">هیچ نمادی وتو نشد — دامنه اسکن و آستانه‌ها را بررسی کنید.</p>`; return; }
  box.innerHTML = vetoed.slice(0, 40).map(r => `
    <div class="mini-row"><span class="l"><b>${esc(r.inst.l18)}</b>
      <span class="tiny faint">${esc(r.inst.cs)}</span></span>
      <span class="r down">${r.veto.fa.map(esc).join(' • ')}</span></div>`).join('')
    + (vetoed.length > 40 ? `<p class="tiny faint">+ ${fmtNum(vetoed.length - 40)} مورد دیگر</p>` : '');
}

export function renderVetoCards(counts) {
  const box = $('#veto-cards'); if (!box) return;
  box.innerHTML = VETO_META.map(v => `
    <div class="glass veto-card p-6" style="border-radius:18px">
      <div class="row" style="gap:11px">
        <span class="ico" style="background:rgba(255,84,112,.09);border:1px solid rgba(255,84,112,.3)">
          ${ico(v.icon, 19, 'var(--red)')}</span>
        <b style="font-size:14.5px">${v.fa}</b>
        <span class="mono" style="margin-inline-start:auto;color:var(--red);font-size:20px;direction:ltr">${fmtNum(counts[v.code] || 0)}</span>
      </div>
      <p class="small muted" style="margin-top:12px">${v.detail}</p>
      <span class="tiny faint mono" dir="ltr">${fmtNum(counts[v.code] || 0)} نماد در اجرای اخیر</span>
    </div>`).join('');
  icons();
}

/* ═════════════════۵. موتور امتیاز (دونات، کارت‌ها، اسلایدر) ═════════════════ */

export function renderDonut(weights) {
  const svg = $('#w-donut'); const leg = $('#w-legend');
  if (!svg) return;
  const total = FACTOR_META.reduce((a, f) => a + (weights[f.key] || 0), 0) || 1;
  const R = 15.9155, C = 100;
  let off = 25;
  const segs = FACTOR_META.map(f => {
    const w = (weights[f.key] || 0) / total * 100;
    const el = `<circle cx="21" cy="21" r="${R}" fill="none" stroke="${f.color}" stroke-width="4.6"
      stroke-linecap="round" stroke-dasharray="${Math.max(0, w - 0.6).toFixed(2)} ${(C - Math.max(0, w - 0.6)).toFixed(2)}"
      stroke-dashoffset="${off.toFixed(2)}" class="dseg"><title>${f.fa}: ${fmtNum(w, 1)}٪</title></circle>`;
    off -= w;
    return el;
  }).join('');
  svg.innerHTML = `<circle cx="21" cy="21" r="${R}" fill="none" stroke="rgba(148,163,184,.08)" stroke-width="4.6"/>
    ${segs}
    <text x="21" y="20.4" text-anchor="middle" fill="var(--ink)" font-family="JetBrains Mono" font-weight="800" font-size="6">100</text>
    <text x="21" y="26.4" text-anchor="middle" fill="var(--faint)" font-size="2.5">ΣW = ${fmtNum(total / 100, 2)}</text>`;
  svg.setAttribute('aria-label', `وزن عوامل: ${FACTOR_META.map(f => `${f.fa} ${fmtNum((weights[f.key] || 0) / total * 100, 1)}٪`).join('، ')}`);
  if (leg) leg.innerHTML = FACTOR_META.map(f => `<span><i style="background:${f.color}"></i>${f.fa}
    <b>${fmtNum((weights[f.key] || 0) / total * 100, 1)}٪</b></span>`).join('');
}

export function renderFactorCards(f, weights) {
  const box = $('#factor-cards'); if (!box) return;
  const total = FACTOR_META.reduce((a, x) => a + (weights[x.key] || 0), 0) || 1;
  box.innerHTML = FACTOR_META.map(fc => `
    <div class="glass pcard p-6" style="border-radius:18px">
      <div class="row-between">
        <span class="row" style="gap:11px">
          <span class="ico" style="background:${hexA(fc.color, .1)};border:1px solid ${hexA(fc.color, .3)}">${ico(fcIcon(fc.key), 18, fc.color)}</span>
          <b style="font-size:15px">${fc.fa}</b>
        </span>
        <span class="mono" style="color:${fc.color};font-size:12px" dir="ltr">${fmtNum((weights[fc.key] || 0) / total * 100, 0)}٪</span>
      </div>
      <p class="small muted" style="margin-top:12px">${fc.desc}</p>
      <p class="tiny faint mono" style="margin-top:8px" dir="ltr">${subline(fc.key, f?.detail?.[fc.key] || {})}</p>
    </div>`).join('');
  icons();
}
const fcIcon = k => ({ tablo: 'eye', short: 'zap', mid: 'trending-up', long: 'layers', risk: 'shield-check' }[k] || 'gauge');
const hexA = (hex, a) => {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return hex;
  const n0 = parseInt(hex.slice(1), 16);
  return `rgba(${(n0 >> 16) & 255},${(n0 >> 8) & 255},${n0 & 255},${a})`;
};

export function renderWeightSliders(weights, rules, onChange) {
  const box = $('#w-sliders'); if (!box) return;
  box.innerHTML = FACTOR_META.map(f => `
    <div class="slider-row" style="--c:${f.color}">
      <label for="w-${f.key}" style="font-size:12.5px;color:${f.color}">${f.fa}</label>
      <output class="wout" id="o-${f.key}">${fmtNum(weights[f.key], 0)}</output>
      <input type="range" id="w-${f.key}" min="0" max="50" step="1" value="${weights[f.key]}"
             style="--c:${f.color}" aria-label="وزن ${f.fa}" />
    </div>`).join('');
  box.querySelectorAll('input[type=range]').forEach(inp => {
    inp.addEventListener('input', () => {
      const key = inp.id.slice(2);
      $(`#o-${key}`).textContent = fmtNum(+inp.value, 0);
      onChange(key, +inp.value);
    });
  });
  const mv = $('#r-minval'); if (mv) mv.value = Math.round(rules.minValue / 1e9);
  const cb = (id, on) => { const e = $(id); if (e) e.checked = !!on; };
  cb('#r-base', rules.includeBase); cb('#r-funds', rules.includeFunds); cb('#r-hist', rules.requireHistory);
  const wire = (id, fn) => { const e = $(id); if (e && !e.dataset.wired) { e.dataset.wired = '1'; e.addEventListener('change', fn); } };
  wire('#r-minval', () => onChange('minValue', (+mv.value || 0) * 1e9));
  wire('#r-base', () => onChange('includeBase', $('#r-base').checked));
  wire('#r-funds', () => onChange('includeFunds', $('#r-funds').checked));
  wire('#r-hist', () => onChange('requireHistory', $('#r-hist').checked));
}

/* ═════════════════۶. پایپ‌لاین، ترمینال، JSON ═════════════════ */

export const PIPELINE = [
  { fa: 'واکشی داده', file: 'assets/js/data.js · server.py', icon: 'satellite-dish', color: 'var(--cyan)',
    desc: 'زنجیره منبع: پروکسی محلی ← BrsApi ← TSETMC ← اسنپ‌شات آفلاین، با تایم‌اوت و مسیر جایگزین.' },
  { fa: 'نرمال‌سازی', file: 'assets/js/tse.js', icon: 'git-merge', color: 'var(--green)',
    desc: 'تبدیل نام‌های متفاوت فیلدها (pc/pl/qd1/Buy_I_Volume/tmax…) به یک مدل یکنواخت + قواعد بازار.' },
  { fa: 'خُردساختار تابلو', file: 'assets/js/engine.js · instrumentMetrics', icon: 'eye', color: 'var(--violet)',
    desc: 'سرانه، قدرت خریدار، پول حقیقی خالص، کد‌به‌کد، صف‌ها، OBI، حجم مشکوک، فاصله تا سقف مجاز.' },
  { fa: 'تکنیکال چندبازه', file: 'assets/js/indicators.js', icon: 'line-chart', color: 'var(--amber)',
    desc: 'RSI/EMA/SMA(20-50-200)/MACD/Bollinger/ATR روی تاریخچه واقعی؛ در نبود داده، factor=نمشده.' },
  { fa: 'امتیاز + وتو', file: 'assets/js/engine.js · rankInstruments', icon: 'gauge', color: 'var(--green)',
    desc: 'پنج عامل وزنی، اطمینان، درجه سیگنال، نقشه معامله و استخراج Top-N.' },
  { fa: 'رندر و خروجی', file: 'assets/js/ui.js · app.js', icon: 'file-json', color: 'var(--cyan)',
    desc: 'دیده‌بان، هیت‌مپ، رادار، CSV/JSON، اشتراک تلگرام و CLI مرورگر.' },
  { fa: 'میز پژوهش', file: 'tsepy/backtest.py · assets/js/scorecard.js', icon: 'graduation-cap', color: 'var(--violet)',
    desc: 'ثبت هر اسکن در out/runs/، walk-forward بدون نگاه‌به‌آینده، کارنامۀ مدل، رویدادها، هشدار شرطی و مقایسۀ دو نماد.' },
];

export function renderPipeline() {
  const box = $('#pflow'); if (!box || box.dataset.done) return;
  box.dataset.done = '1';
  box.insertAdjacentHTML('beforeend', PIPELINE.map((p, i) => `
    <div class="pnode reveal" style="transition-delay:${(i * 0.07).toFixed(2)}s">
      <div class="glass pcard p-5" style="border-radius:18px">
        <span class="pnum mono" dir="ltr">${String(i + 1).padStart(2, '0')}</span>
        <span class="ico" style="margin-bottom:14px;background:${hexA(p.color === 'var(--cyan)' ? '#4cc9ff' : p.color === 'var(--green)' ? '#16e08c' : p.color === 'var(--violet)' ? '#9b8cff' : '#ffc14d', .1)};border:1px solid ${hexA(p.color === 'var(--cyan)' ? '#4cc9ff' : p.color === 'var(--green)' ? '#16e08c' : p.color === 'var(--violet)' ? '#9b8cff' : '#ffc14d', .3)}">
          ${ico(p.icon, 19, p.color)}</span>
        <b style="font-size:14.5px">${p.fa}</b>
        <p class="mono tiny faint" dir="ltr" style="margin:5px 0 0">${p.file}</p>
        <p class="small muted" style="margin-top:10px">${p.desc}</p>
      </div>
    </div>`).join(''));
  icons();
}

export function termLog(lv, msg) {
  const box = $('#term-body'); if (!box) return;
  const col = { INFO: '#5ecbff', OK: '#16e08c', WARN: '#ffc14d', ERROR: '#ff5470', CMD: '#9b8cff' }[lv] || '#5ecbff';
  const line = document.createElement('div');
  line.className = 'ln';
  line.innerHTML = `<span class="ts">${tehranTime(new Date())}</span>
    <span style="color:${col}">[${lv}]</span><span>${esc(msg)}</span>`;
  box.appendChild(line);
  box.scrollTop = box.scrollHeight;
  while (box.children.length > 240) box.removeChild(box.firstChild);
}

export function renderJSON(payload, err) {
  const b = $('#json-body'); if (!b) return;
  const dl = $('#json-dl');
  if (err || !payload) {
    b.innerHTML = `<span class="j-punc">//</span> <span class="muted">${esc(err || 'هنوز خروجی موفقی تولید نشده است.')}</span>`;
    if (dl) dl.disabled = true;
    return;
  }
  const K = '<span class="j-key">', S = '<span class="j-str">', N = '<span class="j-num">', P = '<span class="j-punc">', E = '</span>';
  const v = x => x === null || x === undefined || !Number.isFinite(x) && typeof x === 'number'
    ? `${P}null${E}`
    : (typeof x === 'string' ? `${S}"${esc(x)}"${E}` : typeof x === 'boolean' ? `${P}${x}${E}` : `${N}${x}${E}`);
  const rows = payload.signals.map((s, i) => `  ${P}{${E}
${K}"rank"${E}${P}:${E} ${i + 1}${P},${E}
${K}"symbol"${E}${P}:${E} ${S}"${esc(s.symbol)}"${E}${P},${E}
${K}"ins_code"${E}${P}:${E} ${S}"${esc(s.insCode)}"${E}${P},${E}
${K}"price_last"${E}${P}:${E} ${v(s.price_last)}${P},${E}
${K}"chg_last_vs_closing_pct"${E}${P}:${E} ${v(s.chg_last_pct)}${P},${E}
${K}"chg_closing_pct"${E}${P}:${E} ${v(s.chg_close_pct)}${P},${E}
${K}"buyer_power_ratio"${E}${P}:${E} ${v(s.buyer_power)}${P},${E}
${K}"net_real_money_rial"${E}${P}:${E} ${v(s.net_real)}${P},${E}
${K}"queue_bid_rial"${E}${P}:${E} ${v(s.bid_queue)}${P},${E}
${K}"volume_shock"${E}${P}:${E} ${v(s.volume_shock)}${P},${E}
${K}"obi"${E}${P}:${E} ${v(s.obi)}${P},${E}
${K}"k2k_pattern"${E}${P}:${E} ${s.k2k ? S + '"' + esc(s.k2k) + '"' + E : `${P}null${E}`}${P},${E}
${K}"score"${E}${P}:${E} ${v(s.score)}${P},${E}
${K}"confidence"${E}${P}:${E} ${v(s.confidence)}${P},${E}
${K}"grade"${E}${P}:${E} ${S}"${esc(s.grade)}"${E}${P},${E}
${K}"entry / stop / targets"${E}${P}:${E} ${S}"${[s.entry, s.stop, ...(s.targets || [])].filter(Number.isFinite).map(x => fmtNum(x)).join(' / ')}"${E}
${P}}${E}${i < payload.signals.length - 1 ? P + ',' + E : ''}`).join('\n');
  b.innerHTML = `${P}{${E}
  ${K}"generated_at"${E}${P}:${E} ${S}"${esc(payload.generated_at)}"${E}${P},${E}
  ${K}"source"${E}${P}:${E} ${S}"${esc(payload.source)}"${E}${P},${E}
  ${K}"market_rules"${E}${P}:${E} ${P}{${E} ${K}"price_limit_pct"${E}${P}:${E} ${v(3)}${P},${E} ${K}"base_volume"${E}${P}:${E} ${v(1)}${P} ${P}}${E}${P},${E}
  ${K}"scanned"${E}${P}:${E} ${v(payload.scanned)}${P},${P},${E}
  ${K}"vetoed"${E}${P}:${E} ${P}{${E}${Object.entries(payload.vetoCounts || {}).map(([k2, val]) => `${K}"${k2}"${E}${P}:${E} ${v(val)}`).join(`${P},${E} `)}${P}}${E}${P},${E}
  ${K}"missing_fields"${E}${P}:${E} ${P}[${E}${(payload.missing || []).map(x => S + '"' + esc(x) + '"' + E).join(`${P},${E} `)}${P}]${E}${P},${E}
  ${K}"signals"${E}${P}:${E} ${P}[${E}
${rows}
  ${P}]${E}
${P}}${E}`;
  if (dl) dl.disabled = false;
}

export function notice(kind, html) {
  const el = $('#live-notice'); if (!el) return;
  if (kind === 'none') { el.className = ''; el.innerHTML = ''; return; }
  el.className = `notice n-${kind}`;
  el.innerHTML = html;
  icons();
}
