import { SketchModel, canvasPoint, SKETCH_SIZE } from './sketch-model.js';
import { renderSketch } from './sketch-renderer.js';
import { prepareSketch } from './sketch-snapshot.js';
import { SketchSession } from './sketch-session.js';

const $ = id => document.getElementById(id);
const canvas = $('sketch');
const ctx = canvas.getContext('2d');
const model = new SketchModel();
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
let ink = '#e56b39', erasing = false, busy = false, timer, ratio = 1;
let frame = 0;
const session = new SketchSession();
let preparing = false, previewUrl = null;
export function getPreparedSketch() { return session.snapshot; }
export function getGenerationRequest() { return session.request?.envelope ?? null; }
function discardPreview() {
  session.invalidate(); preparing = false;
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;
  $('snapshot-image').removeAttribute('src');
}


function render() {
  frame = 0;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, SKETCH_SIZE, SKETCH_SIZE);
  renderSketch(ctx, model.state, model.active);
}
function scheduleRender() { if (!frame) frame = requestAnimationFrame(render); }
function sync() {
  if (session.capture && !session.isCurrent(session.capture, model.sketchId, model.revision)) discardPreview();
  const preview = !!session.snapshot;
  $('snapshot-preview').hidden = !preview && !preparing;
  $('snapshot-image').hidden = !preview;
  $('snapshot-title').textContent = preparing ? 'Preparing your sketch…' : 'Your sketch, captured.';
  $('edit-sketch').textContent = preparing ? 'Cancel preparation' : 'Back to drawing';
  $('sketch').setAttribute('aria-busy', String(preparing));
  const sample = model.state.sample && !model.state.strokes.length && !model.active;
  $('undo').disabled = busy || !model.canUndo;
  $('redo').disabled = busy || !model.canRedo;
  $('clear').disabled = busy || !model.hasContent || !!model.active;
  $('sample').disabled = busy || !!model.active;
  $('bring').disabled = busy || preparing || !!model.active || !model.hasContent;
  $('input-label').textContent = sample ? 'SAMPLE SKETCH' : 'YOUR SKETCH';
  $('paper-caption').textContent = model.hasContent || model.active ? '' : 'Your first line starts something.';
  $('stage-empty').hidden = sample;
  $('specimen').hidden = !sample;
  document.querySelector('.shadow').hidden = !sample;
  $('stage-caption').hidden = !sample;
  $('bring').textContent = preparing ? 'Preparing your sketch…' : sample ? 'Replay the transformation ↗' : preview ? 'Bring to life ↗' : 'Preview my sketch ↗';
  $('stage-status').textContent = preview ? 'Your sketch / revision ' + session.snapshot.revision : sample ? 'Little daydream / authored sample' : 'Your sketch / ready when you are';
  for (const id of ['play', 'restart', 'zoom']) $(id).disabled = !sample || busy;
}
function resize() {
  const next = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  if (next !== ratio || canvas.width !== SKETCH_SIZE * next) {
    ratio = next;
    canvas.width = canvas.height = Math.round(SKETCH_SIZE * ratio);
  }
  scheduleRender();
}
new ResizeObserver(resize).observe(canvas);
window.addEventListener('resize', resize);
// A monitor change can alter pixel density without changing CSS dimensions.
let densityQuery;
function watchDensity() {
  densityQuery?.removeEventListener('change', densityChanged);
  densityQuery = matchMedia('(resolution: ' + window.devicePixelRatio + 'dppx)');
  densityQuery.addEventListener('change', densityChanged);
}
function densityChanged() { resize(); watchDensity(); }
watchDensity();

