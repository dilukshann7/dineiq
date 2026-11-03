import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createDetectionLoop, createFrameCapture, containRect } from '../src/lib/detection.ts'

test('slow inference starts the next fresh frame without an extra idle delay', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let now = 0
  t.mock.method(performance, 'now', () => now)
  const pending = Promise.withResolvers()
  let requests = 0
  const stop = createDetectionLoop({
    capture: async () => new Blob(['frame']),
    detect: async () => { requests++; return pending.promise },
    onResult: () => {},
    onError: (error) => assert.fail(error.message),
  })
  try {
    await Promise.resolve()
    assert.equal(requests, 1)
    now = 100
    pending.resolve({ width: 1280, height: 720, detections: [] })
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    t.mock.timers.tick(0)
    await Promise.resolve()
    assert.equal(requests, 2)
  } finally {
    stop()
  }
})

test('capture preserves detail from a 1080p camera and avoids upscaling', async () => {
  const originalDocument = globalThis.document
  const canvas = {
    width: 0, height: 0,
    getContext: () => ({ drawImage: () => {} }),
    toBlob: (callback) => callback(new Blob(['jpeg'])),
  }
  globalThis.document = { createElement: () => canvas }
  try {
    const video = { readyState: 2, videoWidth: 1920, videoHeight: 1080 }
    const capture = createFrameCapture(video)
    await capture()
    assert.deepEqual([canvas.width, canvas.height], [1280, 720])
    video.videoWidth = 320
    video.videoHeight = 240
    await capture()
    assert.deepEqual([canvas.width, canvas.height], [320, 240])
  } finally {
    if (originalDocument === undefined) delete globalThis.document
    else globalThis.document = originalDocument
  }
})

test('overlay follows object-fit contain, including letterboxing', () => {
  assert.deepEqual(containRect(1000, 1000, 1600, 900), {
    x: 0, y: 218.75, width: 1000, height: 562.5,
  })
  assert.deepEqual(containRect(1000, 500, 500, 1000), {
    x: 375, y: 0, width: 250, height: 500,
  })
})

test('detection waits for an in-flight response and aborts on cleanup', async () => {
  const pending = Promise.withResolvers()
  let requests = 0
  let signal
  const results = []
  const stop = createDetectionLoop({
    capture: async () => new Blob(['frame']),
    detect: async (_frame, requestSignal) => {
      requests++
      signal = requestSignal
      return pending.promise
    },
    onResult: (result) => results.push(result),
    onError: () => assert.fail('cleanup should not report an error'),
    intervalMs: 1,
  })
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(requests, 1)
  stop()
  assert.equal(signal.aborted, true)
  pending.resolve({ width: 640, height: 360, detections: [] })
  await new Promise((resolve) => setTimeout(resolve, 10))
  assert.equal(results.length, 0)
  assert.equal(requests, 1)
})

test('detection errors stop the loop instead of repeatedly posting frames', async () => {
  let requests = 0
  const errors = []
  const stop = createDetectionLoop({
    capture: async () => new Blob(['frame']),
    detect: async () => { requests++; throw new Error('Backend unavailable') },
    onResult: () => assert.fail('failed detection must not publish results'),
    onError: (error) => errors.push(error.message),
    intervalMs: 1,
  })
  await new Promise((resolve) => setTimeout(resolve, 20))
  stop()
  assert.equal(requests, 1)
  assert.deepEqual(errors, ['Backend unavailable'])
})
