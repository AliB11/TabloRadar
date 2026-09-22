/**
 * sources.js — پارسر منابع دادهٔ واقعی (آینهٔ JS برای tsepy/tsetmc_live.py و tsepy/bourse_trader.py)
 *
 * این ماژول «متن خام» سرویس‌های واقعی را به فیلدهای تابلورادار تبدیل می‌کند تا مرورگر هم
 * بتواند بدون سرور محلی، مستقیم داده بگیرد:
 *   • TSETMC  MarketWatchInit.aspx?h=0&r=0   → قیمت‌ها + دفتر سفارش ۵ سطحی + وضعیت بازار
 *   • TSETMC  ClientTypeAll.aspx             → حقیقی/حقوقی کل بازار
 *   • بورس‌تریدر /symbol/<نماد> و /          → تابلوی نماد و نبض بازار (متن strip‌شده)
 *
 * قاعدهٔ طلایی: هیچ مقداری ساخته نمی‌شود. برچسبی که پیدا نشود، فیلد غایب می‌ماند تا موتور
 * اطمینان را کاهش دهد (نه اینکه عدد جعلی جای داده واقعی بگذارد).
 */

/* ─────────────────────────── ابزار متن/عدد ─────────────────────────── */

const FA = /[۰-۹]/g, AR = /[٠-٩]/g;
const faDigits = s => String(s).replace(FA, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
  .replace(AR, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));

const SUFFIX = { k: 1e3, m: 1e6, b: 1e9, t: 1e12, 'هزار': 1e3, 'میلیون': 1e6, 'میلیارد': 1e9, 'همت': 1e12 };

/** «1,234.5» «۳۲۳» «1.2T» «4780-» «(105.2B)» «-4.44%» → عدد؛ نامعتبر → NaN */
export function parseAmount(token) {
  if (token === null || token === undefined) return NaN;
  let s = faDigits(token).trim().replace(/[٬\u200c ]/g, '').replace(/[−–]/g, '-');
  const pct = /[%٪]/.test(s);
  let neg = false;
  if (s.startsWith('(') && s.endsWith(')')) {
    const inner = s.slice(1, -1);
    neg = !pct || inner.trim().startsWith('-');
    s = inner;
  }
  if (s.startsWith('-')) { neg = true; s = s.slice(1); }
  if (s.endsWith('-')) { neg = true; s = s.slice(0, -1); }
  s = s.replace(/[٪%$]+$/, '');
  let mult = 1;
  const low = s.toLowerCase();
  for (const suf of Object.keys(SUFFIX).sort((a, b) => b.length - a.length)) {
    if (low.endsWith(suf) && s.length > suf.length) {
      const body = s.slice(0, s.length - suf.length);
      if (/^[\d.,]+$/.test(body)) { mult = SUFFIX[suf]; s = body; break; }
    }
  }
  if (!/^\d[\d,]*\.?\d*$/.test(s)) return NaN;
  const val = parseFloat(s.replace(/,/g, '')) * mult;
  return Number.isFinite(val) ? (neg ? -val : val) : NaN;
}

/** HTML → متن: هر `</tr>` خط جدید، هر سلول TAB، پیوند نماد به شکل ⟦نام⟧ */
export function stripTags(html) {
  let text = String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<a\b[^>]*href="([^"]*symbol[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi,
      (_, href, inner) => `⟦${inner.replace(/<[^>]+>/g, '').trim()}⟧ `)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(tr|div|p|li|h1|h2|h3|h4|section)>/gi, '\n')
    .replace(/<\/(td|th)>/gi, '\t')
    .replace(/<[^>]+>/g, ' ');
  text = text.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'");
  return text.replace(/[ \t]*\n[ \t\n]*/g, '\n').replace(/[ \t]{2,}/g, ' ');
}

export const tokenize = text => String(text).split(/[\s|]+|\t+/).filter(Boolean);
const isWord = tok => /^[\u0600-\u06FFA-Za-zآ-ی]+$/.test(tok || '');

/**
 * اعداد بعد از هر بار آمدن «label» را برمی‌گرداند.
 * قواعد ضدخطا: توکن بعدی اگر واژه باشد تطبیق رد می‌شود؛ توکن درصدی به‌طور پیش‌فرض نادیده
 * می‌رود (تا «(31%) 293» عدد ۳۱ را به‌جای ۲۹۳ برنگرداند).
 */
