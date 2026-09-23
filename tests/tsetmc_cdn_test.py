import json
import unittest
from unittest import mock

from tsepy import tsetmc_live as tl

CODE = "46348559193224090"


class TsetmcCdnContractTests(unittest.TestCase):
    def test_instrument_info_nested_contract(self):
        payload = {"instrumentInfo": {"insCode": CODE, "lVal18AFC": "فولاد", "lVal30": "فولاد مباركه اصفهان",
            "cIsin": "IRO1FOLD0009", "zTitad": 1935000000000.0, "baseVol": 1, "flow": 1,
            "flowTitle": "بازار بورس", "cgrValCotTitle": "بازار اول (تابلوی اصلی) بورس",
            "dEven": 20260923, "qTotTran5JAvg": 3902110225.0, "kAjCapValCpsIdx": "36",
            "sector": {"cSecVal": "27 ", "lSecVal": "فلزات اساسي"},
            "eps": {"epsValue": None, "estimatedEPS": "518", "sectorPE": 13.48, "psr": 2145.5034},
            "staticThreshold": {"psGelStaMax": 3350.0, "psGelStaMin": 3170.0}}}
        with mock.patch.object(tl, "http_get", return_value=json.dumps(payload)):
            got = tl.instrument_info(CODE)
        self.assertEqual((got["tmin"], got["tmax"]), (3170, 3350))
        self.assertNotEqual(got["eps"], got["eps"])  # epsValue=null => NaN، نه صفر/برآورد
        self.assertEqual(got["eps_estimated"], 518)
        self.assertEqual(got["sectorPE"], 13.48)
        self.assertEqual(got["freeFloat"], 36)

    def test_history_filters_non_trading_days_and_maps_volume_value(self):
        payload = {"closingPriceDaily": [
            {"dEven": 20260922, "priceFirst": 3380, "priceMax": 3380, "priceMin": 3200,
             "pClosing": 3260, "pDrCotVal": 3230, "zTotTran": 45559,
             "qTotTran5J": 3705610251, "qTotCap": 12095800625600},
            {"dEven": 20260805, "priceFirst": 0, "priceMax": 0, "priceMin": 0,
             "pClosing": 2549, "pDrCotVal": 2549, "zTotTran": 0, "qTotTran5J": 0, "qTotCap": 0},
            {"dEven": 20260921, "priceFirst": 3280, "priceMax": 3300, "priceMin": 3200,
             "pClosing": 3290, "pDrCotVal": 3300, "zTotTran": 38289,
             "qTotTran5J": 3581143472, "qTotCap": 11785928323720}]}
        with mock.patch.object(tl, "http_get", return_value=json.dumps(payload)):
            bars = tl.cdn_daily_history(CODE)
        self.assertEqual([b["d"] for b in bars], [20260921, 20260922])
        self.assertEqual(bars[-1]["v"], 3705610251)
        self.assertEqual(bars[-1]["val"], 12095800625600)
        self.assertTrue(bars[-1]["raw"])

    def test_best_limits_maps_five_levels(self):
        payload = {"bestLimits": [{"number": i, "qTitMeDem": 100 * i, "zOrdMeDem": i,
            "pMeDem": 3360 - 10 * i, "pMeOf": 3350 + 10 * i,
            "zOrdMeOf": i + 1, "qTitMeOf": 200 * i} for i in range(1, 6)]}
        with mock.patch.object(tl, "http_get", return_value=json.dumps(payload)):
            book = tl.best_limits(CODE)
        self.assertEqual(len(book), 5)
        self.assertEqual(book[0]["bid"], {"q": 100.0, "p": 3350.0, "n": 1.0})
        self.assertEqual(book[4]["ask"], {"q": 1000.0, "p": 3400.0, "n": 6.0})


if __name__ == "__main__":
    unittest.main()
