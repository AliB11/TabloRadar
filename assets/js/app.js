/**
 * app.js — بوت، اتصال رویدادها و چرخه حیات داشبورد تابلورادار
 */

import { marketPhase, tehranTime, fmtNum, fmtPct, fmtOpts, tehranDate } from './tse.js';
import {
  rankInstruments, marketPulse, sectorAggregates, DEFAULT_WEIGHTS, DEFAULT_RULES,
  instrumentMetrics, FACTOR_META,
} from './engine.js';
import { loadMarket, loadOfflineSnapshot, CFG, loadConfigFromStorage, saveConfig } from './data.js';
import { loadModelReport, renderScorecard } from './scorecard.js';
import { parseAlert, checkAlerts, alertLabel, alertLine, fireText, loadAlerts, saveAlerts } from './alerts.js';
import { loadEvents, upcoming, eventItemHtml } from './events.js';
import { buildCompare, compareHtml, drawCompareSpark } from './compare.js';
import * as U from './ui.js';

const S = {
  insts: [], rows: [], vetoed: [], pulse: null, sectors: [],
  weights: { ...DEFAULT_WEIGHTS }, rules: { ...DEFAULT_RULES },
  sort: { key: 'score', dir: -1 },
  view: 'table', filter: { q: '', sector: '', market: '', top: 10, limitUp: false, inflow: false, queueFree: false },
  selected: null, watch: [], meta: {}, busy: false, timer: null, cd: null, attempt: 0,
  report: null, reportErr: '', events: [], eventsErr: '', alerts: [], cmp: [], fired: [], heroMode: 'candles',
};

try {
  S.weights = JSON.parse(localStorage.getItem('tr.weights') || 'null') || S.weights;
  S.rules = JSON.parse(localStorage.getItem('tr.rules') || 'null') || S.rules;
  S.watch = JSON.parse(localStorage.getItem('tr.watch') || '[]');
  S.heroMode = localStorage.getItem('tr.hero') === 'net' ? 'net' : 'candles';
  Object.assign(fmtOpts, JSON.parse(localStorage.getItem('tr.fmt') || '{}'));
} catch { /* تنظیمات نخستین */ }
S.alerts = loadAlerts();

/* ─────────────── ۱٫ب  میز پژوهش: کارنامه، رویدادها، هشدارها، مقایسه ─────────────── */

async function refreshLab() {
  const [rep, ev] = await Promise.all([loadModelReport(), loadEvents()]);
  S.report = rep.rep; S.reportErr = rep.err || '';
  S.events = ev.events || []; S.eventsErr = ev.err || '';
  renderLab();
}

function renderLab() {
  renderScorecard(S.report, { err: S.reportErr });
  renderEventsPanel();
  renderAlertList();
  fireCheck();
}

function renderEventsPanel() {
  const list = U.$('#ev-list'), note = U.$('#ev-note');
  if (!list) return;
  if (!S.events.length) {
    list.innerHTML = `<p class="tiny faint" style="margin:0">${U.esc(S.eventsErr ? `منبع رویداد متصل نیست (${S.eventsErr}) — ساختگی نمایش داده نمی‌شود.` : 'رویدادی برای دو هفته پیش‌رو ثبت نشده.')}</p>`;
    if (note) note.textContent = '—';
    return;
  }
  const up = upcoming(S.events, 6);
  list.innerHTML = up.map(eventItemHtml).join('')
    + `<p class="tiny faint" style="margin:4px 0 0">${U.esc('منبع: data/events.json — برچسب‌دار/شبیه‌سازی؛ در نسخۀ متصل خوانندۀ کدال جایگزین می‌شود.')}</p>`;
  if (note) note.textContent = `${fmtNum(up.length)} رویداد پیش‌رو`;
}

function renderAlertList() {
  const el = U.$('#alert-list');
  if (!el) return;
  if (!S.alerts.length) { el.innerHTML = '<span class="tiny faint">هیچ شرطی ثبت نشده.</span>'; return; }
  el.innerHTML = S.alerts.map((a, i) => `<div class="alert-item" data-i="${i}">
    <span class="mono" dir="ltr">⚑</span><span>${U.esc(a.raw)}</span>
    <button class="x" title="حذف" data-rm="${i}">✕</button></div>`).join('');
}

function fireCheck() {
  const box = U.$('#alert-fired');
  if (!box) return;
  S.fired = checkAlerts(S.alerts, S.rows);
  if (!S.fired.length) { box.innerHTML = ''; return; }
  box.innerHTML = S.fired.map(f => `<div class="notice n-ok" style="margin:0">
      <span class="alert-chip">فعال شد — ${U.esc(alertLabel(f.cond))}</span>
      <div class="tiny" style="margin-top:6px">${f.hits.map(r => U.esc(alertLine(r, f.cond))).join('<br/>')}</div>
      <button class="btn-mini" id="al-share" style="margin-top:8px"><span>اشتراک در تلگرام</span></button>
    </div>`).join('');
  const sh = U.$('#al-share');
  if (sh) sh.onclick = () => {
    const txt = fireText(S.fired, tehranDate());
    window.open(`https://t.me/share/url?url=${encodeURIComponent('https://tabloradar.ir')}&text=${encodeURIComponent(txt)}`, '_blank', 'noopener');
  };
  U.toast(`🔔 ${fmtNum(S.fired.length)} شرط هشدار فعال شد`, 3600);
}

function addAlert(text) {
  const c = parseAlert(text);
  if (!c) throw new Error('شرط خوانده نشد — الگو: «وبملت قدرت خریدار > 1.4» یا «هر نماد حجم مشکوک ≥ 2.5»');
  S.alerts.push(c); saveAlerts(S.alerts); renderAlertList(); fireCheck();
  return `شرط ثبت شد: ${c.raw}`;
}

/* ── مقایسه دو نماد ── */
function toggleCmp(sym) {
  const i = S.cmp.indexOf(sym);
  if (i >= 0) S.cmp.splice(i, 1);
  else { S.cmp.push(sym); if (S.cmp.length > 2) S.cmp.shift(); }
  if (S.cmp.length === 2) openCompare(); else closeCompare();
  const row = S.rows.find(r => r.inst.l18 === S.selected);
  if (row) U.renderDetail(row, detailOpts());
}
const detailOpts = () => ({
  watchlist: S.watch, onWatch: toggleWatch, events: S.events,
  cmp: S.cmp, onCmp: toggleCmp,
});
function openCompare() {
  const [a, b] = S.cmp.map(sym => S.rows.find(r => r.inst.l18 === sym) || S.vetoed.find(r => r.inst.l18 === sym));
  const modal = U.$('#cmp-modal'), scrim = U.$('#cmp-scrim'), body = U.$('#cmp-body');
  if (!modal || !body) return;
  if (!a || !b) { closeCompare(); return; }
  body.innerHTML = compareHtml(a, b, buildCompare(a, b));
  modal.classList.add('open'); scrim.classList.add('on');
  requestAnimationFrame(() => drawCompareSpark(U.$('#cmp-spark'), [a, b]));
}
function closeCompare() {
  U.$('#cmp-modal')?.classList.remove('open'); U.$('#cmp-scrim')?.classList.remove('on');
}

/* ─────────────────────────── ۱. اسکن و رندر ─────────────────────────── */

