# DineIQ FastAPI backend

Python 3.12 backend using FastAPI, SQLModel, and a local PostgreSQL database through Psycopg 3. The webcam detection endpoint uses the existing YOLO26m-seg model to find people and dining tables. No custom training is required.

Monitoring is organized into layout, capture, table state/history, and staff-action services behind `app/monitoring/service.py`. HTTP JPEG parsing is shared in `app/api/frames.py`; authentication, staff management, and activity each have their own router. See the [architecture guide](../docs/architecture.md) for the full structure and extension rules.

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

Detection does not initialize monitoring state, but `/detect` now requires an authenticated admin and a PostgreSQL-backed session. If the backend is unavailable, the webcam preview continues and offers Retry detection. Stop camera stops sampling and aborts the current browser request; inference already running on the backend can still finish. This stateless endpoint provides bounding boxes and table polygons, without persistent track IDs. The separate monitoring endpoints below add configured-seat occupancy and cleaning estimates.

## Table monitoring and history

Configure PostgreSQL, then apply the included migration before using monitoring:

```powershell
.\.venv\Scripts\python.exe -m alembic upgrade head
```

Run **one Uvicorn worker**. Continuous-evidence timers belong to that worker; PostgreSQL stores layout revisions, seats, capture sessions, latest states, and append-only events. Application startup never creates or migrates database tables. The first monitoring request recovers persisted sessions as unknown after a restart. `/health` and `/detect` remain usable without a monitoring database connection.

In the frontend, start the camera and choose Configure tables. Capture an empty scene with the camera fixed at an elevated diagonal angle. New setups automatically suggest tabletop outlines and seated-body regions from visible chairs in that frozen frame. Review each table and seat, add missing regions where chairs are hidden, name the tables, save, then select Start monitoring. Table capacity is the number of reviewed seat regions. Existing setups offer Auto-detect tables & seats to replace the editable draft while retaining unambiguous matching names and IDs. Layouts allow up to 16 tables and 32 seats per table. Leave textured, stationary background outside all regions so camera registration can find at least 20 matching features.

Monitoring samples at 2 Hz without queuing frames. Each person can match only one seat. Their box center must fall inside its region, cover at least 25% of it, and have height no greater than 1.35 times the region height. Competing assignments produce unknown state rather than double counts. Confirm arrivals/count increases after 10 seconds and departures/count decreases after 30 seconds; initial empty observations also require 30 seconds. Counts are estimates: standing or leaning people and occlusion can still cause errors.

Cleaning is not assessed while occupied. At an empty table, supported cups, bowls, cutlery, bottles, or food persisting for five seconds produce Needs cleaning — estimate. A visible empty surface without supported items for ten seconds produces Looks clear — estimate. Clearance requires at least 80% visibility of the tabletop region after excluding segmented chair pixels. At least 70% of the full saved region must also be detected as tabletop, and chair masks may exclude at most 30% of that region. This accounts for chair backs inside convex setup outlines without treating chair bounding boxes as visible surface. Person obstruction must remain below 10% of the full saved region. Plates, stains, crumbs, unfamiliar objects, and actual hygiene are not verified. Manual cleaning corrections are audited, expire at the next confirmed arrival or new session, and can be removed with Resume automatic. Missing observations override every cleaning correction with unknown.

Background registration requires at least 20 matching inliers, 60% inlier agreement, and displacement within 2% of the source-frame diagonal. Failed registration latches a reconfirmation requirement; check every region against a new frozen frame and save again. Gaps exceeding two seconds reset pending evidence. Frames taking more than two seconds to process cannot confirm states. After five seconds without frames, the watchdog marks states unknown and records a single interruption. Camera stop, invalid frames, database failure, and restart never imply departure or cleaning.

The API uses camera ID `main` by default:

| Endpoint | Purpose |
| --- | --- |
| `POST /monitoring/suggestions` | Analyze a frozen JPEG into editable tabletop and seated-body regions using visible chairs. Returns warnings and assigned/visible chair counts; no database or image persistence is required. |
| `GET /monitoring/layout` | Current layout or `null`; descriptors and images are never returned. |
| `PUT /monitoring/layout` | Save named polygons/seats, source dimensions, `expected_revision`, and a transient base64 JPEG `frame`. Returns the new revision. |
| `POST /monitoring/sessions` | Start one capture session for the camera; returns session ID, sequence, and freshness token. The frontend supplies `expected_revision` to reject stale layouts before capture. |
| `DELETE /monitoring/sessions/{id}` | Stop capture and mark observations unknown; safe to repeat. |
| `POST /monitoring/sessions/{id}/frames?sequence=…&token=…` | Submit a JPEG body. Tokens rotate after each accepted frame and expire after five seconds. |
| `GET /monitoring/tables` | Current counts/capacities, occupancy, cleaning, evidence, timestamps, and validity. |
| `GET /monitoring/history?limit=20&before=…&table_id=…` | Newest-first events with an exclusive ID cursor and optional table filter. |
| `POST /monitoring/tables/{id}/correction` | Apply `looks_clear`, `needs_cleaning`, or `automatic`. |

