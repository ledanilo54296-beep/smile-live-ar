import { load } from '@tensorflow-models/body-pix';
import * as tf from '@tensorflow/tfjs-core';
import model from './models/body-segmentation.json';
import weightsUrl from './models/body-segmentation.bin?url';

export async function createSegmenter() {
  const response = await fetch(weightsUrl);
  if (!response.ok) throw new Error(`Segmentation asset failed: ${response.status}`);
  const weightData = await response.arrayBuffer();
  return load({
    architecture: 'MobileNetV1', outputStride: 16, multiplier: 0.5, quantBytes: 1,
    modelUrl: { load: async () => ({ modelTopology: model.modelTopology, weightSpecs: model.weightsManifest[0].weights, weightData }) },
  });
}

export async function segmentHead(model, canvas, points) {
  const input = tf.browser.fromPixels(canvas);
  const output = model.segmentPersonActivation(input, 0.75, 0.4);
  const width = 256, height = Math.round(canvas.height / canvas.width * width);
  const resized = tf.tidy(() => tf.image.resizeBilinear(output.segmentation.toFloat().expandDims(-1), [height, width], true).squeeze());
  try {
    const data = new Float32Array(await resized.data());
    const xs = points.slice(0, 17).map((p) => p.x), ys = points.slice(0, 17).map((p) => p.y);
    const faceWidth = Math.max(...xs) - Math.min(...xs);
    return { data, width, height, bounds: {
      left: Math.min(...xs) - faceWidth * 0.5, right: Math.max(...xs) + faceWidth * 0.5,
      top: Math.min(...ys) - faceWidth, bottom: Math.max(...ys) + faceWidth * 0.05,
    } };
  } finally {
    input.dispose(); resized.dispose();
    for (const value of Object.values(output)) if (value instanceof tf.Tensor) value.dispose();
  }
}