async function scan({ manual = false, withHistory = true } = {}) {
  if (S.busy) return;
  S.busy = true; S.attempt++;
  S.t0 = performance.now();
  const btn = U.$('#live-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spin"></span><span>در حال واکشی …</span>'; }

  /* نمایش موقت از اسنپ‌شات محلیِ واقعی — فقط تا رسیدن داده زنده (شبیه‌سازی‌شده رد می‌شود) */
  let primedLocal = false;
  if (!S.insts.length) {
    U.tableSkeleton('load');
    U.renderNone('load');
    /* رندر اولیه فقط از اسنپ‌شات واقعی؛ نمونهٔ شبیه‌سازی‌شده عمداً نمایش داده نمی‌شود. */
    const primed = await loadOfflineSnapshot();
    const primedIsReal = primed?.kind !== 'simulated' &&
      !primed?.instruments?.some(i => i?.synthetic === true);
    if (primed?.instruments?.length && primedIsReal) {
      S.insts = primed.instruments;
      S.meta = { live: false, source: primed.source, at: new Date(), route: 'حافظه محلی',
        kind: primed.kind || 'live-partial', simulatedFields: primed.simulatedFields || null,
        historyCount: primed.instruments.filter(i => i.history?.length >= 30).length,
        snapshot: primed.snapshotMeta };
      S.meta.historyOk = S.meta.historyCount > 0;
      S.fetchElapsed = (performance.now() - S.t0) / 1000;
      S.tAnalyze = performance.now();
      recompute();
      S.lastElapsed = (performance.now() - S.tAnalyze) / 1000;
      renderAll();
      primedLocal = true;
      U.termLog('INFO', `رندر اولیه از اسنپ‌شات آفلاین (${S.rows.length} سیگنال)`);
    }
  }
  U.notice('load', primedLocal
    ? `${U.esc('اتصال به منبع داده …')} نمایش موقت از اسنپ‌شات محلی <span class="spin"></span>`
    : `${U.esc('اتصال به منابع داده …')} <span class="spin"></span>`);
  U.termLog('INFO', manual ? `درخواست واکشی دستی (#${S.attempt})` : `آغاز پایپ‌لاین تحلیل کمی (#${S.attempt})`);

  try {
    const histN = withHistory ? Number(U.$('#s-histn')?.value || 40) : 0;
    const res = await loadMarket({
      historyFor: histN,
      onProgress: (done, total, sym) => { if (done % 10 === 0 || done === total) U.termLog('INFO', `تاریخچه ${done}/${total} — ${sym}`); },
    });
    S.insts = res.instruments;
    S.meta = {
      live: res.live, source: res.source, at: new Date(), route: res.route || '',
      kind: res.kind || (res.live ? 'live' : 'live-partial'),
      asOf: res.asOf || '', simulatedFields: res.simulatedFields || null,
      historyCount: res.instruments.filter(i => i.history?.length >= 30).length,
      snapshot: res.snapshotMeta || null,
    };
    S.meta.historyOk = S.meta.historyCount > 0;
    S.fetchElapsed = (performance.now() - S.t0) / 1000;
    U.termLog(res.live ? 'OK' : 'WARN',
      `${res.live ? 'داده زنده دریافت شد' : (S.meta.kind === 'simulated' ? 'دادهٔ شبیه‌سازی‌شده (غیرواقعی)' : 'حالت آفلاین')}: ${res.source} · ${fmtNum(S.insts.length)} نماد`);
    if (S.meta.kind === 'simulated') {
      const sim = (S.meta.simulatedFields?.simulated || []).slice(0, 6).join('، ');
      U.notice('fail', `<b class="down">⚠ این داده‌ها واقعی نیستند — شبیه‌سازی‌شده‌اند</b>
        هیچ منبع زنده‌ای پاسخ نداد، پس داشبورد روی «اسنپ‌شات نمونه» اجرا می‌شود. فقط
        <b>قیمت پایانی/دیروز، ارزش و تعداد معاملات</b> لنگر خبری دارند؛ ${U.esc(sim)} … ساخته شده‌اند.
        <div class="tiny" style="margin-top:6px">برای دادهٔ واقعی یکی از این دو کار را انجام دهید:
          <span class="mono" dir="ltr">python3 tools/fetch_live_snapshot.py</span> (رونوشت واقعی از TSETMC/بورس‌تریدر،
          حتی برای حالت بی‌شبکه) یا <span class="mono" dir="ltr">python3 server.py</span> (داده زنده در لحظه).
        </div>`);
    } else if (!S.meta.live) {
      U.notice('warn', `<b class="warn">داده زنده در دسترس نبود</b> — داشبورد روی اسنپ‌شات محلی اجرا می‌شود
        (${U.esc(S.meta.asOf || 'بدون تاریخ')}). برای داده لحظه‌ای <span class="mono" dir="ltr">python3 server.py</span>
        را اجرا کنید یا کلید BrsApi را در بخش «داده و شفافیت» وارد کنید.
        ${S.meta.snapshot ? `<div class="tiny faint" style="margin-top:6px">${U.esc(S.meta.snapshot.disclaimer || '')}</div>` : ''}`);
    } else if (S.meta.kind === 'live-partial') {
      U.notice('warn', `<b class="warn">داده واقعی اما جزئی</b> — منبع: ${U.esc(S.meta.source)}.
        پوشش کامل بازار با TSETMC به دست می‌آید؛ برای دادهٔ کامل/لحظه‌ای
        <span class="mono" dir="ltr">python3 server.py</span> را اجرا کنید.`);
    }
    S.tAnalyze = performance.now();
    recompute();
    S.lastElapsed = (performance.now() - S.tAnalyze) / 1000;
    renderAll();
    scheduleRetry(CFG.refreshSec);
  } catch (e) {
    U.termLog('ERROR', `شکست در واکشی: ${String(e.message || e)}`);
    const hasLocal = S.insts.length > 0;
    U.notice(hasLocal ? 'warn' : 'fail',
      `<b class="${hasLocal ? 'warn' : 'down'}">${hasLocal ? 'داده زنده نرسید — نمایش روی اسنپ‌شات محلی ادامه دارد' : 'هیچ منبعی پاسخ نداد.'}</b>
       ${U.esc(String(e.message || e).slice(0, 200))}
       <div class="tiny" style="margin-top:6px">مسیرهای آزموده‌شده: ${(e.log || []).map(U.esc).join(' · ') || 'پروکسی محلی، BrsApi، TSETMC، اسنپ‌شات'}</div>`);
    if (!hasLocal) { U.renderNone('fail', String(e.message || e).slice(0, 160)); U.renderTable([]); }
    scheduleRetry(30);
  } finally {
    S.busy = false;
    if (btn) { btn.disabled = false; btn.innerHTML = `${U.esc('')}<i data-lucide="rotate-cw" style="width:12px;height:12px"></i><span>واکشی مجدد</span>`; U.icons(); }
  }
  return S.rows.length;
}

/** بازمحاسبه صرفاً روی داده‌های در حافظه (برای اسلایدر وزن و فیلترهای وتو) */
function recompute() {
  const out = rankInstruments(S.insts, { rules: S.rules, weights: S.weights });
  S.rows = out.rows; S.vetoed = out.vetoed; S.vetoCounts = out.vetoCounts;
  S.pulse = marketPulse(S.insts, S.rows.slice(0, 10));
  S.sectors = sectorAggregates(S.insts);
  const sel = S.selected && S.rows.find(r => r.inst.l18 === S.selected);
  S.selected = sel ? S.selected : (S.rows[0]?.inst.l18 || null);
}

