/**
 * engine.js — موتور تحلیل و سیگنال‌دهی تابلورادار
 *
 * سه لایه:
 *   ۱) instrumentMetrics() — سنجه‌های خُردساختار بازار ایران (صف، سرانه، پول حقیقی،
 *      کد‌به‌کد، فاصله تا سقف مجاز، OBI، حجم مشکوک، P/E نسبی)
 *   ۲) vetoCheck()         — فیلترهای وتوکننده (توقف، نقدشوندگی، صف فروش قفل، بازار پایه)
 *   ۳) scoreInstrument()   — امتیاز چندعاملی ۰..۱۰۰ + ضریب اطمینان + درجه سیگنال
 *
 * اصل طراحی: **هیچ عدد ساختگی در امتیاز دخالت ندارد.** اگر داده‌ای موجود نباشد،
 * آن عامل `null` می‌شود، پوشش (coverage) و در نتیجه ضریب اطمینان کاهش می‌یابد.
 */

import { limitPctOf, fmtNum, expandHistory } from './tse.js';
import {
  sma, ema, rsi, macd, bollinger, atr, returns, slope, annualizedVol,
  rangePosition, maxDrawdown, toSeries,
} from './indicators.js';

/* ───────────────────────── پیکربندی پیش‌فرض ───────────────────────── */

export const DEFAULT_WEIGHTS = { tablo: 30, short: 20, mid: 20, long: 15, risk: 15 };

export const FACTOR_META = [
  { key: 'tablo', fa: 'تابلو و جریان پول', color: '#16e08c',
    desc: 'سرانه خرید/فروش، قدرت خریدار، پول حقیقی خالص، کد‌به‌کد، عدم تعادل دفتر سفارش، حجم مشکوک' },
  { key: 'short', fa: 'افق کوتاه‌مدت', color: '#4cc9ff',
    desc: 'RSI، تقاطع EMA(9/21)، موقعیت قیمت در بازه روز، مومنتوم ۵ روزه، ظرفیت رشد تا سقف مجاز' },
  { key: 'mid', fa: 'افق میان‌مدت', color: '#9b8cff',
    desc: 'تقاطع SMA(20/50)، هیستوگرام MACD، تثبیت بالای میانگین ۲۰، شیب روند' },
  { key: 'long', fa: 'افق بلندمدت و بنیادی', color: '#ffc14d',
    desc: 'موقعیت نسبت به SMA(200)، شیب سالانه، P/E در برابر میانگین صنعت، نقدشوندگی ساختاری' },
  { key: 'risk', fa: 'ریسک و ایمنی معامله', color: '#ff5470',
    desc: 'نقدشوندگی روز، ریسک قفل صف، شناوری آزاد، نوسان در برابر دامنه مجاز' },
];

export const DEFAULT_RULES = {
  minValue: 50e9,          // حداقل ارزش معاملات روز (ریال)
  includeBase: false,      // ورود نمادهای بازار پایه
  includeFunds: false,     // ورود صندوق‌ها
  includeRights: false,    // ورود حق‌تقدم
  requireHistory: false,   // وتوی نمادهای بدون تاریخچه
  minFloat: 0,             // حداقل سهام شناور آزاد (٪)
  pePenalty: 2.5,          // P/E بیش از این ضریب میانگین صنعت → جریمه ریسک
  minOrderValue: 5e6,      // حداقل ارزش سفارش برخط (ریال) — قابل تنظیم توسط کاربر
};

export const VETO_META = [
  { code: 'liq',      fa: 'نقدشوندگی ناکافی', icon: 'coins',
    detail: 'ارزش معاملات روز کمتر از آستانه؛ خروج از پوزیشن پرهزینه است.' },
  { code: 'sellQueue', fa: 'صف فروش قفل', icon: 'lock',
    detail: 'قیمت در کف مجاز با صف فروش و نبود تقاضا؛ ریسک گیرافتادن.' },
  { code: 'state',    fa: 'توقف / ممنوعیت', icon: 'shield-x',
    detail: 'نماد متوقف، ناظر یا ممنوع‌المعامله است.' },
  { code: 'universe', fa: 'خارج از دامنه اسکن', icon: 'filter',
    detail: 'صندوق، اوراق، حق‌تقدم یا بازار پایه (طبق تنظیمات شما).' },
  { code: 'data',     fa: 'داده ناکافی', icon: 'database-zap',
    detail: 'قیمت یا داده تابلو ناقص است؛ امتیازدهی معتبر ممکن نیست.' },
];

/* ───────────────────────── ابزار ریاضی ───────────────────────── */

const clamp = (v, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, v));
const sig = (x, mid, k) => 100 / (1 + Math.exp(-k * (x - mid)));
const has = v => Number.isFinite(v);

/** ترکیب وزنی فقط روی عوامل موجود؛ اگر همه null باشند → null */
function weighted(parts) {
  let sw = 0, sx = 0;
  for (const { v, w } of parts) {
    if (!has(v)) continue;
    sw += w; sx += w * v;
  }
  return sw > 0 ? sx / sw : null;
}

const round = (v, d = 1) => has(v) ? +v.toFixed(d) : null;

