/**
 * data.js — لایه داده تابلورادار
 *
 * زنجیره منبع (از مطمئن‌ترین در دسترس‌ترین):
 *   ۱) پروکسی هم‌ریشه  /api/market       → سرور `server.py` (TSETMC → بورس‌تریدر → اسنپ‌شات)
 *   ۲) BrsApi فقط از پروکسی امن سرور → `Api.BrsApi.ir/Tsetmc/AllSymbols.php`
 *   ۳) سرویس رسمی TSETMC (بدون کلید)      → `old.tsetmc.com/tsev2/data/MarketWatchInit.aspx`
 *      + `ClientTypeAll.aspx` برای حقیقی/حقوقی (قالب رسمی؛ پارسر در `sources.js`)
 *   ۴) بورس‌تریدر — نبض بازار و تابلوهای عمومی نمادها (مسیر مستقیم مرورگر با پراکسی CORS)
 *   ۵) اسنپ‌شات محلی `data/offline-snapshot.json` — فقط اگر واقعی باشد؛ نمونهٔ شبیه‌سازی‌شده
 *      (`kind: simulated` یا `synthetic: true`) به‌صورت fail-closed رد می‌شود و اصلاً نمایش داده نمی‌شود.
 *
 * تاریخچه قیمت (برای اندیکاتورهای واقعی):
 *   /api/history?l18=… → cdn.tsetmc.com /api/MarketWatch/GetPriceHistory → BrsApi History.php
 */

import { normalizeInstrument, normalizeAll, expandHistory } from './tse.js';
import { toSeries } from './indicators.js';
import {
  parseMarketWatchInit, parseClientTypeAll, buildRows, parseChartCsv,
  btOverviewFromText, btSymbolFromText,
} from './sources.js';

export const CFG = {
  brsBase: 'https://Api.BrsApi.ir/Tsetmc/',
  brsAlt: 'https://BrsApi.ir/Api/Tsetmc/',
  tsetmcBase: 'https://old.tsetmc.com/tsev2/data/',   // قالب متنی رسمی TSETMC
  cdnBase: 'https://cdn.tsetmc.com/api/',
  btBase: 'https://bourse-trader.ir',
  timeout: 9000,
  directTimeout: 4500,   // منابع مستقیم مرورگر سریع شکست بخورند (تجربهٔ کاربری)
  btSymbols: 10,         // در مسیر مستقیم چند نماد از بورس‌تریدر خوانده شود
  historyDays: 260,
  refreshSec: 60,
};

/* ───────────────── ابزار شبکه ───────────────── */

const cache = new Map();
const memo = (key, ttl, val) => {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < ttl) return hit.v;
  cache.set(key, { t: Date.now(), v: val });
  return val;
};

async function httpJson(url, timeout = CFG.timeout) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json,*/*' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = (await res.text()).trim();
    if (!text) throw new Error('پاسخ خالی');
    try { return JSON.parse(text); } catch { return text; }   /* سرویس قدیمی TSETMC متن JS برمی‌گرداند */
  } finally { clearTimeout(to); }
}

const PROXIES = [
  { id: 'corsproxy',  make: u => `https://corsproxy.io/?url=${encodeURIComponent(u)}` },
  { id: 'allorigins', make: u => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}` },
  { id: 'codetabs',   make: u => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}` },
];

let preferredRoute = null;

/** یک URL را با زنجیره مسیرها (مستقیم → جایگزین → پراکسی CORS) می‌خواند. */
async function fetchSmart(url, { alt, tag = '', allowProxy = true, timeout = CFG.timeout, maxRoutes = 0 } = {}) {
  const sameOrigin = url.startsWith('/');
  const routes = [];
  if (alt) routes.push({ id: 'althost', label: 'میزبان جایگزین', fn: () => alt });
  routes.push({ id: 'direct', label: 'اتصال مستقیم', fn: () => url });
  if (allowProxy && !sameOrigin) {
    for (const p of PROXIES) routes.push({ id: p.id, label: `پراکسی ${p.id}`, fn: () => p.make(url) });
  }
  const _timeout = timeout;

  let ordered = preferredRoute
    ? [routes.find(r => r.id === preferredRoute), ...routes.filter(r => r.id !== preferredRoute)]
    : routes;
  if (maxRoutes > 0) ordered = ordered.slice(0, maxRoutes);
  const errs = [];
  for (const r of ordered) {
    if (!r) continue;
    try {
      const data = await httpJson(r.fn(), _timeout);
      preferredRoute = r.id;
      if (data && typeof data === 'object' && data.error && !Array.isArray(data)) throw new Error(String(data.error).slice(0, 60));
      return { data, route: r.label };
    } catch (e) {
      errs.push(`${r.id}: ${e && e.name === 'AbortError' ? 'timeout' : String(e.message || e).slice(0, 40)}`);
    }
  }
  throw new Error(errs.join(' | ') || 'خطای ناشناخته');
}

