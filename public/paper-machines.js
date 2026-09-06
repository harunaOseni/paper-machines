import { SketchModel, canvasPoint, SKETCH_SIZE } from './sketch-model.js';

const $ = id => document.getElementById(id);
const canvas = $('sketch');
const ctx = canvas.getContext('2d');
const model = new SketchModel();
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
let ink = '#e56b39', erasing = false, busy = false, timer, ratio = 1;
let frame = 0;

function renderSample() {
ctx.save();ctx.translate(220,205);ctx.scale(1.05,1.05);ctx.lineCap='round';ctx.lineJoin='round';ctx.strokeStyle='#d87847';ctx.lineWidth=4;ctx.fillStyle='#edaa7440';ctx.beginPath();ctx.moveTo(42,135);ctx.bezierCurveTo(12,95,20,36,43,55);ctx.lineTo(77,100);ctx.bezierCurveTo(125,60,185,73,228,100);ctx.bezierCurveTo(255,30,280,56,263,125);ctx.bezierCurveTo(332,180,318,290,263,316);ctx.bezierCurveTo(188,355,58,345,26,295);ctx.bezierCurveTo(-8,247,1,171,42,135);ctx.fill();ctx.stroke();ctx.beginPath();ctx.ellipse(64,332,36,15,-.2,0,Math.PI*2);ctx.ellipse(244,334,36,14,.1,0,Math.PI*2);ctx.stroke();ctx.strokeStyle='#7b6047';ctx.lineWidth=5;for(const x of [111,205]){ctx.beginPath();ctx.ellipse(x,210,6,11,0,0,Math.PI*2);ctx.stroke();}ctx.beginPath();ctx.arc(159,235,15,0,Math.PI);ctx.stroke();ctx.strokeStyle='#d8784770';ctx.lineWidth=2;for(let i=0;i<6;i++){ctx.beginPath();ctx.moveTo(48+i*7,164);ctx.lineTo(37+i*7,188);ctx.stroke();}ctx.restore();
}

function paintStroke(stroke) {
  ctx.save();
  ctx.globalCompositeOperation = stroke.eraser ? 'destination-out' : 'source-over';
  ctx.strokeStyle = stroke.color;
  ctx.fillStyle = stroke.color;
  ctx.lineWidth = stroke.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const [first, ...rest] = stroke.points;
  ctx.beginPath();
  if (!rest.length) {
    ctx.arc(first.x, first.y, stroke.width / 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.moveTo(first.x, first.y);
    for (const point of rest) ctx.lineTo(point.x, point.y);
    ctx.stroke();
  }
  ctx.restore();
}

function render() {
  frame = 0;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, SKETCH_SIZE, SKETCH_SIZE);
  if (model.state.sample) renderSample();
  for (const stroke of model.state.strokes) paintStroke(stroke);
  if (model.active) paintStroke(model.active);
}
function scheduleRender() { if (!frame) frame = requestAnimationFrame(render); }
function sync() {
  const sample = model.state.sample && !model.state.strokes.length && !model.active;
  $('undo').disabled = busy || !model.canUndo;
  $('redo').disabled = busy || !model.canRedo;
  $('clear').disabled = busy || !model.hasContent || !!model.active;
  $('sample').disabled = busy || !!model.active;
  $('bring').disabled = busy || !!model.active || !model.hasContent;
  $('input-label').textContent = sample ? 'SAMPLE SKETCH' : 'YOUR SKETCH';
  $('paper-caption').textContent = model.hasContent || model.active ? '' : 'Your first line starts something.';
  $('stage-empty').hidden = sample;
  $('specimen').hidden = !sample;
  document.querySelector('.shadow').hidden = !sample;
  $('stage-caption').hidden = !sample;
  $('bring').textContent = sample ? 'Replay the transformation ↗' : 'Bring to life ↗';
  $('stage-status').textContent = sample ? 'Little daydream / authored sample' : 'Your sketch / ready when you are';
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
function finish(event, cancel = false) {
  if (model.active?.pointerId !== event.pointerId) return;
  if (!cancel) model.move(event.pointerId, canvasPoint(event.clientX, event.clientY, canvas.getBoundingClientRect(), true));
  model.end(event.pointerId, cancel);
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  sync(); scheduleRender();
}
canvas.addEventListener('pointerup', event => finish(event));
canvas.addEventListener('pointercancel', event => finish(event, true));
canvas.addEventListener('lostpointercapture', event => finish(event, true));
window.addEventListener('blur', () => {
  if (!model.active) return;
  model.end(model.active.pointerId, true); sync(); scheduleRender();
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
$('bring').onclick = () => {
  if (busy || model.active || !model.hasContent) return;
  if (!model.state.sample || model.state.strokes.length) {
    $('notice').textContent = 'Your sketch is ready. Generation is not connected yet.'; return;
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