export function findNumbers(words, label, { window = 8, allowPercent = false, notAfter = [], maxWordGap = 0 } = {}) {
  const lab = String(label).trim().split(/\s+/);
  const out = [];
  for (let i = 0; i + lab.length <= words.length; i++) {
    let match = true;
    for (let k = 0; k < lab.length; k++) if (words[i + k] !== lab[k]) { match = false; break; }
    if (!match) continue;
    if (notAfter.length && i > 0 && notAfter.includes(words[i - 1])) continue;
    let gap = 0;
    if (isWord(words[i + lab.length] || '')) {
      while (gap < maxWordGap && isWord(words[i + lab.length + gap] || '')) gap++;
      if (gap >= maxWordGap) continue;
    }
    const vals = [];
    for (let j = i + lab.length + gap; j < i + lab.length + gap + window && j < words.length; j++) {
      if (!allowPercent && /[%٪]/.test(words[j])) continue;
      const n = parseAmount(words[j]);
      if (Number.isFinite(n)) vals.push(n);
    }
    out.push(vals);
  }
  return out;
}

export const firstNumber = (words, label, opts) => {
  for (const g of findNumbers(words, label, opts)) if (g.length) return g[0];
  return NaN;
};

/* ─────────────────────────── TSETMC: MarketWatchInit ─────────────────────────── */

/** ترتیب ستون‌های سطر قیمت در MarketWatchInit (قرارداد سرویس TSETMC) */
export const PRICE_COLS = ['insCode', 'isin', 'l18', 'l30', 'heven', 'pf', 'pc', 'pl', 'tno', 'tvol',
  'tval', 'pmin', 'pmax', 'py', 'eps', 'bvol', 'visitcount', 'flow', 'cs', 'tmax', 'tmin',
  'z', 'yval', 'predtran', 'buyop'];

const FLOW_MARKET = { 0: ['عمومی', '—'], 1: ['بورس', 'بازار اول'], 2: ['فرابورس', 'بازار اول'],
  3: ['مشتقه', '—'], 4: ['پایه', 'زرد'], 5: ['پایه', 'زرد'], 6: ['بورس انرژی', '—'], 7: ['بورس کالا', '—'] };

/** سطرهای «فشرده» TSETMC (حذف شناسهٔ تکراری) → سطرهای هم‌عرض */
function rows(text, sep, ncols, splitter = ';') {
  const out = [];
  let lastId = null;
  for (const chunk of String(text).split(splitter)) {
    let items = chunk.split(sep);
    if (!items.some(x => x !== '')) continue;
    if (items.length < ncols && lastId !== null) items = [lastId, ...items];
    if (items.length > ncols) items = items.slice(0, ncols);
    if (!items[0]) continue;
    lastId = items[0];
    out.push(items);
  }
  return out;
}

/** «(113024)-1.5524%» → {delta: -113024, pct: -1.5524} */
export function parseChange(field) {
  if (!field) return { delta: NaN, pct: NaN };
  let delta = NaN, neg = false;
  const m = String(field).match(/\(([\d,.]+)\)/);
  if (m) { delta = parseAmount(m[1]); neg = true; }
  else {
    const m2 = String(field).match(/-?[\d,.]+/);
    if (m2) { delta = parseAmount(m2[0]); neg = Number.isFinite(delta) && delta < 0; }
  }
  if (Number.isFinite(delta)) delta = neg ? -Math.abs(delta) : Math.abs(delta);
  const mp = String(field).match(/(-?[\d.]+)\s*%/);
  return { delta, pct: mp ? parseAmount(mp[1]) : NaN };
}

export function parseMarketState(raw) {
  if (!raw || (raw.match(/,/g) || []).length < 10) return {};
  const f = raw.split(',');
  const chg = parseChange(f[3]);
  return {
    datetimeRaw: f[0], tseStatus: f[1], indexTotal: parseAmount(f[2]),
    indexChange: chg.delta, indexChangePct: chg.pct, marketValueCap: parseAmount(f[4]),
    tseVolume: parseAmount(f[5]), tseValue: parseAmount(f[6]), tseTrades: parseAmount(f[7]),
    faraVolume: parseAmount(f[9]), faraValue: parseAmount(f[10]), faraTrades: parseAmount(f[11]),
  };
}

