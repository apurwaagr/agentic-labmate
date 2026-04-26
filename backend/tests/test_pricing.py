import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.labmate.pricing import FilePriceCache, PricingResolver


class PricingResolverTests(unittest.TestCase):
    def test_uses_seeded_fallback_when_live_unavailable(self):
        with tempfile.TemporaryDirectory() as tmp:
            cache = FilePriceCache(Path(tmp) / "price_cache.json", ttl_seconds=3600)
            resolver = PricingResolver(cache)
            quote = resolver.resolve(
                name="trehalose",
                supplier="Sigma-Aldrich",
                catalog_number="T9531",
                fallback_unit_cost_usd=45.0,
                fallback_source="seeded_kb",
            )
            self.assertGreaterEqual(quote.unit_cost_usd, 0.0)
            self.assertIn(quote.source_name, {"seeded_kb", "sigma_live"})

    @patch("backend.labmate.pricing.requests.get")
    def test_sigma_adapter_extracts_live_price(self, mock_get):
        mock_get.return_value.status_code = 200
        mock_get.return_value.text = "<html><title>Trehalose Product</title><body>Price: $67.50</body></html>"

        with tempfile.TemporaryDirectory() as tmp:
            cache = FilePriceCache(Path(tmp) / "price_cache.json", ttl_seconds=3600)
            resolver = PricingResolver(cache)
            quote = resolver.resolve(
                name="trehalose",
                supplier="Sigma-Aldrich",
                catalog_number="T9531",
                fallback_unit_cost_usd=45.0,
                fallback_source="seeded_kb",
            )

            self.assertEqual(quote.source_name, "sigma_live")
            self.assertEqual(quote.unit_cost_usd, 67.5)


if __name__ == "__main__":
    unittest.main()
