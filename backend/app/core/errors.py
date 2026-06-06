from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse


class ApiError(Exception):
    def __init__(self, status_code: int, code: str, message: str, details: dict | None = None):
        self.status_code = status_code
        self.code = code
        self.message = message
        self.details = details or {}


def api_error(status_code: int, code: str, message: str, details: dict | None = None) -> ApiError:
    return ApiError(status_code=status_code, code=code, message=message, details=details)


async def api_error_handler(_: Request, exc: ApiError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": {"code": exc.code, "message": exc.message, "details": exc.details}},
    )


async def http_error_handler(_: Request, exc: HTTPException) -> JSONResponse:
    detail = exc.detail if isinstance(exc.detail, dict) else {"message": str(exc.detail)}
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": {"code": detail.get("code", "http_error"), "message": detail.get("message", str(exc.detail)), "details": detail.get("details", {})}},
    )


def sanitize_log(value: str) -> str:
    redacted = value.replace("\\", "/")
    parts = []
    for token in redacted.split():
        if "/" in token:
            parts.append(token.rsplit("/", 1)[-1])
        elif "token=" in token.lower() or "password=" in token.lower() or "secret=" in token.lower():
            parts.append("[redacted]")
        else:
            parts.append(token)
    return " ".join(parts)[-1800:]
