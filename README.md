# تابلورادار — TabloRadar

**کالبدشکافی کمی تابلوی بورس تهران و فرابورس — دیده‌بان، رتبه‌بندی و نقشه معامله با قواعد واقعی تالار (۱۴۰۵)**

یک داشبورد تک‌صفحه‌ای (Landing + Live Dashboard) با هسته ماژولار ES و یک پایپ‌لاین پایتون stdlib که **همان فرمول‌ها** را اجرا می‌کند.
داده از سرویس‌های عمومی TSETMC / BrsApi خوانده می‌شود؛ کلید API هرگز در ریپو یا مرورگر نمی‌ماند.

> ⚠️ **سلب مسئولیت:** ابزار تحلیل داده است، نه توصیه سرمایه‌گذاری. مسئولیت هر تصمیم معاملاتی با کاربر است.

---

## چه چیزی آن را متمایز می‌کند

| سنجه بومی | چرا در بازار ایران لازم است |
|---|---|
| `capacity` — فاصله تا سقف مجاز (دامنه ۳٪) | سهمی که به سقف چسبیده امروز «جای خرید» ندارد؛ سیگنال بدون این عدد گمراه‌کننده است |
| تشخیص **صف خرید/فروش** از ۵ سطح دفتر سفارش | قفل بودن صف = ریسک گیرافتادن (وتو) یا ادامه روند (امتیاز) |
| **حجم مبنا = ۱** از ۱ دی ۱۴۰۴ | وتوی قدیمی `tVol<bvol` بی‌معنا شد؛ جایش را حجم مشکوک و گردش روزانه گرفت |
| سرانه / **قدرت خریدار** / پول حقیقی خالص | همان سنجه‌هایی که رسانه‌ها و بازیگران تالار دنبال می‌کنند |
| **کد‌به‌کد** (حدس ساختاری) | حقوقی→حقیقی صعودی، حقیقی→حقوقی نزولی |
| P/E **نسبت به میانگین صنعت** | با نرخ بدون ریسک ۲۰–۲۴٪، عدد مطلق P/E گمراه‌کننده است |
| شناوری آزاد، بازار پایه، وضعیت توقف | سه منبع ریسک که در مدل‌های وارداتی وجود ندارد |
| **ضریب اطمینان** (پوشش داده × هم‌راستایی عوامل) | داده ناقص = اطمینان پایین، نه صفر ساختگی |

## اجرا

```bash
# ۱) داشبورد + پروکسی امن داده (بدون هیچ وابستگی)
python3 server.py                    # http://localhost:8000
BRS_API_KEY=… python3 server.py      # کلید فقط در محیط سرور می‌ماند

# ۲) پایپ‌لاین پایتون (CLI/Cron) — همان فرمول‌ها
python3 main.py --offline            # رتبه‌بندی + out/signals.json + out/signals.csv
python3 main.py --explain فملی        # دلیل فارسی امتیاز یک نماد
python3 main.py --weights 40 15 15 15 15 --minval 120 --include-base
python3 main.py --loop               # اجرای روزانه ۱۲:۳۵ تهران

# ۳) آزمون‌ها
npm test                # ۴۱ آزمون: هسته + رندر + بوت کامل (Node، بدون وابستگی)
npm run check           # node --check روی همه ماژول‌ها
npm run wiring          # اتصال DOM/CSS، importها، توازن تگ، نشت کلید
npm run parity          # برابری خروجی JS و Python روی یک داده
```

## ساختار