/* ───────────────────── ۱. سنجه‌های خُردساختار ایران ───────────────────── */

/**
 * @param {object} inst — Instrument نرمال‌شده (از tse.normalizeInstrument)
 * @param {{bars?:Array}} [ctx]
 */
export function instrumentMetrics(inst, ctx = {}) {
  const m = {};
  const { pc, pl, py, pf, pmin, pmax, tmin, tmax, tvol, tval } = inst;

  /* قیمت میانگین وزنی روز — مرجع ارزش‌گذاری جریان پول */
  m.vwap = has(tval) && has(tvol) && tvol > 0 ? tval / tvol : (has(pl) ? pl : NaN);

  /* تغییرات: در ایران هم «آخرین نسبت به پایانی» و هم «پایانی نسبت به دیروز» معنا دارد */
  m.chgLast = has(pl) && has(pc) && pc ? ((pl - pc) / pc) * 100 : NaN;
  m.chgClose = has(pc) && has(py) && py ? ((pc - py) / py) * 100 : NaN;
  m.chgOpen = has(pf) && has(pc) && pc ? ((pf - pc) / pc) * 100 : NaN;

  /* دامنه مجاز و فاصله تا سقف/کف — قلب برنامه‌ریزی معامله در بازار ۳ درصدی */
  m.limitPct = limitPctOf(inst);
  m.gapToUp = has(pl) && has(tmax) && pl ? ((tmax - pl) / pl) * 100 : NaN;
  m.gapToDown = has(pl) && has(tmin) && pl ? ((pl - tmin) / pl) * 100 : NaN;
  m.capacity = has(m.gapToUp) && m.limitPct ? clamp(m.gapToUp / (m.limitPct * 100), 0, 1) : NaN;
  m.atLimitUp = has(tmax) && has(pl) && pl >= tmax * 0.999;
  m.atLimitDown = has(tmin) && has(pl) && pl <= tmin * 1.001;
  m.dayRangePos = has(pl) && has(pmin) && has(pmax) && pmax > pmin ? (pl - pmin) / (pmax - pmin) : NaN;

  /* ── صف خرید / صف فروش (از دفتر سفارش ۵ سطحی) ── */
  let buyQ = 0, sellQ = 0, bidVol = 0, askVol = 0;
  for (const lv of inst.book || []) {
    if (has(lv.bid.q)) {
      bidVol += lv.bid.q;
      if (has(tmax) && has(lv.bid.p) && lv.bid.p >= tmax * 0.999) buyQ += lv.bid.q;
    }
    if (has(lv.ask.q)) {
      askVol += lv.ask.q;
      if (has(tmin) && has(lv.ask.p) && lv.ask.p <= tmin * 1.001) sellQ += lv.ask.q;
    }
  }
  /* اگر داده صف قیمتی نبود ولی قیمت در سقف/کف است، سطح اول را صف فرض می‌کنیم */
  if (!buyQ && m.atLimitUp && inst.book?.[0] && has(inst.book[0].bid.q)) buyQ = inst.book[0].bid.q;
  if (!sellQ && m.atLimitDown && inst.book?.[0] && has(inst.book[0].ask.q)) sellQ = inst.book[0].ask.q;

  m.buyQueue = buyQ;
  m.sellQueue = sellQ;
  m.buyQueueValue = has(tmax) ? buyQ * tmax : NaN;
  m.sellQueueValue = has(tmin) ? sellQ * tmin : NaN;
  m.queueRatio = has(tval) && tval > 0 && has(m.buyQueueValue)
    ? (m.buyQueueValue - (m.sellQueueValue || 0)) / tval : NaN;
  m.sellQueueLocked = m.atLimitDown && sellQ > 0 && bidVol === 0;
  m.buyQueueLocked = m.atLimitUp && buyQ > 0 && askVol === 0;

  /* عدم تعادل دفتر سفارش (OBI) */
  m.obi = (bidVol + askVol) > 0 ? (bidVol - askVol) / (bidVol + askVol) : NaN;
  m.bidVol = bidVol; m.askVol = askVol;

  /* ── حقیقی / حقوقی: سرانه، قدرت خریدار، پول هوشمند ── */
  const { buyIVol, buyICount, sellIVol, sellICount, buyNVol, buyNCount, sellNVol, sellNCount } = inst;
  const px = m.vwap;

  m.sarBuy = has(buyIVol) && has(buyICount) && buyICount > 0 && has(px) ? (buyIVol / buyICount) * px : NaN;
  m.sarSell = has(sellIVol) && has(sellICount) && sellICount > 0 && has(px) ? (sellIVol / sellICount) * px : NaN;
  m.buyerPower = has(m.sarBuy) && has(m.sarSell) && m.sarSell > 0 ? m.sarBuy / m.sarSell : NaN;

  m.netRealMoney = has(buyIVol) && has(sellIVol) && has(px) ? (buyIVol - sellIVol) * px : NaN;
  m.netRealShare = has(m.netRealMoney) && has(tval) && tval > 0 ? m.netRealMoney / tval : NaN;

  const totalBuyVol = (has(buyIVol) ? buyIVol : 0) + (has(buyNVol) ? buyNVol : 0);
  const totalSellVol = (has(sellIVol) ? sellIVol : 0) + (has(sellNVol) ? sellNVol : 0);
  m.realBuyShare = totalBuyVol > 0 && has(buyIVol) ? buyIVol / totalBuyVol : NaN;
  m.legalBuyShare = totalBuyVol > 0 && has(buyNVol) ? buyNVol / totalBuyVol : NaN;
  m.realSellShare = totalSellVol > 0 && has(sellIVol) ? sellIVol / totalSellVol : NaN;
  m.legalSellShare = totalSellVol > 0 && has(sellNVol) ? sellNVol / totalSellVol : NaN;

  /* ── کد به کد (heuristic بر پایه تقارن حجم حقوقی/حقیقی) ── */
  m.k2k = classifyK2K(m);

  /* ── حجم مشکوک: نسبت به میانگین ۳۰ روزه ── */
  const hist = Array.isArray(inst.history) ? inst.history : expandHistory(inst.history);
  const bars = ctx.bars || (hist ? toSeries(hist).bars : null);
  m.bars = bars || null;
  const vols = bars ? toSeries(bars).volumes.filter(Number.isFinite) : [];
  const maVol30 = vols.length >= 30 ? vols.slice(-30).reduce((a, b) => a + b, 0) / 30 : NaN;
  if (has(tvol) && has(maVol30) && maVol30 > 0) m.volumeShock = tvol / maVol30;
  else if (has(tvol) && has(inst.avgVal) && inst.avgVal > 0 && has(px) && px > 0) {
    /* جایگزین معتبر: میانگین ارزش معاملات (qTotTran5JAvg) تقسیم بر قیمت میانگین امروز */
    m.volumeShock = tvol / (inst.avgVal / px);
    m.volumeShockSource = 'avgVal';
  } else m.volumeShock = NaN;

  /* ── نقدشوندگی و ساختار ── */
  m.turnover = has(tval) && has(inst.marketValue) && inst.marketValue > 0
    ? tval / inst.marketValue : NaN;
  m.avgBuyCount = has(buyICount) && has(buyNCount) ? buyICount + buyNCount : NaN;
  m.peRatio = has(inst.pe) && inst.pe > 0 ? inst.pe
    : (has(inst.eps) && inst.eps > 0 && has(pl) ? pl / inst.eps : NaN);
  m.peVsSector = has(m.peRatio) && has(inst.sectorPE) && inst.sectorPE > 0
    ? m.peRatio / inst.sectorPE : NaN;
  m.freeFloat = has(inst.freeFloat) ? inst.freeFloat : NaN;

  /* ── تکنیکال روی تاریخچه واقعی ── */
  const closes = bars ? toSeries(bars).closes : [];
  const withLive = has(pl) && closes.length && Math.abs(closes[closes.length - 1] - pl) / pl > 0.005
    ? [...closes, pl] : closes;
  m.hasHistory = withLive.length >= 30;
  if (m.hasHistory) {
    m.rsi = rsi(withLive, 14);
    m.ema9 = ema(withLive, 9);
    m.ema21 = ema(withLive, 21);
    m.sma20 = sma(withLive, 20);
    m.sma50 = sma(withLive, 50);
    m.sma200 = withLive.length >= 200 ? sma(withLive, 200) : NaN;
    m.sma200Prev = withLive.length >= 220 ? sma(withLive.slice(0, -20), 200) : NaN;
    const md = macd(withLive);
    m.macdHist = md.hist; m.macdHistPrev = md.histPrev; m.macd = md.macd; m.macdSignal = md.signal;
    const bb = bollinger(withLive, 20, 2);
    m.bbPctB = bb.pctB; m.bbWidth = bb.width; m.bbMid = bb.mid;
    m.atr = atr(bars, 14);
    m.ret5 = returns(withLive, 5);
    m.ret20 = returns(withLive, 20);
    m.ret60 = returns(withLive, 60);
    m.slope20 = slope(withLive, 20);
    m.vol60 = annualizedVol(withLive);
    m.rangePos60 = rangePosition(withLive, 60);
    m.mdd = maxDrawdown(withLive);
  }

  return m;
}

