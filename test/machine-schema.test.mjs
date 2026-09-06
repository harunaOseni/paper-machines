import test from "node:test";
import assert from "node:assert/strict";
import { validateMachine, assertValidMachine, machineSchema, imagePointToWorld } from "../src/paper-machines/machine-schema.mjs";
import { createExampleMachine } from "./fixtures/example-machine.mjs";

test("authored launch example validates, round-trips through JSON and stays unchanged", () => {
  const machine = createExampleMachine();
  const before = JSON.stringify(machine);
  assert.deepEqual(validateMachine(machine), { valid: true, errors: [] });
  assert.equal(assertValidMachine(machine), machine);
  assert.deepEqual(validateMachine(JSON.parse(before)), { valid: true, errors: [] });
  assert.equal(JSON.stringify(machine), before);
  assert.deepEqual(JSON.parse(JSON.stringify(machineSchema)), machineSchema);
});

const invalid = [
  ["unsupported schema version", m => { m.schemaVersion = "2.0.0"; }, "const"],
  ["missing field", m => { delete m.source; }, "required"],
  ["unknown field", m => { m.success = true; }, "unknown_field"],
  ["prototype-named field", m => { m.parts[0].constructor = "bad"; }, "unknown_field"],
  ["unsupported part", m => { m.parts[0].kind = "motor"; }, "unsupported_part"],
  ["negative radius", m => { m.parts[0].radius = -1; }, "range"],
  ["zero dimension", m => { m.parts[1].width = 0; }, "range"],
  ["NaN", m => { m.parts[0].position.x = NaN; }, "finite"],
  ["infinity", m => { m.world.gravity.y = Infinity; }, "finite"],
  ["unbounded friction", m => { m.parts[0].material.friction = 2; }, "range"],
  ["duplicate part ID", m => { m.parts[1].id = m.parts[0].id; }, "duplicate_id"],
  ["duplicate ID across collections", m => { m.goals[0].id = m.parts[0].id; }, "duplicate_id"],
  ["missing lever pivot", m => { m.joints = []; }, "pivot_count"],
  ["multiple lever pivots", m => { m.joints.push({ ...m.joints[0], id: "second-pivot" }); }, "pivot_count"],
  ["dangling pivot", m => { m.joints[0].bodyId = "missing"; }, "pivot_reference"],
  ["pivot on static ramp", m => { m.joints[0].bodyId = "launch-ramp"; }, "pivot_reference"],
  ["pivot outside lever", m => { m.joints[0].anchor.x = 8; }, "pivot_geometry"],
  ["missing goal body", m => { m.goals[0].bodyId = "missing"; }, "goal_reference"],
  ["non-bucket goal destination", m => { m.goals[0].bucketId = "floor"; }, "goal_reference"],
  ["solid bucket", m => { m.parts[4].wallThickness = 0.6; }, "bucket_geometry"],
  ["out-of-image region", m => { m.parts[0].sourceRegion.x = 800; }, "image_bounds"],
  ["out-of-image origin", m => { m.source.originPx.y = 501; }, "image_bounds"],
  ["missing material assumption", m => { m.assumptions.pop(); }, "missing_assumption"],
  ["duplicate assumption", m => { m.assumptions.push({ ...m.assumptions[0] }); }, "duplicate_assumption"],
  ["dangling assumption pointer", m => { m.assumptions[0].path = "/parts/100/material/massKg"; }, "assumption_reference"],
  ["unresolved interpretation", m => { m.interpretation.status = "unresolved"; }, "unresolved_interpretation"],
  ["ready with unresolved marks", m => { m.interpretation.unresolved.push({ code: "unknown-mark", message: "Could be a gear.", sourceRegion: m.parts[0].sourceRegion }); }, "unresolved_interpretation"],
  ["empty parts", m => { m.parts = []; }, "size"],
  ["too many parts", m => { m.parts = Array(101).fill(m.parts[0]); }, "size"],
  ["sparse part array", m => { delete m.parts[0]; }, "unsupported_part"],
  ["no goal", m => { m.goals = []; }, "size"],
];
for (const [name, mutate, expectedCode] of invalid) {
  test(`rejects ${name} with actionable paths`, () => {
    const machine = createExampleMachine();
    mutate(machine);
    const result = validateMachine(machine);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.code === expectedCode), JSON.stringify(result.errors));
    assert.ok(result.errors.every(e => e.path.startsWith("/") && e.message));
    assert.throws(() => assertValidMachine(machine), e => e.issues.some(issue => issue.code === expectedCode));
  });
}

test("handles malformed top-level and nested input without crashing", () => {
  for (const value of [null, undefined, false, "machine", [], 42, new Date()]) assert.equal(validateMachine(value).valid, false);
  for (const value of [null, false, [], "part"]) {
    const machine = createExampleMachine();
    machine.parts[0] = value;
    assert.equal(validateMachine(machine).valid, false);
  }
});

test("rotated lever pivot uses local geometry", () => {
  const machine = createExampleMachine();
  machine.parts[2].angleRad = Math.PI / 2;
  machine.joints[0].anchor = { x: 3, y: 4 };
  assert.equal(validateMachine(machine).valid, true);
  machine.joints[0].anchor = { x: 4, y: 3 };
  assert.equal(validateMachine(machine).valid, false);
});

test("valid alternative geometry is accepted without guessing success or redesigning it", () => {
  const machine = createExampleMachine();
  machine.parts[1].angleRad = -0.3;
  machine.parts[4].position.x = 7;
  const before = structuredClone(machine);
  assert.equal(validateMachine(machine).valid, true);
  assert.deepEqual(machine, before);
  assert.equal("success" in machine, false);
});

test("image coordinates map to meters with an explicit origin and downward y-axis", () => {
  assert.deepEqual(imagePointToWorld({ x: 250, y: 120 }, { originPx: { x: 50, y: 20 }, metersPerPixel: 0.01 }), { x: 2, y: 1 });
});
