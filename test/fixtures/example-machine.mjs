import { MACHINE_VERSION } from "../../src/paper-machines/machine-schema.mjs";

/** Authored contract fixture, NOT an AI interpretation or verified physics run. */
export function createExampleMachine() {
  const makePart = (id, kind, x, y, geometry, massKg = 1) => ({
    id, kind, position: { x, y }, angleRad: 0,
    sourceRegion: { x: Math.max(0, x * 100 - 40), y: Math.max(0, y * 100 - 20), width: 80, height: 40 },
    material: { massKg, friction: 0.3, restitution: 0.15 }, ...geometry,
  });
  const parts = [
    makePart("drive-weight", "weight", 1, 1, { radius: 0.2 }, 4),
    makePart("launch-ramp", "ramp", 1.5, 1.8, { width: 1.8, height: 0.12, angleRad: 0.5 }),
    makePart("launch-lever", "lever", 3, 3, { width: 2.4, height: 0.12 }),
    makePart("projectile", "ball", 3.9, 2.7, { radius: 0.15 }, 0.3),
    makePart("catch-bucket", "bucket", 6.5, 3, { width: 1, height: 1.2, wallThickness: 0.08 }),
    makePart("floor", "platform", 4, 4.5, { width: 8, height: 0.2 }),
  ];
  return {
    schemaVersion: MACHINE_VERSION, id: "lever-launch-example", revision: 1,
    source: { imageId: "authored-example-image", widthPx: 800, heightPx: 500, originPx: { x: 0, y: 0 }, metersPerPixel: 0.01 },
    world: { units: "m-kg-s", yAxis: "down", gravity: { x: 0, y: 9.81 }, stepSeconds: 1 / 120, maxRunSeconds: 15 },
    parts,
    joints: [{ id: "lever-pivot", kind: "pivot", bodyId: "launch-lever", anchor: { x: 3, y: 3 } }],
    goals: [{ id: "catch-ball", kind: "capture", bodyId: "projectile", bucketId: "catch-bucket", dwellSeconds: 0.5 }],
    assumptions: [
      { path: "/source/metersPerPixel", basis: "default", reason: "Example scale; a sketch does not establish real-world size." },
      { path: "/world/gravity/y", basis: "default", reason: "Earth-like downward gravity." },
      ...parts.flatMap((_, index) => ["massKg", "friction", "restitution"].map((key) => ({
        path: `/parts/${index}/material/${key}`, basis: "default", reason: "Illustrative material value, not measured from the drawing.",
      }))),
    ],
    interpretation: { status: "ready", unresolved: [] },
  };
}