/**
 * دسته‌بندی کد به کد بر پایه عدم تقارن حقیقی/حقوقی.
 * حقوقی→حقیقی = صعودی (حقوقی می‌فروشد، حقیقی می‌خرد)
 * حقیقی→حقوقی = نزولی
 */
export function classifyK2K(m) {
  const { legalSellShare, realBuyShare, realSellShare, legalBuyShare, volumeShock } = m;
  const strong = !has(volumeShock) || volumeShock >= 1.2;
  if (has(legalSellShare) && has(realBuyShare) && legalSellShare >= 0.25 && realBuyShare >= 0.5 && strong) {
    return { code: 'legal2real', fa: 'کد‌به‌کد حقوقی → حقیقی', bias: +1 };
  }
  if (has(legalBuyShare) && has(realSellShare) && legalBuyShare >= 0.25 && realSellShare >= 0.5 && strong) {
    return { code: 'real2legal', fa: 'کد‌به‌کد حقیقی → حقوقی', bias: -1 };
  }
  if (has(realBuyShare) && has(realSellShare) && realBuyShare >= 0.7 && realSellShare <= 0.25) {
    return { code: 'realCollect', fa: 'جمع‌آوری توسط حقیقی‌ها', bias: +0.5 };
  }
  if (has(realBuyShare) && realBuyShare <= 0.3 && has(realSellShare) && realSellShare >= 0.7) {
    return { code: 'realExit', fa: 'خروج حقیقی‌ها', bias: -0.5 };
  }
  return { code: 'none', fa: 'الگوی خاص شناسایی نشد', bias: 0 };
}

