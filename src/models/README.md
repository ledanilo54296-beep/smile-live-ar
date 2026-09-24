# BodyPix Model

TensorFlow.js BodyPix MobileNetV1, multiplier 0.5, stride 16, one-byte quantization.
Model topology and weights are unmodified upstream downloads:

- https://storage.googleapis.com/tfjs-models/savedmodel/bodypix/mobilenet/quant1/050/model-stride16.json
- https://storage.googleapis.com/tfjs-models/savedmodel/bodypix/mobilenet/quant1/050/group1-shard1of1.bin

Source: https://github.com/tensorflow/tfjs-models/tree/master/body-pix

Copyright Google LLC. Apache License 2.0; see `LICENSE.bodypix.txt`.
The loader supplies the locally named binary through TensorFlow's structured IO handler.
