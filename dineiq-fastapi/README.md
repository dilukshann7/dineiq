# DineIQ FastAPI backend

Python 3.12 backend using FastAPI, SQLModel, and a local PostgreSQL database through Psycopg 3. This scaffold does not run detection or receive camera frames yet.

## Install dependencies

Run these commands from this folder in PowerShell:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
Copy-Item .env.example .env
```

The backend has its own environment, separate from the detector's environment in the parent folder. `requirements.txt` contains runtime dependencies; `requirements-dev.txt` also installs tests and linting tools. `requirements.lock.txt` records the complete installed development environment for reproducibility on Windows with Python 3.12.

## Configure local PostgreSQL

Using pgAdmin or `psql` as a PostgreSQL administrator, create a dedicated role and database:

```sql
CREATE ROLE dineiq WITH LOGIN PASSWORD 'replace-with-your-local-password';
CREATE DATABASE dineiq OWNER dineiq;
```

Update `.env` with your local credentials:

```dotenv
DATABASE_URL=postgresql+psycopg://dineiq:replace-with-your-local-password@localhost:5432/dineiq
```

Percent-encode special characters in the password when including it in a URL. `.env` is ignored by Git. The application loads this folder's `.env` regardless of the current working directory. Process environment variables take precedence.

## Run when needed

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

- API documentation: <http://127.0.0.1:8000/docs>
- `GET /health`: process liveness, without accessing the database.
- `GET /health/db`: database readiness; returns HTTP 503 when PostgreSQL is unavailable.

Vite origins at `http://localhost:5173` and `http://127.0.0.1:5173` are allowed by default. Configure `CORS_ORIGINS` as a JSON array in `.env` to change them.

## Add models and migrations

Place SQLModel table classes under `app/models/` and import their modules explicitly in `alembic/env.py` so Alembic can discover their metadata. Application folders use Python namespace packages without `__init__.py` files. The scaffold intentionally defines no domain tables and creates no tables at application startup.

Once PostgreSQL is configured and a model exists:

```powershell
.\.venv\Scripts\python.exe -m alembic revision --autogenerate -m "Add initial tables"
.\.venv\Scripts\python.exe -m alembic upgrade head
```

Review generated migrations before applying them. Alembic reads the same database configuration as the application.

Use `SessionDep` from `app.db.session` in synchronous route functions to receive a SQLModel session that closes after the request. Commit writes explicitly; database work uses the synchronous Psycopg driver.

## Checks

```powershell
.\.venv\Scripts\python.exe -m pytest
.\.venv\Scripts\python.exe -m ruff check .
.\.venv\Scripts\python.exe -m ruff format --check .
.\.venv\Scripts\python.exe -m pip check
```

Tests use FastAPI's in-process client and mocked database sessions. They do not require a server or PostgreSQL connection and do not establish that your local database credentials work.

## Layout

```text
app/
  api/routes/health.py   Liveness and database readiness
  core/config.py         Environment-backed settings
  db/session.py          Engine and session dependency
  models/                Future SQLModel table definitions
  main.py                Application factory and middleware
alembic/                 Migration environment and revision files
tests/                   API and configuration tests
```
