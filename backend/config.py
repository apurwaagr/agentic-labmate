from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    parser_provider: str = "vertex"                         # PARSER_PROVIDER: vertex
    parser_model_groq: str = "llama-3.3-70b-versatile"      # legacy
    parser_model_google: str = "gemini-2.0-flash"           # legacy
    groq_api_key: str = ""                                  # GROQ_API_KEY
    groq_api_keys_raw: str = ""                             # GROQ_API_KEYS (comma-separated for rotation)
    glm_api_key: str = ""                                   # GLM_API_KEY (zhipu AI, plan generation)
    glm_model: str = "glm-4.5-air"                          # GLM_MODEL (EdgeQuake OpenAI-compatible model)
    google_api_key: str = ""                                # GOOGLE_API_KEY
    plan_provider: str = "vertex"                           # PLAN_PROVIDER: vertex
    plan_enable_google_fallback: bool = False               # PLAN_ENABLE_GOOGLE_FALLBACK (default false for production SSE flow)
    plan_model_google: str = "gemini-2.5-flash"             # PLAN_MODEL_GOOGLE
    plan_model_groq: str = "llama-3.3-70b-versatile"        # PLAN_MODEL_GROQ
    google_api_keys: list[str] = []                        # GOOGLE_API_KEYS (comma-separated for rotation)
    s2_api_key: str = ""                                    # S2_API_KEY (optional for unauthenticated fallback)
    tavily_api_key: str = ""                                # TAVILY_API_KEY
    edgequake_base_url: str = "http://localhost:8081"       # EDGEQUAKE_BASE_URL (host port mapped from docker-compose edgequake:8080)
    edgequake_api_key: str = ""                             # EDGEQUAKE_API_KEY
    edgequake_tenant_id: str = "00000000-0000-0000-0000-000000000002"  # EDGEQUAKE_TENANT_ID
    # Per-query overrides sent on every EdgeQuake /query call. These must
    # match the server-side default providers so EdgeQuake never tries to
    # resolve a non-installed provider (e.g. Gemini, whose 429s were the
    # chronic failure mode). "ollama" matches the docker-compose config.
    edgequake_query_provider: str = "ollama"                # EDGEQUAKE_QUERY_PROVIDER
    edgequake_query_model: str = "llama3.2:3b"              # EDGEQUAKE_QUERY_MODEL
    edgequake_query_provider_fallback: str = ""             # EDGEQUAKE_QUERY_PROVIDER_FALLBACK
    edgequake_query_model_fallback: str = ""                # EDGEQUAKE_QUERY_MODEL_FALLBACK
    redis_url: str = "redis://localhost:6379"               # REDIS_URL
    cache_enabled: bool = True                               # CACHE_ENABLED
    cache_namespace: str = "ai_scientist"                    # CACHE_NAMESPACE
    cache_qc_ttl_s: int = 86400                              # CACHE_QC_TTL_S (24h)
    cache_plan_ttl_s: int = 21600                            # CACHE_PLAN_TTL_S (6h)
    
    @property
    def google_api_key_list(self) -> list[str]:
        """Return list of Google API keys, with primary key first"""
        if not self.google_api_keys:
            return [self.google_api_key]
        # Ensure primary key is first
        keys = [k for k in self.google_api_keys if k != self.google_api_key]
        return [self.google_api_key] + keys

    @property
    def groq_api_key_list(self) -> list[str]:
        """Return list of Groq API keys, with primary key first."""
        extra_keys = [k.strip() for k in self.groq_api_keys_raw.split(",") if k.strip()]
        if not extra_keys:
            return [self.groq_api_key] if self.groq_api_key else []
        keys = [k for k in extra_keys if k != self.groq_api_key]
        if self.groq_api_key:
            return [self.groq_api_key] + keys
        return keys

    class Config:
        env_file = (".env", ".env.local")
        extra = "ignore"


settings = Settings()
