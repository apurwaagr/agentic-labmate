from __future__ import annotations

import json
import logging
from typing import Any, Optional

import redis.asyncio as aioredis

from .config import settings

logger = logging.getLogger(__name__)
_redis_client: aioredis.Redis | None = None


def _prefixed(key: str) -> str:
    return f"{settings.cache_namespace}:{key}"


def _client() -> aioredis.Redis:
    global _redis_client
    if _redis_client is None:
        _redis_client = aioredis.from_url(settings.redis_url, decode_responses=True)
    return _redis_client


async def get_json(key: str) -> Optional[dict[str, Any]]:
    if not settings.cache_enabled:
        return None
    try:
        raw = await _client().get(_prefixed(key))
        if not raw:
            return None
        obj = json.loads(raw)
        return obj if isinstance(obj, dict) else None
    except Exception as exc:
        logger.debug("Cache get failed key=%s err=%s", key, exc)
        return None


async def set_json(key: str, value: dict[str, Any], ttl_s: int) -> None:
    if not settings.cache_enabled:
        return
    try:
        await _client().set(_prefixed(key), json.dumps(value), ex=max(1, int(ttl_s)))
    except Exception as exc:
        logger.debug("Cache set failed key=%s err=%s", key, exc)
