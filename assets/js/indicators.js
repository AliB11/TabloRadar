/**
 * indicators.js — اندیکاتورهای تکنیکال (بدون وابستگی، خالص و قابل آزمون)
 * ورودی‌ها آرایه‌های صعودی زمانی هستند: قدیمی‌ترین در خانه ۰.
 */

export const mean = a => (a && a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);

export function sma(values, period) {
  if (!values || values.length < period) return NaN;
  return mean(values.slice(-period));
}

export function ema(values, period) {
  if (!values || values.length < period) return NaN;
  const k = 2 / (period + 1);
  let e = values[0];
  for (const v of values) e = k * v + (1 - k) * e;
  return e;
}

/** سری کامل EMA (برای MACD) */
export function emaSeries(values, period) {
  if (!values || !values.length) return [];
  const k = 2 / (period + 1);
  const out = [];
  let e = values[0];
  for (let i = 0; i < values.length; i++) {
    e = i === 0 ? values[0] : k * values[i] + (1 - k) * e;
    out.push(e);
  }
  return out;
}

/**
 * RSI با روش وایلدر (هموارسازی نمایی) — همان روش رایج در TSETMC/ره‌آورد.
 * @returns {number[]} سری RSI
 */
export function rsiSeries(closes, period = 14) {
  if (!closes || closes.length <= period) return [];
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d; else loss -= d;
  }
  gain /= period; loss /= period;
  const out = new Array(period).fill(NaN);
  out.push(loss === 0 ? 100 : 100 - 100 / (1 + gain / loss));
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gain = (gain * (period - 1) + Math.max(d, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
    out.push(loss === 0 ? 100 : 100 - 100 / (1 + gain / loss));
  }
  return out;
}

export const rsi = (closes, period = 14) => {
  const s = rsiSeries(closes, period);
  return s.length ? s[s.length - 1] : NaN;
};

/** MACD استاندارد (12,26,9) → {macd, signal, hist, histPrev} */
export function macd(closes, fast = 12, slow = 26, signalP = 9) {
  if (!closes || closes.length < slow + signalP) return { macd: NaN, signal: NaN, hist: NaN, histPrev: NaN };
  const ef = emaSeries(closes, fast);
  const es = emaSeries(closes, slow);
  const line = closes.map((_, i) => ef[i] - es[i]).slice(slow - 1);
  const sig = emaSeries(line, signalP);
  const hist = line.map((v, i) => v - sig[i]);
  return {
    macd: line[line.length - 1],
    signal: sig[sig.length - 1],
    hist: hist[hist.length - 1],
    histPrev: hist.length > 1 ? hist[hist.length - 2] : NaN,
  };
}

/** باندهای بولینگر */
export function bollinger(closes, period = 20, mult = 2) {
  if (!closes || closes.length < period) return { mid: NaN, up: NaN, lo: NaN, pctB: NaN, width: NaN };
  const win = closes.slice(-period);
  const mid = mean(win);
  const sd = Math.sqrt(mean(win.map(v => (v - mid) ** 2)));
  const up = mid + mult * sd, lo = mid - mult * sd;
  const last = closes[closes.length - 1];
  return {
    mid, up, lo,
    pctB: up === lo ? NaN : (last - lo) / (up - lo),
    width: mid ? (up - lo) / mid : NaN,
  };
}

/** میانگین نوسان واقعی (ATR) — برای تعیین حد ضرر و هدف قیمتی */
export function atr(bars, period = 14) {
  if (!bars || bars.length <= period) return NaN;
  const trs = [];
  for (let i = 1; i < bars.length; i++) {
    const h = bars[i].h, l = bars[i].l, pc = bars[i - 1].c;
    if (![h, l, pc].every(Number.isFinite)) continue;
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  if (trs.length < period) return NaN;
  return mean(trs.slice(-period));
}

/** بازده ساده n روزه (درصد) */
export function returns(closes, n) {
  if (!closes || closes.length <= n) return NaN;
  const a = closes[closes.length - 1 - n], b = closes[closes.length - 1];
  return a ? ((b - a) / a) * 100 : NaN;
}

/** شیب خطی نرمال‌شده (درصد در هر کندل) — برای سنجش جهت روند */
export function slope(values, period = 20) {
  if (!values || values.length < period) return NaN;
  const y = values.slice(-period);
  const n = y.length;
  const xm = (n - 1) / 2, ym = mean(y);
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (i - xm) * (y[i] - ym); den += (i - xm) ** 2; }
  if (!den || !ym) return NaN;
  return (num / den) / ym * 100;
}

/** بیشترین افت از قله (درصد) — سنجه ریسک */
export function maxDrawdown(closes) {
  if (!closes || closes.length < 2) return NaN;
  let peak = closes[0], dd = 0;
  for (const c of closes) {
    peak = Math.max(peak, c);
    dd = Math.min(dd, (c - peak) / peak);
  }
  return dd * 100;
}

/** انحراف معیار بازده روزانه (نوسان سالانه‌شده، درصد) */
export function annualizedVol(closes) {
  if (!closes || closes.length < 21) return NaN;
  const r = [];
  for (let i = 1; i < closes.length; i++) if (closes[i - 1]) r.push(Math.log(closes[i] / closes[i - 1]));
  if (r.length < 20) return NaN;
  const m = mean(r);
  const sd = Math.sqrt(mean(r.map(v => (v - m) ** 2)));
  return sd * Math.sqrt(252) * 100;
}

/** موقعیت آخرین قیمت در بازه n روزه (۰ = کف، ۱ = سقف) */
export function rangePosition(closes, n = 60) {
  if (!closes || closes.length < 2) return NaN;
  const win = closes.slice(-n);
  const lo = Math.min(...win), hi = Math.max(...win);
  return hi === lo ? 0.5 : (closes[closes.length - 1] - lo) / (hi - lo);
}

/** فشرده‌سازی یک آرایه کندل خام به سری‌های قابل‌استفاده */
export function toSeries(bars) {
  const clean = (bars || []).filter(b => b && Number.isFinite(b.c) && b.c > 0);
  return {
    closes: clean.map(b => b.c),
    volumes: clean.map(b => (Number.isFinite(b.v) ? b.v : NaN)),
    bars: clean,
  };
}
