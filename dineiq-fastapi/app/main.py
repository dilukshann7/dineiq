import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import SQLAlchemyError
from starlette.concurrency import run_in_threadpool

from app.alerts.delivery import TelegramDelivery
from app.api.routes.activity import router as activity_router
from app.api.routes.auth import router as auth_router
from app.api.routes.calibration import router as calibration_router
from app.api.routes.detect import router as detection_router
from app.api.routes.health import router as health_router
from app.api.routes.monitoring import router as monitoring_router
from app.api.routes.settings import router as settings_router
from app.api.routes.setup import router as setup_router
from app.api.routes.staff import router as staff_router
from app.auth.service import AuthService
from app.core.config import Settings, get_settings
from app.db.session import create_db_engine
from app.detector import Detector
from app.monitoring.service import MonitoringService
from app.setup.lifecycle import LifecycleGate, LifecycleMiddleware
from app.setup.service import SetupService


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings if settings is not None else get_settings()

    @asynccontextmanager
    async def lifespan(application: FastAPI) -> AsyncIterator[None]:
        engine = create_db_engine(settings)
        application.state.engine = engine
        application.state.auth = AuthService(engine)
        application.state.detector = Detector(settings)
        service = MonitoringService(engine, application.state.detector)
        application.state.monitoring = service
        delivery = TelegramDelivery(service, settings)
        gate = LifecycleGate()
        application.state.lifecycle = gate
        application.state.setup = SetupService(
            engine, application.state.auth, service, delivery, gate
        )

        async def monitor_feed():
            while True:
                await asyncio.sleep(1)
                await run_in_threadpool(gate.background, service.watchdog)
                service.previews.expire()

        watchdog = asyncio.create_task(monitor_feed())

        async def deliver_alerts():
            while True:
                await asyncio.sleep(1)
                await run_in_threadpool(gate.background, delivery.tick)

        dispatcher = asyncio.create_task(deliver_alerts())
        try:
            yield
        finally:
            watchdog.cancel()
            dispatcher.cancel()
            with suppress(asyncio.CancelledError):
                await watchdog
            with suppress(asyncio.CancelledError):
                await dispatcher
            engine.dispose()

    application = FastAPI(title=settings.app_name, version="0.1.0", lifespan=lifespan)
    application.state.settings = settings
    application.add_middleware(LifecycleMiddleware)
    application.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "X-CSRF-Token"],
    )

    @application.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError):
        return JSONResponse(
            status_code=422,
            content={
                "detail": [
                    {key: error[key] for key in ("loc", "msg", "type")} for error in exc.errors()
                ]
            },
        )

    @application.exception_handler(SQLAlchemyError)
    async def database_error(request: Request, exc: SQLAlchemyError):
        return JSONResponse(
            status_code=503,
            content={"detail": "Database unavailable. Check PostgreSQL and migrations."},
        )

    @application.middleware("http")
    async def private_responses(request: Request, call_next):
        response = await call_next(request)
        if request.url.path != "/health":
            response.headers["Cache-Control"] = "no-store"
        return response

    application.include_router(auth_router)
    application.include_router(setup_router)
    application.include_router(settings_router)
    application.include_router(calibration_router)
    application.include_router(staff_router)
    application.include_router(activity_router)
    application.include_router(health_router)
    application.include_router(detection_router)
    application.include_router(monitoring_router)
    return application


app = create_app()
