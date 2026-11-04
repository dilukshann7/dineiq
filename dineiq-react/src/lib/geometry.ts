export function containRect(
  width: number,
  height: number,
  frameWidth: number,
  frameHeight: number,
) {
  if (frameWidth <= 0 || frameHeight <= 0)
    return { x: 0, y: 0, width: 0, height: 0 };
  const scale = Math.min(width / frameWidth, height / frameHeight);
  const fittedWidth = frameWidth * scale;
  const fittedHeight = frameHeight * scale;
  return {
    x: (width - fittedWidth) / 2,
    y: (height - fittedHeight) / 2,
    width: fittedWidth,
    height: fittedHeight,
  };
}