/* ───────────────────── ۲. فیلترهای وتوکننده ───────────────────── */

/**
 * @returns {{vetoed:boolean, codes:string[], fa:string[]}}
 */
export function vetoCheck(inst, m, rules = DEFAULT_RULES) {
  const codes = [], fa = [];
  const push = (c, f) => { codes.push(c); fa.push(f); };

  if (inst.halted || (inst.state && !/مجاز|^$/.test(inst.state))) {
    push('state', `وضعیت: ${inst.state}`);
  }
  const isBase = inst.market === 'پایه';
  const isFund = inst.kind.startsWith('fund');
  const isRight = inst.kind === 'right';
  const isBond = inst.kind === 'bond';
  if ((isBase && !rules.includeBase) || ((isFund || isBond) && !rules.includeFunds) ||
      (isRight && !rules.includeRights) || inst.kind === 'index' || inst.kind === 'other') {
    push('universe', `${inst.kind === 'stock' ? inst.board : inst.kind} · ${inst.cs}`);
  }
  if (has(inst.tval) && inst.tval < rules.minValue) {
    push('liq', `ارزش معاملات ${fmtNum(inst.tval / 1e9, 1)} میلیارد ریال < ${fmtNum(rules.minValue / 1e9, 0)} میلیارد`);
  }
  if (m.sellQueueLocked) push('sellQueue', `صف فروش ${fmtNum(m.sellQueue)} برگه در کف مجاز`);
  if (has(m.freeFloat) && m.freeFloat < rules.minFloat) {
    push('data', `شناوری آزاد ${fmtNum(m.freeFloat, 1)}٪ کمتر از آستانه`);
  }
  if (rules.requireHistory && !m.hasHistory) push('data', 'تاریخچه قیمت موجود نیست');
  if (!has(inst.pl) || inst.pl <= 0) push('data', 'قیمت معتبر دریافت نشد');

  return { vetoed: codes.length > 0, codes, fa };
}

/* ───────────────────── ۳. نمره‌دهی چندعاملی ───────────────────── */

function rsiScore(v) {
  if (!has(v)) return null;
  if (v >= 80) return 25;          // اشباع خرید شدید
  if (v >= 70) return 62;          // مومنتوم قوی اما پرریسک
  if (v >= 55) return 100;         // منطقه طلایی روند
  if (v >= 45) return 78;
  if (v >= 35) return 55;          // خروج از اشباع فروش
  return 40;                       // کف احتمالی، اما بدون تایید
}

