import test from 'node:test';
import assert from 'node:assert/strict';
import { Script } from 'node:vm';
import { validateObjectPackage, parseObjectPackage, validateRuntimeMessage, LIMITS, EXECUTION_POLICY, objectPackageSchema } from '../src/paper-machines/object-contract.mjs';
import { createExampleObject, bouncingBallFactory } from './fixtures/example-object.mjs';
import { createTrustedLifecycle, seededRandom } from '../src/paper-machines/object-lifecycle.mjs';

test('object package round-trips as JSON without mutation; source compiles but is not executed', () => {
  const example = createExampleObject();
  const original = structuredClone(example);
  assert.deepEqual(validateObjectPackage(example), { valid: true, issues: [] });
  assert.deepEqual(parseObjectPackage(JSON.stringify(example)).value, example);
  assert.deepEqual(example, original);
  assert.doesNotThrow(() => new Script(`(function(THREE, random) {${example.code.source}\n})`));
  assert.deepEqual(JSON.parse(JSON.stringify(objectPackageSchema)), objectPackageSchema);
});

for (const [name, mutate, code] of [
  ['version', p => p.schemaVersion = '2', 'version_or_constant'],
  ['runtime version', p => p.runtimeVersion = '2', 'version_or_constant'],
  ['missing source', p => delete p.source, 'required'],
  ['invalid digest', p => p.source.sha256 = 'not-a-digest', 'format'],
  ['fractional revision', p => p.revision = 1.5, 'type'],
  ['unknown capability', p => p.network = true, 'unknown_field'],
  ['prototype-named key', p => p.constructor = 'bad', 'unknown_field'],
  ['blank code', p => p.code.source = '  ', 'format'],
  ['code length', p => p.code.source = 'a'.repeat(LIMITS.sourceBytes + 1), 'format'],
  ['UTF-8 source budget', p => p.code.source = '🌍'.repeat(20000), 'source_size'],
  ['NaN bounds', p => p.bounds.min.x = NaN, 'range'],
  ['infinite bounds', p => p.bounds.max.x = Infinity, 'range'],
  ['inverted bounds', p => p.bounds.min.x = 100, 'bounds'],
  ['flat bounds', p => p.bounds.max.z = p.bounds.min.z, 'bounds'],
  ['missing depth assumption', p => p.assumptions = p.assumptions.filter(a => a.kind !== 'depth'), 'depth_assumption'],
  ['unbounded duration', p => p.animation.durationSeconds = 100, 'range'],
  ['negative seed', p => p.animation.seed = -1, 'range'],
  ['unexpected animation kind', p => p.animation.kind = 'physics-guaranteed', 'unsupported_value'],
  ['too many features', p => p.subject.preservedFeatures = Array(21).fill('x'), 'size'],
  ['sparse features', p => delete p.subject.preservedFeatures[0], 'type'],
]) test(`rejects ${name}`, () => {
  const p = createExampleObject(); mutate(p);
  const result = validateObjectPackage(p);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some(i => i.code === code), JSON.stringify(result));
  assert.ok(result.issues.every(i => i.path.startsWith('/') && i.message));
});

test('parser rejects malformed and oversized responses before use', () => {
  for (const value of ['', '{', 'null', '[]', 'true']) assert.equal(parseObjectPackage(value).valid, false);
  assert.equal(parseObjectPackage(' '.repeat(LIMITS.packageBytes + 1)).issues[0].code, 'package_size');
  for (const value of [null, undefined, [], true, 1, new Date()]) assert.equal(validateObjectPackage(value).valid, false);
});

test('validation never executes code and does not claim malicious code is safe', () => {
  const p = createExampleObject();
  p.code.source = 'throw new Error("not executed");';
  assert.equal(validateObjectPackage(p).valid, true);
  assert.equal(EXECUTION_POLICY.isolationRequired, true);
  assert.equal(EXECUTION_POLICY.network, false);
  assert.equal(EXECUTION_POLICY.hostDOM, false);
  assert.ok(Object.isFrozen(EXECUTION_POLICY.capabilities));
});

