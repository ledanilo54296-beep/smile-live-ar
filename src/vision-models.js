import detectorManifest from '@vladmandic/face-api/model/tiny_face_detector_model-weights_manifest.json';
import landmarksManifest from '@vladmandic/face-api/model/face_landmark_68_tiny_model-weights_manifest.json';
import expressionManifest from '@vladmandic/face-api/model/face_expression_model-weights_manifest.json';
import detectorUrl from '@vladmandic/face-api/model/tiny_face_detector_model.bin?url';
import landmarksUrl from '@vladmandic/face-api/model/face_landmark_68_tiny_model.bin?url';
import expressionUrl from '@vladmandic/face-api/model/face_expression_model.bin?url';

export const models = [
  { name: 'tinyFaceDetector', url: detectorUrl, weights: detectorManifest[0].weights },
  { name: 'faceLandmark68TinyNet', url: landmarksUrl, weights: landmarksManifest[0].weights },
  { name: 'faceExpressionNet', url: expressionUrl, weights: expressionManifest[0].weights },
];
