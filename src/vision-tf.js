// FaceAPI uses tensor operations, not TensorFlow's layers, training or data packages.
import '@tensorflow/tfjs-core/dist/public/chained_ops/register_all_chained_ops';
export * from '@tensorflow/tfjs-core';
