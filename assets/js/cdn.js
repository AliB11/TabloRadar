/**
 * cdn.js — کلاینت زندهٔ CDN رسمی TSETMC (cdn.tsetmc.com)
 *
 * یافتهٔ کلیدی معماری (تأییدشده با پاسخ واقعی، ۱۴۰۵/۰۸/۰۳): سه endpoint رسمی CDN
 * هدر `Access-Control-Allow-Origin: *` می‌فرستند — یعنی مرورگر **بدون سرور و بدون
 * پروکسی** می‌تواند مستقیم بخواند:
 *
 *   ۱) /api/Instrument/GetInstrumentInfo/{insCode}          شناسنامه (EPS، صنعت، آستانه، ۵۲هفته، شناوری)
 *   ۲) /api/ClosingPrice/GetClosingPriceDailyList/{insCode}/{days}   تاریخچهٔ روزانهٔ خام
 *   ۳) /api/BestLimits/{insCode}                             دفتر سفارش ۵ سطحی زنده
 *
 * نکتهٔ قرارداد: CDN endpoint «فهرست کل بازار» ندارد (مسیرهای /api/MarketWatch/* فقط
 * صفحهٔ SPA را برمی‌گردانند). فهرست نماد↔شناسه از `data/seed-symbols.json` می‌آید که
 * با `node tools/build_seed.mjs` از MarketWatchInit رسمی ساخته می‌شود، و در اجراهای
 * موفقِ زنده با کش `localStorage` (کتابخانهٔ شناسه‌ها) تکمیل می‌گردد.
 *
 * قاعدهٔ طلایی حفظ می‌شود: هیچ عددی ساخته نمی‌شود؛ فیلد غایب همان‌جا غایب می‌ماند.
 * قرارداد فیلدها: docs/TSETMC_CDN_CONTRACT.md
 */

export const CDN_BASE = 'https://cdn.tsetmc.com/api/';
export const CDN_TIMEOUT = 9000;

/* ───────────────── کش در حافظه + ابزار شبکه ───────────────── */

const memCache = new Map();

function cacheGet(key, ttl) {
  const hit = memCache.get(key);
  return hit && Date.now() - hit.t < ttl ? hit.v : null;
}
function cacheSet(key, v) { memCache.set(key, { t: Date.now(), v }); }

const toNum = v => {
  if (v === null || v === undefined || v === '') return NaN;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[,٬\s]/g, ''));
  return Number.isFinite(n) ? n : NaN;
};

