# Restaurant calibration

Administrators can open **Settings → Calibration** to tune detection without editing code or restarting the backend. Settings apply to the entire installation. Staff accounts cannot access the panel or its APIs.

## Deploying the feature

Apply the additive migration `20261105_06` through the normal deployment process before using the updated application:

```powershell
cd dineiq-fastapi
.\.venv\Scripts\python.exe -m alembic upgrade head
```

The migration creates revision storage and a singleton active-revision pointer. The first request initializes calibration from the existing `YOLO_CONFIDENCE` and existing monitoring constants. Confidence must be within the panel's supported range, 0.05–0.95. Subsequent operational values come from the database. Model weights, device, image resolution, and alert schedules remain deployment settings.

This change does not run migrations automatically. Existing layouts, accounts, visits, and history are retained. Application reset removes calibration history and restores initial defaults on the next setup.

## Calibrating a restaurant

1. Correct the table and seat boundaries using the link to Tables. Camera position and lighting should be suitable for the monitored area.
2. Adjust the four sliders: **People detection**, **Cleaning detection**, **Confirm arrivals**, and **Confirm departures**. Higher detection sensitivity catches more possible people or leftover objects; lower sensitivity reduces false detections. Arrival and departure delays are measured in seconds.
3. Select **Save settings** to activate the changes. Monitoring reconfirms observations under the new revision. Existing arrival times, served visits, manual corrections, and alert episodes are preserved.
4. Check the normal Camera and Tables screens as people arrive and leave. Calibration does not require a camera stream and has no preview or revision-history controls.

**Undo changes** restores the saved slider values. **Reset sliders** loads their defaults; select Save settings to activate them. Other detection, geometry, visibility, and timing settings retain their saved values. Another administrator's changes cause a stale-save error. Select **Reload settings** to refresh saved values while retaining edited sliders, then save again.

## Preview behavior

The backend retains preview and revision-history APIs for existing integrations. The simplified Settings panel does not call them. The behavior below applies only to direct API clients.

Preview reuses the existing camera stream. Without table setup it supports detection only. A preview session holds independent state machines and geometry trackers in memory, expires after 60 idle seconds, and is replaced by another preview from the same admin. Draft edits or changes to active calibration or table setup restart the simulations.

Only one preview frame is submitted at a time, at most once per second. Production inference takes priority; busy preview frames are skipped. The ordinary detection-only loop pauses during preview to avoid competing for the model, while active production monitoring continues. Inference already running cannot be preempted. Camera frames are transient and are never written to disk.

## Interfaces

- `GET /admin/settings/calibration`: saved revision, settings, defaults, and control metadata.
- `PUT /admin/settings/calibration`: complete `settings` and `expected_revision`; HTTP 409 indicates a stale baseline. Every successful apply creates a revision, including rollback.
- `GET /admin/settings/calibration/history?before=<revision>&limit=20`: revision history and `next_before` pagination cursor.
- `POST /admin/settings/calibration/previews`: `settings`, `camera_id`, and `expected_layout_revision` (null without layout).
- `POST /admin/settings/calibration/previews/{id}/frames?sequence=<integer>`: JPEG body, existing frame-size limits, increasing sequence. HTTP 429 means skip/retry; HTTP 409 means restart after settings/layout changes.
- `DELETE /admin/settings/calibration/previews/{id}`: release the owner's simulation state.

These interfaces use the existing admin session, origin checks, and CSRF protection. Revisions identify the configuration used by monitoring results and table-state history. In-memory preview and capture ownership follow the existing single-worker backend architecture; previews must return to the worker that created them.

## Verification

```powershell
cd dineiq-fastapi
.\.venv\Scripts\python.exe scripts/test_postgres.py tests
cd ../dineiq-react
npm test
npm run typecheck
npm run lint
```

The PostgreSQL helper creates a disposable cluster and test schemas; it does not migrate the restaurant database. Tests cover rules and application behavior using synthetic detections, not real-world model accuracy.
