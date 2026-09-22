/**
 * tse.js — قواعد و ساختار بازار سرمایه ایران (بورس تهران + فرابورس)
 *
 * این ماژول «دانش بازار» را از منطق محاسبه جدا می‌کند:
 *  - ساعت‌های جلسه معاملاتی (پیش‌گشایش / پیوسته / حراج پایانی TAL)
 *  - دامنه نوسان مجاز به تفکیک نوع ابزار و بازار
 *  - وضعیت حجم مبنا (از ۱ دی ۱۴۰۴ برابر یک سهم)
 *  - طبقه‌بندی بازار/تابلو/صنعت
 *  - نگاشت فیلدهای خام TSETMC/BrsApi به یک مدل یکنواخت
 *  - قالب‌بندی اعداد به سبک بازار ایران (ریال/تومان، میلیارد، همت)
 *
 * منابع قواعد: مستند در docs/TSE_MARKET_RESEARCH.md
 */

/* ───────────────────────── ۱. جلسه معاملاتی ───────────────────────── */

/** روزهای کاری تالار: شنبه تا چهارشنبه (Intl: 0=یکشنبه … 6=شنبه) */
export const WORKING_DAYS = [0, 1, 2, 3, 6];

export const SESSIONS = [
  { id: 'pre',      fa: 'پیش‌گشایش',        start: '08:30', end: '09:00' },
  { id: 'open',     fa: 'معاملات پیوسته',   start: '09:00', end: '12:30' },
  { id: 'tal',      fa: 'حراج پایانی (TAL)', start: '12:45', end: '13:00' },
];

/**
 * وضعیت بازار در یک لحظه مشخص (بر اساس ساعت تهران).
 * @param {Date} [now]
 * @returns {{phase:string, fa:string, open:boolean, nextOpenInMin:number, progress:number}}
 */
export function marketPhase(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Tehran', hour12: false,
    weekday: 'short', hour: '2-digit', minute: '2-digit',
  }).formatToParts(now);
  const get = t => (parts.find(p => p.type === t) || {}).value;
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  const hm = `${get('hour')}:${get('minute')}`;

  const isWorking = WORKING_DAYS.includes(wd);
  let phase = 'closed';
  if (isWorking) {
    if (hm >= '08:30' && hm < '09:00') phase = 'pre';
    else if (hm >= '09:00' && hm < '12:30') phase = 'open';
    else if (hm >= '12:45' && hm < '13:00') phase = 'tal';
    else if (hm < '08:30') phase = 'pre-open';
    else phase = 'after';
  }
  const fa = {
    pre: 'پیش‌گشایش', open: 'بازار باز', tal: 'حراج پایانی',
    'pre-open': 'پیش از پیش‌گشایش', after: 'بازار بسته', closed: 'بازار بسته (تعطیل)',
  }[phase];

  /* فاصله تا بازگشایی بعدی (دقیقه) */
  let nextOpenInMin = null;
  const [h, m] = hm.split(':').map(Number);
  const mins = h * 60 + m;
  const toOpen = 9 * 60 - mins;
  if (isWorking && toOpen > 0) nextOpenInMin = toOpen;
  else {
    let d = 1;
    while (d <= 7 && !WORKING_DAYS.includes((wd + d) % 7)) d++;
    nextOpenInMin = (d * 24 * 60) - mins + 9 * 60;
  }

  /* درصد پیشرفت جلسه پیوسته */
  const start = 9 * 60, end = 12 * 60 + 30;
  const progress = Math.max(0, Math.min(1, (mins - start) / (end - start)));

  return { phase, fa, open: phase === 'open' || phase === 'tal' || phase === 'pre', nextOpenInMin, progress, hm };
}

/* ───────────────────── ۲. دامنه نوسان مجاز ───────────────────── */

/**
 * دامنه نوسان روزانه (کسری) بر اساس نوع ابزار/بازار.
 * سهام و حق‌تقدم در بورس و بازارهای اصلی فرابورس: ۳٪
 * بازار پایه: زرد ۳٪ / نارنجی ۲٪ / قرمز ۱٪
 * صندوق سهامی: ۴٪ | صندوق درآمد ثابت: ۳٪ | صندوق طلا (بورس کالا): ۱۰٪
 */
