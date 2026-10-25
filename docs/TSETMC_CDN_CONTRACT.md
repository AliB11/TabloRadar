# قرارداد تأییدشدهٔ CDN رسمی TSETMC

این قرارداد از سه پاسخ واقعی نماد «فولاد» با `insCode=46348559193224090` استخراج شده است.
بروزرسانی ۱۴۰۵/۰۸/۰۳: **هر سه endpoint روی GET هدر `Access-Control-Allow-Origin: *` می‌فرستند** —
پس مرورگر بدون سرور و بدون پروکسی می‌تواند مستقیم بخواند (کلاینت: `assets/js/cdn.js`).

## ۱) شناسنامه

`GET https://cdn.tsetmc.com/api/Instrument/GetInstrumentInfo/{insCode}`

ریشه: `instrumentInfo`. فیلدهای تودرتو مهم: `eps`, `sector`, `staticThreshold`. مقدار `eps.epsValue=null` صفر نیست و `estimatedEPS` جداگانه با برچسب برآوردی نگهداری می‌شود.
فیلدهای ۵۲هفته/ماه (`minYear/maxYear/minWeek/maxWeek`)، میانگین حجم ۳۰ جلسه (`qTotTran5JAvg`)،
شناوری (`kAjCapValCpsIdx`) و پرچم ناظر (`underSupervision`) نیز در همین پاسخ‌اند.

## ۲) تاریخچهٔ خام روزانه

`GET https://cdn.tsetmc.com/api/ClosingPrice/GetClosingPriceDailyList/{insCode}/{days}`

ریشه: `closingPriceDaily`، ترتیب پاسخ جدید→قدیم. نگاشت قطعی:

- O/H/L/C: `priceFirst/priceMax/priceMin/pClosing`
- آخرین: `pDrCotVal`
- دیروز: `priceYesterday`
- حجم: `qTotTran5J`
- ارزش ریالی: `qTotCap`
- تعداد: `zTotTran`

روزهای بدون معامله با OHLC/حجم/ارزش/تعداد صفر حذف می‌شوند. خروجی raw و تعدیل‌نشده فرض می‌شود؛ هیچ ادعای adjusted بودن نداریم.
**توجه:** این endpoint در طول جلسه هم به‌روز می‌شود — سطر نخستِ `days=1` همان تابلوی جاری است؛ مبنای «اسکن بذری».

## ۳) دفتر سفارش

`GET https://cdn.tsetmc.com/api/BestLimits/{insCode}`

ریشه: `bestLimits`. تقاضا: `qTitMeDem/zOrdMeDem/pMeDem`؛ عرضه: `qTitMeOf/zOrdMeOf/pMeOf`. فقط سطوح `number=1..5` پذیرفته می‌شود.

## ۴) آنچه روی CDN وجود ندارد (پروب‌شده در ۱۴۰۵/۰۸/۰۳)

مسیرهای `api/MarketWatch/GetMarketWatch`، `api/Home/GetLastTrades`، `api/Home/GetHomeInfo`،
`api/Tse/GetMarketState`، `api/MarketWatch/GetMarketWatchInit` و `api/ClientType/*` یا صفحهٔ SPA
را برمی‌گردانند یا خالی‌اند. یعنی:

- **فهرست کل بازار و حقیقی/حقوقی از CDN قابل گرفتن نیست** — مسیر آن MarketWatchInit/ClientTypeAll روی
  `old.tsetmc.com` است (بدون CORS؛ فقط از سرور یا پراکسی).
- برای اجرای مرورگری بدون سرور، نقشهٔ `نماد ↔ شناسه` از `data/seed-symbols.json` می‌آید که با
  `node tools/build_seed.mjs` از MarketWatchInit رسمی ساخته می‌شود (۴۲۰ نماد پرگردش سهام)، و در
  اجراهای زندهٔ بعدی با کش خودآموز `localStorage` (`tr.codemap.v1`) تکمیل می‌گردد.

## محدودیت معماری

این سه endpoint تک‌نمادی‌اند. ساختن یا حدس زدن شناسه ممنوع است؛ شناسه فقط از فایل بذری
(منبع: MarketWatchInit رسمی)، کتابخانهٔ خودآموز مرورگر یا پاسخ زندهٔ سرور می‌آید. CDN منبع اول
شناسنامه، تاریخچه و دفتر سفارش هر شناسه است.
