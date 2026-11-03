export type Detection = {
  label: 'person' | 'dining table'
  confidence: number
  box: [number, number, number, number]
  polygon?: [number, number][]
}

export type DetectionResult = {
  width: number
  height: number
  detections: Detection[]
}

export function containRect(width: number, height: number, frameWidth: number, frameHeight: number) {
  if (frameWidth <= 0 || frameHeight <= 0) return { x: 0, y: 0, width: 0, height: 0 }
  const scale = Math.min(width / frameWidth, height / frameHeight)
  const fittedWidth = frameWidth * scale
  const fittedHeight = frameHeight * scale
  return { x: (width - fittedWidth) / 2, y: (height - fittedHeight) / 2, width: fittedWidth, height: fittedHeight }
}

export function createDetectionLoop({ capture, detect, onResult, onError, intervalMs = 1000 / 30 }: {
  capture: () => Promise<Blob | null>
  detect: (frame: Blob, signal: AbortSignal) => Promise<DetectionResult>
  onResult: (result: DetectionResult) => void
  onError: (error: Error) => void
  intervalMs?: number
}) {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined

  async function next() {
    const started = performance.now()
    try {
      const frame = await capture()
      if (controller.signal.aborted) return
      if (frame) {
        const result = await detect(frame, controller.signal)
        if (controller.signal.aborted) return
        onResult(result)
      }
      if (controller.signal.aborted) return
      // Inference time counts toward the interval; never queue stale camera frames.
      const delay = frame ? Math.max(0, intervalMs - (performance.now() - started)) : 50
      timer = setTimeout(() => void next(), delay)
    } catch (error) {
      if (!controller.signal.aborted) {
        onError(error instanceof Error ? error : new Error('Detection failed. Please retry.'))
      }
    }
  }

  void next()
  return () => {
    controller.abort()
    clearTimeout(timer)
  }
}

export function createFrameCapture(video: HTMLVideoElement) {
  const canvas = document.createElement('canvas')
  return async (): Promise<Blob | null> => {
    if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) return null
    const scale = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight))
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale))
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('This browser cannot capture frames for detection.')
    context.drawImage(video, 0, 0, canvas.width, canvas.height)
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Could not capture a camera frame.')), 'image/jpeg', 0.9)
    })
  }
}

function validResult(value: unknown): value is DetectionResult {
  if (!value || typeof value !== 'object') return false
  const result = value as Partial<DetectionResult>
  return typeof result.width === 'number' && Number.isFinite(result.width) && result.width > 0
    && typeof result.height === 'number' && Number.isFinite(result.height) && result.height > 0
    && Array.isArray(result.detections) && result.detections.every((detection) =>
      detection && (detection.label === 'person' || detection.label === 'dining table')
      && Number.isFinite(detection.confidence) && detection.confidence >= 0 && detection.confidence <= 1
      && Array.isArray(detection.box) && detection.box.length === 4
      && detection.box.every((coordinate) => Number.isFinite(coordinate) && coordinate >= 0 && coordinate <= 1)
      && detection.box[0] <= detection.box[2] && detection.box[1] <= detection.box[3]
      && (detection.polygon === undefined || (Array.isArray(detection.polygon)
        && detection.polygon.length >= 3 && detection.polygon.every((point) =>
          Array.isArray(point) && point.length === 2 && point.every((value) =>
            Number.isFinite(value) && value >= 0 && value <= 1)))))
}

export async function requestDetection(apiBase: string, frame: Blob, signal: AbortSignal): Promise<DetectionResult> {
  let response: Response
  try {
    response = await fetch(`${apiBase.replace(/\/$/, '')}/detect`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/jpeg' },
      body: frame,
      signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
    })
  } catch (error) {
    if (signal.aborted) throw error
    throw new Error('Detection could not connect. Check the backend is running, then retry.')
  }
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null)
    const message = body && typeof body === 'object' && 'detail' in body && typeof body.detail === 'string'
      ? body.detail : 'Detection is unavailable. Check the backend, then retry.'
    throw new Error(message)
  }
  const result: unknown = await response.json()
  if (!validResult(result)) throw new Error('The detector returned an invalid response. Please retry.')
  return result
}

export function drawDetections(canvas: HTMLCanvasElement, result: DetectionResult | null) {
  const width = canvas.clientWidth
  const height = canvas.clientHeight
  const ratio = Math.min(window.devicePixelRatio || 1, 2)
  canvas.width = Math.round(width * ratio)
  canvas.height = Math.round(height * ratio)
  const context = canvas.getContext('2d')
  if (!context) return
  context.setTransform(ratio, 0, 0, ratio, 0, 0)
  context.clearRect(0, 0, width, height)
  if (!result) return
  const fitted = containRect(width, height, result.width, result.height)
  context.font = '12px Geist, sans-serif'
  context.textBaseline = 'middle'
  context.lineWidth = 1.5
  for (const detection of result.detections) {
    const [left, top, right, bottom] = detection.box
    const x = fitted.x + left * fitted.width
    const y = fitted.y + top * fitted.height
    const boxWidth = (right - left) * fitted.width
    const boxHeight = (bottom - top) * fitted.height
    let anchorX = x
    let anchorY = y - 23
    if (detection.label === 'dining table') {
      if (!detection.polygon) continue
      const points = detection.polygon.map(([px, py]) => [
        fitted.x + px * fitted.width, fitted.y + py * fitted.height,
      ])
      context.beginPath()
      context.moveTo(points[0][0], points[0][1])
      for (const [px, py] of points.slice(1)) context.lineTo(px, py)
      context.closePath()
      context.fillStyle = 'rgba(16, 185, 129, 0.30)'
      context.strokeStyle = '#34d399'
      context.fill()
      context.stroke()
      anchorX = x + boxWidth / 2
      const ys = points.map((point) => point[1])
      anchorY = (Math.min(...ys) + Math.max(...ys)) / 2 - 11
    } else {
      context.strokeStyle = '#34d399'
      context.strokeRect(x, y, boxWidth, boxHeight)
    }
    const label = `${detection.label === 'person' ? 'Person' : 'Table'} ${Math.round(detection.confidence * 100)}%`
    const labelWidth = context.measureText(label).width + 12
    if (detection.label === 'dining table') anchorX -= labelWidth / 2
    const labelX = Math.max(0, Math.min(anchorX, width - labelWidth))
    const labelY = Math.max(0, Math.min(anchorY, height - 22))
    context.fillStyle = '#0a0a0a'
    context.fillRect(labelX, labelY, labelWidth, 22)
    context.fillStyle = '#ededed'
    context.fillText(label, labelX + 6, labelY + 11)
  }
}
