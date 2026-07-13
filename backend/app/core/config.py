import json
from functools import lru_cache
from pydantic import AnyHttpUrl, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql://mukai:mukai@postgres:5432/mukai"
    redis_url: str = "redis://redis:6379/0"
    artifact_root: str = "/app/artifacts"
    model_cache_root: str = "/app/model-cache"
    max_upload_bytes: int = 524_288_000
    max_project_archive_bytes: int = 2_147_483_648
    max_project_unpacked_bytes: int = 10_737_418_240
    max_project_archive_entries: int = 10_000
    cors_origins: list[AnyHttpUrl] | list[str] = Field(
        default_factory=lambda: ["http://localhost:5173", "http://localhost:8080"]
    )
    auto_migrate: bool = True
    queue_name: str = "mukai:jobs"
    separation_queue_name: str = "mukai:separation"
    transcription_queue_name: str = "mukai:transcription"
    pitch_queue_name: str = "mukai:pitch"
    allow_cpu_separation: bool = True
    allow_cpu_transcription: bool = True
    allow_cpu_pitch: bool = True
    transcription_batch_size: int = 16
    transcription_low_confidence_threshold: float = 0.55
    pitch_batch_size: int = 2048

    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_cors_origins(cls, value):
        if isinstance(value, str):
            if value.strip().startswith("["):
                return json.loads(value)
            return [item.strip() for item in value.split(",") if item.strip()]
        return value


@lru_cache
def get_settings() -> Settings:
    return Settings()
