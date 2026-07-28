/**
 * face-verify.ts — Real on-device face matching using face-api.js
 *
 * Models loaded from /public/models/ (local, no CDN dependency).
 * Everything runs in the browser — no face data sent to server.
 *
 * Pipeline:
 *   1. loadModels()            — load TinyFaceDetector + landmarks + recognition nets
 *   2. extractDescriptor()     — get 128-D face embedding from an image/canvas
 *   3. matchScore(d1, d2)      — euclidean distance → 0–1 similarity score
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FaceApiModule = any;

let faceapi: FaceApiModule = null;
let modelsLoaded = false;
let loadPromise: Promise<void> | null = null;

export async function loadFaceModels(onProgress?: (msg: string) => void): Promise<void> {
  if (modelsLoaded) return;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    onProgress?.("Loading face detection engine…");

    // Dynamic import — browser only, never runs on server
    faceapi = await import("@vladmandic/face-api/dist/face-api.esm.js" as string);

    const MODEL_URL = "/models";

    onProgress?.("Loading face detector (190 KB)…");
    await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);

    // Full landmark net, not the tiny one: the tiny model's eye contours are too
    // coarse for EAR to move on a blink (it sits near the "average open" shape).
    onProgress?.("Loading landmark model (349 KB)…");
    await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);

    onProgress?.("Loading recognition model (6.2 MB)…");
    await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL);

    modelsLoaded = true;
    onProgress?.("AI face models ready");
  })();

  return loadPromise;
}

// ── Liveness metrics (from 68-pt landmarks) ──────────────────────────────────
// Used to verify the user actually performs the challenge: a photo can't blink
// (EAR never drops) and a flat photo can't yaw past threshold.

export interface FaceMetrics {
  detected: boolean;
  ear: number; // eye-aspect-ratio: ~0.3 open, <0.18 closed (a blink)
  yaw: number; // head turn: ~0 frontal, |yaw| > 0.28 is a clear side turn
}

function _dist(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function _ear(eye: { x: number; y: number }[]) {
  // eye: 6 ordered landmark points
  const A = _dist(eye[1], eye[5]);
  const B = _dist(eye[2], eye[4]);
  const C = _dist(eye[0], eye[3]) || 1;
  return (A + B) / (2 * C);
}

/** One lightweight detect+landmark pass for the liveness loop (no descriptor). */
export async function analyzeFace(
  source: HTMLVideoElement | HTMLCanvasElement | HTMLImageElement,
): Promise<FaceMetrics> {
  if (!faceapi || !modelsLoaded) return { detected: false, ear: 1, yaw: 0 };
  try {
    // ponytail: low threshold on purpose — a hard blink/squint drops detector
    // confidence below 0.4, so the closed-eye frames vanish exactly when EAR
    // matters. Raise if a non-face ever scores here.
    const r = await faceapi
      .detectSingleFace(source, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.2 }))
      .withFaceLandmarks();
    if (!r) return { detected: false, ear: 1, yaw: 0 };
    const lm = r.landmarks;
    const le = lm.getLeftEye();
    const re = lm.getRightEye();
    const ear = (_ear(le) + _ear(re)) / 2;
    const nose = lm.getNose();
    const noseTip = nose[3] ?? nose[nose.length - 1];
    const leftCorner = le[0];   // outer corner of left eye
    const rightCorner = re[3];  // outer corner of right eye
    const leftDist = noseTip.x - leftCorner.x;
    const rightDist = rightCorner.x - noseTip.x;
    const yaw = (rightDist - leftDist) / ((rightDist + leftDist) || 1);
    return { detected: true, ear, yaw };
  } catch {
    return { detected: false, ear: 1, yaw: 0 };
  }
}

/** Euclidean distance between two descriptors. < ~0.5 = same person. */
export function faceDistance(d1: Float32Array, d2: Float32Array): number {
  if (!faceapi) return 1;
  return faceapi.euclideanDistance(d1, d2);
}

/** Returns a 128-D face descriptor from an image element, or null if no face found */
export async function extractDescriptor(
  source: HTMLImageElement | HTMLCanvasElement | HTMLVideoElement,
): Promise<Float32Array | null> {
  if (!faceapi || !modelsLoaded) return null;
  try {
    const result = await faceapi
      .detectSingleFace(source, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.4 }))
      .withFaceLandmarks()
      .withFaceDescriptor();
    return result?.descriptor ?? null;
  } catch {
    return null;
  }
}

/** Extract descriptor from a base64 JPEG/PNG string */
export async function extractDescriptorFromBase64(b64: string): Promise<Float32Array | null> {
  if (!faceapi || !modelsLoaded) return null;
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = async () => resolve(await extractDescriptor(img));
    img.onerror = () => resolve(null);
    img.src = `data:image/jpeg;base64,${b64}`;
  });
}

/**
 * Compute face similarity score: 0.0 (different) → 1.0 (same person)
 * Euclidean distance threshold is ~0.6 for face-api.js recognition net.
 */
export function matchScore(desc1: Float32Array, desc2: Float32Array): number {
  if (!faceapi) return 0;
  const distance = faceapi.euclideanDistance(desc1, desc2);
  // Map [0 … 0.6] → [1.0 … 0.0], clamp below 0
  return Math.max(0, Math.min(1, 1 - distance / 0.6));
}

/** Best match score between an ID descriptor and a list of live descriptors */
export function bestMatch(idDesc: Float32Array, liveDescs: Float32Array[]): number {
  if (liveDescs.length === 0) return 0;
  return Math.max(...liveDescs.map((d) => matchScore(idDesc, d)));
}

export function isLoaded() { return modelsLoaded; }
