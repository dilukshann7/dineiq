from io import BytesIO
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from app.api.routes.detect import get_detector
from app.core.config import Settings
from app.detector import Detector, InvalidFrame
from app.main import create_app


@pytest.fixture
def jpeg():
    from PIL import Image

    buffer = BytesIO()
    Image.new("RGB", (160, 90)).save(buffer, format="JPEG")
    return buffer.getvalue()


@pytest.fixture
def client():
    settings = Settings(_env_file=None)
    app = create_app(settings)
    detector = MagicMock()
    detector.predict.return_value = {
        "width": 160,
        "height": 90,
        "detections": [{"label": "person", "confidence": 0.9, "box": [0.1, 0.2, 0.4, 0.8]}],
    }
    app.dependency_overrides[get_detector] = lambda: detector
    with TestClient(app) as test_client:
        yield test_client, detector


def test_detect_returns_bounding_boxes_without_using_the_database(client, jpeg):
    http, detector = client
    response = http.post("/detect", content=jpeg, headers={"Content-Type": "image/jpeg"})
    assert response.status_code == 200
    assert response.json()["detections"][0]["label"] == "person"
    detector.predict.assert_called_once_with(jpeg)


def test_detect_rejects_unsupported_content_type(client):
    http, detector = client
    response = http.post("/detect", content=b"bad", headers={"Content-Type": "text/plain"})
    assert response.status_code == 415
    detector.predict.assert_not_called()


def test_detect_rejects_large_frames_before_inference(client):
    http, detector = client
    response = http.post(
        "/detect",
        content=b"x" * (2 * 1024 * 1024 + 1),
        headers={"Content-Type": "image/jpeg"},
    )
    assert response.status_code == 413
    detector.predict.assert_not_called()


def test_corrupt_frame_is_reported_as_a_client_error(client):
    http, detector = client
    detector.predict.side_effect = InvalidFrame("Invalid JPEG frame")
    response = http.post("/detect", content=b"bad", headers={"Content-Type": "image/jpeg"})
    assert response.status_code == 422


def test_detector_validates_images_before_loading_the_model(tmp_path):
    detector = Detector(Settings(_env_file=None, yolo_model_path=tmp_path / "missing.pt"))
    with pytest.raises(InvalidFrame):
        detector.predict(b"not an image")


def test_detector_filters_classes_and_normalizes_boxes(jpeg, monkeypatch):
    model = MagicMock()
    model.names = {0: "person", 1: "bicycle", 60: "dining table"}
    box = MagicMock()
    box.cls.item.return_value = 60
    box.conf.item.return_value = 0.85
    box.xyxy.__getitem__.return_value.tolist.return_value = [16, 18, 144, 81]
    model.predict.return_value = [MagicMock(boxes=[box])]
    detector = Detector(Settings(_env_file=None))
    monkeypatch.setattr(detector, "_load_model", lambda: model)
    result = detector.predict(jpeg)
    assert result == {
        "width": 160,
        "height": 90,
        "detections": [{"label": "dining table", "confidence": 0.85, "box": [0.1, 0.2, 0.9, 0.9]}],
    }
    assert model.predict.call_args.kwargs["classes"] == [0, 60]
    assert model.predict.call_args.kwargs["save"] is False


def test_tabletop_polygon_excludes_thin_supports():
    import numpy as np

    from app.detector import tabletop_outline

    points = np.array(
        [(12, 10), (90, 15), (85, 48), (82, 48), (82, 85), (80, 85), (80, 48), (7, 40)]
    )
    outline = tabletop_outline(points, 100, 100)
    assert len(outline) >= 3
    assert 0.40 <= max(y for _, y in outline) < 0.55
    assert min(x for x, _ in outline) < 0.12
    assert max(x for x, _ in outline) > 0.85


def test_detector_applies_resolution_and_precision_settings(jpeg, monkeypatch):
    model = MagicMock()
    model.names = {0: "person", 60: "dining table"}
    model.predict.return_value = [MagicMock(boxes=[])]
    detector = Detector(
        Settings(_env_file=None, yolo_image_size=1280, yolo_device="0", yolo_half=True)
    )
    monkeypatch.setattr(detector, "_load_model", lambda: model)
    detector.predict(jpeg)
    options = model.predict.call_args.kwargs
    assert options["imgsz"] == 1280
    assert options["device"] == "0"
    assert options["quantize"] == 16


def test_detector_keeps_full_precision_on_cpu(jpeg, monkeypatch):
    model = MagicMock()
    model.names = {0: "person", 60: "dining table"}
    model.predict.return_value = [MagicMock(boxes=[])]
    detector = Detector(Settings(_env_file=None, yolo_device="cpu", yolo_half=True))
    monkeypatch.setattr(detector, "_load_model", lambda: model)
    detector.predict(jpeg)
    assert model.predict.call_args.kwargs["quantize"] == 32


@pytest.mark.parametrize("cuda_available, expected_device", [(True, "0"), (False, "cpu")])
def test_detector_auto_device_uses_cuda_when_available(
    jpeg, monkeypatch, cuda_available, expected_device
):
    import torch

    monkeypatch.setattr(torch.cuda, "is_available", lambda: cuda_available)
    model = MagicMock()
    model.names = {0: "person", 60: "dining table"}
    model.predict.return_value = [MagicMock(boxes=[])]
    detector = Detector(Settings(_env_file=None, yolo_device="auto"))
    monkeypatch.setattr(detector, "_load_model", lambda: model)
    detector.predict(jpeg)
    assert model.predict.call_args.kwargs["device"] == expected_device
