from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router
from app.core.config import get_settings
from app.core.errors import ApiError, api_error_handler, http_error_handler
from app.db.database import run_migrations


settings = get_settings()

app = FastAPI(title="Mukai API", version="0.1.0")
app.add_exception_handler(ApiError, api_error_handler)
app.add_exception_handler(HTTPException, http_error_handler)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[str(origin) for origin in settings.cors_origins],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(router)


@app.on_event("startup")
def startup() -> None:
    if settings.auto_migrate:
        run_migrations()