/** یک GET به CDN؛ خطاها fail-soft بالا می‌روند تا لایهٔ صداکننده تصمیم بگیرد */
export async function cdnFetch(path, { timeout = CDN_TIMEOUT } = {}) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(CDN_BASE + path, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json, text/plain, */*' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally { clearTimeout(to); }
}

/* ───────────────── ۱) شناسنامهٔ رسمی نماد ───────────────── */

/**
 * GetInstrumentInfo → مدل تمیز. epsValue=null یعنی «پیش‌بینی فعال نیست»، نه صفر.
 * @returns {{eps, estimatedEPS, sectorPE, psr, sectorName, sectorId, tmax, tmin,
 *            minWeek, maxWeek, minYear, maxYear, avgVol30, baseVol, nav, freeFloatPct,
 *            totalShares, marketTitle, boardTitle, flow, isin, l30, l18, underSupervision}|null}
 */
export async function cdnInfo(insCode, { ttl = 10 * 60_000 } = {}) {
  const key = `info:${insCode}`;
  const hit = cacheGet(key, ttl);
  if (hit !== null) return hit;
  const r = await cdnFetch(`Instrument/GetInstrumentInfo/${encodeURIComponent(insCode)}`);
  const out = mapInstrumentInfo(r);
  cacheSet(key, out);
  return out;
}

/** پارسر خالص شناسنامه (آزمون‌پذیر روی فیکسچر واقعی) */
export function mapInstrumentInfo(resp) {
  const o = resp?.instrumentInfo || resp;
  if (!o || typeof o !== 'object') return null;
  const out = {
    eps: toNum(o.eps?.epsValue),
    estimatedEPS: toNum(o.eps?.estimatedEPS),
    sectorPE: toNum(o.eps?.sectorPE),
    psr: toNum(o.eps?.psr),
    sectorName: (o.sector?.lSecVal || '').trim() || undefined,
    sectorId: toNum(o.sector?.cSecVal),
    tmax: toNum(o.staticThreshold?.psGelStaMax),
    tmin: toNum(o.staticThreshold?.psGelStaMin),
    minWeek: toNum(o.minWeek), maxWeek: toNum(o.maxWeek),
    minYear: toNum(o.minYear), maxYear: toNum(o.maxYear),
    avgVol30: toNum(o.qTotTran5JAvg),
    baseVol: toNum(o.baseVol),
    nav: toNum(o.nav),
    freeFloatPct: toNum(o.kAjCapValCpsIdx),
    totalShares: toNum(o.zTitad),
    marketTitle: (o.flowTitle || '').trim() || undefined,
    boardTitle: (o.cgrValCotTitle || '').trim() || undefined,
    flow: toNum(o.flow),
    isin: o.cIsin || undefined,
    l30: (o.lVal30 || '').trim() || undefined,
    l18: (o.lVal18AFC || '').trim() || undefined,
    underSupervision: toNum(o.underSupervision),
  };
  return out;
}

/* ───────────────── ۲) تاریخچهٔ روزانهٔ خام ───────────────── */

/**
 * GetClosingPriceDailyList → کندل‌های {d,o,h,l,c,p,v,val} صعودی.
 * قرارداد: O/H/L/C = priceFirst/priceMax/priceMin/pClosing، آخرین = pDrCotVal،
 * حجم = qTotTran5J، ارزش = qTotCap، تعداد = zTotTran. روزهای بدون معامله (همه صفر)
 * حذف می‌شوند تا کندل جعلی وارد اندیکاتور نشود.
 */
export async function cdnDailyBars(insCode, days = 260, { ttl = 20 * 60_000 } = {}) {
  const key = `daily:${insCode}:${days}`;
  const hit = cacheGet(key, ttl);
  if (hit !== null) return hit;
  const r = await cdnFetch(`ClosingPrice/GetClosingPriceDailyList/${encodeURIComponent(insCode)}/${days}`);
  const bars = mapDailyList(r);
  cacheSet(key, bars);
  return bars;
}

/** پارسر خالص تاریخچهٔ روزانه (آزمون‌پذیر روی فیکسچر واقعی) */
export function mapDailyList(resp) {
  const arr = resp?.closingPriceDaily || resp || [];
  return (Array.isArray(arr) ? arr : [])
    .map(x => ({
      d: toNum(x.dEven), o: toNum(x.priceFirst), h: toNum(x.priceMax), l: toNum(x.priceMin),
      c: toNum(x.pClosing), p: toNum(x.pDrCotVal), v: toNum(x.qTotTran5J), val: toNum(x.qTotCap),
      tno: toNum(x.zTotTran), pyRef: toNum(x.priceYesterday),
    }))
    .filter(b => b.c > 0 && b.v > 0 && b.val > 0 && b.o > 0 && b.h > 0 && b.l > 0)
    .sort((a, b) => a.d - b.d);
}

/**
 * آخرین سطر روزانه به‌صورت رکورد خام سازگار با normalizeInstrument (برای اسکن بذری).
 * pClosing = میانگین وزنی پایانی، pDrCotVal = آخرین معامله، priceYesterday = پایانی دیروز.
 */
export function dailyRowToRaw(sym, b) {
  if (!b) return null;
  return {
    insCode: String(sym.i),
    l18: sym.s, l30: sym.n || sym.s, cs: sym.g || '—',
    cgrValCotTitle: `${sym.b || 'بازار اول'} ${sym.m || ''}`.trim(),
    flowTitle: sym.m || '',
    py: toNum(b.pyRef || b.c),                   // priceYesterday رسمی همان سطر
    pc: toNum(b.pClosing),
    pl: toNum(b.p > 0 ? b.p : b.c),
    pf: toNum(b.o), pmin: toNum(b.l), pmax: toNum(b.h),
    tvol: toNum(b.v), tval: toNum(b.val), tno: toNum(b.tno),
    provenance: 'tsetmc-cdn', synthetic: false,
    lastSession: b.d != null && Number.isFinite(b.d) ? String(b.d) : '',   // 'YYYYMMDD' رشته‌ای
  };
}

/* ───────────────── ۳) دفتر سفارش زنده (۵ سطح) ───────────────── */

/**
 * BestLimits → book در شکل موتور: [{i, bid:{p,q,n}, ask:{p,q,n}}, …]
 * تقاضا: qTitMeDem(حجم)/zOrdMeDem(تعداد سفارش)/pMeDem(قیمت) — عرضه به‌مثابهٔ Of.
 */
export async function cdnBook(insCode, { ttl = 25_000 } = {}) {
  const key = `book:${insCode}`;
  const hit = cacheGet(key, ttl);
  if (hit !== null) return hit;
  const r = await cdnFetch(`BestLimits/${encodeURIComponent(insCode)}`);
  const book = mapBestLimits(r);
  if (book.length) cacheSet(key, book);
  return book;
}

/** پارسر خالص دفتر سفارش (آزمون‌پذیر روی فیکسچر واقعی) */
export function mapBestLimits(resp) {
  const arr = resp?.bestLimits || [];
  return (Array.isArray(arr) ? arr : [])
    .filter(x => toNum(x.number) >= 1 && toNum(x.number) <= 5)
    .map(x => ({
      i: toNum(x.number),
      bid: { p: toNum(x.pMeDem), q: toNum(x.qTitMeDem), n: toNum(x.zOrdMeDem) },
      ask: { p: toNum(x.pMeOf), q: toNum(x.qTitMeOf), n: toNum(x.zOrdMeOf) },
    }))
    .filter(l => (l.bid.p > 0 && l.bid.q > 0) || (l.ask.p > 0 && l.ask.q > 0))
    .sort((a, b) => a.i - b.i);
}

/* ───────────────── ۴) کتابخانهٔ شناسه‌ها (خودآموز) ───────────────── */

const CODEMAP_KEY = 'tr.codemap.v1';

export function loadCodemap() {
  try {
    const o = JSON.parse(localStorage.getItem(CODEMAP_KEY) || '{}');
    return o && typeof o === 'object' ? o : {};
  } catch { return {}; }
}

/** پس از هر اسکن بازار موفق، نگاشت نماد→شناسه برای نمادهای پرگردش ذخیره می‌شود */
export function saveCodemap(insts, max = 1200) {
  try {
    const cur = loadCodemap();
    const sorted = [...insts]
      .filter(i => i.l18 && i.insCode)
      .sort((a, b) => (b.tval || 0) - (a.tval || 0))
      .slice(0, max);
    for (const i of sorted) cur[i.l18] = i.insCode;
    localStorage.setItem(CODEMAP_KEY, JSON.stringify(cur));
  } catch { /* حالت خصوصی مرورگر */ }
}

/** ادغام فایل بذری + کتابخانهٔ خودآموز → [{i,s,n,g,m,b}] بدون تکرار */
export function mergeSeedWithCodemap(seedSymbols, codemap) {
  const seen = new Set(seedSymbols.map(x => x.s));
  const out = [...seedSymbols];
  for (const [l18, insCode] of Object.entries(codemap || {})) {
    if (seen.has(l18)) continue;
    out.push({ i: String(insCode), s: l18, n: l18, g: '—', m: '', b: '' });
    seen.add(l18);
  }
  return out;
}

/* ───────────────── ۵) اسکن بذری CDN — سنگر میانی زنده ───────────────── */

/** اجرای هم‌زمان محدود؛ مستقل از data.js تا حلقهٔ import ساخته نشود */
async function mapLimit(arr, n, fn) {
  const out = new Array(arr.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, arr.length)) }, async () => {
    while (i < arr.length) { const k = i++; out[k] = await fn(arr[k], k); }
  }));
  return out;
}

