import { SketchModel, canvasPoint, SKETCH_SIZE } from './sketch-model.js';
import { renderSketch } from './sketch-renderer.js';
import { prepareSketch } from './sketch-snapshot.js';
import { SketchSession } from './sketch-session.js';
import { requestGeneration } from './generation-client.js';
import { GenerationProgress } from './generation-progress.js';
import { ObjectRuntime } from '/runtime/host.js';
import { API_ORIGIN } from './deployment-config.js';

const $ = id => document.getElementById(id);
const generationProgress = new GenerationProgress($('generation-progress'));
const canvas = $('sketch');
const ctx = canvas.getContext('2d');
const model = new SketchModel();
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
let ink = '#e56b39', erasing = false, busy = false, timer, ratio = 1;
let frame = 0;
const session = new SketchSession();
let preparing = false, previewUrl = null;
let generatingId = null, generatedObject = null;
let runtimeReady = false, runtimePaused = reducedMotion;
const runtime = new ObjectRuntime($('runtime-view'), (status, message) => {
  runtimeReady = status === 'ready';
  $('runtime-view').hidden = !runtimeReady;
  $('runtime-view').dataset.state = status;
  if (runtimeReady) { runtime.pause(runtimePaused); runtime.setScale(Number($('zoom').value)/100); }
  if (runtimeReady) generationProgress.complete();
  else if(status==='error') generationProgress.fail(message);
  $('notice').textContent = message;
  sync();
}, {frameUrl:API_ORIGIN+'/runtime/frame'});
function startRuntime() {
  runtimeReady = false; $('runtime-view').hidden = true;
  if(!generationProgress.stage) generationProgress.start();
  generationProgress.set('opening');
  $('runtime-view').dataset.state = 'loading';
  try { runtime.start(generatedObject); }
  catch (error) {
    $('runtime-view').hidden = true; $('runtime-view').dataset.state = 'error';
    $('notice').textContent = error.message || 'This object could not start.';
    generationProgress.fail($('notice').textContent);
  }
}
export function getGeneratedObject() { return generatedObject; }
export function getPreparedSketch() { return session.snapshot; }
export function getGenerationRequest() { return session.request?.envelope ?? null; }
function discardPreview() {
  generationProgress.reset();
  runtime.dispose(); runtimeReady = false; $('runtime-view').hidden = true;
  session.invalidate(); preparing = false;
  generatingId = generatedObject = null;
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
  $('snapshot-preview').hidden = runtimeReady || (!preview && !preparing);
  document.querySelector('.stage-controls').hidden = !runtimeReady && (preview || preparing);
  $('runtime-back').hidden = !runtimeReady;
  $('snapshot-image').hidden = !preview;
  $('snapshot-preview').classList.toggle('is-generating', !generationProgress.container.hidden);
  $('snapshot-title').textContent = preparing ? 'Preparing your sketch…' : !generationProgress.container.hidden ? 'From sketch to life' : generatedObject ? 'Your object is generated.' : 'Your sketch, captured.';
  $('edit-sketch').textContent = generatingId ? 'Cancel generation' : preparing ? 'Cancel preparation' : 'Back to drawing';
  $('sketch').setAttribute('aria-busy', String(preparing));
  const sample = model.state.sample && !model.state.strokes.length && !model.active;
  $('undo').disabled = busy || !model.canUndo;
  $('redo').disabled = busy || !model.canRedo;
  $('clear').disabled = busy || !model.hasContent || !!model.active;
  $('sample').disabled = busy || !!model.active;
  $('bring').disabled = busy || preparing || !!generatingId || !!model.active || !model.hasContent;
  $('input-label').textContent = sample ? 'SAMPLE SKETCH' : 'YOUR SKETCH';
  $('paper-caption').textContent = model.hasContent || model.active ? '' : 'Your first line starts something.';
  $('stage-empty').hidden = sample;
  $('specimen').hidden = !sample;
  document.querySelector('.shadow').hidden = !sample;
  $('stage-caption').hidden = !sample;
  $('bring').textContent = generatingId ? 'Creating your object…' : preparing ? 'Preparing your sketch…' : sample ? 'Replay the transformation ↗' : generatedObject ? 'Try another interpretation ↗' : preview ? 'Bring to life ↗' : 'Preview my sketch ↗';
  $('stage-status').textContent = preview ? 'Your sketch' : sample ? 'Little daydream / authored sample' : 'Your sketch / ready when you are';
  for (const id of ['play', 'restart']) $(id).disabled = (!sample && !runtimeReady) || busy;
  $('zoom').disabled = (!sample && !runtimeReady) || busy;
  if (runtimeReady) {
    $('play').textContent = runtimePaused ? '▶' : 'Ⅱ';
    $('play').setAttribute('aria-label', runtimePaused ? 'Play animation' : 'Pause animation');
    $('restart').setAttribute('aria-label', 'Restart animation');
    $('stage-status').textContent = generatedObject.subject.summary;
  }
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
  if (busy || preparing || generatingId || model.active || !model.hasContent) return;
  if (!model.state.sample || model.state.strokes.length) {
    if (session.snapshot) {
      const request = session.startRequest();
      runtime.dispose(); runtimeReady = false; $('runtime-view').hidden = true;
      generatingId = request.requestId; generatedObject = null; generationProgress.start(); sync();
      $('notice').textContent = 'Giving your sketch shape and movement…';
      try {
        const result = await requestGeneration(request, fetch, stage => {
          if(!request.signal.aborted && generatingId===request.requestId) generationProgress.set(stage);
        });
        if (!session.accepts(result.definition)) return;
        generatedObject = result.definition;
        $('notice').textContent = 'Object and animation generated. Opening your creation…';
        startRuntime();
      } catch (error) {
        if (!request.signal.aborted && generatingId === request.requestId) {
          $('notice').textContent = error.message || 'Generation failed. Please try again.';
          generationProgress.fail($('notice').textContent);
        }
      } finally {
        if (generatingId === request.requestId) generatingId = null;
        sync();
      }
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
$('runtime-back').onclick = $('edit-sketch').onclick;
$('play').onclick = () => {
  if (runtimeReady) { runtimePaused = !runtimePaused; runtime.pause(runtimePaused); sync(); return; }
  const paused = $('stage').classList.toggle('paused');
  $('play').textContent = paused ? '▶' : 'Ⅱ';
  $('play').setAttribute('aria-label', paused ? 'Play demo animation' : 'Pause demo animation');
};
$('restart').onclick = () => {
  if (generatedObject) { startRuntime(); sync(); return; }
  const el = $('specimen'); el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
  $('stage').classList.remove('paused'); $('play').textContent = 'Ⅱ';
  $('play').setAttribute('aria-label', 'Pause demo animation');
};
$('zoom').oninput = event => {
  const scale=Number(event.target.value)/100;
  if(runtimeReady)runtime.setScale(scale);
  else $('specimen').style.setProperty('--scale',scale);
};
$('about').onclick = () => $('about-dialog').showModal();
for (const id of ['close-about', 'back']) $(id).onclick = () => $('about-dialog').close();
if (reducedMotion) {
  $('stage').classList.add('paused'); $('play').textContent = '▶';
  $('play').setAttribute('aria-label', 'Play demo animation');
}
resize(); sync();
