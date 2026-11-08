<div align="center">
  <img src="dineiq-react/public/logo-readme.svg" alt="DineIQ logo" width="220" />
  <p>Camera-based table monitoring for restaurant teams.</p>
  <p>
    <img alt="React" src="https://img.shields.io/badge/React-20232A?style=flat-square&amp;logo=react&amp;logoColor=61DAFB" />
    <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&amp;logo=typescript&amp;logoColor=white" />
    <img alt="FastAPI" src="https://img.shields.io/badge/FastAPI-009688?style=flat-square&amp;logo=fastapi&amp;logoColor=white" />
    <img alt="PostgreSQL" src="https://img.shields.io/badge/PostgreSQL-4169E1?style=flat-square&amp;logo=postgresql&amp;logoColor=white" />
    <img alt="Ultralytics YOLO" src="https://img.shields.io/badge/Ultralytics-YOLO-111F68?style=flat-square" />
  </p>
</div>

A browser camera sends frames to a FastAPI backend for object detection; a React dashboard presents table states and staff actions.

## Features

- **Table monitoring:** estimate occupancy and flag visible items that may need cleaning.
- **Automatic setup:** discover tables and visible seats, with manual adjustments when needed.
- **Staff workflows:** record service, cleaning acknowledgements, and activity; optionally send alerts to a Telegram group.
- **Access control:** manage admin and staff accounts, passwords, and first-run setup.
- **Calibration:** adjust detection settings and occupancy confirmation delays.

Occupancy and cleaning states are estimates, not guarantees. Camera position, lighting, occlusion, and the objects visible to the model affect results. Staff should verify cleaning in person.

## Tech stack

React, TypeScript, Vite, and Tailwind CSS on the frontend; Python, FastAPI, PostgreSQL, and Alembic on the backend; Ultralytics YOLO and OpenCV for vision.

## Getting started

You need Python 3.12, Node.js compatible with Vite (`^20.19.0` or `>=22.12.0`), PostgreSQL, a browser-accessible camera, and YOLO instance-segmentation weights. CPU inference is supported; see the [backend guide](dineiq-fastapi/README.md) for CUDA setup.

The commands below use PowerShell and start from the repository root.

### 1. Set up the backend

```powershell
Set-Location dineiq-fastapi
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

Create a PostgreSQL database and update `DATABASE_URL` in `.env`. Keep any existing `.env` instead of overwriting it. Place `yolo26m-seg.pt` at `../downloads/models/yolo26m-seg.pt` relative to the repository root, or set `YOLO_MODEL_PATH` in `.env` to the weights file. Relative model paths are resolved from `dineiq-fastapi/`. See [model setup](dineiq-fastapi/README.md#webcam-detection) for the download and configuration details.

Apply migrations and create a single-use setup code:

```powershell
.\.venv\Scripts\python.exe -m alembic upgrade head
.\.venv\Scripts\python.exe scripts/setup.py issue-code
```

The code expires after 30 minutes. If an administrator already exists, sign in instead. Back up an existing database before applying migrations.

### 2. Set up the frontend

```powershell
Set-Location ../dineiq-react
npm ci
```

The frontend uses the browser's hostname and scheme on port `8000` for the API by default. To override this, copy `dineiq-react/.env.example` to `.env` and set `VITE_API_URL`. Use consistent hostnames for the frontend and API so session cookies work.

### 3. Run the application

From `dineiq-fastapi/`:

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

In another terminal, from `dineiq-react/`:

```powershell
npm run dev
```

Open the URL printed by Vite, usually [localhost:5173](http://localhost:5173), and complete the setup flow. Start the camera, review detected tables and seats, and adjust the layout if needed. The API documentation is available at [localhost:8000/docs](http://localhost:8000/docs).

## Deployment notes

- Run **one backend worker**: monitoring and alert dispatch rely on the current single-worker architecture.
- Configure `DATABASE_URL`, exact `CORS_ORIGINS`, and the model path for the deployment. Set `AUTH_SECURE_COOKIE=true` when using HTTPS.
- Serve the frontend over HTTPS for camera access on remote devices. Configure frontend hosting to return `index.html` for application routes without intercepting API or asset requests.
- Apply migrations explicitly before starting the updated application. Keep database backups and secrets outside the repository.

See the [backend guide](dineiq-fastapi/README.md) and [frontend guide](dineiq-react/README.md) for configuration and operational details.

## Development checks

```powershell
# From dineiq-fastapi/
.\.venv\Scripts\python.exe -m ruff check .
.\.venv\Scripts\python.exe -m ruff format --check .

# From dineiq-react/
npm run lint
npm run typecheck
```

This checkout does not currently include backend or frontend test suites.

## Project structure

```text
dineiq-react/      React dashboard and camera capture
dineiq-fastapi/    API, monitoring, authentication, and migrations
docs/              Table layout and calibration guides
identify.py        Separate command-line video detection utility
```

The root Python requirements belong to `identify.py`; the dashboard backend uses its own requirements in `dineiq-fastapi/`.

## Privacy and limitations

Camera frames are sent to the configured backend for transient inference. The application stores derived layout and monitoring data, accounts, and settings; it does not record video or save camera frames. Evaluate the system in its intended environment before relying on its estimates.

For more detail, see [automatic table layouts](docs/automatic-table-layout.md) and [calibration](docs/calibration.md).
