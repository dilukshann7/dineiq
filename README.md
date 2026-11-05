# DineIQ

DineIQ is a camera-based dining-space monitoring application for restaurants and community canteens. It estimates table occupancy, flags visible leftover items, and helps staff track service and cleaning tasks through a shared dashboard.

A browser captures camera frames and sends them to a Python backend for YOLO instance segmentation. PostgreSQL stores layouts, monitoring events, accounts, and settings. The React dashboard displays results and records staff actions.

## Features

- **Live camera view:** person boxes and tabletop overlays, with detection status and processing rate.
- **Automatic table setup:** discovers tables and visible chairs, derives seat regions, and starts monitoring after consistent observations. Manual editing is available for corrections.
- **Layout updates:** confirms added, moved, or removed tables over multiple observations. Stable camera-view changes can establish a new layout.
- **Occupancy estimates:** shows Empty, Partly occupied, Full, or Unknown with estimated counts and seat capacity.
- **Cleaning estimates:** identifies supported leftover items at empty tables, with manual corrections and an option to resume automatic assessment.
- **Staff workflows:** records initial service, cleaning acknowledgements, and activity history. Optional Telegram alerts go to one staff group.
- **Admin and staff accounts:** role-based access, first-run onboarding, temporary-password changes, account management, and an admin application-data reset.
- **Runtime calibration:** admin controls for people detection, cleaning detection, and arrival/departure confirmation delays.

## How monitoring works

Keep the camera stationary with an elevated view of the seating area and some textured background visible. Automatic setup needs visible chairs to estimate capacity; hidden chairs and benches may require manual seat regions.

The backend combines detections with configured seat regions and repeated observations. Default confirmation times are:

| Observation | Continuous evidence required |
| --- | --- |
| Arrival or occupancy increase | 10 seconds |
| Departure, occupancy decrease, or initial empty state | 30 seconds |
| Supported leftover items at an empty table | 5 seconds |
| A sufficiently visible surface without supported items | 10 seconds |

Administrators can change arrival and departure delays in Settings. Missing, stale, or ambiguous evidence produces **Unknown** rather than an assumed vacancy. A service reminder is created after five minutes of an unserved visit; cleaning alerts follow confirmed cleaning episodes.

See [automatic table layouts](docs/automatic-table-layout.md) for discovery, layout changes, and camera-view recovery, and [calibration](docs/calibration.md) for settings and API behavior.

## Technology

| Layer | Tools |
| --- | --- |
| Frontend | React, TypeScript, Vite, React Router, Tailwind CSS, shadcn/ui |
| Backend | Python 3.12, FastAPI, SQLModel, Psycopg 3 |
| Computer vision | Ultralytics YOLO instance segmentation, OpenCV, PyTorch |
| Persistence | PostgreSQL, Alembic migrations |
| Optional notifications | Telegram Bot API |

## Repository structure

```text
DineIQ/
  dineiq-react/          Browser dashboard and camera capture
  dineiq-fastapi/        API, detection, monitoring, accounts, and alerts
    app/                Application services and HTTP routes
    alembic/            Database migrations
    scripts/            Setup, account, Telegram, and test utilities
    tests/              Backend tests
  docs/                 Automatic-layout and calibration guides
  identify.py           Standalone video detection and tracking utility
  requirements.in       Direct dependencies for the standalone utility
  requirements.txt      Hashed Windows dependency lock for that utility
```

The dashboard backend and standalone utility use separate Python environments. Use `dineiq-fastapi/requirements-dev.txt` for dashboard development; the root dependency lock belongs to `identify.py`.

## Local setup

The commands below use PowerShell and assume you start at the repository root.

### Prerequisites

- 64-bit Python 3.12.
- Node.js compatible with the installed Vite package and npm. Vite currently requires Node.js `^20.19.0 || >=22.12.0`.
- A running PostgreSQL server and permission to create a database and role.
- A browser-accessible camera and permission to use it.
- Local instance-segmentation model weights. The backend defaults to `yolo26m-seg.pt`.

CPU inference is supported. NVIDIA acceleration requires compatible hardware, drivers, and the backend's CUDA dependency profile.

### 1. Install the backend

```powershell
Set-Location dineiq-fastapi
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
Copy-Item .env.example .env
```