export function factorScores(inst, m, rules = DEFAULT_RULES) {
  const f = { detail: {} };

  /* ── تابلو و جریان پول ── */
  const k2kScore = { legal2real: 100, realCollect: 78, none: 50, realExit: 22, real2legal: 5 }[m.k2k?.code] ?? null;
  const tabloParts = [
    { v: has(m.buyerPower) ? sig(m.buyerPower, 1.0, 2.4) : null, w: .30 },
    { v: has(m.netRealShare) ? sig(m.netRealShare, 0, 7) : null, w: .25 },
    { v: has(m.obi) ? sig(m.obi, 0, 5) : null, w: .15 },
    { v: has(m.volumeShock) ? sig(m.volumeShock, 1.5, 1.3) : null, w: .15 },
    { v: k2kScore, w: .15 },
  ];
  f.tablo = weighted(tabloParts);
  f.detail.tablo = {
    buyerPower: m.buyerPower, netRealShare: m.netRealShare, obi: m.obi,
    volumeShock: m.volumeShock, k2k: m.k2k?.fa,
  };

  /* ── کوتاه‌مدت (با اعمال ظرفیت رشد تا سقف مجاز) ── */
  const emaGap = has(m.ema9) && has(m.ema21) && m.ema21 ? (m.ema9 - m.ema21) / m.ema21 * 100 : NaN;
  let shortRaw = weighted([
    { v: rsiScore(m.rsi), w: .30 },
    { v: has(emaGap) ? sig(emaGap, 0, 3.2) : null, w: .25 },
    { v: has(m.dayRangePos) ? m.dayRangePos * 100 : null, w: .15 },
    { v: has(m.ret5) ? sig(m.ret5, 0, .55) : null, w: .30 },
  ]);
  if (has(shortRaw) && has(m.capacity)) shortRaw = shortRaw * (0.55 + 0.45 * m.capacity);
  f.short = has(shortRaw) ? clamp(shortRaw) : null;
  f.detail.short = { rsi: m.rsi, emaGap, dayRangePos: m.dayRangePos, ret5: m.ret5, capacity: m.capacity };

  /* ── میان‌مدت ── */
  const smaGap = has(m.sma20) && has(m.sma50) && m.sma50 ? (m.sma20 - m.sma50) / m.sma50 * 100 : NaN;
  const macdRising = has(m.macdHist) && has(m.macdHistPrev) ? (m.macdHist > m.macdHistPrev ? 1 : 0) : NaN;
  const priceVsSma = has(inst.pl) && has(m.sma20) && m.sma20 ? (inst.pl - m.sma20) / m.sma20 * 100 : NaN;
  f.mid = weighted([
    { v: has(smaGap) ? sig(smaGap, 0, 2.2) : null, w: .30 },
    { v: has(m.macdHist) ? sig(m.macdHist / (inst.pl || 1) * 100, 0, 3.5) : null, w: .25 },
    { v: has(priceVsSma) ? sig(priceVsSma, 0, 1.6) : null, w: .25 },
    { v: has(m.slope20) ? sig(m.slope20, 0, 9) : null, w: .20 },
  ]);
  f.detail.mid = { smaGap, macdHist: m.macdHist, macdRising, priceVsSma, slope20: m.slope20 };

  /* ── بلندمدت و بنیادی ── */
  const vs200 = has(inst.pl) && has(m.sma200) && m.sma200 ? (inst.pl - m.sma200) / m.sma200 * 100 : NaN;
  const slope200 = has(m.sma200) && has(m.sma200Prev) && m.sma200Prev ? (m.sma200 - m.sma200Prev) / m.sma200Prev * 100 : NaN;
  let peScore = null;
  if (has(m.peVsSector)) peScore = m.peVsSector <= 0 ? 40 : clamp(sig(-m.peVsSector, -1, 2.4));
  else if (has(m.peRatio)) peScore = clamp(sig(-m.peRatio, -12, .25));
  f.long = weighted([
    { v: has(vs200) ? sig(vs200, 0, .55) : null, w: .35 },
    { v: has(slope200) ? sig(slope200, 0, 1.2) : null, w: .20 },
    { v: peScore, w: .25 },
    { v: has(m.turnover) ? sig(m.turnover * 100, .4, 2.6) : null, w: .20 },
  ]);
  f.detail.long = { vs200, slope200, pe: m.peRatio, peVsSector: m.peVsSector, turnover: m.turnover };

  /* ── ریسک (۱۰۰ = کم‌ریسک) ── */
  const liqScore = has(inst.tval) ? sig(inst.tval / 1e9, 250, .02) : null;
  let queueRisk = null;
  if (m.sellQueueLocked) queueRisk = 0;
  else if (m.buyQueueLocked) queueRisk = 62;   // تقاضای قوی اما ریسک خروج در صف
  else if (has(m.queueRatio)) queueRisk = clamp(sig(m.queueRatio, 0, 6));
  const floatScore = has(m.freeFloat) ? clamp(sig(m.freeFloat, 15, .35)) : null;
  const volLimit = has(m.vol60) && has(m.limitPct)
    ? clamp(sig(-(m.vol60 / (m.limitPct * 100 * Math.sqrt(252))), -2.2, 2.4)) : null;
  let riskRaw = weighted([
    { v: liqScore, w: .35 },
    { v: queueRisk, w: .25 },
    { v: floatScore, w: .20 },
    { v: volLimit, w: .20 },
  ]);
  if (has(riskRaw) && has(m.peVsSector) && m.peVsSector > rules.pePenalty) riskRaw *= 0.8;
  if (has(riskRaw) && inst.market === 'پایه') riskRaw *= 0.6;
  f.risk = has(riskRaw) ? clamp(riskRaw) : null;
  f.detail.risk = { tval: inst.tval, queueRatio: m.queueRatio, freeFloat: m.freeFloat, vol60: m.vol60 };

  /* ── پوشش داده ── */
  const keys = FACTOR_META.map(x => x.key);
  f.coverage = keys.filter(k => has(f[k])).length / keys.length;
  return f;
}

export function gradeOf(score, confidence) {
  if (!has(score)) return { fa: 'بدون داده', cls: 'g-na' };
  const lowConf = has(confidence) && confidence < 45;
  if (score >= 80 && !lowConf) return { fa: 'خرید قوی', cls: 'g-a' };
  if (score >= 68 && !lowConf) return { fa: 'خرید', cls: 'g-b' };
  if (score >= 55) return { fa: lowConf ? 'رصد (داده ناقص)' : 'خنثی مثبت', cls: 'g-c' };
  if (score >= 42) return { fa: 'احتیاط', cls: 'g-d' };
  return { fa: 'ضعیف', cls: 'g-e' };
}

