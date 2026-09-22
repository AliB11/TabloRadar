/**
 * events.js — کارت «اتفاقات نماد» (هفتۀ ۲ نقشه راه — سمت UI)
 *
 * خواندن data/events.json (آفلاین/برچسب‌دار) — در نسخۀ متصل، منبع کدال/TSETMC
 * جای همین فایل می‌نشیند؛ ساختار آرایه حفظ می‌شود. اگر فایل نبود، پنل خالی
 * با پیام صادقانۀ «منبع رویداد متصل نیست» می‌آید — نه رویداد ساختگی.
 */

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export async function loadEvents(url = './data/events.json') {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return { events: [], disclaimer: '', err: `HTTP ${res.status}` };
    const j = await res.json();
    return { events: j.events || [], disclaimer: j.disclaimer || '', err: null };
  } catch (e) {
    return { events: [], disclaimer: '', err: String(e && e.message || e) };
  }
}

export const KIND_META = {
  assembly: { icon: 'users', cls: 'ev-a' },
  capincrease: { icon: 'trending-up', cls: 'ev-c' },
  reopen: { icon: 'unlock', cls: 'ev-r' },
  dividend: { icon: 'banknote', cls: 'ev-d' },
  offer: { icon: 'rocket', cls: 'ev-o' },
  profit: { icon: 'file-bar-chart', cls: 'ev-p' },
};

/** رویدادهای یک نماد، مرتب‌شده به وقت؛ قابل آزمون در Node */
export function eventsFor(events, l18) {
  return (events || []).filter(e => e.l18 === l18).sort((a, b) => a.days_ahead - b.days_ahead);
}

/** پیش‌رونده‌ترین رویدادهای کل بازار (فقط آینده و نزدیک‌ترین‌ها) */
export function upcoming(events, limit = 6) {
  return [...(events || [])].filter(e => e.days_ahead >= 0)
    .sort((a, b) => a.days_ahead - b.days_ahead).slice(0, limit);
}

export function daysLabel(d) {
  if (d < 0) return `${-d} روز پیش`;
  if (d === 0) return 'امروز';
  if (d === 1) return 'فردا';
  return `${d} روز دیگر`;
}

export function eventItemHtml(e) {
  const meta = KIND_META[e.type] || { icon: 'calendar', cls: 'ev-a' };
  return `<div class="ev-item ${meta.cls}" data-ev="${esc(e.l18)}">
    <span class="ev-ic" data-lucide="${esc(meta.icon)}" aria-hidden="true"></span>
    <div class="ev-body">
      <div class="ev-t"><b>${esc(e.type_fa)}</b> · <span class="mono" dir="ltr">${esc(e.date)}</span>
        <span class="ev-when">${daysLabel(e.days_ahead)}</span></div>
      <p class="tiny muted" style="margin:2px 0 0">${esc(e.detail)}</p>
    </div>
    ${e.provenance === 'simulated' ? '<span class="chip" title="رویداد شبیه‌سازی‌شده برای نمایش رابط">نمونه</span>' : ''}
  </div>`;
}

/** خلاصهٔ تراکم رویدادها برای ردیف جدول: «۲ رویداد» یا «—» */
export function eventsBadge(events, l18) {
  const mine = eventsFor(events, l18).filter(e => e.days_ahead >= 0);
  if (!mine.length) return '';
  return `<span class="ev-badge" title="${esc(mine.map(e => `${e.type_fa} (${e.date})`).join(' • '))}">⚑ ${mine.length}</span>`;
}