Copy the example only when creating a new `.env`; preserve an existing configuration. Virtual-environment activation is optional because these commands call its interpreter directly.

The default dependency profile supports CPU inference. See the [backend README](dineiq-fastapi/README.md) for CUDA installation and the separate Windows development lock.

### 2. Configure PostgreSQL and model weights

In `psql` or pgAdmin, connect as a PostgreSQL administrator and create a dedicated role and database:

```sql
CREATE ROLE dineiq WITH LOGIN PASSWORD 'replace-with-your-local-password';
CREATE DATABASE dineiq OWNER dineiq;
```

Edit `dineiq-fastapi/.env` to match:

```dotenv
DATABASE_URL=postgresql+psycopg://dineiq:replace-with-your-local-password@localhost:5432/dineiq
```

Percent-encode special characters in a password embedded in the URL. Environment files are ignored by Git.

Place `yolo26m-seg.pt` at `../downloads/models/yolo26m-seg.pt` relative to the repository root, or add `YOLO_MODEL_PATH` to the backend `.env` with the location of your checkpoint. Relative model paths resolve from `dineiq-fastapi/`. The checkpoint must support instance segmentation and the classes used by monitoring. See [backend model setup](dineiq-fastapi/README.md#webcam-detection) for the default weights.

### 3. Apply migrations and issue a setup code

From `dineiq-fastapi/`:

```powershell
.\.venv\Scripts\python.exe -m alembic upgrade head
.\.venv\Scripts\python.exe scripts/setup.py issue-code
```

The setup code is single-use and expires after 30 minutes. Use it in the first-run browser flow to create the initial administrator. There are no default login credentials or public signup. If an administrator already exists, sign in with that account instead of issuing a code.

Application startup does not apply migrations. Back up an existing database before upgrading it; `alembic upgrade head` includes the account, onboarding, Telegram-settings, and calibration migrations.

### 4. Install the frontend

From the backend directory:

```powershell
Set-Location ../dineiq-react
npm ci
```

By default, the frontend uses its own hostname and scheme on port `8000` for the API. To override it, create a frontend `.env` from `.env.example` and edit `VITE_API_URL`. For local use, keep frontend and API hostnames consistent, such as `localhost` for both, so session cookies work correctly.

See the [frontend README](dineiq-react/README.md) for camera controls, dashboard routes, and hosting requirements.

### 5. Run locally

In a terminal at `dineiq-fastapi/`:

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

In another terminal at `dineiq-react/`:

```powershell
npm run dev
```

Open the URL printed by Vite, normally [http://localhost:5173](http://localhost:5173). The backend exposes [API documentation](http://localhost:8000/docs) and a [process-health endpoint](http://localhost:8000/health). Database readiness at `/health/db` requires an admin session.

Run **one backend worker**. Monitoring evidence, capture ownership, and background alert dispatch depend on the current single-worker architecture.

### 6. Complete onboarding

1. Open [first-run setup](http://localhost:5173/setup), enter the setup code, and create the administrator account.
2. Start the camera and allow browser access. Keep the scene stable while automatic setup discovers tables and visible seats.
3. Check table outlines and capacity. Use **Edit tables manually** when chairs are hidden or a suggested region needs correction.
4. Optionally create staff accounts, then complete the monitoring check.
5. Use Tables for current states and staff actions, History for monitoring events, and Settings for passwords, Telegram, and calibration.

Staff can sign in from another device without starting a camera. That device must be able to reach the configured frontend and backend. Temporary staff passwords must be changed at first login.

## Configuration

Backend configuration lives in `dineiq-fastapi/.env`. Process environment variables take precedence. The frontend reads `VITE_*` variables when Vite starts or builds.

| Variable | Purpose / default |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection using the `postgresql+psycopg` scheme |
| `CORS_ORIGINS` | JSON array of allowed frontend origins; defaults to localhost and `127.0.0.1` on port `5173` |
| `YOLO_MODEL_PATH` | Local instance-segmentation checkpoint; defaults to the sibling downloads directory described above |
| `YOLO_DEVICE` | `auto` selects CUDA when available; `cpu` forces CPU; `0` requires the first NVIDIA GPU |
| `YOLO_IMAGE_SIZE` | Inference size, default `960`; multiples of 32 from 320 to 2048 |
| `YOLO_HALF` | Default `true`; FP16 is used on CUDA, while CPU uses FP32 |
| `YOLO_CONFIDENCE` | Initial detection-confidence default, `0.2`; saved calibration controls operational thresholds afterward |
| `AUTH_SECURE_COOKIE` | Default `false` locally; set `true` for HTTPS deployments |
| `TELEGRAM_ENABLED` | Optional group delivery, default `false` |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | Backend-only Telegram defaults until an admin saves settings |
| `VITE_API_URL` | Frontend API override, for example `http://localhost:8000` |

Admins can save Telegram settings in **Settings → Telegram alerts**. Saved values persist in PostgreSQL and apply immediately. Keep bot tokens out of frontend variables and source files. See [Telegram staff alerts](dineiq-fastapi/README.md#telegram-staff-alerts) for group setup and the explicit test-message command.

## Development checks

Backend checks, from `dineiq-fastapi/`:

```powershell
.\.venv\Scripts\python.exe -m pytest
.\.venv\Scripts\python.exe -m ruff check .
.\.venv\Scripts\python.exe -m ruff format --check .
```

Frontend checks, from `dineiq-react/`:

```powershell
npm test
npm run lint
npm run typecheck
```

These checks do not require a development server. PostgreSQL integration tests are opt-in; see [backend checks](dineiq-fastapi/README.md#checks) for the disposable-cluster helper and database requirements. Tests with mocked detections or synthetic scenes verify application behavior, not real-world detection accuracy.

## Standalone video utility

`identify.py` processes a local video with YOLO11n and ByteTrack on CPU, independently of the dashboard. It emits one JSON record per frame with confidence, pixel bounding boxes, and temporary track IDs when available. IDs belong to that video and may change after occlusion.

Frame numbering starts at zero. Each record contains a `people` list by default or a `tables` list with `--target tables`; bounding boxes use left, top, right, bottom pixel coordinates.

Use a separate virtual environment at the repository root. The root `requirements.txt` is a hashed lock for Windows and Python 3.12. If the original offline wheel bundle is available in `../downloads/python/wheels`, recreate it with:

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install --no-index --find-links ../downloads/python/wheels --require-hashes -r requirements.txt
```

With local video and model assets available, run from the repository root:

```powershell
.\.venv\Scripts\python.exe identify.py ../downloads/samples/people-counting.mp4
.\.venv\Scripts\python.exe identify.py path/to/video.mp4 --target tables
```

Use `--weights` to choose a local detection checkpoint containing the target class, and `--imgsz` to change the inference size. The default weights are `../downloads/models/yolo11n.pt`. Model weights, videos, and offline wheels are local assets and are not included in this repository. Windows locks and wheels need separate dependency resolution for Linux deployments.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Setup or dashboard returns HTTP 503 | Confirm PostgreSQL is running, check `DATABASE_URL`, and apply `alembic upgrade head`. |
| Camera preview works but detection fails | Check the backend connection, `YOLO_MODEL_PATH`, segmentation weights, and inference-device configuration. Model loading makes the first request slower. |
| Automatic setup does not find seats | Show chairs clearly, keep the view stable, or add seat regions manually. |
| Table state stays Unknown | Check camera alignment, occlusion, seat overlap, processing delays, and whether enough continuous evidence has accumulated. |
| Login or API calls fail across origins | Use consistent hostnames, the correct `VITE_API_URL`, and an exact allowed origin in `CORS_ORIGINS`. Restart Vite after frontend environment changes. |
| Camera is unavailable on another device | Browser camera access requires localhost or HTTPS. A remote device's `localhost` refers to that device. |
| Refreshing a deployed dashboard route returns 404 | Configure static hosting to serve `index.html` for frontend routes while keeping assets and API requests outside the fallback. |

## Privacy and limitations

Camera frames are sent to the configured backend for inference and processed transiently. The application does not record video or save camera frames to disk or PostgreSQL. It persists derived registration and appearance data, table regions, state snapshots, events, accounts, and settings.

Occupancy and cleaning are estimates. Standing people, occlusion, hidden chairs, changing lighting, and camera movement can affect results. Cleaning detection covers supported visible items; it does not verify hygiene, stains, crumbs, or every type of dish. Staff inspection remains necessary.

The overlay is a 2D visualization of the camera view. Real-world accuracy, processing capacity, and deployment behavior must be evaluated in the intended venue before operational use.