export function scoreInstrument(inst, m, factors, weights = DEFAULT_WEIGHTS) {
  const parts = FACTOR_META.map(({ key }) => ({
    v: factors[key], w: weights[key] ?? 0,
  })).filter(p => p.w > 0);

  const total = weighted(parts);
  const present = parts.filter(p => has(p.v)).map(p => p.v);
  const mean = present.length ? present.reduce((a, b) => a + b, 0) / present.length : NaN;
  const sd = present.length > 1
    ? Math.sqrt(present.reduce((a, b) => a + (b - mean) ** 2, 0) / present.length) : NaN;
  const agreement = has(sd) ? clamp(100 - sd * 1.35) : (present.length ? 55 : 0);
  /* اطمینان = پوشش داده × هم‌راستایی عوامل؛ با داده ناقص هرگز «بااطمینان» نمی‌شود */
  const confidence = clamp(factors.coverage * 100 * (0.65 + 0.35 * (agreement / 100)));

  const grade = gradeOf(total, confidence);
  return {
    total: has(total) ? +total.toFixed(1) : null,
    confidence: +confidence.toFixed(0),
    dispersion: has(sd) ? +sd.toFixed(1) : null,
    grade,
    weights,
  };
}

/* ───────────────────── ۴. نقشه معامله (entry/stop/target) ───────────────────── */

/**
 * هدف‌ها و حد ضرر بر پایه ATR واقعی (یا برآورد مبتنی بر دامنه نوسان)
 * و با در نظر گرفتن سقف حرکت روزانه (بازار ۳ درصدی).
 */
/** افق پیشنهادی بر پایه برتری عوامل — در تالار ایران «زمان» به‌اندازه «قیمت» مهم است */
export function horizonOf(f) {
  const s = f.short ?? -1, t = f.tablo ?? -1, l = f.long ?? -1, md = f.mid ?? -1;
  if (s >= 68 && t >= 65) return 'short';
  if (l >= 70 && s < 60) return 'long';
  if (md >= 62 || t >= 70) return 'mid';
  return 'short';
}

export function signalPlan(inst, m, opts = {}) {
  const entry = inst.pl;
  if (!has(entry)) return null;
  const limit = m.limitPct || 0.03;
  const atrVal = has(m.atr) && m.atr > 0 ? m.atr : entry * limit * 0.75;
  const atrSource = has(m.atr) && m.atr > 0 ? 'ATR(14)' : 'برآورد از دامنه نوسان';
  const stop = Math.max(has(inst.tmin) ? inst.tmin : 0, entry - 1.6 * atrVal);
  const targets = [1.2, 2.2, 3.4].map(k => entry + k * atrVal);
  const risk = entry - stop;
  const rr = risk > 0 ? (targets[1] - entry) / risk : NaN;
  const sessionsTo = t => Math.max(1, Math.ceil(((t - entry) / entry) / limit));

  return {
    entry, stop, atr: atrVal, atrSource,
    targets, rr: has(rr) ? +rr.toFixed(2) : null,
    stopPct: risk > 0 ? -(risk / entry) * 100 : NaN,
    targetPct: targets.map(t => ((t - entry) / entry) * 100),
    sessions: targets.map(sessionsTo),
    minOrderValue: opts.minOrderValue ?? DEFAULT_RULES.minOrderValue,
  };
}

/** موقعیت پیشنهادی بر پایه ریسک ثابت (مثلاً ۱٪ سرمایه) */
export function positionSize(plan, capital, riskPct = 1) {
  if (!plan || !has(plan.entry) || !has(plan.stop) || plan.entry <= plan.stop) return null;
  const riskAmount = capital * riskPct / 100;
  const shares = Math.floor(riskAmount / (plan.entry - plan.stop) / 10) * 10;
  const value = shares * plan.entry;
  return { shares, value, riskAmount, feasible: value >= plan.minOrderValue };
}

/* ───────────────────── ۵. توضیح زبان طبیعی سیگنال ───────────────────── */

const money = (v, unit = 'میلیارد ریال') => {
  if (!has(v)) return '—';
  if (unit === 'میلیارد ریال') return `${fmtNum(v / 1e9, 1)} میلیارد ریال`;
  return `${fmtNum(v / 1e6, 1)} میلیون ریال`;
};

/**
 * چرا این نماد این امتیاز را گرفته؟ جملات فارسی ساخته‌شده از اعداد واقعی.
 * @returns {{text:string, tone:'pos'|'neg'|'neutral'}[]}
 */