/** متن MarketWatchInit → {messages, state, refid, prices, limits} */
export function parseMarketWatchInit(text) {
  const parts = String(text).split('@');
  if (parts.length < 5) throw new Error(`قالب MarketWatchInit ناشناخته (${parts.length} بخش)`);
  const [messages, stateRaw, pricesCsv, limitsCsv, refid] = parts;
  const prices = [];
  for (const items of rows(pricesCsv, ',', PRICE_COLS.length)) {
    const row = {};
    for (let i = 0; i < Math.min(items.length, PRICE_COLS.length); i++) row[PRICE_COLS[i]] = items[i];
    if (!row.insCode) continue;
    row.insCode = String(row.insCode);
    prices.push(row);
  }
  const limits = {};
  for (const items of rows(limitsCsv, ',', 8)) {
    const code = String(items[0] || '');
    const depth = parseInt(parseAmount(items[1]), 10);
    if (!code || !(depth >= 1 && depth <= 5)) continue;
    (limits[code] = limits[code] || {})[depth] = {
      zo: parseAmount(items[2]), zd: parseAmount(items[3]), pd: parseAmount(items[4]),
      po: parseAmount(items[5]), qd: parseAmount(items[6]), qo: parseAmount(items[7]),
    };
  }
  return { messages, state: parseMarketState(stateRaw), refid: parseAmount(refid), prices, limits };
}

/** متن ClientTypeAll → {insCode: {n_buy_count, l_buy_vol, …}} (n_ = حقیقی، l_ = حقوقی) */
export function parseClientTypeAll(text) {
  const cols = ['insCode', 'n_buy_count', 'l_buy_count', 'n_buy_vol', 'l_buy_vol',
    'n_sell_count', 'l_sell_count', 'n_sell_vol', 'l_sell_vol'];
  const out = {};
  for (const items of rows(text, ',', cols.length, '\n')) {
    if (items.length < cols.length) continue;
    const rec = {};
    for (let i = 1; i < cols.length; i++) rec[cols[i]] = parseAmount(items[i]);
    out[String(items[0])] = rec;
  }
  return out;
}

/** (قیمت + دفتر سفارش + حقیقی/حقوقی) → رکورد یکنواخت تابلورادار (ریال) */
export function buildRows(mw, clients = {}) {
  const put = (o, k, v) => { if (v !== undefined && v !== null && v !== '' && !(typeof v === 'number' && !Number.isFinite(v))) o[k] = v; };
  return (mw.prices || []).map(price => {
    const flow = Number.isFinite(parseAmount(price.flow)) ? parseInt(parseAmount(price.flow), 10) : 0;
    const [market, board] = FLOW_MARKET[flow] || ['نامشخص', '—'];
    const out = { provenance: 'tsetmc', synthetic: false };
    put(out, 'insCode', String(price.insCode || ''));
    put(out, 'l18', price.l18); put(out, 'l30', price.l30); put(out, 'isin', price.isin);
    put(out, 'cs_id', parseAmount(price.cs));
    put(out, 'flowTitle', ['بورس', 'فرابورس'].includes(market) ? `بازار ${market}` : market);
    put(out, 'cgrValCotTitle', board); put(out, 'market', market); put(out, 'board', board);
    for (const k of ['py', 'pc', 'pl', 'pf', 'pmin', 'pmax', 'tmax', 'tmin', 'tvol', 'tval', 'tno', 'eps', 'bvol']) {
      const v = parseAmount(price[k]); if (Number.isFinite(v)) out[k] = v;
    }
    const z = parseAmount(price.z); if (Number.isFinite(z)) out.zTitad = z;
    const pe = out.pc / out.eps;
    if (Number.isFinite(pe) && pe > 0) out.pe = Math.round(pe * 100) / 100;
    const lv = (mw.limits || {})[String(price.insCode)];
    if (lv) for (const d of [1, 2, 3, 4, 5]) {
      const d2 = lv[d]; if (!d2) continue;
      for (const k of ['pd', 'qd', 'zd', 'po', 'qo', 'zo']) if (Number.isFinite(d2[k])) out[`${k}${d}`] = d2[k];
    }
    const c = clients[String(price.insCode)];
    if (c) {
      const map = { Buy_CountI: 'n_buy_count', Buy_I_Volume: 'n_buy_vol', Buy_CountN: 'l_buy_count',
        Buy_N_Volume: 'l_buy_vol', Sell_CountI: 'n_sell_count', Sell_I_Volume: 'n_sell_vol',
        Sell_CountN: 'l_sell_count', Sell_N_Volume: 'l_sell_vol' };
      for (const [dst, src] of Object.entries(map)) if (Number.isFinite(c[src])) out[dst] = c[src];
    }
    const trades = parseAmount(price.tno);
    out.traded = Number.isFinite(trades) && trades > 0;
    return out;
  });
}