/** اجرای هم‌زمان با محدودیت تعداد (برای واکشی تاریخچه) */
export async function mapLimit(arr, n, fn) {
  const out = new Array(arr.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, arr.length) }, async () => {
    while (i < arr.length) { const k = i++; out[k] = await fn(arr[k], k); }
  }));
  return out;
}

/* ───────────────── خواندن آرایه از پاسخ‌های متفاوت ───────────────── */

function extractArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload) return [];
  for (const k of ['data', 'result', 'rows', 'InstrumentInfo', 'instrumentList', 'lastData', 'MarketWatch', 'closingPriceDaily', 'bestLimits']) {
    if (Array.isArray(payload[k])) return payload[k];
  }
  /* سرویس قدیمی TSETMC: رشته‌ای شبیه var instrumentList=[...];  */
  if (typeof payload === 'string') return parseTsetmcScript(payload);
  return [];
}

/**
 * پارس خروجی instinfodata.aspx (TSETMC legacy).
 * ساختار: `var instrumentList = [["insCode","l18","l30",...],...];var lastData=[...]`
 * ستون‌ها با سرستوردهای متنی می‌آیند؛ در نبود سرستون، نگاشت رایج زیر استفاده می‌شود.
 */
const LEGACY_COLS = ['insCode', 'l18', 'l30', 'isin', 'cs', 'cs_id', 'market', 'state',
  'pc', 'pl', 'py', 'pf', 'pmin', 'pmax', 'tvol', 'tval', 'tno', 'bvol', 'eps', 'pe', 'zTitad'];

function parseTsetmcScript(text) {
  try {
    const m = text.match(/instrumentList\s*=\s*(\[.*?\])\s*;/s);
    if (!m) return [];
    const arr = JSON.parse(m[1].replace(/,(\s*[}\]])/g, '$1').replace(/'/g, '"'));
    if (!Array.isArray(arr) || !arr.length) return [];
    return arr.map(row => {
      if (Array.isArray(row)) {
        const o = {};
        row.forEach((v, i) => { o[LEGACY_COLS[i] ?? `c${i}`] = v; });
        return o;
      }
      return row;
    });
  } catch { return []; }
}

/* ───────────────── منابع اصلی ───────────────── */

