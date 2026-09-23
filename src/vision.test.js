import test from 'node:test';
import assert from 'node:assert/strict';
import { FaceTracker } from './vision.js';

test('worker timeouts terminate execution, reject pending frames, and allow a fresh tracker', async (t) => {
  let worker;
  class FakeWorker {
    constructor() { worker = this; }
    postMessage(message) { this.message = message; }
    terminate() { this.terminated = true; }
    respond(data) { this.onmessage({ data }); }
  }
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const original = globalThis.Worker;
  globalThis.Worker = FakeWorker;
  t.after(() => { globalThis.Worker = original; });
  const tracker = new FaceTracker(() => {});
  worker.respond({ id: worker.message.id, type: 'ready' });
  await tracker.ready;
  const failed = assert.rejects(tracker.detect(new ImageDataStub()), /stopped responding/);
  t.mock.timers.tick(5000);
  await failed;
  assert.equal(worker.terminated, true);
  assert.equal(tracker.pending.size, 0);
  const fresh = new FaceTracker(() => {});
  worker.respond({ id: worker.message.id, type: 'ready' });
  await fresh.ready;
  const result = fresh.detect(new ImageDataStub());
  worker.respond({ id: worker.message.id, result: null, inferenceMs: 1 });
  assert.equal((await result).result, null);
  fresh.close();
});

class ImageDataStub {
  width = 1;
  height = 1;
  data = new Uint8ClampedArray(4);
}