/* ─────────────────────────── TSETMC: تاریخچهٔ تعدیل‌شده ─────────────────────────── */

/**
 * متن `members.tsetmc.com/tsev2/chart/data/Financial.aspx?i=…&t=ph&a=1`
 * → کندل‌های {d,o,h,l,c,v} (date,pmax,pmin,pf,pl,tvol,pc) مرتب بر اساس تاریخ.
 */
export function parseChartCsv(text) {
  const bars = [];
  for (const chunk of String(text).split(';')) {
    const items = chunk.split(',').filter(x => x !== '');
    if (items.length < 7) continue;
    const [d, pmax, pmin, pf, pl, tvol, pc] = items.slice(0, 7).map(parseAmount);
    const close = Number.isFinite(pc) && pc > 0 ? pc : pl;
    if (!Number.isFinite(close) || close <= 0) continue;
    bars.push({ d, o: pf, h: pmax, l: pmin, c: close, v: tvol });
  }
  bars.sort((a, b) => a.d - b.d);
  return bars;
}

/* ─────────────────────────── بورس‌تریدر (متن صفحه) ─────────────────────────── */

const BT_FIELDS = [
  ['pl', 'قیمت آخرین', 'price'], ['pc', 'قیمت پایانی', 'price'], ['pf', 'قیمت اولین', 'price'],
  ['py', 'دیروز', 'price'], ['pmin', 'حداقل', 'price'], ['pmax', 'حداکثر', 'price'],
  ['tvol', 'حجم معاملات', 'volume'], ['tval', 'ارزش معاملات', 'toman'], ['tno', 'تعداد معاملات', 'count'],
  ['netRealMoneyToday', 'ورود پول', 'toman'], ['bvol', 'حجم مبنا', 'volume'],
  ['zTitad', 'تعداد سهام', 'volume'], ['marketCap', 'ارزش بازار', 'toman'],
  ['pe', 'P/E', 'ratio'], ['sectorPE', 'Group P/E', 'ratio'], ['eps', 'EPS', 'eps'],
  ['psr', 'P/S', 'ratio'], ['avgVolMonth', 'میانگین حجم ماه', 'volume'],
  ['avgVolWeek', 'میانگین حجم هفته', 'volume'], ['surplusVolMonth', 'حجم مشکوک ماه', 'volume'],
  ['demandPerCapita', 'سرانه تقاضا', 'eps'], ['supplyPerCapita', 'سرانه عرضه', 'eps'],
  ['buyPower', 'قدرت خرید', 'ratio'], ['volToFloatPct', 'حجم به شناوری', 'percent'],
  ['volToSharesPct', 'حجم به کل شرکت', 'percent'],
];
const BT_TOMAN = new Set(['price', 'toman', 'eps']);

/** متن صفحهٔ نماد بورس‌تریدر → فیلدهای تابلورادار (تومان → ریال) */
export function btSymbolFromText(text, symbol) {
  const words = tokenize(text.includes('<') ? stripTags(text) : text);
  const out = { symbol, source: 'bourse-trader.ir/symbol', ambiguous: [] };
  for (const [field, label, unit] of BT_FIELDS) {
    const groups = findNumbers(words, label, {
      allowPercent: unit === 'percent', notAfter: field === 'pe' || field === 'eps' ? ['Group'] : [],
    }).filter(g => g.length);
    if (!groups.length) continue;
    let val = groups[0][0];
    if (BT_TOMAN.has(unit)) val *= 10;               // تومان → ریال
    out[field] = val;
    if (groups.slice(1).some(g => Math.abs(g[0] - val) > 1e-6)) out.ambiguous.push(field);
  }
  const ff = findNumbers(words, 'سهام شناور', { allowPercent: true }).filter(g => g.length >= 2);
  if (ff.length) {
    out.freeFloatShares = ff[0][0];
    const pct = ff[0].slice(1).find(v => v > 0 && v <= 100);
    if (pct !== undefined) out.freeFloatPct = pct;
  }
  const book = btBook(words);
  if (book.length) out.book = book;
  return out;
}

const BOOK_HEADER = ['تعداد', 'ارزش', 'حجم', 'قیمت', 'قیمت', 'حجم', 'ارزش', 'تعداد'];

function bookNumber(tok) {
  const core = faDigits(tok).replace(/,/g, '');
  if (!/^\d/.test(core)) return NaN;
  const m = core.match(/^(\d[\d.]*[KkMmBbTt]?)/);
  return m ? parseAmount(m[1]) : NaN;
}

