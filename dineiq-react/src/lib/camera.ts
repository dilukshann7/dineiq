export type CameraState =
  | { status: 'idle' | 'requesting' }
  | { status: 'live'; label: string; width?: number; height?: number }
  | { status: 'error'; message: string }

export type CameraSession = ReturnType<typeof createCameraSession>

function cameraError(error: unknown): string {
  const name = error instanceof Error ? error.name : ''
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Camera access is blocked. Allow camera permission in your browser, then try again.'
    case 'NotFoundError':
      return 'No camera was found. Connect a webcam, then try again.'
    case 'NotReadableError':
    case 'AbortError':
      return 'Your camera could not start. Close other apps using it, then try again.'
    default:
      return 'The camera preview could not start. Check your camera connection and try again.'
  }
}

export function createCameraSession(
  video: Pick<HTMLVideoElement, 'srcObject' | 'play' | 'pause'>,
  onChange: (state: CameraState) => void,
  mediaDevices: Pick<MediaDevices, 'getUserMedia'> | undefined,
) {
  let generation = 0
  let disposed = false
  let stream: MediaStream | null = null
  let removeListeners = () => {}

  function release() {
    removeListeners()
    removeListeners = () => {}
    const previous = stream
    stream = null
    video.pause()
    video.srcObject = null
    previous?.getTracks().forEach((track) => track.stop())
  }

  async function start() {
    if (disposed) return
    const request = ++generation
    release()

    if (!mediaDevices?.getUserMedia) {
      onChange({ status: 'error', message: 'Camera access needs HTTPS or localhost and a browser that supports webcams.' })
      return
    }

    onChange({ status: 'requesting' })
    try {
      const acquired = await mediaDevices.getUserMedia({
        audio: false,
        video: { width: { ideal: 1920 }, height: { ideal: 1080 }, facingMode: 'user' },
      })

      // Permission may arrive after cancellation or after the page unmounts.
      if (request !== generation || disposed) {
        acquired.getTracks().forEach((track) => track.stop())
        return
      }

      stream = acquired
      const track = acquired.getVideoTracks()[0]
      if (!track) throw new Error('No video track was returned')

      const onEnded = () => {
        if (stream !== acquired || disposed) return
        ++generation
        release()
        onChange({ status: 'error', message: 'Your camera was disconnected. Reconnect it, then try again.' })
      }
      track.addEventListener('ended', onEnded)
      removeListeners = () => track.removeEventListener('ended', onEnded)

      video.srcObject = acquired
      await video.play()
      if (request !== generation || disposed) return

      const { width, height } = track.getSettings()
      onChange({ status: 'live', label: track.label || 'Default webcam', width, height })
    } catch (error) {
      if (request !== generation || disposed) return
      release()
      onChange({ status: 'error', message: cameraError(error) })
    }
  }

  function stop() {
    ++generation
    release()
    if (!disposed) onChange({ status: 'idle' })
  }

  function dispose() {
    disposed = true
    ++generation
    release()
  }

  return { start, stop, dispose }
}
