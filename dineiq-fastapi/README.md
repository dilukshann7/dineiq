# DineIQ FastAPI backend

Python 3.12 backend using FastAPI, SQLModel, and a local PostgreSQL database through Psycopg 3. The webcam detection endpoint uses the existing YOLO26m-seg model to find people and dining tables. No custom training is required.

## Install dependencies

Run these commands from this folder in PowerShell:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
Copy-Item .env.example .env
```

The backend has its own environment, separate from the detector's environment in the parent folder. `requirements.txt` contains runtime dependencies; `requirements-dev.txt` also installs tests and linting tools. `requirements.lock.txt` records the complete installed development environment for Windows with Python 3.12 and CUDA 13.0 PyTorch wheels, including their package index. Reproduce that environment with `.\.venv\Scripts\python.exe -m pip install -r requirements.lock.txt`; use `requirements-dev.txt` for the default CPU profile.

The default requirements make CPU PyTorch wheels available. To use an NVIDIA GPU, install the CUDA 13.0 profile instead. It pins matching PyTorch and torchvision CUDA wheels and requires a compatible NVIDIA driver:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-cuda.txt
.\.venv\Scripts\python.exe -c "import torch; print(torch.__version__, torch.cuda.is_available())"
```

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
- `POST /detect`: send a JPEG request body with `Content-Type: image/jpeg`; receives frame dimensions and normalized bounding boxes and optional tabletop polygons for `person` and `dining table` detections. Frames are limited to 2 MiB and 4096 × 4096 pixels.

Vite origins at `http://localhost:5173` and `http://127.0.0.1:5173` are allowed by default. Configure `CORS_ORIGINS` as a JSON array in `.env` to change them.

## Webcam detection

The default model is [YOLO26m-seg](https://github.com/ultralytics/assets/releases/download/v8.4.0/yolo26m-seg.pt). Place the weights at `../../downloads/models/yolo26m-seg.pt` relative to this backend folder or set `YOLO_MODEL_PATH` to a local instance segmentation checkpoint with COCO person and dining table classes. Table polygons trace the largest connected surface after filtering thin supports.

The model loads on the first detection request and is reused. The first request is slower while model loading and GPU initialization finish. Inference runs outside the asynchronous request loop, with a lock preventing concurrent access to the shared predictor. `YOLO_DEVICE=auto` selects CUDA GPU 0 when CUDA-enabled PyTorch and a compatible GPU are available, otherwise CPU. Set `YOLO_DEVICE=cpu` to force CPU or `YOLO_DEVICE=0` to require the first NVIDIA GPU.

`YOLO_IMAGE_SIZE` defaults to `960` and accepts multiples of 32 from 320 to 2048. Larger images retain more detail for distant and partly obscured tables, at greater processing cost. `YOLO_CONFIDENCE` defaults to `0.2`, allowing weaker detections through; this can also increase false positives. `YOLO_HALF=true` enables FP16 on CUDA to reduce GPU memory and compute cost; CPU always uses FP32. Existing `.env` overrides take precedence, so update old `YOLO_DEVICE=cpu` and `YOLO_CONFIDENCE=0.35` values to use the new profile.

In the React frontend, Start camera also starts detection. The browser sends JPEG frames with a maximum dimension of 1280 pixels, one request at a time, targeting up to 30 Hz. Capture and inference count toward the interval; slow responses have no additional idle delay. Processing speed determines the actual detection rate, displayed beside the counts. The live video remains local to the browser; sampled frames are sent to the configured backend. Frames and detections are not saved to disk or PostgreSQL.

No PostgreSQL connection is needed for `/detect`. If the backend is unavailable, the webcam preview continues and offers Retry detection. Stop camera stops sampling and aborts the current browser request; inference already running on the backend can still finish. Predictions provide bounding boxes, not persistent track IDs or table occupancy decisions.

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

Tests use FastAPI's in-process client, mocked database sessions, and mocked model predictions. They do not require a running server or PostgreSQL connection and do not establish that your local database credentials work. Detection tests exercise JPEG validation, request limits, class filtering, and coordinate normalization.

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