/** اسنپ‌شات کامل بازار (یک درخواست) — زنجیرهٔ منابع زنده تا اسنپ‌شات محلی */
export async function fetchMarketSnapshot() {
  const log = [];

  /* ۱) پروکسی هم‌ریشه (server.py) — داده را سرور از TSETMC/بورس‌تریدر می‌آورد */
  try {
    const { data } = await fetchSmart('/api/market', { tag: 'proxy' });
    const rows = extractArray(data);
    const kind = data?.kind || (data?.instruments?.length ? 'live' : '');
    const minimumRows = kind === 'live-partial' ? 1 : 31;
    if (rows.length >= minimumRows && kind !== 'simulated' && !rows.some(r => r?.synthetic === true)) {
      return {
        rows, source: data.source || 'پروکسی محلی /api/market', kind,
        live: kind === 'live' || kind === 'live-partial',
        asOf: data.as_of || '', indices: data.indices || null,
        marketState: data.market_state || null, overview: data.market_overview || null,
        log: [...log, `proxy:ok(${kind})`],
      };
    }
    log.push(rows.length ? `proxy:${kind || 'snapshot'}` : 'proxy:empty');
  } catch (e) { log.push(`proxy:${String(e.message).slice(0, 40)}`); }

  /* BrsApi فقط از پروکسی سرور فراخوانی می‌شود؛ قوانین سرویس CORS Proxy و اشتراک کلید را منع می‌کند. */

  /* ۳) سرویس رسمی TSETMC — قالب متنی رسمی، بدون کلید (MarketWatchInit + ClientTypeAll) */
  try {
    const mw = await fetchSmart(`${CFG.tsetmcBase}MarketWatchInit.aspx?h=0&r=0`,
      { timeout: CFG.directTimeout, maxRoutes: 2 });
    const parsed = parseMarketWatchInit(typeof mw.data === 'string' ? mw.data : JSON.stringify(mw.data));
    if (parsed.prices.length > 30) {
      let clients = {};
      try {
        const ct = await fetchSmart(`${CFG.tsetmcBase}ClientTypeAll.aspx`,
          { timeout: CFG.directTimeout, maxRoutes: 2 });
        clients = parseClientTypeAll(typeof ct.data === 'string' ? ct.data : '');
      } catch (e) { log.push(`tsetmc-ct:${String(e.message).slice(0, 40)}`); }
      const rows = buildRows(parsed, clients);
      const st = parsed.state || {};
      return {
        rows, source: `TSETMC رسمی (${mw.route})`, kind: 'live', live: true, log,
        asOf: st.datetimeRaw || '',
        indices: st.indexTotal ? {
          index_total: { fa: 'شاخص کل بورس', value: st.indexTotal, chg_pct: st.indexChangePct },
        } : null,
        marketState: st,
      };
    }
    log.push('tsetmc:empty');
  } catch (e) { log.push(`tsetmc:${String(e.message).slice(0, 60)}`); }

  /* ۴) بورس‌تریدر — نبض بازار + تابلوهای عمومی نمادهای پرگردش (پوشش جزئی، صریح) */
  try {
    const home = await fetchSmart(`${CFG.btBase}/`, { timeout: CFG.directTimeout, maxRoutes: 2 });
    const overview = btOverviewFromText(String(home.data || ''));
    const top = [...(overview.top_inflow || []).slice(0, 6), ...(overview.top_outflow || []).slice(0, 4)]
      .map(i => i.symbol).filter(Boolean);
    const rows = [];
    for (const sym of [...new Set(top)].slice(0, CFG.btSymbols)) {
      try {
        const page = await fetchSmart(`${CFG.btBase}/symbol/${encodeURIComponent(sym)}`,
          { timeout: CFG.directTimeout, maxRoutes: 1 });
        const snap = btSymbolFromText(String(page.data || ''), sym);
        rows.push({ ...snap, l18: sym, provenance: 'bourse-trader', synthetic: false, partial: true });
      } catch { /* نماد بعدی */ }
    }
    if (rows.length >= 5) {
      return {
        rows, source: `bourse-trader.ir (پوشش جزئی: ${rows.length} نماد پرگردش)`,
        kind: 'live-partial', live: true, overview, log,
        asOf: new Date().toISOString().slice(0, 16).replace('T', ' '),
      };
    }
    log.push('bt:partial');
  } catch (e) { log.push(`bt:${String(e.message).slice(0, 60)}`); }

  /* ۵) فقط اسنپ‌شات واقعی محلی؛ نمونهٔ شبیه‌سازی‌شده fail-closed رد می‌شود. */
  try {
    const snap = await fetch('data/offline-snapshot.json').then(r => (r.ok ? r.json() : null));
    const rows = snap?.instruments || [];
    const kind = snap?.data_kind || (snap?.simulated_fields ? 'simulated' : 'live-partial');
    const containsSynthetic = rows.some(r => r?.synthetic === true);
    if (rows.length && kind !== 'simulated' && !containsSynthetic) {
      return {
        rows: rows.map(r => ({ ...r, provenance: r.provenance || 'offline-live' })),
        source: `اسنپ‌شات واقعی محلی (${snap.as_of || 'بدون تاریخ'})`,
        kind, live: false, log, snapshotMeta: snap,
      };
    }
    if (rows.length) log.push('offline:rejected-simulated');
  } catch (e) { log.push(`offline:${String(e.message).slice(0, 40)}`); }

  const err = new Error('هیچ منبع داده‌ای در دسترس نبود');
  err.log = log;
  throw err;
}

/** فیلدهای تکمیلی یک نماد از بورس‌تریدر (فقط وقتی پروکسی محلی در دسترس باشد) */
export async function fetchSymbolDetail(l18) {
  if (!l18) return null;
  try {
    const { data } = await fetchSmart(`/api/symbol/${encodeURIComponent(l18)}`, { maxRoutes: 1 });
    return data?.detail || null;
  } catch { return null; }
}

/** نبض بازار (شاخص/صف/پول حقیقی) از پروکسی محلی، وگرنه مستقیم از بورس‌تریدر */
export async function fetchMarketOverview() {
  try {
    const { data } = await fetchSmart('/api/overview', { maxRoutes: 1 });
    if (data?.overview) return data.overview;
  } catch { /* مسیر مستقیم */ }
  try {
    const { data } = await fetchSmart(`${CFG.btBase}/`, { timeout: CFG.directTimeout, maxRoutes: 2 });
    return btOverviewFromText(String(data || ''));
  } catch { return null; }
}

