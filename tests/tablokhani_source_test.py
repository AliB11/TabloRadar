import unittest

from tsepy import tablokhani_source as tk


class TablokhaniPublicSourceTests(unittest.TestCase):
    def test_homepage_symbols_only_accepts_plain_public_symbol_links(self):
        html = '''<a href="/%D9%81%D9%88%D9%84%D8%A7%D8%AF">فولاد</a>
        <a href="/stock-screener/hot-money">پول داغ</a>
        <a href="/%D9%88%D8%A8%D9%85%D9%84%D8%AA">وبملت</a>
        <a href="/auth/login">ورود</a><a href="/%D9%81%D9%88%D9%84%D8%A7%D8%AF">فولاد</a>'''
        self.assertEqual(tk.homepage_symbols(html), ["فولاد", "وبملت"])

    def test_symbol_parser_keeps_only_explicit_public_numbers(self):
        html = '''<html><body><h1>فولاد - فولاد مباركه اصفهان</h1>
        <div>آخرین قیمت ۳,۳۵۰</div><div>قیمت پایانی ۳,۳۵۰</div>
        <div>اولین قیمت ۳,۳۵۰</div><div>تعداد معاملات ۱۶,۸۸۵</div>
        <div>حجم معاملات ۱,۷۹۵M</div><div>ارزش معاملات ۶,۰۰۶B</div>
        <div>حجم مبنا ۱</div><div>تعداد سهم ۱,۹۳۵,۰۰۰M</div>
        <div>ارزش بازار ۶,۴۸۲,۲۵۰B</div>
        <div>آخرین معامله: ۳,۳۵۰</div><div>پایانی: ۳,۳۵۰</div>
        <div>کمترین: ۳,۲۸۰</div><div>بیشترین: ۳,۳۵۰</div><div>دیروز: ۳,۲۶۰</div>
        <div>قیمت مجاز ۳,۳۵۰ - ۳,۱۷۰</div></body></html>'''
        row = tk.parse_symbol(html, "فولاد")
        self.assertEqual(row["pl"], 3350)
        self.assertEqual(row["pc"], 3350)
        self.assertEqual(row["tvol"], 1_795_000_000)
        self.assertEqual(row["tval"], 6_006_000_000_000)
        self.assertEqual((row["tmin"], row["tmax"]), (3170, 3350))
        self.assertEqual(row["provenance"], "tablokhani.com-public")
        self.assertFalse(row["synthetic"])

    def test_private_and_realtime_routes_are_refused_before_network(self):
        for path in ("/auth", "/dashboard", "/realtime-data"):
            with self.assertRaises(ValueError):
                tk.fetch_html(path)


if __name__ == "__main__":
    unittest.main()
