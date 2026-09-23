# تابلورادار — TabloRadar

**کالبدشکافی کمی تابلوی بورس تهران و فرابورس — دیده‌بان، رتبه‌بندی و نقشه معامله با قواعد واقعی تالار (۱۴۰۵)**

یک داشبورد تک‌صفحه‌ای (Landing + Live Dashboard) با هسته ماژولار ES و یک پایپ‌لاین پایتون stdlib که **همان فرمول‌ها** را اجرا می‌کند.
داده از BrsApi، سرویس‌های عمومی TSETMC، بورس‌تریدر و HTML عمومی tablokhani.com خوانده می‌شود؛ کلید API هرگز در ریپو یا مرورگر نمی‌ماند.

> ⚠️ **سلب مسئولیت:** ابزار تحلیل داده است، نه توصیه سرمایه‌گذاری. مسئولیت هر تصمیم معاملاتی با کاربر است.

---

## دادهٔ واقعی یا ساختگی؟ (پاسخ صریح)

* **در کد، همهٔ مسیرها واقعی‌اند**: `assets/js/data.js` و `server.py` و `tsepy/data_provider.py` از سرویس‌های رسمی TSETMC و
  `Api.BrsApi.ir` و صفحه‌های عمومی `bourse-trader.ir` داده می‌خوانند (پارس‌گرهای هر دو سرویس در
  `assets/js/sources.js` و `tsepy/tsetmc_live.py` و `tsepy/bourse_trader.py` با قطعات واقعی آزمون شده‌اند:
  `python3 tools/sources_selftest.py` و `npm test`).
* **سناریوی قطعی شبکه**: آخرین سنگر، فایل `data/offline-snapshot.json` است. نسخهٔ همراه ریپو **شبیه‌سازی‌شده** است —
  لنگرهای قیمت/ارزش معاملات از گزارش‌ها گرفته شده، اما **دفتر سفارش، تفکیک حقیقی/حقوقی و تاریخچه ساختهٔ شبیه‌سازند**.
  این فایل اکنون `data_kind: "simulated"`، `synthetic: true` روی همهٔ رکوردها و فهرست `simulated_fields` دارد.
  داشبورد و `/api/market` آن را **نمایش نمی‌دهند** (fail-closed) و در نبود منبع واقعی پیام خطا می‌دهند؛ فایل فقط fixture توسعه/آزمون است.
* **برای دادهٔ واقعی یکی از این دو کار را انجام دهید:**

```bash
python3 tools/check_data_sources.py                 # آزمون دسترسی به همهٔ منابع (روی ماشین خودتان)
python3 tools/fetch_live_snapshot.py                # رونوشت واقعی: TSETMC + بورس‌تریدر → data/offline-snapshot.json
python3 tools/fetch_live_snapshot.py --history 200 --enrich 120 --bt 15   # عمیق‌تر
python3 server.py                                   # دادهٔ زنده در لحظه (پروکسی + کش دیسکی)
```

پس از اجرای `fetch_live_snapshot.py`، همان فایل `data/offline-snapshot.json` با `data_kind: "live"`،
`provenance` هر رکورد و تاریخ برداشت بازنویسی می‌شود؛ از آن لحظه داشبورد — حتی بدون شبکه — **عدد واقعی** نشان می‌دهد.
(سرویس‌های TSETMC/بورس‌تریدر از بیرون ایران معمولاً در دسترس نیستند؛ این ابزار را روی ماشین/سروری با دسترسی اجرا کنید.)

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
BRS_API_KEY=… python3 server.py      # کلید فقط در محیط سرور می‌ماند؛ فراخوانی مرورگری/CORS ممنوع
# قوانین و قرارداد اتصال: docs/BRSAPI_POLICY.md

# ۲) پایپ‌لاین پایتون (CLI/Cron) — همان فرمول‌ها
python3 main.py --offline            # رتبه‌بندی + out/signals.json + out/signals.csv + دفتر out/runs/
python3 main.py --explain فملی        # دلیل فارسی امتیاز یک نماد
python3 main.py --weights 40 15 15 15 15 --minval 120 --include-base
python3 main.py --offline --backtest  # کارنامۀ مدل → data/model-report.json (walk-forward)
python3 main.py --loop               # اجرای روزانه ۱۲:۳۵ تهران