/** فیلدهای تکمیلی رسمی (EPS/PE/nav/شناوری/آستانه‌ها) برای یک نماد */
export async function fetchInstrumentInfo(insCode) {
  if (!insCode) return null;
  const key = `info:${insCode}`;
  const cached = memo(key, 10 * 60_000, null);
  if (cached) return cached;
  try {
    let data;
    try { ({ data } = await fetchSmart(`/api/info/${encodeURIComponent(insCode)}`, { maxRoutes: 1 })); }
    catch { ({ data } = await fetchSmart(`${CFG.cdnBase}Instrument/GetInstrumentInfo/${insCode}`)); }
    const o = data?.info || data?.instrumentInfo || data?.instrument || data?.staticInfo || data;
    if (o && typeof o === 'object') cache.set(key, { t: Date.now(), v: o });
    return o || null;
  } catch { return null; }
}

/* ───────────────── تاریخچه قیمت (OHLCV) ───────────────── */

const HIST_ALIASES = {
  d: ['xDate', 'date', 'd', 'insDate'],
  o: ['priceFirst', 'yValAdjustPz0', 'yValOpen', 'open', 'o', 'pFirst'],
  h: ['priceMax', 'yValAdjustPh0', 'yValHigh', 'high', 'h', 'pMax', 'priceHigh'],
  l: ['priceMin', 'yValAdjustPmin0', 'yValLow', 'low', 'l', 'pMin', 'priceLow'],
  c: ['pClosing', 'yValAdjustPc0', 'yValClosing', 'pc', 'close', 'c', 'pClose', 'closingPrice'],
  p: ['pDrCotVal', 'yValAdjustPl0', 'yValLast', 'pl', 'last'],
  // قرارداد CDN تأییدشده: qTotTran5J=حجم، qTotCap=ارزش (برعکس نگاشت قدیمی).
  v: ['qTotTran5J', 'volume', 'v', 'vol'],
  val: ['qTotCap', 'value', 'val', 'valAlife', 'tval'],
};

const pickAny = (o, keys) => {
  for (const k of keys) {
    const v = o?.[k];
    if (v !== undefined && v !== null && v !== '') return Number(String(v).replace(/,/g, ''));
  }
  return NaN;
};

/** آرایه خام تاریخچه → سری کندل صعودی */
export function normalizeHistory(payload) {
  const arr = extractArray(payload);
  const rows = arr.map(o => ({
    d: pickAny(o, HIST_ALIASES.d),
    o: pickAny(o, HIST_ALIASES.o),
    h: pickAny(o, HIST_ALIASES.h),
    l: pickAny(o, HIST_ALIASES.l),
    c: pickAny(o, HIST_ALIASES.c),
    p: pickAny(o, HIST_ALIASES.p),
    v: pickAny(o, HIST_ALIASES.v),
    val: pickAny(o, HIST_ALIASES.val),
  })).filter(r => Number.isFinite(r.c) && r.c > 0);

  rows.sort((a, b) => (a.d || 0) - (b.d || 0));
  // CDN روزهای توقف را با OHLC صفر و close تکراری می‌فرستد؛ کندل جعلی وارد اندیکاتور نمی‌شود.
  const live = rows.filter(r => Number.isFinite(r.v) && r.v > 0 && Number.isFinite(r.val) && r.val > 0 &&
    Number.isFinite(r.o) && r.o > 0 && Number.isFinite(r.h) && r.h > 0 && Number.isFinite(r.l) && r.l > 0);
  const base = live.map(r => ({
    d: r.d,
    o: Number.isFinite(r.o) ? r.o : r.c,
    h: Number.isFinite(r.h) ? Math.max(r.h, r.c) : r.c,
    l: Number.isFinite(r.l) ? Math.min(r.l, r.c) : r.c,
    c: r.c, v: Number.isFinite(r.v) ? r.v : 0, val: Number.isFinite(r.val) ? r.val : 0,
  }));
  return base;
}

