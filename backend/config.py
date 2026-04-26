from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    groq_api_key: str                                       # GROQ_API_KEY
    glm_api_key: str = ""                                   # GLM_API_KEY (zhipu AI, plan generation)
    google_api_key: str                                     # GOOGLE_API_KEY
    google_api_keys: list[str] = []                        # GOOGLE_API_KEYS (comma-separated for rotation)
    s2_api_key: str = ""                                    # S2_API_KEY (optional for unauthenticated fallback)
    tavily_api_key: str = ""                                # TAVILY_API_KEY
    edgequake_base_url: str = "http://localhost:3000"       # EDGEQUAKE_BASE_URL
    edgequake_api_key: str = ""                             # EDGEQUAKE_API_KEY
    edgequake_tenant_id: str = "00000000-0000-0000-0000-000000000002"  # EDGEQUAKE_TENANT_ID
    redis_url: str = "redis://localhost:6379"               # REDIS_URL
    
    @property
    def google_api_key_list(self) -> list[str]:
        """Return list of Google API keys, with primary key first"""
        if not self.google_api_keys:
            return [self.google_api_key]
        # Ensure primary key is first
        keys = [k for k in self.google_api_keys if k != self.google_api_key]
        return [self.google_api_key] + keys

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()
