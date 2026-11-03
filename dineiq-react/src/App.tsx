import { useEffect, useRef, useState } from 'react'
import { Camera, CameraOff, Maximize2, ShieldCheck, Square, Video } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter } from '@/components/ui/card'
import { createCameraSession, type CameraSession, type CameraState } from '@/lib/camera'
import './App.css'

function App() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const sessionRef = useRef<CameraSession | null>(null)
  const [camera, setCamera] = useState<CameraState>({ status: 'idle' })
  const [fullscreenError, setFullscreenError] = useState('')
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

        {fullscreenError && <p className="camera-feedback" role="status">{fullscreenError}</p>}
        <p className="camera-privacy"><ShieldCheck size={15} aria-hidden="true" />Video stays in your browser. Nothing is recorded or uploaded.</p>
      </main>

      <footer className="camera-container camera-footer">
        <span>DineIQ</span>
        <span>Live camera workspace</span>
      </footer>
    </div>
  )
}

export default App