/**
 * اسکن بذری: برای هر نمادِ فایل بذری یک درخواست DailyList(days=1) و ساخت ردیف خام.
 * خروجی برای normalizeAll آماده است؛ ۱۰۰٪ واقعی از CDN، با پوشش جزئی (پوشش صادقانه).
 * @returns {Promise<{rows:Array, asOf:string, ok:number, failed:number, lastSession:string}>}
 */
export async function cdnSeedScan({
  seedSymbols, codemap = {},
  concurrency = 10, onProgress, maxSymbols = 500,
} = {}) {
  const universe = mergeSeedWithCodemap(seedSymbols, codemap).slice(0, maxSymbols);
  let ok = 0, failed = 0, done = 0;
  let lastSession = '';
  const rows = await mapLimit(universe, concurrency, async sym => {
    let raw = null;
    try {
      const bars = await cdnDailyBars(sym.i, 1, { ttl: 45_000 });
      raw = dailyRowToRaw(sym, bars[bars.length - 1]);
      if (raw) {
        ok++;
        // مقایسهٔ لغوی امن روی رشتهٔ 'YYYYMMDD' (عرض ثابت)
        if (raw.lastSession && raw.lastSession > (lastSession || '')) lastSession = raw.lastSession;
      } else failed++;
    } catch { failed++; }
    done++;
    if (done % 25 === 0 || done === universe.length) onProgress?.(done, universe.length, ok, failed);
    return raw;
  });
  return {
    rows: rows.filter(Boolean),
    asOf: lastSession ? `${lastSession.slice(0, 4)}/${lastSession.slice(4, 6)}/${lastSession.slice(6)}` : '',
    ok, failed, lastSession,
  };
}

