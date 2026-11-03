import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createCameraSession } from '../src/lib/camera.ts'

function createFixture(getUserMedia) {
  const states = []
  const video = { srcObject: null, play: async () => {}, pause: () => {} }
  const session = createCameraSession(video, (state) => states.push(state), { getUserMedia })
  return { video, session, states }
}

function createStream() {
  const track = Object.assign(new EventTarget(), {
    label: 'Test webcam',
    stopped: false,
    getSettings: () => ({ width: 1280, height: 720 }),
    stop() { this.stopped = true },
  })
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] }
  return { stream, track }
}

test('starts a video-only preview and releases the camera on stop', async () => {
  const { stream, track } = createStream()
  const { session, video, states } = createFixture(async (constraints) => {
    assert.equal(constraints.audio, false)
    assert.ok(constraints.video)
    return stream
  })
  await session.start()
  assert.equal(video.srcObject, stream)
  assert.deepEqual(states.at(-1), { status: 'live', label: 'Test webcam', width: 1280, height: 720 })
  session.stop()
  assert.equal(track.stopped, true)
  assert.equal(video.srcObject, null)
  assert.equal(states.at(-1).status, 'idle')
})

test('canceling a permission request stops a stream granted later', async () => {
  const pending = Promise.withResolvers()
  const { stream, track } = createStream()
  const { session, video, states } = createFixture(() => pending.promise)
  const starting = session.start()
  session.stop()
  pending.resolve(stream)
  await starting
  assert.equal(track.stopped, true)
  assert.equal(video.srcObject, null)
  assert.equal(states.at(-1).status, 'idle')
})

test('permission denial offers an actionable error and permits retry', async () => {
  let denied = true
  const { stream } = createStream()
  const { session, states } = createFixture(async () => {
    if (denied) throw new DOMException('Permission denied', 'NotAllowedError')
    return stream
  })
  await session.start()
  assert.equal(states.at(-1).status, 'error')
  assert.match(states.at(-1).message, /permission/i)
  denied = false
  await session.start()
  assert.equal(states.at(-1).status, 'live')
  session.dispose()
})

test('disposal releases a late stream without updating an unmounted view', async () => {
  const pending = Promise.withResolvers()
  const { stream, track } = createStream()
  const { session, states } = createFixture(() => pending.promise)
  const starting = session.start()
  session.dispose()
  const count = states.length
  pending.resolve(stream)
  await starting
  assert.equal(track.stopped, true)
  assert.equal(states.length, count)
})

test('camera disconnection clears the preview and reports its actual state', async () => {
  const { stream, track } = createStream()
  const { session, video, states } = createFixture(async () => stream)
  await session.start()
  track.dispatchEvent(new Event('ended'))
  assert.equal(video.srcObject, null)
  assert.equal(track.stopped, true)
  assert.equal(states.at(-1).status, 'error')
  assert.match(states.at(-1).message, /disconnected/i)
})

test('failed playback releases the acquired camera', async () => {
  const { stream, track } = createStream()
  const { session, video, states } = createFixture(async () => stream)
  video.play = async () => { throw new DOMException('Playback failed', 'NotSupportedError') }
  await session.start()
  assert.equal(track.stopped, true)
  assert.equal(video.srcObject, null)
  assert.equal(states.at(-1).status, 'error')
})