```
index.html                 مارک‌آپ و محتوای سئو
assets/css/theme.css       سیستم طراحی (بدون Tailwind CDN)
assets/js/tse.js           قواعد بازار + نرمال‌سازی فیلدها + اعداد فارسی
assets/js/indicators.js    RSI · EMA · SMA · MACD · Bollinger · ATR · slope · vol · MDD
assets/js/engine.js         سنجه‌های تابلو، وتوها، ۵ عامل، اطمینان، نقشه، پالس، صنایع
assets/js/data.js          زنجیره منبع، تاریخچه، cache، تنظیمات کاربر
assets/js/ui.js            رندر جدول/پنل/هیت‌مپ/رادار/دونات/ترمینال/JSON
assets/js/app.js           بوت، فیلتر، تب‌ها، CLI، تور، What-If، خروجی‌ها
server.py                  استاتیک + /api/market /api/history /api/info /api/health
main.py · tsepy/*          پایپ‌لاین پایتون (config, data_provider, technical,
                           tablokhani, scoring_engine, cli_dashboard)
tools/                     make_offline_snapshot.py · parity_check.py ·
                           check_wiring.py · inline_code.py
tests/                     engine.test.mjs · dom.test.mjs · boot.test.mjs
docs/TSE_MARKET_RESEARCH.md  تحقیق بازار (منبع‌دار) — مبنای قواعد
AUDIT_360.md               پیمایش ۳۶۰ درجه نسخه ۲ (۱۸ یافته + شواهد خط‌به‌خط)
CREATIVE_PROPOSALS.md      ایده‌ها + وضعیت پیاده‌سازی
data/offline-snapshot.json اسنپ‌شات برچسب‌دار برای حالت بدون شبکه
```

**زنجیره داده:** `server.py /api/market` ← `Api.BrsApi.ir` (کلید کاربر) ← `service.tsetmc.com` ← `data/offline-snapshot.json`.
هر لایه که پاسخ دهد در هدر `X-Data-Source` و در UI («منبع: …») نوشته می‌شود؛ اگر شبکه نرسد، داشبورد با **همان فرمول‌ها روی داده آفلاین** اجرا می‌شود و صریح اعلام می‌کند که آفلاین است.

## APIها و فیلدهای مصرفی

| کاربرد | آدرس |
|---|---|
| اسکن کامل بازار | `BrsApi AllSymbols.php?type=1` · `TSETMC instinfodata.aspx` |
| تاریخچه کندل | `cdn.tsetmc.com/api/ClosingPrice/GetClosingPriceInfoList/{insCode}/{n}` · `BrsApi History.php` |
| اطلاعات تکمیلی (EPS، صنعت، آستانه‌ها) | `cdn.tsetmc.com/api/Instrument/GetInstrumentInfo/{insCode}` |
| دفتر سفارش | `cdn.tsetmc.com/api/BestLimits/{insCode}` |

نام‌های فیلد در منابع مختلف متفاوت است (`pc`/`pClosing`، `pl`/`pDrCotVal`، `tmax`/`psGelStaMax`، `Buy_I_Volume`/`BuyIVolume`)؛
نگاشت در `normalizeInstrument()` انجام می‌شود و بقیه کد فقط مدل یکدست را می‌بیند.

## اسنپ‌شات آفلاین

`python3 tools/make_offline_snapshot.py` بازتولیدش می‌کند:
لنگرها (قیمت پایانی/دیروز، ارزش معاملات، تعداد معاملات) از گزارش‌های ۲۸ تا ۳۰ شهریور ۱۴۰۵ گرفته شده‌اند؛
تفکیک حقیقی/حقوقی، دفتر سفارش و تاریخچه ۲۶۰ جلسه‌ای **شبیه‌سازی قطعی** (seed=14050630) است و در فایل و در UI برچسب دارد.
هدف: اجرای کامل داشبورد و تست‌ها بدون شبکه — نه تحلیل واقعی.

## تنظیمات قابل تغییر از UI

وزن پنج عامل (What-If) · آستانه نقدشوندگی · شمول بازار پایه/صندوق‌ها · اجبار تاریخچه · واحد ریال/تومان · ارقام فارسی ·
بازه واکشی · تعداد تاریخچه · کلید BrsApi · دیده‌بان شخصی (localStorage).

## مستندات عمیق

- [`docs/TSE_MARKET_RESEARCH.md`](./docs/TSE_MARKET_RESEARCH.md) — قواعد، زمان‌بندی، دامنه نوسان، حجم مبنا، خُردساختار، داده‌های لحظه بازار، APIها (منبع‌دار)
- [`AUDIT_360.md`](./AUDIT_360.md) — پیمایش ۳۶۰ درجه نسخه ۲: مدل ساختار، ۱۸ یافته با شاهد خط‌به‌خط، روش آزمون و نتایج
- [`CREATIVE_PROPOSALS.md`](./CREATIVE_PROPOSALS.md) — ایده‌های پیاده‌سازی‌شده و بعدی

## لایسنس

MIT — استفاده آزاد با ذکر منبع.