export const PRICE_LIMITS = {
  stock: 0.03,
  right: 0.03,
  fund_equity: 0.04,
  fund_fixed: 0.03,
  fund_gold: 0.10,
  base_yellow: 0.03,
  base_orange: 0.02,
  base_red: 0.01,
  bond: 0.0,
};

/** حجم مبنا از ۱ دی ۱۴۰۴ برای همه نمادهای بورس و فرابورس برابر یک سهم است. */
export const BASE_VOLUME_RULE = {
  effectiveFrom: '1404-10-01',
  value: 1,
  note: 'حجم مبنا برابر یک سهم؛ مقررات گره معاملاتی نیز لغو شده است.',
};

/**
 * حد نوسان یک نماد را برمی‌گرداند. اگر آستانه مجاز (tmin/tmax) در داده موجود
 * باشد همان مرجع قطعی است (چون شامل استثناهای ناظر می‌شود).
 */
export function limitPctOf(inst) {
  const { pc, tmin, tmax, kind } = inst || {};
  if (Number.isFinite(pc) && pc > 0 && Number.isFinite(tmax) && Number.isFinite(tmin)) {
    const up = (tmax - pc) / pc;
    const dn = (pc - tmin) / pc;
    if (up > 0.0005 && Math.abs(up - dn) < 0.002) return up;
    if (up > 0.0005) return up;
  }
  return PRICE_LIMITS[kind] ?? PRICE_LIMITS.stock;
}

/* ───────────────────── ۳. طبقه‌بندی ابزار و بازار ───────────────────── */

/**
 * نوع ابزار را از روی نام/گروه/کد بازار حدس می‌زند.
 * @returns {'stock'|'right'|'fund_equity'|'fund_fixed'|'fund_gold'|'bond'|'index'|'other'}
 */
export function classifyInstrument(raw) {
  const l18 = String(raw.l18 ?? raw.symbol ?? '');
  const l30 = String(raw.l30 ?? raw.name ?? '');
  const cs = String(raw.cs ?? raw.sector ?? '');
  const cid = Number(raw.cs_id ?? raw.cSecVal ?? raw.sectorId ?? 0);
  const text = `${l18} ${l30} ${cs}`;

  if (/شاخص/.test(text) || cid === 68 || cid === 69) return 'index';
  if (/حق\s*تقدم/.test(l30) || /[-_.]ح$/.test(l18)) return 'right';
  if (/گواهی سپرده|اخزا|اسناد خزانه|صکوک|اوراق|تسهیلات مسکن|مرابحه|اجاره/.test(text)) return 'bond';
  if (/طلا|سکه|شمش/.test(text) && /صندوق/.test(text)) return 'fund_gold';
  if (/صندوق/.test(text)) {
    if (/درآمد ?ثابت|سپرده|کیان|اعتماد|آفرین|نگین|افران|سرو|گنجینه/.test(text)) return 'fund_fixed';
    return 'fund_equity';
  }
  if (/آتی|اختیار/.test(text)) return 'other';
  return 'stock';
}

/** بازار/تابلو از روی عنوان‌های TSETMC (cgrValCotTitle / flowTitle) یا cs_id بازار پایه */
export function marketOf(raw) {
  const title = String(raw.cgrValCotTitle ?? raw.board ?? raw.market ?? '');
  const flow = String(raw.flowTitle ?? '');
  const txt = `${title} ${flow}`;
  if (/پایه.*قرمز|قرمز/.test(txt)) return { market: 'پایه', board: 'قرمز', kind: 'base_red' };
  if (/پایه.*نارنجی|نارنجی/.test(txt)) return { market: 'پایه', board: 'نارنجی', kind: 'base_orange' };
  if (/پایه/.test(txt)) return { market: 'پایه', board: 'زرد', kind: 'base_yellow' };
  if (/فرابورس/.test(txt)) {
    if (/بازار دوم/.test(txt)) return { market: 'فرابورس', board: 'بازار دوم', kind: 'stock' };
    return { market: 'فرابورس', board: 'بازار اول', kind: 'stock' };
  }
  if (/بورس/.test(txt)) {
    if (/بازار دوم/.test(txt)) return { market: 'بورس', board: 'بازار دوم', kind: 'stock' };
    return { market: 'بورس', board: 'بازار اول', kind: 'stock' };
  }
  return { market: 'نامشخص', board: '—', kind: null };
}

