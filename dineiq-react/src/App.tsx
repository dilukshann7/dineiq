import { useEffect, useRef, useState } from 'react'
import { Camera, CameraOff, Maximize2, ShieldCheck, Square, Video } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter } from '@/components/ui/card'
import { createCameraSession, type CameraSession, type CameraState } from '@/lib/camera'
import { createDetectionLoop, createFrameCapture, drawDetections, requestDetection, type DetectionResult } from '@/lib/detection'
import './App.css'

function App() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const sessionRef = useRef<CameraSession | null>(null)
  const [camera, setCamera] = useState<CameraState>({ status: 'idle' })
  const [fullscreenError, setFullscreenError] = useState('')
  const [detection, setDetection] = useState<DetectionResult | null>(null)
  const [detectionError, setDetectionError] = useState('')
  const [detectionRetry, setDetectionRetry] = useState(0)
  const [detectionHz, setDetectionHz] = useState<number | null>(null)
  const live = camera.status === 'live'
  const requesting = camera.status === 'requesting'

  useEffect(() => {
    const preference = window.matchMedia('(prefers-color-scheme: dark)')
    const previous = document.documentElement.classList.contains('dark')
    const applyTheme = () => document.documentElement.classList.toggle('dark', preference.matches)
    applyTheme()
    preference.addEventListener('change', applyTheme)
    return () => {
      preference.removeEventListener('change', applyTheme)
      document.documentElement.classList.toggle('dark', previous)
    }
  }, [])

  useEffect(() => {
    if (!live || !videoRef.current) return
    const apiBase = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000'
    let lastResultAt: number | null = null
    setDetectionHz(null)
    return createDetectionLoop({
      capture: createFrameCapture(videoRef.current),
      detect: (frame, signal) => requestDetection(apiBase, frame, signal),
      onResult: (result) => {
        const now = performance.now()
        if (lastResultAt !== null && now > lastResultAt) {
          const hz = 1000 / (now - lastResultAt)
          setDetectionHz((previous) => previous === null ? hz : previous * 0.7 + hz * 0.3)
        }
        lastResultAt = now
        setDetection(result)
      },
      onError: (error) => {
        setDetection(null)
        setDetectionError(error.message)
      },
    })
  }, [live, detectionRetry])

  useEffect(() => {
    const canvas = overlayRef.current
    const frame = frameRef.current
    if (!canvas || !frame) return
    const render = () => drawDetections(canvas, live ? detection : null)
    render()
    const observer = new ResizeObserver(render)
    observer.observe(frame)
    return () => observer.disconnect()
  }, [detection, live])

  useEffect(() => {
    if (!videoRef.current) return
    const session = createCameraSession(videoRef.current, setCamera, navigator.mediaDevices)
    sessionRef.current = session
    return () => {
      sessionRef.current = null
      session.dispose()
    }
  }, [])

  async function expandPreview() {
    setFullscreenError('')
    try {
      if (!frameRef.current?.requestFullscreen) {
        setFullscreenError('Fullscreen is not available in this browser.')
        return
      }
      await frameRef.current.requestFullscreen()
    } catch {
      setFullscreenError('Fullscreen could not open. You can continue watching here.')
    }
  }

  const statusLabel = live ? 'Live' : requesting ? 'Connecting' : camera.status === 'error' ? 'Unavailable' : 'Camera off'
  const personCount = detection?.detections.filter((box) => box.label === 'person').length ?? 0
  const tableCount = detection?.detections.filter((box) => box.label === 'dining table').length ?? 0

  return (
    <div className="camera-page">
      <a className="camera-skip" href="#main">Skip to camera</a>
      <header className="camera-header">
        <div className="camera-container camera-masthead">
          <div className="camera-brand" aria-label="DineIQ">
            <span className="camera-brand-mark" aria-hidden="true"><Video size={18} strokeWidth={1.8} /></span>
            <span>DineIQ</span>
          </div>
          <span className="camera-breadcrumb" aria-hidden="true">/</span>
          <span className="camera-project">Vision</span>
          <span className="camera-header-note">Camera preview</span>
        </div>
      </header>

      <main id="main" className="camera-container camera-main">
        <div className="camera-heading-row">
          <div className="camera-heading">
            <h1>Camera</h1>
            <p>A live view of your space.</p>
          </div>
          <Button
            size="lg"
            variant={live || requesting ? 'outline' : 'default'}
            className={`rounded-md ${live || requesting ? '' : 'bg-foreground text-background hover:bg-foreground/85'}`}
            onClick={() => {
              setFullscreenError('')
              setDetection(null)
              setDetectionError('')
              if (live || requesting) sessionRef.current?.stop()
              else void sessionRef.current?.start()
            }}
          >
            {live ? <Square aria-hidden="true" /> : requesting ? <CameraOff aria-hidden="true" /> : <Camera aria-hidden="true" />}
            {live ? 'Stop camera' : requesting ? 'Cancel' : camera.status === 'error' ? 'Try again' : 'Start camera'}
          </Button>
        </div>

        <Card className="gap-0 rounded-lg py-0 shadow-none ring-border">
          <div className="camera-toolbar">
            <div className="camera-feed-label"><Video size={16} aria-hidden="true" /><h2>Webcam feed</h2></div>
            <span className="camera-status" data-state={camera.status} role="status">
              <span className="camera-status-dot" aria-hidden="true" />{statusLabel}
            </span>
          </div>
          <CardContent className="px-0">
            <div ref={frameRef} className="camera-viewport">
              <video
                ref={videoRef}
                className="camera-video"
                data-live={live}
                autoPlay
                playsInline
                muted
                aria-label="Live webcam preview"
                aria-hidden={!live}
              />
              <canvas ref={overlayRef} className="camera-overlay" aria-hidden="true" />
              {!live && (
                <div className="camera-empty">
                  {camera.status === 'error' ? <CameraOff size={28} strokeWidth={1.4} aria-hidden="true" /> : <Camera size={28} strokeWidth={1.4} aria-hidden="true" />}
                  <div className="camera-empty-copy" role={camera.status === 'error' ? 'alert' : undefined} aria-live="polite">
                    <h3>{requesting ? 'Waiting for your camera' : camera.status === 'error' ? 'Camera unavailable' : 'Your camera starts here'}</h3>
                    <p>{requesting ? 'Allow camera access in your browser to continue.' : camera.status === 'error' ? camera.message : 'Select Start camera and allow access to your webcam.'}</p>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
          <CardFooter className="camera-feed-footer gap-4 px-4 py-3">
            <span className="camera-source">{live ? camera.label : 'Default webcam'}</span>
            <div className="camera-feed-actions">
              {live && camera.width && camera.height ? <span className="camera-resolution">{camera.width} × {camera.height}</span> : null}
              <Button variant="ghost" size="sm" className="rounded-md" disabled={!live} onClick={() => void expandPreview()}>
                <Maximize2 aria-hidden="true" />Fullscreen
              </Button>
            </div>
          </CardFooter>
        </Card>

        {live && (
          <div className="camera-detection-status" role="status">
            <span>{detectionError || (detection
              ? `${personCount} ${personCount === 1 ? 'person' : 'people'} · ${tableCount} ${tableCount === 1 ? 'table' : 'tables'}${detectionHz === null ? '' : ` · ${detectionHz.toFixed(1)} Hz`}`
              : 'Connecting detector…')}</span>
            {detectionError && (
              <Button variant="outline" size="sm" className="rounded-md" onClick={() => {
                setDetectionError('')
                setDetection(null)
                setDetectionRetry((retry) => retry + 1)
              }}>Retry detection</Button>
            )}
          </div>
        )}
        {fullscreenError && <p className="camera-feedback" role="status">{fullscreenError}</p>}
        <p className="camera-privacy"><ShieldCheck size={15} aria-hidden="true" />Camera frames are analyzed by your backend. Nothing is recorded.</p>
      </main>

      <footer className="camera-container camera-footer">
        <span>DineIQ</span>
        <span>Live camera workspace</span>
      </footer>
    </div>
  )
}

export default App
