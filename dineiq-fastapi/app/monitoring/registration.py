def background_features(frame, tables: list[dict]) -> dict:
    import cv2
    import numpy as np

    height, width = frame.shape[:2]
    scale = min(1, 960 / width)
    resized = cv2.resize(frame, (round(width * scale), round(height * scale)))
    gray = cv2.cvtColor(resized, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape
    mask = np.full((h, w), 255, np.uint8)
    for table in tables:
        for polygon in [table["polygon"], *[seat["polygon"] for seat in table["seats"]]]:
            points = np.rint(np.array(polygon) * (w - 1, h - 1)).astype(np.int32)
            cv2.fillPoly(mask, [points], 0)
    keypoints, descriptors = cv2.ORB_create(nfeatures=1000).detectAndCompute(gray, mask)
    return {
        "width": width,
        "height": height,
        "points": [[point.pt[0] / w, point.pt[1] / h] for point in keypoints],
        "descriptors": [] if descriptors is None else descriptors.tolist(),
    }


def registration_status(reference: dict, current: dict, calibration=None) -> str:
    from app.calibration.contracts import Calibration

    calibration = calibration or Calibration()
    import cv2
    import numpy as np

    if min(len(reference["descriptors"]), len(current["descriptors"])) < 20:
        return "uncertain"
    matches = cv2.BFMatcher(cv2.NORM_HAMMING).knnMatch(
        np.array(reference["descriptors"], np.uint8),
        np.array(current["descriptors"], np.uint8),
        k=2,
    )
    good = [
        pair[0] for pair in matches if len(pair) == 2 and pair[0].distance < 0.75 * pair[1].distance
    ]
    if len(good) < 20:
        return "uncertain"
    source = np.float32([reference["points"][match.queryIdx] for match in good])
    target = np.float32([current["points"][match.trainIdx] for match in good])
    # A free projective fit extrapolates noise from a narrow window across the room.
    # Fit camera translation/rotation/scale robustly; insufficient evidence stays uncertain.
    matrix, inliers = cv2.estimateAffinePartial2D(
        source, target, method=cv2.RANSAC, ransacReprojThreshold=0.005
    )
    if matrix is None or inliers is None or inliers.sum() < 20 or inliers.mean() < 0.6:
        return "uncertain"
    support = source[inliers.ravel().astype(bool)]
    if np.ptp(support, axis=0).min() < 0.15:
        return "uncertain"
    corners = np.float32([[[0, 0], [1, 0], [1, 1], [0, 1]]])
    transformed = cv2.transform(corners, matrix)
    dimensions = np.array([reference["width"], reference["height"]])
    if not np.isfinite(transformed).all():
        return "uncertain"
    displacement = np.linalg.norm((transformed - corners) * dimensions, axis=2).max()
    return (
        "aligned"
        if displacement <= calibration.camera_displacement * np.linalg.norm(dimensions)
        else "moved"
    )


def registration_valid(reference: dict, current: dict) -> bool:
    return registration_status(reference, current) == "aligned"
