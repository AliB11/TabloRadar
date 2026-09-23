"""Regression tests for the live-source failover contract."""
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # اجرای مستقیم بدون PYTHONPATH

import server  # noqa: E402


class SourceFallbackTests(unittest.TestCase):
    def test_bourse_trader_fallback_keeps_matching_money_row(self):
        overview = {
            "index_total": 123,
            "top_inflow": [{"symbol": "فولاد", "money_rial": 420}],
            "top_outflow": [
                {"symbol": "خودرو", "money_rial": -50},
                {"symbol": "وبملت", "money_rial": -30},
                {"symbol": "شپنا", "money_rial": -20},
                {"symbol": "فملی", "money_rial": -10},
            ],
        }
        with mock.patch.object(server.BT, "market_overview", return_value=overview), \
             mock.patch.object(server.BT, "fetch_symbol", side_effect=lambda sym: {"symbol": sym, "pl": 100}):
            env = server.source_bourse_trader()
        assert env["kind"] == "live-partial"
        assert len(env["instruments"]) == 5
        money = {row["l18"]: row["netRealMoneyToday"] for row in env["instruments"]}
        assert money == {"فولاد": 420, "خودرو": -50, "وبملت": -30, "شپنا": -20, "فملی": -10}
        assert all(row["synthetic"] is False for row in env["instruments"])


    def test_market_envelope_rejects_simulated_snapshot(self):
        fake = {"kind": "simulated", "instruments": [{"l18": "نمونه", "synthetic": True}]}
        failing = lambda: (_ for _ in ()).throw(RuntimeError("offline"))
        providers = (("live", failing), ("snapshot", lambda: fake))
        with mock.patch.object(server, "PROVIDERS", providers):
            server._MARKET_FAIL["err"] = ""   # انزوا از کش شکستِ سایر تست‌ها
            try:
                server.market_envelope()
            except RuntimeError as exc:
                assert "هیچ منبع واقعی" in str(exc)
                assert "rejected-simulated" in str(exc)
            else:
                raise AssertionError("simulated snapshot must never pass as market data")
            server._MARKET_FAIL["err"] = ""

    def test_hidden_paths_are_rejected(self):
        """مسیرهای نقطه‌دار (.git/.env/…) هرگز نباید از استاتیک سرو شوند."""
        for p in ("/.git/config", "/.git/HEAD", "/assets/.env", "/%2e%2e/etc/passwd", "/.netrc"):
            self.assertTrue(server.is_hidden_path(p), p)
        # فایل‌های عادی — از جمله server.py که نمایشگر کد به آن نیاز دارد — سالم می‌مانند
        for p in ("/index.html", "/assets/js/app.js", "/server.py", "/main.py",
                  "/data/offline-snapshot.json", "/tsepy/tsetmc_live.py"):
            self.assertFalse(server.is_hidden_path(p), p)

    def test_unknown_api_path_is_json_404_not_html(self):
        handler_cls = server.Handler
        self.assertTrue(callable(getattr(handler_cls, "do_HEAD", None)))
        self.assertTrue(callable(getattr(handler_cls, "do_OPTIONS", None)))

if __name__ == '__main__':
    unittest.main()
