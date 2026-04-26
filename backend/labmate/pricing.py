from __future__ import annotations

import json
import re
import time
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

import requests


@dataclass
class PriceQuote:
    unit_cost_usd: float
    currency: str
    unit: str
    source_url: str
    source_name: str
    retrieved_at: str
    confidence: float
    raw_title: str

    def to_material_fields(self) -> Dict[str, Any]:
        return {
            "unitCostUsd": max(0.0, round(self.unit_cost_usd, 2)),
            "pricingSource": self.source_name,
            "pricingConfidence": round(max(0.0, min(1.0, self.confidence)), 3),
            "pricingTimestamp": self.retrieved_at,
            "pricingSourceUrl": self.source_url,
            "pricingRawTitle": self.raw_title,
        }


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class FilePriceCache:
    def __init__(self, cache_file: Path, ttl_seconds: int = 86400) -> None:
        self.cache_file = cache_file
        self.ttl_seconds = ttl_seconds
        self.cache_file.parent.mkdir(parents=True, exist_ok=True)

    def _read(self) -> Dict[str, Any]:
        if not self.cache_file.exists():
            return {}
        try:
            return json.loads(self.cache_file.read_text())
        except Exception:
            return {}

    def _write(self, data: Dict[str, Any]) -> None:
        self.cache_file.write_text(json.dumps(data, indent=2))

    def get(self, key: str, allow_stale: bool = False) -> Optional[PriceQuote]:
        data = self._read()
        record = data.get(key)
        if not isinstance(record, dict):
            return None
        stored_at = float(record.get("_stored_at", 0))
        age = time.time() - stored_at
        if age > self.ttl_seconds and not allow_stale:
            return None
        try:
            return PriceQuote(
                unit_cost_usd=float(record["unit_cost_usd"]),
                currency=str(record.get("currency", "USD")),
                unit=str(record.get("unit", "unit")),
                source_url=str(record.get("source_url", "")),
                source_name=str(record.get("source_name", "cache")),
                retrieved_at=str(record.get("retrieved_at", _now_iso())),
                confidence=float(record.get("confidence", 0.3)),
                raw_title=str(record.get("raw_title", "")),
            )
        except Exception:
            return None

    def set(self, key: str, quote: PriceQuote) -> None:
        data = self._read()
        data[key] = {
            **asdict(quote),
            "_stored_at": time.time(),
        }
        self._write(data)


def _extract_price_from_text(text: str) -> Optional[float]:
    price_match = re.search(r"\$\s*([0-9]+(?:\.[0-9]{1,2})?)", text)
    if price_match:
        return float(price_match.group(1))
    return None


def _extract_product_title(text: str) -> str:
    title_match = re.search(r"<title>(.*?)</title>", text, flags=re.IGNORECASE | re.DOTALL)
    if title_match:
        return " ".join(title_match.group(1).split())[:180]
    return ""


class SigmaAdapter:
    name = "sigma_live"

    def fetch(self, *, name: str, catalog_number: str) -> Optional[PriceQuote]:
        if not catalog_number or catalog_number.upper() in {"TBD", "N/A"}:
            return None
        url = f"https://www.sigmaaldrich.com/US/en/product/{catalog_number}"
        try:
            response = requests.get(url, timeout=8)
            if response.status_code >= 400:
                return None
            price = _extract_price_from_text(response.text)
            if price is None:
                return None
            return PriceQuote(
                unit_cost_usd=price,
                currency="USD",
                unit="unit",
                source_url=url,
                source_name=self.name,
                retrieved_at=_now_iso(),
                confidence=0.7,
                raw_title=_extract_product_title(response.text) or name,
            )
        except Exception:
            return None


class ThermoAdapter:
    name = "thermo_live"

    def fetch(self, *, name: str, catalog_number: str) -> Optional[PriceQuote]:
        if not catalog_number or catalog_number.upper() in {"TBD", "N/A"}:
            return None
        url = f"https://www.thermofisher.com/order/catalog/product/{catalog_number}"
        try:
            response = requests.get(url, timeout=8)
            if response.status_code >= 400:
                return None
            price = _extract_price_from_text(response.text)
            if price is None:
                return None
            return PriceQuote(
                unit_cost_usd=price,
                currency="USD",
                unit="unit",
                source_url=url,
                source_name=self.name,
                retrieved_at=_now_iso(),
                confidence=0.7,
                raw_title=_extract_product_title(response.text) or name,
            )
        except Exception:
            return None


class PricingResolver:
    def __init__(self, cache: FilePriceCache, ttl_seconds: int = 86400) -> None:
        self.cache = cache
        self.ttl_seconds = ttl_seconds
        self.adapters = {
            "sigma-aldrich": SigmaAdapter(),
            "sigma": SigmaAdapter(),
            "thermo fisher": ThermoAdapter(),
            "thermofisher": ThermoAdapter(),
            "thermo": ThermoAdapter(),
        }

    @staticmethod
    def cache_key(*, supplier: str, catalog_number: str, name: str, region: str = "US") -> str:
        return f"{supplier.strip().lower()}|{catalog_number.strip().upper()}|{name.strip().lower()}|{region}"

    def resolve(
        self,
        *,
        name: str,
        supplier: str,
        catalog_number: str,
        fallback_unit_cost_usd: float,
        fallback_source: str,
        region: str = "US",
    ) -> PriceQuote:
        key = self.cache_key(
            supplier=supplier,
            catalog_number=catalog_number,
            name=name,
            region=region,
        )
        cached = self.cache.get(key)
        if cached:
            return cached

        normalized_supplier = supplier.strip().lower()
        adapter = self.adapters.get(normalized_supplier)
        if adapter:
            live_quote = adapter.fetch(name=name, catalog_number=catalog_number)
            if live_quote and live_quote.confidence >= 0.5:
                self.cache.set(key, live_quote)
                return live_quote

        stale = self.cache.get(key, allow_stale=True)
        if stale:
            return PriceQuote(
                unit_cost_usd=stale.unit_cost_usd,
                currency=stale.currency,
                unit=stale.unit,
                source_url=stale.source_url,
                source_name=f"{stale.source_name}_stale",
                retrieved_at=stale.retrieved_at,
                confidence=max(0.2, stale.confidence - 0.2),
                raw_title=stale.raw_title,
            )

        return PriceQuote(
            unit_cost_usd=max(0.0, float(fallback_unit_cost_usd)),
            currency="USD",
            unit="unit",
            source_url="",
            source_name=fallback_source,
            retrieved_at=_now_iso(),
            confidence=0.4 if fallback_source == "seeded_kb" else 0.25,
            raw_title=name,
        )