test('protocol rejects stale, spoofed and malformed messages', () => {
  const expected = { requestId: 'req-1', executionId: 'exec-1', lastSequence: 3 };
  const message = { protocolVersion: '1.0.0', requestId: 'req-1', executionId: 'exec-1', sequence: 4, type: 'ready', diagnostic: 'Built object' };
  assert.equal(validateRuntimeMessage(message, expected).valid, true);
  for (const patch of [{ sequence: 3 }, { sequence: 2 }, { executionId: 'other' }, { requestId: 'other' }, { protocolVersion: '2' }, { type: 'fetch' }, { extra: true }]) assert.equal(validateRuntimeMessage({ ...message, ...patch }, expected).valid, false);
});

function setup(factoryOverride, options = {}) {
  const events = [], samples = [];
  const root = { isObject3D: true };
  const definition = createExampleObject();
  Object.assign(definition.animation, options);
  const stage = { attach: r => events.push(['attach', r]), detach: r => events.push(['detach', r]) };
  let capabilities;
  const factory = factoryOverride ?? (caps => { capabilities = caps; return { root, update: frame => samples.push(frame), dispose: () => events.push(['dispose']) }; });
  const run = createTrustedLifecycle({ definition, factory, THREE: {}, stage });
  return { run, definition, events, samples, root, get capabilities() { return capabilities; } };
}

test('trusted lifecycle exposes only object API and seeded random, not host stage', () => {
  const f = setup();
  assert.deepEqual(Object.keys(f.capabilities).sort(), ['THREE', 'random']);
  assert.ok(Object.isFrozen(f.capabilities));
  assert.equal(f.run.state, 'paused');
  assert.deepEqual(f.samples[0], { elapsedSeconds: 0, deltaSeconds: 0, tick: 0 });
  f.run.step(); assert.equal(f.run.tick, 0);
  f.run.play(); f.run.step(); assert.equal(f.run.tick, 1);
  f.run.pause(); f.run.step(); assert.equal(f.run.tick, 1);
  f.run.dispose(); f.run.dispose();
  assert.deepEqual(f.events.map(e => e[0]), ['attach', 'detach', 'dispose']);
  f.run.play(); f.run.step(); f.run.restart(); assert.equal(f.run.state, 'disposed');
});

test('restart resets timing and reconstructs; metadata is snapshotted', () => {
  const f = setup();
  f.definition.animation.durationSeconds = 0.1;
  f.run.play(); for (let i = 0; i < 10; i++) f.run.step();
  assert.equal(f.run.tick, 10);
  assert.equal(f.samples.at(-1).tick, 10);
  f.run.restart(); assert.equal(f.run.tick, 0); assert.equal(f.run.state, 'paused');
  assert.deepEqual(f.events.map(e => e[0]), ['attach', 'detach', 'dispose', 'attach']);
  f.run.dispose();
});

test('fixed-step non-looping motion stops; looping wraps at duration', () => {
  const a = setup(undefined, { durationSeconds: 0.1, loop: false });
  a.run.play(); for (let i = 0; i < 8; i++) a.run.step();
  assert.equal(a.run.state, 'paused'); assert.equal(a.run.tick, 6);
  const b = setup(undefined, { durationSeconds: 0.1, loop: true });
  b.run.play(); for (let i = 0; i < 6; i++) b.run.step();
  assert.equal(b.samples.at(-1).elapsedSeconds, 0);
  a.run.dispose(); b.run.dispose();
});

test('deterministic random sequence restarts with the same seed', () => {
  const a = seededRandom(42), b = seededRandom(42), c = seededRandom(43);
  const one = Array.from({ length: 10 }, a);
  assert.deepEqual(one, Array.from({ length: 10 }, b));
  assert.notDeepEqual(one, Array.from({ length: 10 }, c));
  assert.ok(one.every(x => x >= 0 && x < 1));
});

