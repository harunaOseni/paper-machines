import test from 'node:test';
import assert from 'node:assert/strict';
import { SketchSession } from '../public/sketch-session.js';

const snapshot = revision => Object.freeze({ creationId: 'sketch-test', revision,
  source: Object.freeze({ imageId: 'image-test', sha256: 'digest' }), blob: new Blob(['png']) });
function ready() {
  const session = new SketchSession();
  const token = session.begin('sketch-test', 1);
  assert.equal(session.complete(token, snapshot(1), 'sketch-test', 1), true);
  return session;
}
test('handoff retains exact snapshot bytes and provenance', () => {
  const session = ready();
  const request = session.startRequest();
  assert.equal(request.blob, session.snapshot.blob);
  assert.equal(request.source, session.snapshot.source);
  assert.equal(session.accepts(request), true);
  for (const change of [{ requestId: 'other' }, { creationId: 'other' }, { revision: 2 },
    { source: { imageId: 'other', sha256: 'digest' } }, { source: { imageId: 'image-test', sha256: 'other' } }]) {
    assert.equal(session.accepts({ ...request, ...change }), false);
  }
});
test('cancel, clear and replacement fence late captures and requests', () => {
  const session = ready();
  const token = session.capture;
  const request = session.startRequest();
  session.invalidate();
  assert.equal(request.signal.aborted, true);
  assert.equal(session.accepts(request), false);
  assert.equal(session.complete(token, snapshot(1), 'sketch-test', 1), false);
  assert.equal(session.startRequest(), null);
  const replacement = session.begin('sketch-test', 2);
  assert.equal(session.complete(token, snapshot(1), 'sketch-test', 2), false);
  assert.equal(session.complete(replacement, snapshot(1), 'sketch-test', 2), false);
  assert.equal(session.complete(replacement, snapshot(2), 'sketch-test', 3), false);
  assert.equal(session.complete(replacement, snapshot(2), 'sketch-test', 2), true);
});
test('retry uses a new request ID and aborts the previous request', () => {
  const session = ready();
  const first = session.startRequest();
  const second = session.startRequest();
  assert.notEqual(first.requestId, second.requestId);
  assert.equal(first.signal.aborted, true);
  assert.equal(session.accepts(first), false);
  assert.equal(session.accepts(second), true);
});
test('same revision recapture still rejects an older capture', () => {
  const session = ready();
  const old = session.capture;
  const current = session.begin('sketch-test', 1);
  assert.equal(session.complete(old, snapshot(1), 'sketch-test', 1), false);
  assert.equal(session.complete(current, snapshot(1), 'sketch-test', 1), true);
});