export function explain(inst, m, f) {
  const out = [];
  const add = (text, tone = 'neutral') => out.push({ text, tone });

  if (has(m.buyerPower)) {
    add(`سرانه خرید حقیقی ${money(m.sarBuy)} در برابر سرانه فروش ${money(m.sarSell)} → قدرت خریدار ${fmtNum(m.buyerPower, 2)}`,
      m.buyerPower >= 1.2 ? 'pos' : m.buyerPower <= 0.85 ? 'neg' : 'neutral');
  }
  if (has(m.netRealMoney)) {
    add(`${m.netRealMoney >= 0 ? 'ورود' : 'خروج'} پول حقیقی خالص ${money(Math.abs(m.netRealMoney))}` +
        (has(m.netRealShare) ? ` معادل ${fmtNum(Math.abs(m.netRealShare) * 100, 1)}٪ ارزش معاملات روز` : ''),
      m.netRealMoney >= 0 ? 'pos' : 'neg');
  }
  if (m.k2k && m.k2k.code !== 'none') {
    add(`${m.k2k.fa}` + (has(m.legalSellShare) ? ` — ${fmtNum(m.legalSellShare * 100, 0)}٪ حجم را حقوقی فروخت و ${fmtNum(m.realBuyShare * 100, 0)}٪ را حقیقی خرید` : ''),
      m.k2k.bias > 0 ? 'pos' : 'neg');
  }
  if (has(m.obi)) {
    add(`عدم تعادل دفتر سفارش (OBI) ${fmtNum(m.obi, 2)} → ${m.obi > 0.15 ? 'تقاضا غالب' : m.obi < -0.15 ? 'عرضه غالب' : 'تعادل نسبی'}`,
      m.obi > 0.15 ? 'pos' : m.obi < -0.15 ? 'neg' : 'neutral');
  }
  if (has(m.volumeShock)) {
    add(`حجم امروز ${fmtNum(m.volumeShock, 1)} برابر میانگین ۳۰ روز${m.volumeShockSource === 'avgVal' ? ' (از میانگین ارزش معاملات)' : ''}`,
      m.volumeShock >= 1.8 ? 'pos' : m.volumeShock <= 0.7 ? 'neg' : 'neutral');
  }
  if (has(m.gapToUp)) {
    add(`فاصله تا سقف مجاز ${fmtNum(m.gapToUp, 2)}٪ (دامنه ${fmtNum((m.limitPct || .03) * 100, 0)}٪) → ظرفیت رشد امروز ${fmtNum((m.capacity || 0) * 100, 0)}٪`,
      m.capacity >= .5 ? 'pos' : 'neutral');
  }
  if (m.buyQueueLocked) add('صف خرید قفل در سقف مجاز — امکان خرید در قیمت جاری عملاً وجود ندارد؛ ریسک خرید در صف.', 'neutral');
  if (m.sellQueueLocked) add('صف فروش قفل در کف مجاز — ریسک ادامه ریزش و ناتوانی در خروج.', 'neg');
  if (has(m.rsi)) add(`RSI(14) = ${fmtNum(m.rsi, 0)} → ${m.rsi >= 70 ? 'اشباع خرید' : m.rsi >= 55 ? 'روند صعودی' : m.rsi >= 45 ? 'خنثی' : 'نزدیک اشباع فروش'}`,
    m.rsi >= 55 && m.rsi < 72 ? 'pos' : m.rsi >= 75 ? 'neg' : 'neutral');
  if (has(m.sma200) && has(inst.pl)) {
    const d = (inst.pl - m.sma200) / m.sma200 * 100;
    add(`قیمت ${fmtNum(Math.abs(d), 1)}٪ ${d >= 0 ? 'بالای' : 'زیر'} میانگین ۲۰۰ روزه (${fmtNum(m.sma200)})`, d >= 0 ? 'pos' : 'neg');
  }
  if (has(m.peVsSector) && m.peVsSector > 0) {
    add(`P/E ${fmtNum(m.peRatio, 1)} در برابر میانگین صنعت ${fmtNum(inst.sectorPE, 1)} → ${fmtNum(m.peVsSector, 2)} برابر`,
      m.peVsSector <= 0.85 ? 'pos' : m.peVsSector >= 1.6 ? 'neg' : 'neutral');
  }
  if (has(m.freeFloat) && m.freeFloat < 12) add(`سهام شناور آزاد ${fmtNum(m.freeFloat, 1)}٪ — آسیب‌پذیر در برابر دستکاری قیمت`, 'neg');
  if (has(inst.tval)) add(`ارزش معاملات امروز ${money(inst.tval)} · ${fmtNum(inst.tno || NaN)} معامله`, 'neutral');
  return out;
}

/* ───────────────────── ۶. اجرای کامل روی یک نماد ───────────────────── */

export function analyzeInstrument(inst, rules = DEFAULT_RULES, weights = DEFAULT_WEIGHTS) {
  const m = instrumentMetrics(inst);
  const veto = vetoCheck(inst, m, rules);
  const factors = factorScores(inst, m, rules);
  const score = scoreInstrument(inst, m, factors, weights);
  const plan = veto.vetoed ? null : { ...signalPlan(inst, m, rules), horizon: horizonOf(factors) };
  return {
    inst, metrics: m, veto, factors, score, plan,
    tech: { short: factors.short, mid: factors.mid, long: factors.long },
    reasons: veto.vetoed ? [] : explain(inst, m, factors),
  };
}

/* ───────────────────── ۷. سطح بازار: رتبه‌بندی، نبض، صنایع ───────────────────── */

export function rankInstruments(list, opts = {}) {
  const rules = { ...DEFAULT_RULES, ...opts.rules };
  const weights = { ...DEFAULT_WEIGHTS, ...opts.weights };
  const rows = [], vetoed = [];
  const vetoCounts = Object.fromEntries(VETO_META.map(v => [v.code, 0]));

  for (const inst of list) {
    const r = analyzeInstrument(inst, rules, weights);
    for (const c of r.veto.codes) if (c in vetoCounts) vetoCounts[c]++;
    if (r.veto.vetoed) vetoed.push(r);
    else rows.push(r);
  }

  rows.sort((a, b) => {
    const s = (b.score.total ?? -1) - (a.score.total ?? -1);
    return s !== 0 ? s : (b.score.confidence ?? 0) - (a.score.confidence ?? 0);
  });

  return { rows, vetoed, vetoCounts, scanned: list.length, rules, weights };
}