# ۳) آزمون‌ها
npm test                # ۵۶ آزمون: هسته + میز پژوهش + رندر + بوت کامل (Node، بدون وابستگی)
npm run check           # node --check روی همه ماژول‌ها
npm run wiring          # اتصال DOM/CSS، importها، توازن تگ، نشت کلید
npm run parity          # برابری خروجی JS و Python روی یک داده
npm run parity:sources  # برابری پارس‌گرهای منابع (JS ↔ Python) روی قطعه‌های واقعی
npm run selftest        # ۲۲ خودآزمون بک‌تست: no-lookahead، قطعیت، دفتر ثبت
python3 tools/sources_selftest.py   # آزمون پارس‌گر دادهٔ واقعی روی قطعات برداشت‌شده
python3 tools/check_data_sources.py # کدام منبع روی این ماشین پاسخ می‌دهد؟
python3 tools/fetch_live_snapshot.py# ساخت اسنپ‌شات واقعی برای اجرای بی‌شبکه
```

## ساختار

```
index.html                 مارک‌آپ و محتوای سئو (بخش جدید: میز پژوهش #scorecard)
assets/css/theme.css       سیستم طراحی (بدون Tailwind CDN)
assets/js/tse.js           قواعد بازار + نرمال‌سازی فیلدها + اعداد فارسی
assets/js/indicators.js    RSI · EMA · SMA · MACD · Bollinger · ATR · slope · vol · MDD
assets/js/engine.js         سنجه‌های تابلو، وتوها، ۵ عامل، اطمینان، نقشه، پالس، صنایع
assets/js/sources.js      پارس‌گر منابع واقعی (TSETMC رسمی + بورس‌تریدر) — بدون عدد ساختگی
assets/js/data.js          زنجیره منبع (پروکسی → BrsApi → TSETMC → بورس‌تریدر → tablokhani عمومی → اسنپ‌شات)، تاریخچه، cache
assets/js/scorecard.js     رندر «کارنامۀ مدل» (فقط می‌خواند؛ عدد نمی‌سازد)
assets/js/alerts.js        موتور هشدار شرطی — پارسر فارسی + ارزیابی + اشتراک تلگرام
assets/js/events.js        کارت اتفاقات نماد (خواندن data/events.json / منبع دوم)
assets/js/compare.js       مقایسۀ دو نماد سنجه‌به‌سنجه + نمودار روی‌هم
assets/js/ui.js            رندر جدول/پنل/هیت‌مپ/رادار/دونات/ترمینال/JSON
assets/js/app.js           بوت، فیلتر، تب‌ها، CLI، تور، What-If، خروجی‌ها، بوم دوحالتی
server.py                  استاتیک + /api/market /api/history(+کش دیسکی) /api/info /api/health
main.py · tsepy/*          پایپ‌لاین پایتون (config, data_provider, technical,
                           tablokhani, scoring_engine, backtest, cli_dashboard)
tsepy/tsetmc_live.py       کلاینت TSETMC (MarketWatchInit/ClientTypeAll/ClosingPriceAll/chart)
tsepy/bourse_trader.py     خوانندهٔ عمومی بورس‌تریدر (نبض بازار + تابلو نمادها)
tools/                     fetch_live_snapshot.py (رونوشت واقعی) · check_data_sources.py (آزمون دسترسی) ·
                           sources_selftest.py (۲۲+۵۶ آزمون پارسر) · make_offline_snapshot.py (نمونه برچسب‌دار) ·
                           parity_check.py · check_wiring.py · backtest_check.py · inline_code.py
tests/                     engine.test.mjs · dom.test.mjs · lab.test.mjs · boot.test.mjs ·
                           sources.test.mjs (پارس‌گر منابع روی قطعات واقعی) · fixtures/ (نمونه‌های واقعی)
docs/TSE_MARKET_RESEARCH.md  تحقیق بازار (منبع‌دار) — مبنای قواعد
AUDIT_360.md               پیمایش ۳۶۰ درجه نسخه ۲ (۱۸ یافته + شواهد خط‌به‌خط)
CREATIVE_PROPOSALS.md      ایده‌ها + وضعیت پیاده‌سازی (نقشۀ ۴ هفته‌ای: تحویل شد)
data/offline-snapshot.json اسنپ‌شات برچسب‌دار برای حالت بدون شبکه
data/model-report.json     کارنامۀ مدل (خروجی main.py --backtest)
data/events.json           رویدادهای نماد — برچسب‌دار/شبیه‌سازی (جای‌پذیر با منبع کدال)
data/history/              کش دیسکی تاریخچۀ /api/history (هفتگی؛ gitignore شده)
out/                       signals.{json,csv} + دفتر اسکن‌ها runs/ (خروجی CLI)
```

## میز پژوهش — چه چیزی در v3.1 اضافه شد

1. **کارنامۀ مدل (پایداری سیگنال):** `tsepy/backtest.py` روی همان تاریخچۀ نمادها walk-forward می‌زند:
   امتیاز هستۀ تکنیکال فقط با داده‌های رابط ≤ i محاسبه، ورود در بستهِ رابط بعد، و ارزیابی ۱/۳/۵ جلسه‌ای
   با حدضرر ۱.۶×ATR و هدف ۱.۲×ATR گزارش می‌شود (hit-rate، lift نسبت به بچ‌مارک، بازده مازاد، بازده/ریسک،
   جاروب آستانه‌ها). هر اسکن CLI هم در `out/runs/` ثبت می‌شود و در اجرای بعدی با جلسات سپری‌شده ارزیابی می‌گردد
   (در حالت آفلاین «در انتظار» می‌ماند — هیچ عددی جعل نمی‌شود). UI آن را در بخش «کارنامۀ مدل» می‌خواند.
2. **کارت اتفاقات نماد:** `data/events.json` (مجمع/افزایش‌سرمایه/بازگشایی/عرضه/افصاری) — ستون ⚑ در جدول،
   بلوک «اتفاقات نماد» در کالبدشکافی و تقویم پیش‌رو. فعلاً برچسب‌دار/شبیه‌سازی است؛ ساختار برای منبع کدال آماده است.
3. **کش تاریخچۀ سرور:** `/api/history` با ترتیب mem→`data/history/*.json` (TTL هفتگی)→شبکه؛ خطای شبکه
   با کش کهنه + هدر `X-Cache: disk-stale` جواب می‌دهد — پوشش تکنیکال بدون بار شبکه.
4. **بوم دوحالتی:** دکمۀ «بوم: شبکه عصبی» تصویرسازى معماری ورودی→پنج‌عامل→درجه را نشان می‌دهد (صریحاً تزئینی-آموزشی، نه مدل آموزشی).
5. **هشدار شرطیِ فارسی:** `alert add وبملت قدرت خریدار > 1.4` — پارسر، ارزیابی پس از هر اسکن، متن آمادهٔ اشتراک تلگرام. هیچ‌جا سرور/توکن ذخیره نمی‌شود (localStorage).
6. **مقایسۀ دو نماد:** `compare شپنا وبملت` یا دکمۀ «مقایسه» در کالبدشکافی — بیست سنجه با برندۀ هر سطر + منحنی ۶۰ جلسه.

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
بازه واکشی · تعداد تاریخچه · کلید BrsApi در محیط سرور · دیده‌بان شخصی (localStorage).

## مستندات عمیق

- [`docs/TSE_MARKET_RESEARCH.md`](./docs/TSE_MARKET_RESEARCH.md) — قواعد، زمان‌بندی، دامنه نوسان، حجم مبنا، خُردساختار، داده‌های لحظه بازار، APIها (منبع‌دار)
- [`AUDIT_360.md`](./AUDIT_360.md) — پیمایش ۳۶۰ درجه نسخه ۲: مدل ساختار، ۱۸ یافته با شاهد خط‌به‌خط، روش آزمون و نتایج
- [`CREATIVE_PROPOSALS.md`](./CREATIVE_PROPOSALS.md) — ایده‌های پیاده‌سازی‌شده و بعدی

## لایسنس

MIT — استفاده آزاد با ذکر منبع.
