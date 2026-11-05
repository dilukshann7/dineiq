# DineIQ camera frontend

React, TypeScript, Vite, Tailwind CSS, and shadcn/ui. Displays a webcam preview with YOLO detections for people and dining tables from the local FastAPI backend.

`src/App.tsx` composes the public homepage and protected application. Feature components, lifecycle hooks, and styles live under `src/features`; reusable shadcn primitives remain in `src/components/ui`. Detection and monitoring logic is split into focused modules under `src/lib`.

## Setup

```powershell
npm ci
```

The API defaults to the frontend hostname and scheme on port 8000 (for example, `http://localhost:8000`). Keep frontend/API hostnames consistent for session cookies. To change it, copy `.env.example` to `.env` and edit `VITE_API_URL`. Restart Vite after changing environment variables.

## Run when needed

Start the backend using the instructions in `../dineiq-fastapi/README.md`, then run:

```powershell
npm run dev
```

Open Vite's localhost URL, sign in as admin, select Start camera, and allow webcam access. Detection starts automatically. Frames are sent to `/detect` as JPEGs with a maximum dimension of 1280 pixels and JPEG quality 0.9. Sampling targets up to 30 requests per second, with only one request in flight. Capture and inference time count toward this interval; there is no extra idle delay after a slow response and no queue of stale frames. Actual speed depends on the backend and appears beside the detection counts as a smoothed rate in Hz. The camera preview continues if detection fails; Retry detection reconnects to the backend. Stop camera releases the webcam and stops frame sampling.

Translucent tabletop contours and person boxes follow the video's aspect ratio, including letterboxing and fullscreen. Labels display the class and model confidence. Predictions are not occupancy decisions, and objects have no persistent tracking IDs yet.

Camera access requires localhost or HTTPS. No microphone access is requested. Sampled frames are sent to the configured backend for inference; this app does not record video or save frames.

## Table occupancy and cleaning estimates

Apply the backend's bundled Alembic migration with PostgreSQL configured. The backend must run with one worker. All dashboard and inference API access requires a valid database-backed login.

1. Start the camera and keep it fixed at an elevated diagonal angle. Capture an empty area with visible, stationary background detail.
2. Choose **Configure tables**. New setups automatically detect tabletops and visible chairs in the frozen frame, generating table outlines and approximate seated-person regions. For an existing setup, choose **Auto-detect tables & seats** to replace the displayed draft; matching table names and IDs are retained where geometry is unambiguous.
3. Review each suggested table and seat. Hidden chairs and benches cannot establish capacity automatically; add missed regions, remove incorrect seats, or redraw outlines. Manual regions should enclose the expected seated person's visible body, avoiding aisles and neighboring seats. Capacity is derived from the final seat regions.
4. Save the setup, then choose **Start monitoring**. Camera frames are processed transiently; layout revisions and table-state history are stored in PostgreSQL.

The editor uses a frozen frame. Click to add corners, then Finish polygon; Undo corner removes the last point. Keyboard users can focus the drawing surface, move the cursor with arrow keys (Shift for larger steps), add corners with Enter, and clear unfinished corners with Escape. Existing tables and seats can be removed or redrawn. Saving again reconfirms the camera position and ends any previous capture session.

Cards and fullscreen overlays show stable table names, counts/capacities, Empty / Partly occupied / Full / Unknown, cleaning evidence, and timestamps. Arrival/count increases require ten seconds; departure/count decreases and initial empty confirmation require thirty seconds. Monitoring samples at 2 Hz and sends only one frame at a time. Missing, ambiguous, delayed, or stale observations show unknown rather than apparent vacancy.

At empty tables, persistent supported items suggest Needs cleaning. A consistently visible surface without those items suggests Looks clear. These are visual estimates, not hygiene checks: plates, stains, crumbs, and unfamiliar objects may be missed. Manual corrections and Resume automatic are recorded in history; corrections expire on a confirmed arrival or new monitoring session. Stopping the camera/monitoring hides old states immediately.

Camera movement or unverified background registration requires Configure tables again. Check all regions against a new frozen frame and save to reconfirm. Retry connection reloads configuration and states after backend/database recovery. Recent history supports per-table filtering, refresh, and older-event pagination.

The setup/dashboard use Tailwind utilities and existing shadcn components. API payloads are validated before display, capture startup/cleanup handles late sessions, and page exit attempts to close the active backend session.

## Staff alerts

After applying the backend migration, table cards show initial-service timing,
**Mark served**, cleaning **Acknowledge**, and Telegram delivery outcomes. Staff
can sign in to the dashboard on another device without starting its camera; current
table setup and states refresh every two seconds while that device is not
capturing. The configured backend must be reachable from that device.

Cleaning acknowledgement records a response without changing the estimate. Use
**Looks clear** after inspection, or let automatic clearance resolve the alert.
Unknown/stale observations disable staff actions and pause alert delivery. History
records service confirmation, acknowledgements, resolution, and delivery results.

Admins configure Telegram under **Settings → Telegram alerts**. Enable or disable
delivery, set the staff group's negative chat ID, and save or replace the bot token.
Leaving the token field empty preserves the saved token; the API never returns it.
Settings persist in PostgreSQL and apply to delivery immediately. Existing backend
environment settings supply defaults until an admin saves configuration. See the
backend README's **Telegram staff alerts** section for BotFather/group setup,
migration, and the explicit test-message command. No bot credentials belong in
`VITE_*` variables.

## Checks

```powershell
npm run lint
npm run typecheck
```

This checkout does not currently include a frontend test suite.

## Accounts and permissions

Apply the backend migration and issue a local setup code. The frontend guides first-admin creation, camera connection, table/seat review, optional staff creation, and a monitoring check. Saved progress resumes after login or refresh. Admin controls cameras, setup, all history, and staff accounts. After setup completes, staff can view tables, mark service/cleaning, acknowledge alerts, and view My activity. Temporary passwords must be changed at first login. All users can change passwords on the separate Settings page; admins also manage Telegram and application-data reset there. Sessions and temporary setup grants use HttpOnly cookies.

## Routing and hosting

React Router provides `/login`, `/setup`, `/camera`, `/tables`, `/history`, `/staff`,
`/activity`, and `/settings`. Sign-in restores the requested page and query string.
Admin-only URLs redirect staff to Tables. Setup redirects unfinished installations
to `/setup`, with Settings available to the admin. Unknown URLs show a missing-page
message. The camera and monitoring workspace remain mounted during navigation.

Production static hosting must serve `index.html` for frontend routes, including
direct visits or refreshes at `/settings` and other pages. Keep asset and backend
API requests outside this fallback. Vite handles frontend history fallback locally.