/* ───────────────── ۶) غنی‌سازی نماد (شناسنامه + دفتر سفارش) ───────────────── */

/**
 * ادغام شناسنامهٔ رسمی CDN روی نماد نرمال‌شده — فقط جاهای خالی را پر می‌کند
 * (دادهٔ زندهٔ تابلو اولویت دارد؛ CDN مرجع شناسنامه و آستانه‌هاست).
 */
export function applyCdnInfo(inst, info) {
  if (!inst || !info) return false;
  let touched = false;
  const fill = (key, v) => {
    if (!Number.isFinite(v)) return;
    if (!Number.isFinite(inst[key])) { inst[key] = v; touched = true; }
  };
  /* آستانهٔ مجاز رسمی مرجع قطعی است (شامل استثناهای ناظر) — روی مقدار برآوردشده می‌نشیند */
  if (info.tmax > 0 && info.tmin > 0) {
    if (Math.abs((inst.tmax ?? 0) - info.tmax) > 0.5) { inst.tmax = info.tmax; touched = true; }
    if (Math.abs((inst.tmin ?? 0) - info.tmin) > 0.5) { inst.tmin = info.tmin; touched = true; }
  }
  fill('eps', info.eps > 0 ? info.eps : info.estimatedEPS);
  fill('sectorPE', info.sectorPE);
  fill('psr', info.psr);
  fill('minWeek', info.minWeek); fill('maxWeek', info.maxWeek);
  fill('minYear', info.minYear); fill('maxYear', info.maxYear);
  fill('avgVal', info.avgVol30);
  fill('baseVol', info.baseVol);
  fill('nav', info.nav);
  fill('freeFloat', info.freeFloatPct);
  fill('zTitad', info.totalShares);
  if (!Number.isFinite(inst.pe) && Number.isFinite(inst.pl) && Number.isFinite(inst.eps) && inst.eps > 0) {
    inst.pe = inst.pl / inst.eps; touched = true;
  }
  if (!touched && !inst.cdnAt) touched = true;     // حتی بدون فیلد جدید، منبع ثبت شود
  inst.cdnAt = new Date().toISOString();
  inst.cdnSector = info.sectorName || inst.cdnSector;
  /* برچسب صادقانه EPS: فقط وقتی مقدار واقعی داریم؛ epsValue=null یعنی «برآوردی» */
  const epsUsed = Number.isFinite(info.eps) && info.eps > 0 ? info.eps
    : Number.isFinite(info.estimatedEPS) && info.estimatedEPS > 0 ? info.estimatedEPS : NaN;
  if (Number.isFinite(epsUsed)) inst.estimatedEps = !(info.eps > 0);
  return touched;
}

/** جایگزینی دفتر سفارش با دفتر زندهٔ CDN (اگر واقعی و غیرخالی باشد) */
export function applyCdnBook(inst, book) {
  if (!inst || !Array.isArray(book) || !book.length) return false;
  inst.book = book;
  inst.bookSource = 'cdn';
  inst.bookAt = new Date().toISOString();
  return true;
}

/** پرچم تازگی سطر بذری: آیا آخرین جلسهٔ گزارش‌شده امروز تهران است؟ */
export function sessionIsToday(lastSession /* YYYYMMDD */, now = new Date()) {
  if (!lastSession) return false;
  const fa = new Intl.DateTimeFormat('en-CA', {      // en-CA: فرمت YYYY-MM-DD تضمین‌شده
    timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
  const today = fa.replaceAll('-', '');
  return lastSession === today;
}
