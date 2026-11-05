export function createFrameCapture(video: HTMLVideoElement) {
  const canvas = document.createElement("canvas");
  return async (): Promise<Blob | null> => {
    if (video.readyState < 2 || !video.videoWidth || !video.videoHeight)
      return null;
    const scale = Math.min(
      1,
      1280 / Math.max(video.videoWidth, video.videoHeight),
    );
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const context = canvas.getContext("2d");
    if (!context)
      throw new Error("This browser cannot capture frames for detection.");
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) =>
          blob
            ? resolve(blob)
            : reject(new Error("Could not capture a camera frame.")),
        "image/jpeg",
        0.9,
      );
    });
  };
}
