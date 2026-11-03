# DineIQ

AI-powered table monitoring and service management for community canteens, using person detection, tracking, and a cloud backend.

## Python environment

Use **64-bit Python 3.12**. The local virtual environment is `.venv`; it is excluded from Git. The initial environment uses the available Python 3.12.2 interpreter and CPU-only PyTorch.

`requirements.in` lists the selected direct dependencies. `requirements.txt` locks all resolved dependencies to exact versions and SHA-256 hashes for Windows with Python 3.12.

From PowerShell:

```powershell
Set-Location D:\University\NIBM\HND\ET\DineIQ
.\.venv\Scripts\Activate.ps1
```

Activation is optional. Commands can use the virtual environment's interpreter directly:

```powershell
.\.venv\Scripts\python.exe --version
.\.venv\Scripts\python.exe -m pip check
```

To recreate the environment from the existing download bundle:

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install --no-index --find-links ..\downloads\python\wheels --require-hashes -r requirements.txt
```

The dependency set includes Ultralytics, OpenCV, PyTorch, torchvision, FastAPI, Uvicorn, SQLAlchemy, multipart uploads, environment configuration, SciPy, and LAP tracking support. These Windows CPU wheels are platform-specific; a Linux cloud deployment needs its own dependency resolution.

## Existing development assets

The downloaded assets remain in `D:\University\NIBM\HND\ET\downloads`:

- `models/yolo11n.pt`: pretrained COCO object detector.
- `models/bytetrack.yaml`: tracker configuration.
- `samples/`: short demonstration videos.
- `frontend/`: React and TypeScript dependencies.
- `README.md`: bundle details, sources, and license information.

## Detect and track people or dining tables

Run the detector from the project directory with a local video:

```powershell
.\.venv\Scripts\python.exe identify.py ..\downloads\samples\people-counting.mp4
```

Add `--target tables` to track dining tables. For example:

```powershell
.\.venv\Scripts\python.exe identify.py "C:\Users\Dilukshan\Downloads\15485734_3840_2160_50fps.mp4" --target tables
```

The script uses YOLO11n and ByteTrack on the CPU. Each JSON line describes one frame, starting at frame zero. The selected list (`people` by default or `tables`) contains a confidence score, a bounding box in pixels (left, top, right, bottom), and a temporary track ID for each detection when available. IDs apply within a single video and can change after occlusion. Use `--weights` to select a local detection checkpoint that contains the target class.