function renderAll() {
  const el = Number.isFinite(S.lastElapsed) ? S.lastElapsed : NaN;
  const elTxt = Number.isFinite(el) ? el.toFixed(2) : '—';
  const conf = S.rows.length ? S.rows.reduce((a, r) => a + (r.score.confidence || 0), 0) / S.rows.length : 0;
  U.$('#st-scan').textContent = fmtNum(S.insts.length);
  U.$('#st-time').textContent = elTxt;
  U.$('#st-veto').textContent = fmtNum(S.vetoed.length);
  U.$('#st-conf').textContent = S.rows.length ? `${fmtNum(conf, 0)}٪` : '—';
  U.$('#scan-meta').textContent = S.insts.length
    ? `analysis: ${elTxt}s · fetch: ${Number.isFinite(S.fetchElapsed) ? S.fetchElapsed.toFixed(2) : '—'}s · `
      + `ranked: ${S.rows.length} · vetoed: ${S.vetoed.length}`
    : '—';

  U.renderSourceChips(S.meta);
  U.renderPulse(S.pulse);
  U.renderTicker(visibleRowsForTicker());
  U.renderTable(filteredRows(), { sortKey: S.sort.key, sortDir: S.sort.dir, onSort: setSort, events: S.events });
  U.renderHeat(S.sectors, pickSector, S.filter.sector);
  U.renderRadar(S.insts.map(i => ({ inst: i, m: instrumentMetrics(i) })), S.rows);
  U.renderVetoList(S.vetoed);
  U.renderVetoCards(S.vetoCounts);
  U.renderDonut(S.weights);
  U.renderWeightSliders(S.weights, S.rules, onWeightChange);
  const top = S.rows.find(r => r.inst.l18 === S.selected) || S.rows[0];
  U.renderDetail(top, detailOpts());
  fillSectorFilter();
  renderJSON();
  U.$('#f-count').textContent = S.insts.length
    ? `${fmtNum(filteredRows().length)} از ${fmtNum(S.rows.length)} نمادِ منطبق با فیلتر نمایش داده می‌شود` : '';
  if (!S.rows.some(r => r.veto?.vetoed) && S.meta.live) U.notice('ok', noticeOkHtml());
  fireCheck();   // سنجه‌های هشدار شرطی روی تازه‌ترین ردیف‌ها
}

const noticeOkHtml = () => `<b class="up">اسکن کامل شد.</b> ${fmtNum(S.rows.length)} نماد رتبه‌بندی و ${fmtNum(S.vetoed.length)} نماد وتو شد.
  <button class="btn-mini" id="nt-refresh" style="margin-inline-start:8px">${U.esc('')}<i data-lucide="rotate-cw" style="width:11px;height:11px"></i>واکشی تازه</button>
  <span id="retry-in" class="tiny faint"></span>`;

const visibleRowsForTicker = () => [...S.insts]
  .sort((a, b) => (b.tval || 0) - (a.tval || 0)).slice(0, 16)
  .map(i => {
    const m = instrumentMetrics(i);
    return { sym: i.l18, price: Number.isFinite(i.pl) ? fmtNum(fmtOpts.unit === 'toman' ? i.pl / 10 : i.pl) : '—',
      chg: fmtPct(m.chgLast), up: (m.chgLast ?? 0) >= 0 };
  });

/* ─────────────────────────── ۲. فیلتر و مرتب‌سازی ─────────────────────────── */

/* عملگرهای فیلتر CLI: filter power > 1.4 / ≤ 0.8 / off */
const POWER_OPS = {
  '>': (a, b) => a > b, '>=': (a, b) => a >= b, '≥': (a, b) => a >= b,
  '<': (a, b) => a < b, '<=': (a, b) => a <= b, '≤': (a, b) => a <= b,
  '=': (a, b) => a === b, '==': (a, b) => a === b,
};

function filteredRows() {
  const f = S.filter;
  const q = f.q.trim().toLowerCase();
  const powerFn = f.powerOp ? POWER_OPS[f.powerOp] : null;
  const powerOn = powerFn && Number.isFinite(f.powerVal);
  let out = S.rows.filter(r => {
    const { inst: s, metrics: m } = r;
    if (q && !(`${s.l18} ${s.l30} ${s.cs}`.toLowerCase().includes(q))) return false;
    if (f.sector && s.cs !== f.sector) return false;
    if (f.market && s.market !== f.market) return false;
    if (f.limitUp && !m.atLimitUp) return false;
    if (f.inflow && !(Number.isFinite(m.netRealMoney) && m.netRealMoney > 0)) return false;
    if (f.queueFree && (m.buyQueueLocked || m.sellQueueLocked)) return false;
    /* قدرت خریدار: داده غایب ⇒ ردیف رد می‌شود (اعداد ساختگی ممنوع) */
    if (powerOn && !(Number.isFinite(m.buyerPower) && powerFn(m.buyerPower, f.powerVal))) return false;
    return true;
  });
  const k = S.sort.key, dir = S.sort.dir;
  const val = r => ({
    score: r.score.total ?? -1, chg: r.metrics.chgLast ?? -999, chgClose: r.metrics.chgClose ?? -999,
    power: r.metrics.buyerPower ?? -1, netReal: r.metrics.netRealMoney ?? -Infinity,
    shock: r.metrics.volumeShock ?? -1, cap: r.metrics.capacity ?? -1,
  }[k]);
  /* مقایسه‌گر سه‌حالته — تفریقِ مستقیم با ±Infinity عدد NaN می‌ساز و ترتیب sort را می‌شکست */
  out = out.sort((a, b) => {
    const va = val(a), vb = val(b);
    return (va < vb ? -1 : va > vb ? 1 : 0) * dir;
  });
  return out.slice(0, Number(f.top) || 10);
}

function setSort(key) {
  if (S.sort.key === key) S.sort.dir *= -1;
  else { S.sort.key = key; S.sort.dir = -1; }   // جدید: همیشه نزولی (بیشترین اول)
  U.renderTable(filteredRows(), { sortKey: S.sort.key, sortDir: S.sort.dir, onSort: setSort });
}

const pickSector = sec => {
  S.filter.sector = S.filter.sector === sec ? '' : sec;
  U.$('#f-sector').value = S.filter.sector;
  showView('table');
  renderAll();
  if (S.filter.sector) U.toast(`فیلتر صنعت: ${S.filter.sector}`);
};

function fillSectorFilter() {
  const sel = U.$('#f-sector'); if (!sel || sel.dataset.done) return;
  sel.dataset.done = '1';
  sel.innerHTML = `<option value="">همه صنایع</option>` +
    [...new Set(S.insts.map(i => i.cs).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fa'))
      .map(c => `<option value="${U.esc(c)}">${U.esc(c)}</option>`).join('');
}

function showView(v) {
  S.view = v;
  U.$$('[data-view]').forEach(b => {
    const on = b.dataset.view === v;
    b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on));
  });
  for (const id of ['table', 'heat', 'radar', 'veto']) {
    const box = U.$(`#view-${id}`); if (box) box.hidden = id !== v;
  }
  U.$('#detail-panel').style.display = v === 'table' ? '' : 'none';
}

