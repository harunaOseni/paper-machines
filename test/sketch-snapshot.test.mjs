import test from 'node:test';
import assert from 'node:assert/strict';
import { containsInk, encodePng, SNAPSHOT_LIMITS, prepareSketch } from '../public/sketch-snapshot.js';
import { SketchModel } from '../public/sketch-model.js';

test('blank, transparent and near-white pixels are rejected; colored ink survives', () => {
  assert.equal(containsInk(new Uint8ClampedArray([255,255,255,255,0,0,0,0])), false);
  assert.equal(containsInk([250,250,250,255]), false);
  for (const color of [[229,107,57,255],[52,60,54,255],[113,139,112,255]]) assert.equal(containsInk(color), true);
});
test('PNG encoding rejects null, wrong type, oversized output, throws and timeout', async () => {
  for (const blob of [null, new Blob(['x'],{type:'image/jpeg'}), new Blob([],{type:'image/png'}), new Blob([new Uint8Array(SNAPSHOT_LIMITS.maxBytes+1)],{type:'image/png'})]) {
    await assert.rejects(encodePng({toBlob: callback => callback(blob)}));
  }
  await assert.rejects(encodePng({toBlob:()=>{throw new Error('failed');}}));
  await assert.rejects(encodePng({toBlob:()=>{}},5),/too long/);
});
test('PNG encoding preserves the exact returned bytes', async () => {
  const blob=new Blob(['png bytes'],{type:'image/png'});
  assert.equal(await encodePng({toBlob:callback=>callback(blob)}),blob);
});
test('revision changes on edits, undo, redo and clear but not cancellation', () => {
  const m=new SketchModel(), id=m.sketchId;
  m.begin(1,{x:10,y:10},{color:'#000',eraser:false});m.end(1,true);assert.equal(m.revision,0);
  m.begin(1,{x:10,y:10},{color:'#000',eraser:false});m.end(1);assert.equal(m.revision,1);
  m.undo();assert.equal(m.revision,2);m.redo();assert.equal(m.revision,3);m.clear();assert.equal(m.revision,4);
  assert.equal(m.sketchId,id);
});
test('invalid revision and unavailable crypto fail before rendering', async () => {
  await assert.rejects(prepareSketch({state:{},sketchId:'bad',revision:1}),/revision/);
  await assert.rejects(prepareSketch({state:{},sketchId:'sketch-test',revision:1},{cryptoProvider:{}}),/localhost/);
});

test('handoff metadata is stable and hashes the encoded bytes', async () => {
  const blob = new Blob(['deterministic test PNG'], { type: 'image/png' });
  const ctx = { globalCompositeOperation: '', fillStyle: '', fillRect() {}, getImageData: () => ({ data: [0,0,0,255] }) };
  const createCanvas = () => ({ getContext: () => ctx, toBlob: callback => callback(blob) });
  const state = { sample: false, strokes: [] };
  const input = { state, sketchId: 'sketch-test', revision: 7 };
  const a = await prepareSketch(input, { createCanvas });
  const b = await prepareSketch(input, { createCanvas });
  const expected = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())), n => n.toString(16).padStart(2, '0')).join('');
  assert.equal(a.source.sha256, expected);
  assert.equal(a.source.imageId, b.source.imageId);
  assert.ok(a.source.imageId.length <= 64);
  assert.equal(a.revision, 7);
  assert.equal(a.source.widthPx, 800);
  assert.equal(a.blob, blob);
  assert.deepEqual(state, { sample: false, strokes: [] });
  assert.ok(Object.isFrozen(a) && Object.isFrozen(a.source));
});