Configuration and monitoring state require PostgreSQL. Database errors return a sanitized HTTP 503 and reset pending evidence; recover the database, then start a new session. Configuration revision conflicts, duplicate/expired frames, or competing capture sessions return HTTP 409. Tokens bound normal-client capture delay, but do not attest that an untrusted client captured a fresh image. Camera frames are processed transiently; only derived ORB descriptors, configuration, state snapshots, and event metadata are persisted.

## Telegram staff alerts

One Telegram staff group receives cleaning inspection requests and initial-service
reminders. Staff sign in and confirm actions in the dashboard; no Telegram callbacks are required. Alert records and dashboard actions work with
Telegram disabled. Existing API access rules also apply to staff actions.

Apply the new migration using the backend environment before using this version:

```powershell
.\.venv\Scripts\python.exe -m alembic upgrade head
```

This adds visit and alert tables without replacing existing monitoring records.
Run one Uvicorn worker, as required by the monitoring engine. Migrations never run
at application startup. Back up existing data before applying a migration.

### Connect the staff group

1. In Telegram, open [@BotFather](https://t.me/BotFather), send `/newbot`, and
   follow the prompts. Save its token through **Settings → Telegram alerts** in the
   authenticated admin dashboard. Do not paste it into frontend environment
   variables, source files, chat, or browser URLs.
2. Create a staff group and add the bot with permission to send messages. Keep
   alerts disabled while discovering the group ID, and save the bot token in Settings.
3. Send `/start@YourBotUsername` in the staff group. Discover its numeric ID:

   ```powershell
   .\.venv\Scripts\python.exe scripts/telegram_alerts.py chat-id
   ```

   This reads bot updates and prints only group titles and IDs. It sends no
   messages and does not advance the update offset. Use a dedicated bot; another
   application's webhook or polling may interfere. Newly sent updates must still
   be available to Telegram's `getUpdates` endpoint.
4. Enter the resulting negative group ID in **Settings → Telegram alerts**, enable
   alerts, and save. Changes persist in PostgreSQL and apply immediately. A blank
   token field keeps the existing token. Responses and activity records never
   contain the token. Application-data reset preserves Telegram configuration.

   Existing environment configuration remains the default until Settings is saved:

   ```dotenv
   TELEGRAM_ENABLED=true
   TELEGRAM_BOT_TOKEN=<token-from-BotFather>
   TELEGRAM_CHAT_ID=-1001234567890
   ```

5. Explicitly send one configuration test when ready:

   ```powershell
   .\.venv\Scripts\python.exe scripts/telegram_alerts.py send-test
   ```

   This command sends a real message to the configured staff group. A success
   reports Telegram's message ID; confirm receipt in Telegram as well. Both CLI
   commands use the same saved settings as delivery. Restart the backend yourself
   after changing `.env` if no saved configuration overrides those defaults.

### Rules and staff actions

- A visit starts after confirmed occupancy, using the first observation that led
  to arrival confirmation. At 300 seconds, one reminder is created if initial
  service remains unconfirmed. Count changes do not reset the visit.
- **Mark served** records service and resolves the reminder. A confirmed departure
  closes the visit. A new arrival creates a new visit.
- An empty table entering confirmed **Needs cleaning** creates one inspection
  alert, including a manual Needs cleaning correction. Visible item changes and
  temporary unknown states do not create another alert for that episode.
- **Acknowledge** records the response without clearing the cleaning estimate.
  Use the existing **Looks clear** correction after inspection, or let automatic
  clearance resolve the episode. Occupancy ends an earlier cleaning episode.
- Unknown/stale observations pause alert generation and dispatch. Brief gaps
  preserve visit timing; once observations are confirmed again, elapsed time
  includes the gap. Stop, layout replacement, and backend restart cancel old
  unresolved episodes. A new capture session starts new episodes.
- Another staff device can open the same dashboard: table state refreshes every
  two seconds when that device is not capturing. A live current observation is
  required for staff actions; it does not need a local camera. History shows
  alert creation, acknowledgement, resolution/cancellation, and delivery outcomes.

`GET /monitoring/tables` and frame/correction responses now include `visit_id`,
`arrived_at`, `served_at`, `service_status` (`none`, `waiting`, `overdue`, `served`),
and current `alerts`. Each alert includes its ID, kind, creation/acknowledgement
times, delivery status, and a sanitized error category.

| Endpoint | Body | Behavior |
| --- | --- | --- |
| `POST /monitoring/tables/{table_id}/service` | `{"camera_id":"main","visit_id":"current-visit-id"}` | Mark current visit served; safe to repeat. Stale visit returns HTTP 409. |
| `POST /monitoring/alerts/{alert_id}/acknowledge` | `{"camera_id":"main"}` | Acknowledge current cleaning alert; safe to repeat. Stale/mismatched alert returns HTTP 409. |

`camera_id` defaults to `main`. Telegram requests use plain-text `sendMessage`,
with no camera images or identifying customer information. Timestamped messages
use UTC. Credentials and raw Telegram responses never enter API responses/history.

Delivery runs outside monitoring locks/transactions with a five-second HTTP
timeout and at most one attempt per three seconds. Network/server failures retry
after 5, 10, 20, and 40 seconds, up to five total attempts. Telegram rate limits
can extend these delays. Permanent errors fail immediately. Pending alerts expire
15 minutes after creation, including while delivery is disabled or observations
are unavailable. Resolution cancels pending delivery, but already sent messages
remain in Telegram. In-flight sends can finish after a staff action or shutdown;
an ambiguous network failure may produce a duplicate on retry.

Delivery status and attempts are durable. Restart cancels obsolete session
alerts before dispatch; it does not resend old reminders. Telegram outages do
not stop detection. Automated tests mock Telegram; no live delivery is implied
by a passing test suite. See the official [Bot API](https://core.telegram.org/bots/api#sendmessage)
and [bot setup](https://core.telegram.org/bots/features#botfather).

## Add models and migrations

Place SQLModel table classes under `app/models/` and import their modules explicitly in `alembic/env.py` so Alembic can discover their metadata. Application folders use Python namespace packages without `__init__.py` files. Monitoring models are already registered; no tables are created at application startup.

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

The default tests use FastAPI's in-process client, isolated SQLite databases for monitoring transactions, and mocked model predictions. They require no running application server. PostgreSQL integration tests are opt-in and use uniquely named disposable schemas; they check migration parity, upgrade/downgrade, persisted history, and restart recovery without touching application tables:

```powershell
$env:DINEIQ_TEST_POSTGRES = '1'
.\.venv\Scripts\python.exe -m pytest -q
Remove-Item Env:DINEIQ_TEST_POSTGRES
```

Set `DINEIQ_TEST_DATABASE_URL` to override the configured database for these tests. The account must be allowed to create schemas. On Windows, an optional helper starts and stops a disposable PostgreSQL cluster under `.pytest_cache` with a random localhost port:

```powershell
.\.venv\Scripts\python.exe scripts/test_postgres.py tests/test_monitoring_postgres.py
```

Set `POSTGRES_BIN` if PostgreSQL is not installed at `C:\Program Files\PostgreSQL\18\bin`. These checks verify application rules and persistence, not live camera accuracy. Evaluate representative seating, passersby, standing people, adjacent tables, occlusion, leftover items, and camera movement before making accuracy claims.

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

## Admin and staff accounts

This version requires the additive `20261104_04` onboarding migration. Existing installations with an admin retain dashboard access. Fresh installations use a single-use local setup code and the browser wizard; there are no default credentials or public signup:

```powershell
.\.venv\Scripts\python.exe -m alembic upgrade head
.\.venv\Scripts\python.exe scripts/setup.py issue-code
```

Admin manages staff accounts; staff have table actions and personal activity only after onboarding completes. Detection, camera controls, configuration, shared monitoring history, and database readiness require admin. Set `AUTH_SECURE_COOKIE=true` for HTTPS deployments and use exact frontend `CORS_ORIGINS`. See [first-run setup, reset, API contracts, and recovery](../docs/onboarding.md).

## Runtime calibration

Admin Settings includes versioned detection calibration and isolated live simulations. Apply migration 20261105_06 before using this feature. See [calibration, rollback, API contracts, and verification](../docs/calibration.md).