function onWeightChange(key, value) {
  if (key === 'minValue') S.rules.minValue = value;
  else if (key in S.rules) S.rules[key] = value;
  else S.weights[key] = value;
  try {
    localStorage.setItem('tr.weights', JSON.stringify(S.weights));
    localStorage.setItem('tr.rules', JSON.stringify(S.rules));
  } catch { /* noop */ }
  if (S.insts.length) {
    const ta = performance.now();
    recompute();
    S.lastElapsed = (performance.now() - ta) / 1000;
    renderAll();
  }
  const sum = FACTOR_META.reduce((a, f) => a + (S.weights[f.key] || 0), 0);
  const top = S.rows[0];
  U.$('#w-summary').textContent = top
    ? `Σw=${fmtNum(sum)} · نفر اول: ${top.inst.l18} (${fmtNum(top.score.total, 1)}) · وتو: ${fmtNum(S.vetoed.length)}` : '—';
}

function toggleWatch(sym) {
  S.watch = S.watch.includes(sym) ? S.watch.filter(x => x !== sym) : [...S.watch, sym];
  try { localStorage.setItem('tr.watch', JSON.stringify(S.watch)); } catch { /* noop */ }
  U.toast(S.watch.includes(sym) ? `${sym} به دیده‌بان اضافه شد` : `${sym} از دیده‌بان حذف شد`);
  U.renderDetail(S.rows.find(r => r.inst.l18 === S.selected) || S.rows[0], detailOpts());
}

/* ─────────────────────────── ۳. زمان‌بندی ─────────────────────────── */

function scheduleRetry(sec) {
  clearInterval(S.cd); clearTimeout(S.timer);
  let left = sec;
  const tick = () => { const e = U.$('#retry-in'); if (e) e.textContent = left > 0 ? ` — ${fmtNum(left)} ثانیه تا واکشی بعدی` : ''; };
  tick();
  S.cd = setInterval(() => { left--; tick(); if (left <= 0) clearInterval(S.cd); }, 1000);
  const auto = U.$('#s-autorefresh')?.checked !== false;
  if (!auto) return;
  S.timer = setTimeout(() => scan({ manual: false, withHistory: false }), Math.max(15, sec) * 1000);
}

function phaseLoop() {
  const ph = marketPhase();
  const dot = U.$('#mkt-dot'), st = U.$('#mkt-status');
  if (st) st.textContent = ph.fa;
  if (dot) dot.classList.toggle('off', !ph.open);
  const clk = U.$('#tehran-clock');
  if (clk) clk.textContent = tehranTime();
  const stamp = U.$('#pulse-stamp');
  if (stamp) stamp.textContent = `${ph.open ? 'در جلسه معاملاتی' : 'خارج از جلسه'} · آخرین اسکن ${S.meta.at ? tehranTime(S.meta.at) : '—'}`;
  return ph;
}

/* ─────────────────────────── ۴. خروجی‌ها ─────────────────────────── */

function renderJSON() {
  const missing = [];
  if (!S.meta.historyOk) missing.push('history');
  if (S.insts.some(i => !Number.isFinite(i.eps))) missing.push('eps');
  if (S.insts.some(i => !Number.isFinite(i.sectorPE))) missing.push('sectorPE');
  if (S.insts.some(i => !(i.book || []).length)) missing.push('orderBook');
  const payload = {
    tool: 'TabloRadar v3.1',
    generated_at: new Date().toISOString(),
    tehran_calendar: tehranDate(),
    source: S.meta.source || '—',
    data_kind: S.meta.kind || 'live',
    as_of: S.meta.asOf || '',
    simulated_fields: S.meta.kind === 'simulated' ? (S.meta.simulatedFields?.simulated || []) : [],
    live: !!S.meta.live,
    market_rules: { price_limit_pct: 3, base_volume: 1, session: '09:00-12:30 + TAL 12:45-13:00' },
    weights: S.weights, rules: S.rules,
    scanned: S.insts.length, vetoed_count: S.vetoed.length, vetoCounts: S.vetoCounts,
    missing,
    signals: S.rows.slice(0, 10).map(r => ({
      rank: 0, symbol: r.inst.l18, insCode: r.inst.insCode, name: r.inst.l30, sector: r.inst.cs,
      price_last: rnd(r.inst.pl), price_closing: rnd(r.inst.pc), price_yesterday: rnd(r.inst.py),
      chg_last_pct: rnd(r.metrics.chgLast, 2), chg_close_pct: rnd(r.metrics.chgClose, 2),
      buyer_power: rnd(r.metrics.buyerPower, 2), net_real: rnd(r.metrics.netRealMoney),
      bid_queue: rnd(r.metrics.buyQueueValue), ask_queue: rnd(r.metrics.sellQueueValue),
      volume_shock: rnd(r.metrics.volumeShock, 2), obi: rnd(r.metrics.obi, 3),
      k2k: r.metrics.k2k?.code ?? null, capacity_to_ceiling: rnd(r.metrics.capacity, 3),
      score: r.score.total, confidence: r.score.confidence, grade: r.score.grade.fa,
      factors: { tablo: rnd(r.factors.tablo), short: rnd(r.factors.short), mid: rnd(r.factors.mid), long: rnd(r.factors.long), risk: rnd(r.factors.risk) },
      entry: rnd(r.plan?.entry), stop: rnd(r.plan?.stop), targets: (r.plan?.targets || []).map(t => rnd(t)),
      r_r: r.plan?.rr ?? null,
      why: (r.reasons || []).map(x => x.text),
    })).map((s, i) => ({ ...s, rank: i + 1 })),
  };
  S.payload = payload;
  U.renderJSON(payload);
}
const rnd = (v, d = 0) => Number.isFinite(v) ? +v.toFixed(d) : null;

function download(name, text, type = 'application/json;charset=utf-8') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; a.click(); URL.revokeObjectURL(a.href);
}

