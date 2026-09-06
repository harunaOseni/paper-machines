import test from 'node:test';
import assert from 'node:assert/strict';
import { SketchModel, canvasPoint, HISTORY_LIMIT } from '../public/sketch-model.js';
const point = { x: 120, y: 150 };
const pen = { color: '#e56b39', eraser: false };
function stroke(model, id = 1) {
  model.begin(id, point, pen);
  model.move(id, { x: 240, y: 300 });
  model.end(id);
}
test('starts with an independent blank personal sketch', () => {
  const m = new SketchModel();
  assert.deepEqual(m.state, { sample: false, strokes: [] });
  assert.equal(m.canUndo, false);
  assert.equal(m.canRedo, false);
});
test('maps letterboxed desktop and mobile coordinates without drift', () => {
  assert.deepEqual(canvasPoint(250, 150, { left: 0, top: 0, width: 500, height: 300 }), { x: 400, y: 400 });
  assert.deepEqual(canvasPoint(160, 250, { left: 10, top: 100, width: 300, height: 300 }), { x: 400, y: 400 });
  assert.equal(canvasPoint(20, 100, { left: 0, top: 0, width: 500, height: 300 }), null);
  assert.deepEqual(canvasPoint(0, 900, { left: 0, top: 0, width: 500, height: 300 }, true), { x: 0, y: 800 });
  assert.equal(canvasPoint(0, 0, { left: 0, top: 0, width: 0, height: 0 }), null);
});
for (const pointerType of ['mouse', 'pen', 'touch']) test(`${pointerType} stroke supports undo and redo`, () => {
  const m = new SketchModel(); stroke(m);
  const saved = structuredClone(m.state);
  m.undo(); assert.equal(m.hasContent, false);
  m.redo(); assert.deepEqual(m.state, saved);
});
test('secondary pointers cannot corrupt an active stroke', () => {
  const m = new SketchModel(); m.begin(1, point, pen);
  assert.equal(m.begin(2, point, pen), false);
  m.move(2, { x: 700, y: 700 });
  assert.equal(m.end(2), false);
  assert.equal(m.active.points.length, 1);
  m.end(1); assert.equal(m.state.strokes.length, 1);
});
test('pointer cancellation rolls back without an undo entry', () => {
  const m = new SketchModel(); m.begin(1, point, pen); m.end(1, true);
  assert.equal(m.hasContent, false); assert.equal(m.canUndo, false);
});
test('tap creates a one-point stroke; tool settings are captured at start', () => {
  const m = new SketchModel(); const tool = { color: '#718b70', eraser: true };
  m.begin(1, point, tool); tool.eraser = false; m.end(1);
  assert.equal(m.state.strokes[0].eraser, true);
  assert.equal(m.state.strokes[0].width, 32);
  assert.equal(m.state.strokes[0].points.length, 1);
});
test('clear and sample replacement are reversible with matching provenance', () => {
  const m = new SketchModel(); stroke(m); const saved = m.state;
  m.loadSample(); assert.equal(m.state.sample, true);
  m.undo(); assert.deepEqual(m.state, saved);
  m.redo(); m.clear(); assert.equal(m.state.sample, false);
  m.undo(); assert.equal(m.state.sample, true);
});
test('new strokes invalidate redo and history remains bounded', () => {
  const m = new SketchModel(); stroke(m); m.undo(); stroke(m);
  assert.equal(m.canRedo, false);
  for (let i = 0; i < 80; i++) stroke(m);
  assert.equal(m.past.length, HISTORY_LIMIT);
});
test('coordinate changes do not mutate the logical sketch', () => {
  const m = new SketchModel(); stroke(m); const saved = structuredClone(m.state);
  for (const size of [200, 400, 800, 1600]) canvasPoint(size/2, size/2, { left: 0, top: 0, width: size, height: size });
  assert.deepEqual(m.state, saved);
});
