# DineIQ camera frontend

React, TypeScript, Vite, Tailwind CSS, and shadcn/ui. Displays a webcam preview with YOLO detections for people and dining tables from the local FastAPI backend.

## Setup

```powershell
npm ci
```

The API defaults to `http://127.0.0.1:8000`. To change it, copy `.env.example` to `.env` and edit `VITE_API_URL`. Restart Vite after changing environment variables.

## Run when needed

Start the backend using the instructions in `../dineiq-fastapi/README.md`, then run:

```powershell
npm run dev
```

Open Vite's localhost URL, select Start camera, and allow webcam access. Detection starts automatically. Frames are sent to `/detect` as JPEGs with a maximum dimension of 1280 pixels and JPEG quality 0.9. Sampling targets up to 30 requests per second, with only one request in flight. Capture and inference time count toward this interval; there is no extra idle delay after a slow response and no queue of stale frames. Actual speed depends on the backend and appears beside the detection counts as a smoothed rate in Hz. The camera preview continues if detection fails; Retry detection reconnects to the backend. Stop camera releases the webcam and stops frame sampling.

Translucent tabletop contours and person boxes follow the video's aspect ratio, including letterboxing and fullscreen. Labels display the class and model confidence. Predictions are not occupancy decisions, and objects have no persistent tracking IDs yet.

Camera access requires localhost or HTTPS. No microphone access is requested. Sampled frames are sent to the configured backend for inference; this app does not record video or save frames.

## Checks

```powershell
npm test
npm run lint
npx tsc --noEmit -p tsconfig.app.json
```

Tests cover camera lifecycle, cancellation, detection request scheduling, and overlay geometry without opening a real webcam.
