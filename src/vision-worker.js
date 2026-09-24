import { models } from './vision-models.js';
import { smileFromLandmarks } from './expression.js';
import wasmUrl from '@tensorflow/tfjs-backend-wasm/dist/tfjs-backend-wasm.wasm?url';
import simdUrl from '@tensorflow/tfjs-backend-wasm/dist/tfjs-backend-wasm-simd.wasm?url';
import threadedUrl from '@tensorflow/tfjs-backend-wasm/dist/tfjs-backend-wasm-threaded-simd.wasm?url';

let api;
let canvas;
let context;
let ready;
let segmenter;
let segmentHead;

async function initialize() {
  const [library, buffers, segmentation] = await Promise.all([
    import('@vladmandic/face-api/dist/face-api.esm-nobundle.js'),
    Promise.all(models.map(async ({ url }) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Vision asset failed: ${response.status}`);
      return response.arrayBuffer();
    })),
    import('./segmentation.js'),
  ]);
  api = library;
  // FaceAPI's documented environment adapter lets it use worker canvases.
  class UnusedMedia {}
  api.env.setEnv({
    Canvas: OffscreenCanvas,
    CanvasRenderingContext2D: OffscreenCanvasRenderingContext2D,
    Image: UnusedMedia,
    Video: UnusedMedia,
    ImageData,
    createCanvasElement: () => new OffscreenCanvas(1, 1),
    fetch: fetch.bind(self),
  });
  // Single-threaded WASM works on Pages without cross-origin isolation or GPU compilation.
  api.tf.setThreadsCount(1);
  api.tf.setWasmPaths({
    'tfjs-backend-wasm.wasm': wasmUrl,
    'tfjs-backend-wasm-simd.wasm': simdUrl,
    'tfjs-backend-wasm-threaded-simd.wasm': threadedUrl,
  });
  await api.tf.setBackend('wasm');
  await api.tf.ready();
  // Load the hair boundary in the background. Face inference must not wait for
  // the optional segmentation model; the tracked head remains the first-frame fallback.
  segmentation.createSegmenter().then((value) => { segmenter = value; }).catch(() => {});
  segmentHead = segmentation.segmentHead;
  models.forEach(({ name, weights }, index) => {
    api.nets[name].loadFromWeightMap(api.tf.io.decodeWeights(buffers[index], weights));
  });
  canvas = new OffscreenCanvas(1, 1);
  context = canvas.getContext('2d', { willReadFrequently: true });
}

self.onmessage = async ({ data }) => {
  const { id, type } = data;
  try {
    if (type === 'init') {
      ready = initialize();
      await ready;
      self.postMessage({ id, type: 'ready' });
      return;
    }
    await ready;
    const startedAt = performance.now();
    const { width, height, pixels } = data;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    context.putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height), 0, 0);
    const face = await api.detectSingleFace(canvas, new api.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.4 }))
      .withFaceLandmarks(true).withFaceExpressions();
    let result = null;
    if (face) {
      const points = face.landmarks.positions.map(({ x, y }) => ({ x: x / width, y: y / height }));
      result = {
        points,
        smile: smileFromLandmarks(face.expressions.happy, points, width / height),
        mask: segmenter ? await segmentHead(segmenter, canvas, points) : null,
        confidence: face.detection.score,
      };
    }
    self.postMessage({ id, result, inferenceMs: performance.now() - startedAt, backend: api.tf.getBackend() }, result ? [result.mask.data.buffer] : []);
  } catch (error) {
    self.postMessage({ id, error: error.message });
  }
};