canvas.addEventListener('pointerdown', event => {
  if (busy || event.button !== 0 || event.isPrimary === false) return;
  const point = canvasPoint(event.clientX, event.clientY, canvas.getBoundingClientRect());
  if (!point) return;
  if (!model.begin(event.pointerId, point, { color: ink, eraser: erasing })) {
    if (!model.active) $('notice').textContent = 'This sketch has reached its stroke limit. Undo or clear to continue.';
    return;
  }
  discardPreview();
  event.preventDefault();
  canvas.focus({ preventScroll: true });
  canvas.setPointerCapture(event.pointerId);
  $('notice').textContent = '';
  sync(); scheduleRender();
});
canvas.addEventListener('pointermove', event => {
  if (model.active?.pointerId !== event.pointerId) return;
  event.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const points = event.getCoalescedEvents?.() || [];
  for (const e of points.length ? points : [event]) model.move(event.pointerId, canvasPoint(e.clientX, e.clientY, rect, true));
  scheduleRender();
});
function finish(event, interrupted = false) {
  if (model.active?.pointerId !== event.pointerId) return;
  // Interruptions often have no useful coordinates. Keep the ink already collected,
  // without extending it to a synthetic (0, 0) endpoint or rolling it back.
  if (!interrupted) model.move(event.pointerId, canvasPoint(event.clientX, event.clientY, canvas.getBoundingClientRect(), true));
  model.end(event.pointerId);
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  sync(); scheduleRender();
}
canvas.addEventListener('pointerup', event => finish(event));
canvas.addEventListener('pointercancel', event => finish(event, true));
canvas.addEventListener('lostpointercapture', event => finish(event, true));
window.addEventListener('blur', () => {
  if (!model.active) return;
  finish({ pointerId: model.active.pointerId }, true);
});
function chooseTool(erase) {
  erasing = erase;
  for (const [id, selected] of [['pen', !erase], ['eraser', erase]]) {
    $(id).classList.toggle('selected', selected);
    $(id).setAttribute('aria-pressed', String(selected));
  }
  canvas.style.cursor = erase ? 'cell' : 'crosshair';
}
$('pen').onclick = () => chooseTool(false);
$('eraser').onclick = () => chooseTool(true);
document.querySelectorAll('.swatch').forEach(button => button.onclick = () => {
  ink = button.dataset.color; chooseTool(false);
  document.querySelectorAll('.swatch').forEach(item => {
    item.classList.toggle('active', item === button);
    item.setAttribute('aria-pressed', String(item === button));
  });
});
function historyAction(action) {
  if (busy || !model[action]()) return;
  $('notice').textContent = action === 'undo' ? 'Last edit undone.' : 'Edit restored.';
  sync(); scheduleRender();
}
$('undo').onclick = () => historyAction('undo');
$('redo').onclick = () => historyAction('redo');
$('clear').onclick = () => {
  if (busy || model.active || !model.hasContent) return;
  if (!confirm('Clear this sketch? You can restore it with Undo.')) return;
  model.clear(); $('notice').textContent = 'Canvas cleared. Undo restores your sketch.';
  sync(); scheduleRender();
};
document.querySelector('.paper-panel').addEventListener('keydown', event => {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
  const key = event.key.toLowerCase();
  if (key !== 'z' && key !== 'y') return;
  event.preventDefault();
  historyAction(key === 'y' || event.shiftKey ? 'redo' : 'undo');
});
$('sample').onclick = () => {
  if (busy || model.active) return;
  if (model.hasContent && !confirm('Replace your sketch with the sample? Undo will restore it.')) return;
  model.loadSample(); $('notice').textContent = '';
  sync(); scheduleRender();
};
$('bring').onclick = async () => {
  if (busy || model.active || !model.hasContent) return;
  if (!model.state.sample || model.state.strokes.length) {
    if (session.snapshot) {
      session.startRequest();
      $('notice').textContent = 'Your sketch is ready. Generation is not connected yet.';
      return;
    }
    discardPreview();
    const token = session.begin(model.sketchId, model.revision);
    preparing = true; sync();
    $('notice').textContent = '';
    try {
      const snapshot = await prepareSketch({ state: model.state, sketchId: model.sketchId, revision: model.revision });
      if (!session.complete(token, snapshot, model.sketchId, model.revision)) return;
      previewUrl = URL.createObjectURL(snapshot.blob);
      $('snapshot-image').src = previewUrl;
      $('notice').textContent = 'Your sketch is ready. Keep drawing or bring it to life.';
    } catch (error) {
      if (session.isCurrent(token, model.sketchId, model.revision)) {
        discardPreview();
        $('notice').textContent = error.message || 'Could not prepare your sketch. Please try again.';
      }
    } finally {
      if (session.isCurrent(token, model.sketchId, model.revision)) preparing = false;
      sync();
    }
    return;
  }
  busy = true; sync(); $('progress').hidden = false;
  $('progress-title').textContent = 'Finding a little personality…';
  timer = setTimeout(() => {
    $('progress-title').textContent = 'Giving the idea a little dimension…';
    timer = setTimeout(() => {
      $('progress').hidden = true; busy = false; sync();
      $('notice').textContent = 'Sample transformation complete.';
    }, 1500);
  }, 1500);
};
$('edit-sketch').onclick = () => {
  discardPreview(); sync();
  $('notice').textContent = 'Your drawing is still here. Keep going.';
  canvas.focus({ preventScroll: true });
};
window.addEventListener('pagehide', discardPreview);
$('play').onclick = () => {
  const paused = $('stage').classList.toggle('paused');
  $('play').textContent = paused ? '▶' : 'Ⅱ';
  $('play').setAttribute('aria-label', paused ? 'Play demo animation' : 'Pause demo animation');
};
$('restart').onclick = () => {
  const el = $('specimen'); el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
  $('stage').classList.remove('paused'); $('play').textContent = 'Ⅱ';
  $('play').setAttribute('aria-label', 'Pause demo animation');
};
$('zoom').oninput = event => $('specimen').style.setProperty('--scale', event.target.value / 100);
$('about').onclick = () => $('about-dialog').showModal();
for (const id of ['close-about', 'back']) $(id).onclick = () => $('about-dialog').close();
if (reducedMotion) {
  $('stage').classList.add('paused'); $('play').textContent = '▶';
  $('play').setAttribute('aria-label', 'Play demo animation');
}
resize(); sync();