function csvOf() {
  const cols = ['rank', 'symbol', 'name', 'sector', 'market', 'price_last', 'chg_last_pct', 'chg_close_pct',
    'buyer_power', 'net_real_rial', 'bid_queue_rial', 'volume_shock', 'obi', 'k2k', 'capacity', 'score', 'confidence', 'grade', 'entry', 'stop', 'target1', 'target2', 'target3'];
  const head = cols.join(',');
  const body = S.rows.slice(0, Number(S.filter.top) || 10).map((r, i) => [
    i + 1, r.inst.l18, r.inst.l30, r.inst.cs, `${r.inst.market} ${r.inst.board}`,
    r.inst.pl, fx(r.metrics.chgLast), fx(r.metrics.chgClose), fx(r.metrics.buyerPower, 2),
    Math.round(r.metrics.netRealMoney ?? ''), Math.round(r.metrics.buyQueueValue ?? ''),
    fx(r.metrics.volumeShock, 2), fx(r.metrics.obi, 3), r.metrics.k2k?.code ?? '', fx(r.metrics.capacity, 3),
    r.score.total ?? '', r.score.confidence ?? '', r.score.grade.fa,
    r.plan?.entry ?? '', r.plan?.stop ?? '', ...(r.plan?.targets || [ '', '', '']).map(x => x ?? ''),
  ].map(x => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\n');
  return '' + head + '\n' + body;
}
const fx = (v, d = 2) => Number.isFinite(v) ? v.toFixed(d) : '';

function telegramText() {
  const L = [`📡 تابلورادار — ${tehranDate()} (قیمت: ریال)`];
  S.rows.slice(0, 10).forEach((r, i) => L.push(
    `${i + 1}. ${r.inst.l18} — ${fmtNum(r.inst.pl)} (${fmtPct(r.metrics.chgLast)}) — امتیاز ${fmtNum(r.score.total, 1)}` +
    (r.plan ? ` — حد ضرر ${fmtNum(r.plan.stop)}` : '')));
  if (S.meta.kind === 'simulated') L.push('', '⚠ دادهٔ نمایش‌داده‌شده شبیه‌سازی‌شده است (بدون منبع زنده).');
  L.push('', `منبع: ${S.meta.source}`, 'تحلیل داده، نه توصیه سرمایه‌گذاری.', 'https://tabloradar.ir');
  return L.join('\n');
}

/* ─────────────────────────── ۵. CLI مرورگر ─────────────────────────── */

const CLI = {
  help: () => `دستورات: help · top [n] · sort <key> · filter power|inflow|limit|queue <op> <عدد> · sector <نام> · explain <نماد> · watch <نماد> · weights [T S M L R] · rules [minVal] · export csv|json · alert add|list|rm <i>|clear · compare <نماد۱> <نماد۲> · report · refresh · clear`,
  top: a => U.renderTable((setTopN(+a[0] || 10), filteredRows()), sortOpts()),
  sort: a => { if (a[0]) { S.sort.key = a[0]; S.sort.dir = a[1] === 'asc' ? 1 : -1; renderAll(); } return `مرتب‌سازی: ${S.sort.key} ${S.sort.dir > 0 ? 'asc' : 'desc'}`; },
  filter: a => {
    const [field, op, num] = a;
    const v = Number(num);
    if (field === 'power') {
      if (op === 'off' || op === 'clear' || !Number.isFinite(v)) {
        delete S.filter.powerOp; delete S.filter.powerVal;
        renderAll();
        return 'فیلتر قدرت خریدار: خاموش';
      }
      if (!POWER_OPS[op]) return 'عملگر نامعتبر — مثال: filter power > 1.4 یا filter power off';
      S.filter.powerOp = op; S.filter.powerVal = v;
      renderAll();
      return `فیلتر قدرت خریدار ${op} ${v}`;
    }
    if (field === 'inflow') { S.filter.inflow = op !== 'off'; renderAll(); return `فیلتر ورود پول حقیقی: ${S.filter.inflow ? 'روشن' : 'خاموش'}`; }
    if (field === 'limit') { S.filter.limitUp = op !== 'off'; renderAll(); return `فیلتر چسبیده به سقف: ${S.filter.limitUp ? 'روشن' : 'خاموش'}`; }
    if (field === 'queue') { S.filter.queueFree = op !== 'off'; renderAll(); return `فیلتر بدون صف قفل: ${S.filter.queueFree ? 'روشن' : 'خاموش'}`; }
    return 'فیلتر ناشناخته — help';
  },
  sector: a => { pickSector(a.join(' ')); U.$('#f-sector').value = S.filter.sector; showView('heat'); renderAll(); return S.filter.sector ? `فیلتر صنعت: ${S.filter.sector}` : 'نمایش همه صنایع'; },
  explain: a => {
    const r = S.rows.find(x => x.inst.l18 === a[0]);
    if (!r) return `نماد ${U.esc(a[0] || '')} در فهرست رتبه‌بندی‌شده نیست`;
    U.renderDetail(r, detailOpts()); showView('table');
    return `${r.inst.l18} — امتیاز ${r.score.total} · اطمینان ${r.score.confidence}%\n` + (r.reasons || []).map(x => `• ${x.text}`).join('\n');
  },
  watch: a => { if (a[0]) toggleWatch(a[0]); return `دیده‌بان: ${S.watch.join(', ') || '—'}`; },
  weights: a => {
    if (a.length >= 5) { ['tablo', 'short', 'mid', 'long', 'risk'].forEach((k, i) => S.weights[k] = Number(a[i]) || 0); recompute(); renderAll(); U.termLog('CMD', `دوباره امتیازدهی شد: ${JSON.stringify(S.weights)}`); }
    return `وزن‌ها: ${Object.entries(S.weights).map(([k, v]) => `${k}=${v}`).join(' ')}`;
  },
  rules: a => { if (a[0]) { S.rules.minValue = Number(a[0]) * 1e9; recompute(); renderAll(); } return `حداقل ارزش معاملات: ${fmtNum(S.rules.minValue / 1e9, 0)} میلیارد ریال · وتوشده: ${S.vetoed.length}`; },
  export: a => {
    if (a[0] === 'csv') { download('tabloradar.csv', csvOf(), 'text/csv;charset=utf-8'); return 'CSV دانلود شد'; }
    if (a[0] === 'json') { download('signals.json', JSON.stringify(S.payload, null, 2)); return 'JSON دانلود شد'; }
    return 'export csv|json';
  },
  refresh: () => { scan({ manual: true }); return 'واکشی آغاز شد …'; },
  alert: a => {
    const sub = (a[0] || 'list').toLowerCase();
    if (sub === 'add') { const txt = a.slice(1).join(' '); if (!txt) return 'alert add <شرط> — مثال: alert add وبملت قدرت خریدار > 1.4'; return addAlert(txt); }
    if (sub === 'rm' || sub === 'remove') { const i = +a[1]; if (!(i >= 0) || !S.alerts[i]) return 'alert rm <شماره‌ردیف list>'; const [gone] = S.alerts.splice(i, 1); saveAlerts(S.alerts); renderAlertList(); return `حذف شد: ${gone.raw}`; }
    if (sub === 'clear') { S.alerts = []; saveAlerts(S.alerts); renderAlertList(); return 'همه هشدارها پاک شد'; }
    if (!S.alerts.length) return 'هیچ هشدار فعالی نیست — «alert add فولاد ظرفیت > 60»';
    return S.alerts.map((c, i) => `${i}. ${c.raw}${checkAlerts([c], S.rows).length ? '  ← فعال است' : ''}`).join('\n');
  },
  compare: a => {
    const [x, y] = a;
    if (!x || !y) return 'compare <نماد۱> <نماد۲>';
    const ok = s => (s ? (S.rows.find(r => r.inst.l18 === s) ? '✓' : '⚠ وتو/ناشناخته') : '✗');
    S.cmp = [x, y];
    openCompare();
    return `مقایسۀ ${x} ↔ ${y} باز شد · دسترس: ${ok(x)} ${ok(y)}`;
  },
  report: () => { refreshLab(); return S.report
    ? `کارنامه ✓ · تولید ${S.report.generated_at} · داوری: ${S.report.verdict?.fa || '—'}`
    : `کارنامۀ آماده‌ای نیست (${S.reportErr || '—'}) — بسازید: python3 main.py --offline --backtest`; },
  clear: () => { U.$('#term-body').innerHTML = ''; return null; },
};
const setTopN = nn => { S.filter.top = nn; U.$('#f-top').value = String(nn); };
const sortOpts = () => ({ sortKey: S.sort.key, sortDir: S.sort.dir, onSort: setSort });

function runCommand(line) {
  const [cmd, ...args] = String(line).trim().split(/\s+/);
  if (!cmd) return;
  U.termLog('CMD', `> ${line}`);
  const fn = CLI[cmd];
  if (!fn) { U.termLog('ERROR', `دستور ناشناخته: ${cmd} — «help» را امتحان کنید`); return; }
  try { const out = fn(args); if (out) U.termLog('OK', out); }
  catch (e) { U.termLog('ERROR', String(e.message || e)); }
}

/* ─────────────────────────── ۶. تور ۹۰ ثانیه‌ای ─────────────────────────── */

const TOUR = [
  { sel: '#pulse-grid', t: 'نبض بازار', d: 'دمای بازار، عرض بازار، ارزش معاملات و پول حقیقی خالص — از همان اسنپ‌شات؛ اگر این چهار عدد هم‌جهت باشند، سیگنال‌های فردا اعتبار بیشتری دارند.' },
  { sel: '#sig-table', t: 'دیده‌بان رتبه‌بندی‌شده', d: 'فقط نمادهایی که از فیلترهای وتو رد شده‌اند. «ظرفیت تا سقف» می‌گوید با دامنه ۳٪ امروز چقدر جای حرکت هست.' },
  { sel: '#detail-panel', t: 'کالبدشکافی و نقشه', d: 'پنج عامل، دلیل‌های فارسی، محدوده ورود، حد ضرر و پله‌های هدف — همراه با تعداد جلسات لازم.' },
  { sel: '#view-heat', t: 'هیت‌مپ صنایع', d: 'بازار ایران صنعت‌محور است: کلیک روی یک کاشی، کل جدول را روی همان صنعت فیلتر می‌کند.' },
  { sel: '#w-sliders', t: 'سناریوی وزن‌ها', d: 'مدل جعبه سیاه نیست. وزن خودتان را بدهید و ببینید چه می‌شود.' },
  { sel: '#sc-card', t: 'کارنامۀ مدل', d: 'خودِ ادعا هم سنجیده می‌شود: walk-forward روی تاریخچه، hit-rate سه‌جلسه‌ای و مازاد بر بازار — پیش از آن‌که به امتیاز اعتماد کنید، کارنامه را ببینید.' },
  { sel: '#view-radar', t: 'رادار صف و کد‌به‌کد', d: 'سنگین‌ترین صف‌های خرید، الگوهای کد‌به‌کد و نمادهای منتظر تایید فردا.' },
  { sel: '#data', t: 'شفافیت داده', d: 'منبع، زمان، مسیر و فیلدهای غایب همیشه اعلام می‌شود.' },
];

let tourIdx = -1;
function tourStep(i) {
  const root = U.$('#tour');
  if (i < 0 || i >= TOUR.length) { if (root) root.remove(); tourIdx = -1; return; }
  tourIdx = i;
  let el = U.$('#tour');
  if (!el) {
    document.body.insertAdjacentHTML('beforeend',
      `<div class="tour" id="tour"><div class="veil"></div><div class="spot"></div>
       <div class="card glass p-6" style="border-radius:18px">
         <div class="row-between"><b id="tour-t"></b><span class="pill mono" id="tour-i"></span></div>
         <p class="small muted" style="margin-top:10px" id="tour-d"></p>
         <div class="row-between" style="margin-top:16px">
           <button class="btn-mini" id="tour-prev">قبلی</button>
           <span class="row" style="gap:8px"><button class="btn-mini" id="tour-exit">خروج</button>
           <button class="btn btn-primary btn-sm" id="tour-next">بعدی</button></span>
         </div></div></div>`);
    U.$('#tour-next').onclick = () => tourStep(tourIdx + 1);
    U.$('#tour-prev').onclick = () => tourStep(tourIdx - 1);
    U.$('#tour-exit').onclick = () => tourStep(-1);
    U.$('#tour .veil').onclick = () => tourStep(-1);
    el = U.$('#tour');
  }
  const step = TOUR[i];
  U.$('#tour-t').textContent = step.t;
  U.$('#tour-d').textContent = step.d;
  U.$('#tour-i').textContent = `${i + 1}/${TOUR.length}`;
  U.$('#tour-next').textContent = i === TOUR.length - 1 ? 'پایان' : 'بعدی';
  const target = U.$(step.sel);
  const spot = U.$('#tour .spot'), card = U.$('#tour .card');
  if (target) {
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    requestAnimationFrame(() => {
      const r = target.getBoundingClientRect();
      Object.assign(spot.style, { top: `${r.top - 8}px`, left: `${r.left - 8}px`, width: `${r.width + 16}px`, height: `${r.height + 16}px` });
      const below = r.bottom + 200 < innerHeight;
      Object.assign(card.style, {
        top: `${below ? r.bottom + 18 : Math.max(16, r.top - 210)}px`,
        left: `${Math.max(12, Math.min(innerWidth - 400, r.left))}px`,
      });
    });
  }
  U.icons();
}

/* ─────────────────────────── ۷. نمایشگر کد ─────────────────────────── */

const CODE_LIST = [
  'assets/js/engine.js', 'assets/js/tse.js', 'assets/js/indicators.js',
  'assets/js/data.js', 'assets/js/ui.js', 'assets/js/scorecard.js', 'assets/js/alerts.js',
  'assets/js/events.js', 'assets/js/compare.js', 'assets/js/app.js', 'server.py', 'main.py',
  'tsepy/scoring_engine.py', 'tsepy/backtest.py',
];

/** فایل‌های واقعی ریپو را می‌خواند؛ اگر باندل آفلاین ساخته شده باشد از همان استفاده می‌شود */
async function loadCodeFiles() {
  if (Array.isArray(window.__TR_CODE) && window.__TR_CODE.length) return window.__TR_CODE;
  const out = [];
  for (const path of CODE_LIST) {
    try {
      const res = await fetch(`./${path}`);
      if (!res.ok) continue;
      out.push({ name: path, lang: path.endsWith('.py') ? 'python' : 'javascript', src: await res.text() });
    } catch { /* file:// یا نبود سرور */ }
  }
  return out;
}

async function codeViewer() {
  const tabs = U.$('#code-tabs');
  if (!tabs) return;
  const files = await loadCodeFiles();
  if (!files.length) {
    tabs.innerHTML = `<span class="codetab">برای نمایش کد منبع، داشبورد را با «python3 server.py» اجرا کنید</span>`;
    return;
  }
  tabs.innerHTML = files.map((f, i) =>
    `<button class="codetab" role="tab" id="ct-${i}" aria-selected="${i === 0}" data-id="${i}">${U.esc(f.name.split('/').pop())}</button>`).join('');
  let cur = '';
  const load = i => {
    const f = files[i] || files[0];
    cur = f.src;
    U.$('#code-title').textContent = `tabloradar / ${f.name}`;
    const body = U.$('#code-body');
    body.className = `language-${f.lang}`;
    try { body.innerHTML = window.hljs ? window.hljs.highlight(f.src, { language: f.lang }).value : U.esc(f.src); }
    catch { body.textContent = f.src; }
    U.$('#code-gutter').innerHTML = f.src.split('\n').map((_, j) => `<span>${j + 1}</span>`).join('');
    tabs.querySelectorAll('.codetab').forEach(b => b.setAttribute('aria-selected', String(+b.dataset.id === i)));
  };
  tabs.addEventListener('click', e => { const b = e.target.closest('.codetab'); if (b) load(+b.dataset.id); });
  load(Math.max(0, files.findIndex(f => f.name.includes('engine.js'))));
}


/* ─────────────────────────── ۸. بوم هیرو ─────────────────────────── */

function heroCanvas() {
  const cv = U.$('#hero-canvas'); if (!cv) return;
  const ctx = cv.getContext('2d');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const CW = 9, GAP = 7, STEP = CW + GAP;
  let W = 0, H = 0, dpr = 1, candles = [], off = 0, price = 100, t = 0;
  const next = () => {
    const o = price, c = o + (Math.random() - 0.44) * 4.2;
    price = c;
    candles.push({ o, c, h: Math.max(o, c) + Math.random() * 2.6, l: Math.min(o, c) - Math.random() * 2.6 });
  };
  const resize = () => {
    dpr = Math.min(devicePixelRatio || 1, 2);
    W = cv.clientWidth; H = cv.clientHeight;
    cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    buildNet();
  };
  /* —— حالت دوم بوم: شبکه عصبی (تصویرسازی معماری پنج‌عاملی؛ نه مدل آموزشی فعال) —— */
  let net = null;
  const buildNet = () => {
    const layers = [4, 6, 6, 5, 3, 1];                       // ورودی‌ها → پنج عامل → درجه
    const nodes = layers.map((n, li) => Array.from({ length: n }, (_, ni) => ({
      x: W * (0.1 + 0.8 * (li / (layers.length - 1))),
      y: H / 2 + (ni - (n - 1) / 2) * Math.max(26, (H * 0.72) / Math.max(n, 5)),
    })));
    const edges = [];
    for (let li = 0; li < nodes.length - 1; li++)
      for (const a of nodes[li]) for (const b of nodes[li + 1])
        edges.push({ a, b, w: Math.random() });              // وزن نمایشی
    net = { nodes, edges };
  };
  const drawNet = () => {
    if (!net) return;
    ctx.clearRect(0, 0, W, H);
    const pulsePos = (t % 160) / 160;
    for (const e of net.edges) {
      const strong = e.w > 0.72;
      ctx.strokeStyle = strong ? 'rgba(22,224,140,.22)' : 'rgba(148,163,184,.06)';
      ctx.lineWidth = strong ? 1.1 : 0.6;
      ctx.beginPath(); ctx.moveTo(e.a.x, e.a.y); ctx.lineTo(e.b.x, e.b.y); ctx.stroke();
      if (strong) {
        const px = e.a.x + (e.b.x - e.a.x) * pulsePos, py = e.a.y + (e.b.y - e.a.y) * pulsePos;
        ctx.fillStyle = 'rgba(76,201,255,.5)';
        ctx.beginPath(); ctx.arc(px, py, 1.4, 0, 7); ctx.fill();
      }
    }
    net.nodes.forEach((L, li) => L.forEach(nd => {
      const beat = 1 + 0.14 * Math.sin(t / 24 + nd.y / 34 + li);
      const r = (li === net.nodes.length - 1 ? 5.4 : 3.4) * beat;
      ctx.fillStyle = li === 0 ? 'rgba(76,201,255,.75)'
        : li === net.nodes.length - 1 ? 'rgba(22,224,140,.9)' : 'rgba(155,140,255,.6)';
      ctx.beginPath(); ctx.arc(nd.x, nd.y, r, 0, 7); ctx.fill();
    }));
    ctx.fillStyle = 'rgba(233,239,249,.34)'; ctx.font = '10px monospace';
    ctx.fillText('4 inputs · 5 factors · grade', 14, 18);
    t++;
  };
  const draw = () => {
    if (S.heroMode === 'net') return drawNet();
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(148,163,184,.05)'; ctx.lineWidth = 1;
    for (let gy = 0; gy < H; gy += 64) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke(); }
    let lo = Infinity, hi = -Infinity;
    candles.forEach(k => { lo = Math.min(lo, k.l); hi = Math.max(hi, k.h); });
    const pad = (hi - lo) * 0.18 + 0.001; lo -= pad; hi += pad;
    const py = v => H - ((v - lo) / (hi - lo)) * H;
    candles.forEach((k, i) => {
      const x = i * STEP + off;
      if (x < -STEP || x > W + STEP) return;
      const up = k.c >= k.o;
      ctx.strokeStyle = up ? 'rgba(22,224,140,.7)' : 'rgba(255,84,112,.62)';
      ctx.fillStyle = up ? 'rgba(22,224,140,.5)' : 'rgba(255,84,112,.45)';
      ctx.beginPath(); ctx.moveTo(x + CW / 2, py(k.h)); ctx.lineTo(x + CW / 2, py(k.l)); ctx.stroke();
      ctx.fillRect(x, Math.min(py(k.o), py(k.c)), CW, Math.max(1.6, Math.abs(py(k.o) - py(k.c))));
    });
  };
  resize();
  for (let i = 0; i < 240; i++) next();
  addEventListener('resize', resize);
  const btn = U.$('#hero-mode');
  const syncBtn = () => { if (btn) btn.innerHTML = S.heroMode === 'net'
    ? '<i data-lucide="candlestick-chart" style="width:16px;height:16px"></i> بوم: کندل‌ها'
    : '<i data-lucide="network" style="width:16px;height:16px"></i> بوم: شبکه عصبی'; U.icons(); };
  btn?.addEventListener('click', () => {
    S.heroMode = S.heroMode === 'net' ? 'candles' : 'net';
    try { localStorage.setItem('tr.hero', S.heroMode); } catch { /* بی‌اهمیت */ }
    cv.classList.toggle('net', S.heroMode === 'net');
    syncBtn();
    if (reduce) draw();   // در حالت کم‌تحرک، انیمیشنی نیست؛ خودِ کلیک یک فریم می‌کشد
  });
  syncBtn(); cv.classList.toggle('net', S.heroMode === 'net');
  if (reduce) { draw(); return; }
  const loop = () => {
    draw();
    if (S.heroMode !== 'net') {
      off -= 0.42;
      if (off <= -STEP) { off += STEP; candles.shift(); next(); }
      while (candles.length * STEP + off < W + STEP * 2) next();
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

/* ─────────────────────────── ۹. سیم‌کشی میز پژوهش ─────────────────────────── */

function wireLab() {
  refreshLab();
  const reload = () => { refreshLab(); U.toast('کارنامه و رویدادها بازخوانی شد'); };
  U.$('#sc-refresh')?.addEventListener('click', reload);
  U.$('#sc-refresh')?.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); reload(); } });
  const input = U.$('#alert-add'), addBtn = U.$('#alert-add-btn');
  const add = () => {
    if (!input || !input.value.trim()) return;
    try { U.termLog('OK', addAlert(input.value)); input.value = ''; }
    catch (e) { U.termLog('ERROR', String(e.message || e)); }
  };
  addBtn?.addEventListener('click', add);
  input?.addEventListener('keydown', e => { if (e.key === 'Enter') add(); });
  U.$('#alert-list')?.addEventListener('click', e => {
    const b = e.target.closest('[data-rm]'); if (!b) return;
    S.alerts.splice(+b.dataset.rm, 1); saveAlerts(S.alerts); renderAlertList(); fireCheck();
  });
  U.$('#cmp-close')?.addEventListener('click', closeCompare);
  U.$('#cmp-scrim')?.addEventListener('click', closeCompare);
}