function btBook(words) {
  for (let i = 0; i + BOOK_HEADER.length <= words.length; i++) {
    if (!BOOK_HEADER.every((h, k) => words[i + k] === h)) continue;
    const nums = [];
    let scanned = 0;
    for (let j = i + BOOK_HEADER.length; j < words.length && nums.length < 40 && scanned < 120; j++, scanned++) {
      const v = bookNumber(words[j]);
      if (Number.isFinite(v)) nums.push(v);
      else if (/[%٪]/.test(words[j])) continue;
      else if (nums.length && /^[\u0600-\u06FF]/.test(words[j])) break;
    }
    if (nums.length < 40) continue;
    return Array.from({ length: 5 }, (_, lvl) => {
      const [bc, bv, bq, bp, ap, aq, av, ac] = nums.slice(lvl * 8, lvl * 8 + 8);
      return { i: lvl + 1, bidCount: bc, qd: bq, pd: bp * 10, askCount: ac, qo: aq, po: ap * 10, bid_val_toman: bv, ask_val_toman: av };
    });
  }
  return [];
}

const BT_OVERVIEW = [
  ['index_total', 'شاخص کل', 'index'], ['index_equal', 'شاخص هم وزن', 'index'],
  ['index_fara', 'شاخص کل فرابورس', 'index'], ['market_cap', 'ارزش بازار', 'toman'],
  ['retail_trade_value', 'معاملات خرد', 'toman'], ['retail_volume', 'حجم معاملات خرد', 'volume'],
  ['symbols_up', 'تعداد نماد مثبت', 'count'], ['symbols_down', 'تعداد نماد منفی', 'count'],
  ['per_capita_buy', 'سرانه خرید حقیقی', 'ratio'], ['per_capita_sell', 'سرانه فروش حقیقی', 'ratio'],
  ['orders_buy_value', 'ارزش سفارشات خرید', 'toman'], ['orders_sell_value', 'ارزش سفارشات فروش', 'toman'],
];

/** متن صفحهٔ اصلی بورس‌تریدر → نبض بازار (ریال) */
export function btOverviewFromText(text) {
  const words = tokenize(text.includes('<') ? stripTags(text) : text);
  const out = { source: 'bourse-trader.ir (صفحهٔ اصلی)', unit: 'rial' };
  for (const [field, label, unit] of BT_OVERVIEW) {
    const notAfter = field === 'retail_trade_value' ? ['حجم'] : (field === 'retail_volume' ? ['ارزش'] : []);
    const val = firstNumber(words, label, { notAfter });
    if (Number.isFinite(val)) out[field] = unit === 'toman' ? val * 10 : val;
  }
  const inflow = findNumbers(words, 'ورود پول حقیقی به معاملات خرد', { window: 12, allowPercent: true, maxWordGap: 2 });
  for (const g of inflow) if (g.length) { out.retail_money_inflow_rial = g[0] * 1e9 * 10; break; }
  out.top_inflow = btFlowTable(words, 'بیشترین ورود پول حقیقی', 'بیشترین خروج پول حقیقی');
  out.top_outflow = btFlowTable(words, 'بیشترین خروج پول حقیقی', 'ورود پول حقیقی به معاملات خرد');
  return out;
}

function btFlowTable(words, heading, stopHeading) {
  const head = heading.split(/\s+/), stop = (stopHeading || '').split(/\s+/).filter(Boolean);
  let start = -1;
  for (let i = 0; i + head.length <= words.length; i++) {
    if (head.every((h, k) => words[i + k] === h)) { start = i + head.length; break; }
  }
  if (start < 0) return [];
  const rowsOut = [];
  for (let i = start; i < words.length && rowsOut.length < 30;) {
    if (stop.length && stop.every((s, k) => words[i + k] === s)) break;
    const m = words[i].match(/^⟦([^⟧]+)⟧$/);
    if (!m) { i++; continue; }
    const nums = [];
    let j = i + 1;
    for (; j < words.length && j < i + 8 && !/^⟦[^⟧]+⟧$/.test(words[j]); j++) {
      const v = parseAmount(words[j]);
      if (Number.isFinite(v)) nums.push(v);
      else if (isWord(words[j]) && nums.length) break;
    }
    if (nums.length >= 3) rowsOut.push({ symbol: m[1], money_toman: nums[0], money_rial: nums[0] * 10,
      last_change_pct: nums[1], real_volume: nums[2], volume: nums[3] ?? null });
    i = j > i ? j : i + 1;
  }
  return rowsOut;
}
