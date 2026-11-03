from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy.exc import OperationalError
from sqlmodel import Session

from app.core.config import Settings
from app.db.session import get_session
from app.main import create_app


@pytest.fixture
def settings():
    return Settings(
        _env_file=None,
        database_url="postgresql+psycopg://test:test@127.0.0.1:5432/dineiq_test",
    )


def test_liveness_does_not_require_a_running_database(settings):
    with TestClient(create_app(settings)) as client:
        response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_database_health_checks_the_session(settings):
    app = create_app(settings)
    session = MagicMock(spec=Session)
    session.exec.return_value.one.return_value = 1
    app.dependency_overrides[get_session] = lambda: session
    with TestClient(app) as client:
        response = client.get("/health/db")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "database": "connected"}
    session.exec.assert_called_once()


def test_database_failure_returns_503_without_exposing_connection_details(settings):
    app = create_app(settings)
    session = MagicMock(spec=Session)
    session.exec.side_effect = OperationalError("secret connection details", {}, Exception())
    app.dependency_overrides[get_session] = lambda: session
    with TestClient(app) as client:
        response = client.get("/health/db")
    assert response.status_code == 503
    assert response.json() == {"detail": "Database unavailable"}


def test_vite_origin_is_allowed(settings):
    with TestClient(create_app(settings)) as client:
        response = client.options(
            "/health",
            headers={
                "Origin": "http://localhost:5173",
                "Access-Control-Request-Method": "GET",
            },
        )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"


def test_unknown_origin_is_not_allowed(settings):
    with TestClient(create_app(settings)) as client:
        response = client.options(
            "/health",
            headers={
                "Origin": "https://untrusted.example",
                "Access-Control-Request-Method": "GET",
            },
        )
    assert response.status_code == 400
    assert "access-control-allow-origin" not in response.headers


def test_settings_reject_non_postgresql_databases():
    with pytest.raises(ValidationError):
        Settings(_env_file=None, database_url="sqlite:///test.db")


def test_settings_require_the_installed_psycopg_driver():
    with pytest.raises(ValidationError, match="postgresql\\+psycopg"):
        Settings(_env_file=None, database_url="postgresql://test:test@localhost/dineiq")
