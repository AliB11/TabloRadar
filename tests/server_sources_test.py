"""Regression tests for the live-source failover contract."""
import unittest
from unittest import mock

import server


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
            try:
                server.market_envelope()
            except RuntimeError as exc:
                assert "هیچ منبع واقعی" in str(exc)
                assert "rejected-simulated" in str(exc)
            else:
                raise AssertionError("simulated snapshot must never pass as market data")

if __name__ == '__main__':
    unittest.main()