test('build failures and invalid factories are diagnosed without attaching', () => {
  for (const factory of [() => { throw Error('build failed'); }, () => null, () => ({ root: {} }), () => Promise.resolve({})]) {
    const f = setup(factory); assert.equal(f.run.state, 'failed'); assert.equal(f.events.length, 0);
    assert.equal(f.run.diagnostics[0].phase, 'build'); f.run.dispose();
  }
});

test('update failure disposes once and cannot keep animating', () => {
  let disposed = 0;
  const f = setup(() => ({ root: { isObject3D: true }, update: frame => { if (frame.tick) throw Error('bad frame'); }, dispose: () => disposed++ }));
  f.run.play(); f.run.step(); f.run.step(); f.run.dispose();
  assert.equal(disposed, 1); assert.equal(f.run.failure, 'update');
  const copy = f.run.diagnostics; copy.length = 0;
  assert.equal(f.run.diagnostics.length, 1);
});

test('async update is rejected and teardown errors remain inspectable', () => {
  const f = setup(() => ({ root: { isObject3D: true }, update: () => Promise.resolve(), dispose: () => { throw Error('dispose failed'); } }));
  assert.equal(f.run.state, 'failed');
  assert.deepEqual(f.run.diagnostics.map(d => d.phase), ['build', 'dispose']);
});

test('partial attach failure attempts detach and disposal', () => {
  const events = [];
  const run = createTrustedLifecycle({ definition: createExampleObject(), THREE: {}, factory: () => ({ root: { isObject3D: true }, update() {}, dispose() { events.push('dispose'); } }), stage: { attach() { throw Error('attach'); }, detach() { events.push('detach'); } } });
  assert.equal(run.state, 'failed'); assert.deepEqual(events, ['detach', 'dispose']);
});

test('rejected asynchronous hooks are observed and diagnosed', async () => {
  const a = setup(() => Promise.reject(Error('async factory')));
  const b = setup(() => ({ root: { isObject3D: true }, update: () => Promise.reject(Error('async update')), dispose: () => Promise.reject(Error('async dispose')) }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(a.run.state, 'failed'); assert.equal(b.run.state, 'failed');
  assert.deepEqual(b.run.diagnostics.map(d => d.phase), ['build', 'dispose']);
});

test('repeated failures keep diagnostic history bounded', () => {
  const f = setup(() => { throw Error('build failed'); });
  for (let i = 0; i < 120; i++) f.run.restart();
  assert.equal(f.run.diagnostics.length, 100);
});

test('invalid packages are rejected before the factory runs', () => {
  let invoked = false;
  const definition = createExampleObject(); definition.schemaVersion = 'bad';
  assert.throws(() => createTrustedLifecycle({ definition, factory: () => { invoked = true; }, stage: {}, THREE: {} }), /Invalid generated-object package/);
  assert.equal(invoked, false);
});

test('authored bouncing ball uses geometry, animates and releases its resources', () => {
  const resources = [];
  class Resource { constructor() { this.disposed = false; resources.push(this); } dispose() { this.disposed = true; } }
  class Group { isObject3D = true; children = []; add(x) { this.children.push(x); } clear() { this.children = []; } }
  class Mesh { position = { y: 0 }; constructor(geometry, material) { this.geometry = geometry; this.material = material; } }
  let root;
  const run = createTrustedLifecycle({ definition: createExampleObject(), factory: bouncingBallFactory, THREE: { Group, Mesh, SphereGeometry: Resource, MeshStandardMaterial: Resource }, stage: { attach(r) { root = r; }, detach() {} } });
  assert.equal(root.children[0].position.y, 0.5);
  run.play(); for (let i = 0; i < 30; i++) run.step();
  assert.equal(root.children[0].position.y, 2);
  run.dispose(); assert.ok(resources.every(r => r.disposed)); assert.equal(root.children.length, 0);
});
