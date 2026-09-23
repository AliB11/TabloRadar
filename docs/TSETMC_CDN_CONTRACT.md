# قرارداد تأییدشدهٔ CDN رسمی TSETMC

این قرارداد از سه پاسخ واقعی نماد «فولاد» با `insCode=46348559193224090` در ۱۴۰۵/۰۷/۰۱ استخراج شده است. همان endpointها با جایگزینی `insCode` برای هر نماد قابل استفاده‌اند.

## ۱) شناسنامه

`GET https://cdn.tsetmc.com/api/Instrument/GetInstrumentInfo/{insCode}`

ریشه: `instrumentInfo`. فیلدهای تودرتو مهم: `eps`, `sector`, `staticThreshold`. مقدار `eps.epsValue=null` صفر نیست و `estimatedEPS` جداگانه با برچسب برآوردی نگهداری می‌شود.

## ۲) تاریخچه خام روزانه

`GET https://cdn.tsetmc.com/api/ClosingPrice/GetClosingPriceDailyList/{insCode}/{days}`

ریشه: `closingPriceDaily`، ترتیب پاسخ جدید→قدیم. نگاشت قطعی:

- O/H/L/C: `priceFirst/priceMax/priceMin/pClosing`
- آخرین: `pDrCotVal`
- حجم: `qTotTran5J`
- ارزش ریالی: `qTotCap`
- تعداد: `zTotTran`

روزهای بدون معامله با OHLC/حجم/ارزش/تعداد صفر حذف می‌شوند. خروجی raw و تعدیل‌نشده فرض می‌شود؛ هیچ ادعای adjusted بودن نداریم.

## ۳) دفتر سفارش

`GET https://cdn.tsetmc.com/api/BestLimits/{insCode}`

ریشه: `bestLimits`. تقاضا: `qTitMeDem/zOrdMeDem/pMeDem`؛ عرضه: `qTitMeOf/zOrdMeOf/pMeOf`. فقط سطوح `number=1..5` پذیرفته می‌شود.

## محدودیت معماری

این سه endpoint تک‌نمادی‌اند. برای تعمیم، ابتدا باید فهرست معتبر `symbol → insCode` از یک منبع بازار واقعی به دست آید؛ سپس CDN منبع اول شناسنامه، تاریخچه و دفتر سفارش هر شناسه است. بدون endpoint تأییدشدهٔ فهرست کل بازار، ساختن یا حدس شناسه‌ها ممنوع است.