/** نبض بازار: عمق، جریان پول، صف‌ها، دما */
export function marketPulse(list, top = []) {
  const stocks = list.filter(i => i.kind === 'stock');
  let up = 0, down = 0, flat = 0, limitUp = 0, limitDown = 0;
  let value = 0, volume = 0, netReal = 0, buyQ = 0, sellQ = 0;
  let wSum = 0, wChg = 0, sumChg = 0, nChg = 0;
  let buyIV = 0, sellIV = 0, buyVal = 0, sellVal = 0;

  for (const inst of stocks) {
    const m = instrumentMetrics(inst);
    const ref = Number.isFinite(inst.pc) && inst.pc ? inst.pc : inst.py;
    const chg = ref && Number.isFinite(inst.pl) ? (inst.pl - ref) / ref * 100 : NaN;
    if (Number.isFinite(chg)) {
      if (chg > 0.05) up++; else if (chg < -0.05) down++; else flat++;
      sumChg += chg; nChg++;
      const cap = Number.isFinite(inst.marketValue) && inst.marketValue > 0 ? inst.marketValue : (inst.tval || 0);
      wSum += cap; wChg += cap * chg;
    }
    if (m.atLimitUp) limitUp++;
    if (m.atLimitDown) limitDown++;
    if (Number.isFinite(inst.tval)) value += inst.tval;
    if (Number.isFinite(inst.tvol)) volume += inst.tvol;
    if (Number.isFinite(m.netRealMoney)) netReal += m.netRealMoney;
    if (Number.isFinite(m.buyQueueValue)) buyQ += m.buyQueueValue;
    if (Number.isFinite(m.sellQueueValue)) sellQ += m.sellQueueValue;
    if (Number.isFinite(inst.buyIVol) && Number.isFinite(m.vwap)) { buyIV += inst.buyIVol; buyVal += inst.buyIVol * m.vwap; }
    if (Number.isFinite(inst.sellIVol) && Number.isFinite(m.vwap)) { sellIV += inst.sellIVol; sellVal += inst.sellIVol * m.vwap; }
  }

  const breadth = (up + down) ? up / (up + down) : NaN;
  const realPower = sellVal > 0 && buyIV > 0 ? buyVal / sellVal : NaN;
  const equalChg = nChg ? sumChg / nChg : NaN;
  const capChg = wSum > 0 ? wChg / wSum : NaN;

  /* دمای بازار ۰..۱۰۰ — ترکیب عمق، جریان پول و صف‌ها */
  const t = clamp(
    34 * (has(breadth) ? breadth : .5) +
    26 * (has(realPower) ? realPower / 2 : .5) +
    22 * (has(capChg) ? 1 / (1 + Math.exp(-capChg * 1.4)) : .5) +
    18 * (buyQ + sellQ > 0 ? buyQ / (buyQ + sellQ) : .5),
  );

  return {
    count: stocks.length, up, down, flat, limitUp, limitDown,
    value, volume, netReal, buyQueueValue: buyQ, sellQueueValue: sellQ,
    breadth, realPower, equalChg, capChg, temperature: +t.toFixed(0),
    topGainers: [...stocks].sort((a, b) => chgOf(b) - chgOf(a)).slice(0, 5),
    topLosers: [...stocks].sort((a, b) => chgOf(a) - chgOf(b)).slice(0, 5),
    topValue: [...stocks].sort((a, b) => (b.tval || 0) - (a.tval || 0)).slice(0, 8),
    signals: top,
  };
}

const chgOf = inst => {
  const ref = Number.isFinite(inst.pc) && inst.pc ? inst.pc : inst.py;
  return ref && Number.isFinite(inst.pl) ? (inst.pl - ref) / ref * 100 : -Infinity;
};

/** تجمیع بر پایه صنعت — خوراک هیت‌مپ */
export function sectorAggregates(list) {
  const map = new Map();
  for (const inst of list) {
    if (inst.kind !== 'stock') continue;
    const key = inst.cs || '—';
    const m = instrumentMetrics(inst);
    const chg = chgOf(inst);
    const rec = map.get(key) || {
      sector: key, count: 0, value: 0, up: 0, down: 0,
      netReal: 0, chgSum: 0, chgN: 0, members: [],
    };
    rec.count++;
    if (Number.isFinite(inst.tval)) rec.value += inst.tval;
    if (Number.isFinite(m.netRealMoney)) rec.netReal += m.netRealMoney;
    if (Number.isFinite(chg)) {
      rec.chgSum += chg; rec.chgN++;
      if (chg > 0.05) rec.up++; else if (chg < -0.05) rec.down++;
    }
    rec.members.push({ l18: inst.l18, chg, value: inst.tval || 0, netReal: m.netRealMoney });
    map.set(key, rec);
  }
  return [...map.values()]
    .map(r => ({
      ...r,
      avgChg: r.chgN ? r.chgSum / r.chgN : NaN,
      members: r.members.sort((a, b) => b.value - a.value).slice(0, 5),
    }))
    .sort((a, b) => b.value - a.value);
}