/* ─────────────────────────── ۱۰. بوت ─────────────────────────── */

(function wire() {
  /* تب‌های نما */
  U.$$('[data-view]').forEach(b => b.addEventListener('click', () => showView(b.dataset.view)));
  /* فیلترها */
  const onIn = (sel, fn, ms = 180) => {
    const e = U.$(sel); if (!e) return;
    let t; e.addEventListener('input', () => { clearTimeout(t); t = setTimeout(fn, ms); });
  };
  onIn('#f-q', () => { S.filter.q = U.$('#f-q').value; renderAll(); });
  U.$('#f-sector')?.addEventListener('change', e => { S.filter.sector = e.target.value; renderAll(); });
  U.$('#f-market')?.addEventListener('change', e => { S.filter.market = e.target.value; renderAll(); });
  U.$('#f-top')?.addEventListener('change', e => { S.filter.top = +e.target.value; renderAll(); });
  [['#f-limitup', 'limitUp'], ['#f-inflow', 'inflow'], ['#f-queuefree', 'queueFree']].forEach(([sel, key]) =>
    U.$(sel)?.addEventListener('change', e => { S.filter[key] = e.target.checked; renderAll(); }));
  U.$('#btn-f-reset')?.addEventListener('click', () => {
    S.filter = { q: '', sector: '', market: '', top: 10, limitUp: false, inflow: false, queueFree: false };
    U.$('#f-q').value = ''; U.$('#f-sector').value = ''; U.$('#f-market').value = '';
    U.$('#f-limitup').checked = false; U.$('#f-inflow').checked = false; U.$('#f-queuefree').checked = false;
    renderAll(); U.toast('فیلترها پاک شد');
  });

  /* کلیک روی جدول */
  U.$('#signal-rows')?.addEventListener('click', e => {
    const tr = e.target.closest('tr[data-r]'); if (!tr) return;
    U.$$('#signal-rows tr').forEach(x => x.classList.remove('active'));
    tr.classList.add('active');
    const row = filteredRows()[+tr.dataset.r];
    if (row) { S.selected = row.inst.l18; U.renderDetail(row, detailOpts()); }
  });
  U.$('#live-notice')?.addEventListener('click', e => { if (e.target.closest('#nt-refresh')) scan({ manual: true }); });
  U.$('#detail-panel')?.addEventListener('click', e => { if (e.target.closest('#dp-retry')) scan({ manual: true }); });

  /* دکمه‌ها */
  U.$('#live-btn')?.addEventListener('click', () => scan({ manual: true }));
  U.$('#pulse-refresh')?.addEventListener('click', () => { recompute(); renderAll(); U.toast('نبض بازار تازه شد'); });
  U.$('#btn-csv')?.addEventListener('click', () => { download('tabloradar.csv', csvOf(), 'text/csv;charset=utf-8'); U.toast('CSV ساخته شد'); });
  U.$('#btn-share')?.addEventListener('click', () => {
    const txt = telegramText();
    const url = `https://t.me/share/url?url=${encodeURIComponent('https://tabloradar.ir')}&text=${encodeURIComponent(txt)}`;
    window.open(url, '_blank', 'noopener');
  });
  U.$('#json-dl')?.addEventListener('click', () => S.payload && download('signals.json', JSON.stringify(S.payload, null, 2)));
  U.$('#json-copy')?.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(JSON.stringify(S.payload, null, 2)); U.toast('JSON کپی شد'); }
    catch { U.toast('کپی در این مرورگر مجاز نیست'); }
  });
  U.$('#w-reset')?.addEventListener('click', () => { S.weights = { ...DEFAULT_WEIGHTS }; onWeightChange('__noop', 0); U.toast('وزن‌ها به پیش‌فرض برگشت'); });

  /* ترمینال */
  U.$('#term-input')?.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    const v = e.target.value; e.target.value = '';
    runCommand(v);
  });

  /* کشوی تنظیمات */
  const drawer = U.$('#drawer'), scrim = U.$('#drawer-scrim');
  const setDrawer = on => { drawer?.classList.toggle('open', on); scrim?.classList.toggle('on', on); };
  U.$('#btn-settings')?.addEventListener('click', () => setDrawer(true));
  scrim?.addEventListener('click', () => setDrawer(false));
  U.$('#drawer-close')?.addEventListener('click', () => setDrawer(false));
  const bindFmt = (sel, key) => { const e = U.$(sel); if (!e) return; e.checked = !!fmtOpts[key];
    e.addEventListener('change', () => { fmtOpts[key] = e.checked; try { localStorage.setItem('tr.fmt', JSON.stringify(fmtOpts)); } catch {} renderAll(); }); };
  bindFmt('#s-toman', 'toman'); bindFmt('#s-fadigits', 'faDigits');
  U.$('#s-interval')?.addEventListener('change', e => {
    const v = Math.max(15, +e.target.value || 60); CFG.refreshSec = v; saveConfig({ refreshSec: v });
    scheduleRetry(v); U.toast(`بازه واکشی: ${v} ثانیه`);
  });

  /* کلید BrsApi فقط در محیط سرور نگهداری می‌شود؛ هرگز وارد مرورگر/localStorage نمی‌شود. */
  loadConfigFromStorage();

  /* تور و میان‌بُرهای صفحه‌کلید */
  U.$('#btn-tour')?.addEventListener('click', () => tourStep(0));
  addEventListener('keydown', e => {
    if (e.target.matches('input,select,textarea')) { if (e.key === 'Escape') tourStep(-1); return; }
    if (e.key === 't') tourStep(tourIdx + 1);
    if (e.key === '/') { e.preventDefault(); U.$('#f-q')?.focus(); }
    if (e.key === 'r') scan({ manual: true });
    if (e.key === 'Escape') { tourStep(-1); closeCompare(); }
  });

  /* ناوبری، نمایان‌سازی، scroll-spy */
  const nav = U.$('#nav'), bar = U.$('#scrollbar');
  addEventListener('scroll', () => {
    nav?.classList.toggle('scrolled', scrollY > 24);
    const p = scrollY / Math.max(1, document.documentElement.scrollHeight - innerHeight);
    if (bar) bar.style.transform = `scaleX(${p})`;
  }, { passive: true });
  const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: .12 });
  U.$$('.reveal').forEach(el => io.observe(el));
  const spy = new IntersectionObserver(es => es.forEach(e => {
    if (!e.isIntersecting) return;
    U.$$('.navlink').forEach(a => a.classList.toggle('active', a.getAttribute('href') === `#${e.target.id}`));
  }), { rootMargin: '-40% 0px -55% 0px' });
  ['pulse', 'signals', 'engine', 'scorecard', 'pipeline', 'data', 'code'].forEach(id => { const el = document.getElementById(id); if (el) spy.observe(el); });

  /* تیکر: pause با لمس */
  const tk = U.$('.ticker');
  if (tk) {
    for (const [ev, on] of [['touchstart', 1], ['touchend', 0], ['mouseenter', 1], ['mouseleave', 0]])
      tk.addEventListener(ev, () => tk.classList.toggle('paused', !!on), { passive: true });
  }

  /* ساعت/وضعیت بازار */
  phaseLoop();
  setInterval(phaseLoop, 1000);
  U.renderPipeline();
  codeViewer();
  heroCanvas();
  wireLab();
  U.icons();
  document.title = `${tehranDate()} — تابلورادار`;

  /* نخستین اجرا */
  scan({ manual: false, withHistory: true }).then(() =>
    U.termLog('OK', `پایپ‌لاین آماده · ${S.rows.length} سیگنال · ${S.vetoed.length} وتو`));
})();
