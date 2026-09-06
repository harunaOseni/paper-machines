import { SKETCH_SIZE } from './sketch-model.js';
import { renderSketch } from './sketch-renderer.js';

export const SNAPSHOT_LIMITS = Object.freeze({ width: SKETCH_SIZE, height: SKETCH_SIZE, maxBytes: 4 * 1024 * 1024, timeoutMs: 5000 });

/** Test the final opaque pixels, not stroke count: erased sketches may be empty. */
export function containsInk(pixels) {
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] > 0 && Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) < 247) return true;
  }
  return false;
}

export function encodePng(canvas, timeoutMs = SNAPSHOT_LIMITS.timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Preparing the sketch took too long. Please try again.')), timeoutMs);
    const fail = message => { clearTimeout(timer); reject(new Error(message)); };
    try {
      canvas.toBlob(blob => {
        if (!blob || blob.type !== 'image/png' || !blob.size) return fail('Could not encode your sketch. Please try again.');
        if (blob.size > SNAPSHOT_LIMITS.maxBytes) return fail('This sketch is too large to prepare. Simplify it and try again.');
        clearTimeout(timer);
        resolve(blob);
      }, 'image/png');
    } catch { fail('Could not encode your sketch. Please try again.'); }
  });
}

/** Local-only generation handoff. Never changes the editable canvas or calls AI. */
export async function prepareSketch({ state, sketchId, revision }, {
  createCanvas = () => document.createElement('canvas'),
  cryptoProvider = globalThis.crypto,
} = {}) {
  if (!/^sketch-[A-Za-z0-9_-]+$/.test(sketchId) || sketchId.length > 64 || !Number.isInteger(revision) || revision < 1 || revision > 1000000) {
    throw new Error('The sketch revision is invalid. Please make an edit and try again.');
  }
  if (!cryptoProvider?.subtle) throw new Error('Open this app on localhost or HTTPS to prepare your sketch.');
  // Copy before any asynchronous encoding so later edits cannot affect this capture.
  const captured = structuredClone(state);
  const canvas = createCanvas();
  canvas.width = SNAPSHOT_LIMITS.width;
  canvas.height = SNAPSHOT_LIMITS.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Your browser could not prepare the sketch. Please try again.');
  renderSketch(ctx, captured);
  // Composite white AFTER erasing, otherwise erasers punch transparent holes in the background.
  ctx.globalCompositeOperation = 'destination-over';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = 'source-over';
  if (!containsInk(ctx.getImageData(0, 0, canvas.width, canvas.height).data)) {
    throw new Error('Your sketch is blank. Add a few lines, then try again.');
  }
  const blob = await encodePng(canvas);
  let digest;
  try {
    digest = await cryptoProvider.subtle.digest('SHA-256', await blob.arrayBuffer());
  } catch { throw new Error('Could not fingerprint your sketch. Please try again.'); }
  const sha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  return Object.freeze({
    creationId: sketchId,
    revision,
    source: Object.freeze({ imageId: 'image-' + sha256.slice(0, 58), sha256, widthPx: canvas.width, heightPx: canvas.height }),
    mimeType: 'image/png', background: '#ffffff', byteLength: blob.size, blob,
  });
}