/** صنایع اصلی بازار (برای تجمیع و فیلتر) */
export const SECTOR_COLORS = [
  '#16e08c', '#4cc9ff', '#9b8cff', '#ffc14d', '#ff5470', '#5ecbff',
  '#6ee7d0', '#ff8fab', '#c0f07a', '#f5a3ff',
];

/* ───────────────────── ۴. نرمال‌سازی فیلدهای خام ───────────────────── */

/**
 * تبدیل امن به عدد: «هیچ» و «متن نامعتبر» باید NaN بمانند تا بعداً
 * مقدار ساختگی (صفر) جای داده غایب را نگیرد.
 */
const FA_DIGITS = /[۰-۹]/g, AR_DIGITS = /[٠-٩]/g;
const toNum = v => {
  if (v === null || v === undefined || v === '') return NaN;
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  const str = String(v).replace(/[,٬\s]/g, '')
    .replace(FA_DIGITS, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(AR_DIGITS, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
  const n = Number(str);
  return Number.isFinite(n) ? n : NaN;
};

/** اولین مقدار موجود از میان چند کلید (تفاوت نام فیلد در BrsApi و TSETMC) */
const pick = (o, keys) => {
  for (const k of keys) {
    const v = o?.[k];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return NaN;
};

/**
 * تبدیل یک رکورد خام (BrsApi AllSymbols / TSETMC / اسنپ‌شات آفلاین)
 * به مدل یکنواخت `Instrument`. تمام قیمت‌ها «ریال» است.
 */
export function normalizeInstrument(raw) {
  let kind = classifyInstrument(raw);
  const mk = marketOf(raw);
  /* نمادهای بازار پایه نوع مستقل می‌گیرند تا دامنه نوسان و ریسک درست اعمال شود */
  if (mk.kind && kind === 'stock') kind = mk.kind;
  const inst = {
    insCode: String(raw.insCode ?? raw.id ?? ''),
    l18: String(raw.l18 ?? raw.symbol ?? '').trim(),
    l30: String(raw.l30 ?? raw.name ?? '').trim(),
    isin: String(raw.cIsin ?? raw.isin ?? ''),
    cs: String(raw.cs ?? raw.sector ?? '—'),
    csId: toNum(pick(raw, ['cs_id', 'cSecVal', 'sectorId'])),
    kind,
    market: mk.market,
    board: mk.board,

    /* قیمت‌ها (ریال) */
    py: toNum(pick(raw, ['py', 'priceYesterday', 'pYesterday'])),
    pc: toNum(pick(raw, ['pc', 'pClosing', 'closingPrice'])),
    pl: toNum(pick(raw, ['pl', 'pDrCotVal', 'lastPrice'])),
    pf: toNum(pick(raw, ['pf', 'priceFirst'])),
    pmin: toNum(pick(raw, ['pmin', 'priceMin'])),
    pmax: toNum(pick(raw, ['pmax', 'priceMax'])),
    tmin: toNum(pick(raw, ['tmin', 'psGelStaMin'])),
    tmax: toNum(pick(raw, ['tmax', 'psGelStaMax'])),

    /* حجم و ارزش */
    tvol: toNum(pick(raw, ['tvol', 'qTotCap', 'volume'])),
    tval: toNum(pick(raw, ['tval', 'qTotTran5J', 'value'])),
    tno: toNum(pick(raw, ['tno', 'zTotTran', 'trades'])),
    avgVal: toNum(pick(raw, ['qTotTran5JAvg', 'avgVal', 'avgValue'])),
    baseVol: toNum(pick(raw, ['bvol', 'baseVol'])) || 1,

    /* بنیادی */
    zTitad: toNum(pick(raw, ['zTitad', 'z', 'totalShares'])),
    eps: toNum(pick(raw, ['eps', 'epsValue'])),
    pe: toNum(pick(raw, ['pe', 'PE'])),
    sectorPE: toNum(pick(raw, ['sectorPE'])),
    psr: toNum(pick(raw, ['psr'])),
    nav: toNum(pick(raw, ['nav'])),
    freeFloat: toNum(pick(raw, ['kAjCapValCpsIdx', 'freeFloat', 'float'])),
    minWeek: toNum(pick(raw, ['minWeek'])),
    maxWeek: toNum(pick(raw, ['maxWeek'])),
    minYear: toNum(pick(raw, ['minYear'])),
    maxYear: toNum(pick(raw, ['maxYear'])),

    /* حقیقی/حقوقی */
    buyICount: toNum(pick(raw, ['Buy_CountI', 'Buy_I_Count', 'buyICount'])),
    buyIVol: toNum(pick(raw, ['Buy_I_Volume', 'BuyIVolume', 'buyIVol'])),
    buyNCount: toNum(pick(raw, ['Buy_CountN', 'Buy_N_Count', 'buyNCount'])),
    buyNVol: toNum(pick(raw, ['Buy_N_Volume', 'BuyNVolume', 'buyNVol'])),
    sellICount: toNum(pick(raw, ['Sell_CountI', 'Sell_I_Count', 'sellICount'])),
    sellIVol: toNum(pick(raw, ['Sell_I_Volume', 'SellIVolume', 'sellIVol'])),
    sellNCount: toNum(pick(raw, ['Sell_CountN', 'Sell_N_Count', 'sellNCount'])),
    sellNVol: toNum(pick(raw, ['Sell_N_Volume', 'SellNVolume', 'sellNVol'])),

    /* دفتر سفارش ۵ سطحی */
    book: normalizeBook(raw),

    /* وضعیت نماد */
    state: String(raw.state ?? raw.cEtavalTitle ?? '').trim(),
    halted: /توقف|ناظر|ممنوع/.test(String(raw.state ?? raw.cEtavalTitle ?? '')),

    history: expandHistory(raw.history ?? raw._hist),
    provenance: raw.provenance ?? 'live',
  };

  /* ارزش بازار (ریال) */
  inst.marketValue = Number.isFinite(inst.zTitad) && Number.isFinite(inst.pl)
    ? inst.zTitad * inst.pl
    : toNum(pick(raw, ['mv', 'marketValue', 'marketCap']));

  /* مرجع قیمت: قیمت پایانی دیروز؛ اگر نبود آخرین معامله */
  if (!Number.isFinite(inst.pc)) inst.pc = Number.isFinite(inst.py) ? inst.py : inst.pl;
  if (!Number.isFinite(inst.pl)) inst.pl = inst.pc;

  /* آستانه مجاز: در صورت نبود، از دامنه نوسان نوع ابزار ساخته می‌شود */
  const L = limitPctOf(inst);
  inst.limitPct = L;
  if (!Number.isFinite(inst.tmax) && Number.isFinite(inst.pc)) inst.tmax = Math.round(inst.pc * (1 + L));
  if (!Number.isFinite(inst.tmin) && Number.isFinite(inst.pc)) inst.tmin = Math.round(inst.pc * (1 - L));

  return inst;
}

/**
 * بازکردن تاریخچه فشرده {c:[…], v:[…]} به آرایه کندل.
 * ورودی آرایه‌ای دست‌نخورده برمی‌گردد؛ ورودی نامعتبر → null.
 */
export function expandHistory(h) {
  if (!h) return null;
  if (Array.isArray(h)) return h.length ? h : null;
  if (Array.isArray(h.c) && h.c.length) {
    const vols = Array.isArray(h.v) ? h.v : [];
    const bars = h.c.map((close, i) => ({
      d: i + 1,
      c: toNum(close),
      v: toNum(vols[i]),
      ...(Array.isArray(h.h) && Array.isArray(h.o) ? {
        o: toNum(h.o[i]), h: toNum(h.h[i]), l: toNum(h.l?.[i]),
      } : {}),
    })).filter(b => Number.isFinite(b.c) && b.c > 0);
    return bars.length >= 5 ? bars : null;
  }
  return null;
}

function normalizeBook(raw) {
  const levels = [];
  for (let i = 1; i <= 5; i++) {
    const bid = {
      q: toNum(pick(raw, [`qd${i}`, `bestLimitsBid${i}`])),
      p: toNum(pick(raw, [`pd${i}`])),
      n: toNum(pick(raw, [`zd${i}`])),
    };
    const ask = {
      q: toNum(pick(raw, [`qo${i}`, `bestLimitsAsk${i}`])),
      p: toNum(pick(raw, [`po${i}`])),
      n: toNum(pick(raw, [`zo${i}`])),
    };
    if ([bid.q, bid.p, ask.q, ask.p].some(Number.isFinite)) levels.push({ i, bid, ask });
  }
  return levels;
}

/** آرایه خام → آرایه Instrument (با حذف رکوردهای بدون قیمت) */
export function normalizeAll(rows) {
  const out = [];
  for (const r of rows || []) {
    if (!r) continue;
    const inst = normalizeInstrument(r);
    if (!inst.l18 || !Number.isFinite(inst.pl) || inst.pl <= 0) continue;
    out.push(inst);
  }
  return out;
}

/* ───────────────────── ۵. قالب‌بندی اعداد بازار ایران ───────────────────── */

const faDigits = s => String(s).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[d]);

export const fmtOpts = { faDigits: false, unit: 'rial' };

/** ۱٬۲۳۴٬۵۶۷ با ارقام لاتین (پیش‌فرض بازار) یا فارسی */
export function fmtNum(n, digits = 0) {
  if (!Number.isFinite(n)) return '—';
  const s = n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return fmtOpts.faDigits ? faDigits(s) : s;
}

/** قیمت به ریال یا تومان بر اساس تنظیم کاربر */
export function fmtPrice(n) {
  if (!Number.isFinite(n)) return '—';
  const v = fmtOpts.unit === 'toman' ? n / 10 : n;
  return `${fmtNum(v, v < 100 ? 1 : 0)} ${fmtOpts.unit === 'toman' ? 'ت' : 'ر'}`;
}

/**
 * خلاصه‌سازی مبالغ بزرگ به سبک رسانه‌های بورسی ایران:
 * میلیارد ریال → «هزار میلیارد ریال» → «همت» (هزار میلیارد تومان = ۱۰ هزار میلیارد ریال)
 */
export function fmtBig(rials) {
  if (!Number.isFinite(rials)) return '—';
  const abs = Math.abs(rials);
  if (abs >= 1e13) return `${fmtNum(rials / 1e13, 2)} همت`;
  if (abs >= 1e10) return `${fmtNum(rials / 1e10, 1)} هزارمیلیارد ریال`;
  if (abs >= 1e9) return `${fmtNum(rials / 1e9, 1)} میلیارد ریال`;
  if (abs >= 1e6) return `${fmtNum(rials / 1e6, 1)} میلیون ریال`;
  return fmtNum(rials);
}

export const fmtPct = (n, d = 2) => Number.isFinite(n) ? `${n >= 0 ? '+' : ''}${fmtNum(n, d)}٪` : '—';

/** تاریخ/ساعت تهران */
export function tehranStamp(d = new Date()) {
  return new Intl.DateTimeFormat('fa-IR-u-nu-latn', {
    timeZone: 'Asia/Tehran', dateStyle: 'medium', timeStyle: 'medium',
  }).format(d);
}

export const tehranTime = (d = new Date()) => new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Tehran', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
}).format(d);

export const tehranDate = (d = new Date()) => new Intl.DateTimeFormat('fa-IR-u-nu-latn', {
  timeZone: 'Asia/Tehran', dateStyle: 'medium',
}).format(d);