/** تاریخچه یک نماد؛ در حالت آفلاین از `history` اسنپ‌شات خوانده می‌شود */
export async function fetchHistory(inst, snapshotMeta) {
  if (inst.history) return toSeries(inst.history).bars;
  if (snapshotMeta?.histories?.[inst.l18]) return snapshotMeta.histories[inst.l18];

  const key = `hist:${inst.insCode || inst.l18}`;
  const cached = memo(key, 30 * 60_000, null);
  if (cached) return cached;

  /* هر ورودی: [url, parser, options] — parser خروجی خام را به کندل تبدیل می‌کند */
  const attempts = [];
  if (inst.insCode) {
    attempts.push([`/api/history?insCode=${encodeURIComponent(inst.insCode)}&days=${CFG.historyDays}`,
      d => (Array.isArray(d?.bars) ? d.bars : normalizeHistory(d)), { maxRoutes: 1 }]);
    // تاریخچهٔ تعدیل‌شدهٔ رسمی TSETMC (قالب CSV)
    attempts.push([`https://members.tsetmc.com/tsev2/chart/data/Financial.aspx?i=${encodeURIComponent(inst.insCode)}&t=ph&a=1`,
      d => parseChartCsv(String(d || '')), { timeout: CFG.directTimeout, maxRoutes: 2 }]);
    // اندپوینت قدیمی CDN (JSON)
    attempts.push([`${CFG.cdnBase}ClosingPrice/GetClosingPriceDailyList/${encodeURIComponent(inst.insCode)}/${CFG.historyDays}`,
      d => normalizeHistory(d?.closingPriceDaily || d), { timeout: CFG.directTimeout, maxRoutes: 2 }]);
  }
  attempts.push([`/api/history?l18=${encodeURIComponent(inst.l18)}&days=${CFG.historyDays}`,
    d => (Array.isArray(d?.bars) ? d.bars : normalizeHistory(d)), { maxRoutes: 1 }]);

  for (const [u, parse, opts] of attempts) {
    try {
      const { data } = await fetchSmart(u, { tag: 'history', ...opts });
      const bars = parse(data);
      if (bars.length >= 20) { cache.set(key, { t: Date.now(), v: bars }); return bars; }
    } catch { /* منبع بعدی */ }
  }
  return null;
}

/** خواندن اسنپ‌شات آفلاین — برای نخستین رندر (بدون معطل‌ماندن روی شبکه) */
export async function loadOfflineSnapshot() {
  try {
    const res = await fetch('data/offline-snapshot.json');
    if (!res.ok) return null;
    const snap = await res.json();
    const rows = (snap.instruments || []).map(r => ({ ...r, provenance: r.provenance || 'offline' }));
    const kind = snap.data_kind || (snap.simulated_fields ? 'simulated' : 'live-partial');
    return { instruments: normalizeAll(rows), source: `اسنپ‌شات محلی (${snap.as_of || '—'})`,
      kind, live: false, snapshotMeta: snap, simulatedFields: snap.simulated_fields || null };
  } catch { return null; }
}

/** بارگذاری کامل: اسنپ‌شات + تاریخچه نمادهای منتخب (برای ستون‌های تکنیکال واقعی) */
export async function loadMarket({ historyFor = 0, concurrency = 6, onProgress } = {}) {
  const snap = await fetchMarketSnapshot();
  let insts = normalizeAll(snap.rows);

  /* اگر رکورد آفلاین history داشت، همان کافی است */
  const rawBySymbol = new Map((snap.rows || []).map(r => [String(r.l18 ?? r.symbol ?? ''), r]));
  for (const it of insts) {
    const raw = rawBySymbol.get(it.l18);
    if (raw?.history && !it.history) it.history = expandHistory(raw.history);
  }

  if (historyFor > 0 && snap.live) {
    const need = insts.filter(i => !i.history)
      .sort((a, b) => (b.tval || 0) - (a.tval || 0)).slice(0, historyFor);
    let done = 0;
    await mapLimit(need, concurrency, async inst => {
      const bars = await fetchHistory(inst, snap.snapshotMeta);
      if (bars) inst.history = bars.map(b => ({ ...b }));
      done++; onProgress?.(done, need.length, inst.l18);
    });
  }

  return { instruments: insts, ...snap };
}

/* ───────────────── تنظیمات کلید/منبع (بدون هاردکد در ریپو) ───────────────── */

export function loadConfigFromStorage() {
  try {
    const raw = localStorage.getItem('tabloradar.cfg');
    if (!raw) return {};
    const o = JSON.parse(raw);
    if (Number.isFinite(o.refreshSec)) CFG.refreshSec = o.refreshSec;
    if (Number.isFinite(o.historyDays)) CFG.historyDays = o.historyDays;
    return o;
  } catch { return {}; }
}

export function saveConfig(patch) {
  Object.assign(CFG, patch);
  try {
    localStorage.setItem('tabloradar.cfg', JSON.stringify({
      refreshSec: CFG.refreshSec, historyDays: CFG.historyDays,
    }));
  } catch { /* حالت خصوصی مرورگر */ }
}

export { normalizeInstrument, normalizeAll };
