// Versioned, JSON-serializable contract shared by recognition, editing and physics.
export const MACHINE_VERSION = "1.0.0";
const number = (minimum = -10000, maximum = 10000) => ({ type: "number", minimum, maximum });
const positive = { type: "number", exclusiveMinimum: 0, maximum: 10000 };
const string = { type: "string", minLength: 1, maxLength: 500 };
const id = { type: "string", pattern: "^[a-zA-Z][a-zA-Z0-9_-]{0,63}$" };
const object = (properties) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const array = (items, minItems = 0, maxItems = 100) => ({ type: "array", items, minItems, maxItems });
const point = object({ x: number(), y: number() });
const region = object({ x: number(0, 20000), y: number(0, 20000), width: positive, height: positive });
const material = object({ massKg: positive, friction: number(0, 1), restitution: number(0, 1) });
const base = {
  id, position: point, angleRad: number(-Math.PI, Math.PI),
  sourceRegion: region, material,
};
const circle = (kind) => object({ ...base, kind: { const: kind }, radius: positive });
const rectangle = (kind) => object({ ...base, kind: { const: kind }, width: positive, height: positive });

export const machineSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Paper Machines v1",
  ...object({
    schemaVersion: { const: MACHINE_VERSION },
    id,
    revision: { type: "integer", minimum: 1, maximum: 1000000 },
    source: object({
      imageId: id,
      widthPx: { type: "integer", minimum: 1, maximum: 20000 },
      heightPx: { type: "integer", minimum: 1, maximum: 20000 },
      // Coordinates refer to the confirmed, orientation-normalized input image.
      originPx: object({ x: number(0, 20000), y: number(0, 20000) }),
      metersPerPixel: { type: "number", exclusiveMinimum: 0, maximum: 100 },
    }),
    world: object({
      units: { const: "m-kg-s" },
      yAxis: { const: "down" },
      gravity: object({ x: { const: 0 }, y: number(0, 100) }),
      stepSeconds: number(1 / 1000, 1 / 30),
      maxRunSeconds: number(1, 120),
    }),
    parts: array({ oneOf: [
      circle("ball"), circle("weight"), rectangle("ramp"),
      rectangle("platform"), rectangle("lever"),
      object({ ...base, kind: { const: "bucket" }, width: positive, height: positive, wallThickness: positive }),
    ] }, 1),
    joints: array(object({ id, kind: { const: "pivot" }, bodyId: id, anchor: point })),
    goals: array(object({ id, kind: { const: "capture" }, bodyId: id, bucketId: id, dwellSeconds: number(0, 30) }), 1),
    assumptions: array(object({
      path: { type: "string", pattern: "^/", maxLength: 500 },
      reason: string,
      basis: { enum: ["default", "inferred", "user-defined"] },
    }), 1, 1000),
    interpretation: object({
      status: { enum: ["ready", "unresolved"] },
      unresolved: array(object({ code: id, message: string, sourceRegion: region })),
    }),
  }),
};

// This validator implements only the keywords used by machineSchema above.
// It is not a general-purpose JSON Schema validator. Consumers may also use a
// draft-2020-12 validator, but must retain the semantic checks below.
function shapeErrors(value, schema, path = "") {
  const error = (code, message) => [{ path: path || "/", code, message }];
  if (schema.oneOf) {
    const matches = schema.oneOf.filter((choice) => shapeErrors(value, choice, path).length === 0);
    if (matches.length === 1) return [];
    const known = schema.oneOf.find((choice) => choice.properties.kind.const === value?.kind);
    return known ? shapeErrors(value, known, path) : error("unsupported_part", "Use a supported v1 part type.");
  }
  if ("const" in schema && value !== schema.const) return error("const", `Expected ${JSON.stringify(schema.const)}.`);
  if (schema.enum && !schema.enum.includes(value)) return error("enum", `Expected one of: ${schema.enum.join(", ")}.`);
  if (!schema.type) return [];
  const actual = Array.isArray(value) ? "array" : value === null ? "null" : typeof value;
  if (schema.type === "integer" ? !Number.isInteger(value) : actual !== schema.type) return error("type", `Expected ${schema.type}.`);
  if (schema.type === "number" || schema.type === "integer") {
    if (!Number.isFinite(value)) return error("finite", "Number must be finite.");
    if (value < schema.minimum || value > schema.maximum || value <= schema.exclusiveMinimum) return error("range", "Number is outside the supported range.");
  }
  if (schema.type === "string") {
    if (value.length < schema.minLength || value.length > schema.maxLength || (schema.pattern && !new RegExp(schema.pattern).test(value))) return error("format", "String does not match the contract.");
  }
  if (schema.type === "array") {
    if (value.length < schema.minItems || value.length > schema.maxItems) return error("size", "Array length is outside the supported range.");
    return Array.from(value).flatMap((item, index) => shapeErrors(item, schema.items, `${path}/${index}`));
  }
  if (schema.type === "object") {
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return error("type", "Expected a plain JSON object.");
    const errors = [];
    for (const key of Object.keys(value)) if (!Object.hasOwn(schema.properties, key)) errors.push({ path: `${path}/${key}`, code: "unknown_field", message: "Field is not part of the v1 contract." });
    for (const key of schema.required) {
      if (!Object.hasOwn(value, key)) errors.push({ path: `${path}/${key}`, code: "required", message: "Required field is missing." });
      else errors.push(...shapeErrors(value[key], schema.properties[key], `${path}/${key}`));
    }
    return errors;
  }
  return [];
}

function resolvePointer(value, path) {
  let current = value;
  for (const key of path.slice(1).split("/")) {
    if (!current || typeof current !== "object" || !Object.hasOwn(current, key)) return undefined;
    current = current[key];
  }
  return current;
}

/** Non-mutating. A valid result authorizes compilation, not a success prediction. */
export function validateMachine(machine) {
  const errors = shapeErrors(machine, machineSchema);
  if (errors.length) return { valid: false, errors };
  const add = (path, code, message) => errors.push({ path, code, message });
  const seen = new Set();
  for (const collection of ["parts", "joints", "goals"]) {
    machine[collection].forEach((item, index) => {
      if (seen.has(item.id)) add(`/${collection}/${index}/id`, "duplicate_id", "IDs must be unique across parts, joints and goals.");
      seen.add(item.id);
    });
  }
  const parts = new Map(machine.parts.map((part) => [part.id, part]));
  const checkRegion = (region, path) => {
    if (region.x + region.width > machine.source.widthPx || region.y + region.height > machine.source.heightPx) add(path, "image_bounds", "Source region extends outside the input image.");
  };
  if (machine.source.originPx.x > machine.source.widthPx || machine.source.originPx.y > machine.source.heightPx) add("/source/originPx", "image_bounds", "Origin must be inside the input image.");
  machine.parts.forEach((part, index) => {
    const path = `/parts/${index}`;
    checkRegion(part.sourceRegion, `${path}/sourceRegion`);
    if (part.kind === "bucket" && (part.wallThickness * 2 >= part.width || part.wallThickness >= part.height)) add(path, "bucket_geometry", "Bucket requires an open interior and a bottom wall.");
    if (part.kind === "lever" && machine.joints.filter((joint) => joint.bodyId === part.id).length !== 1) add(path, "pivot_count", "A lever requires exactly one fixed-world pivot.");
  });
  machine.joints.forEach((joint, index) => {
    const part = parts.get(joint.bodyId);
    if (!part || part.kind !== "lever") return add(`/joints/${index}/bodyId`, "pivot_reference", "Pivot must reference an existing lever.");
    const dx = joint.anchor.x - part.position.x, dy = joint.anchor.y - part.position.y;
    const c = Math.cos(part.angleRad), s = Math.sin(part.angleRad);
    if (Math.abs(c * dx + s * dy) > part.width / 2 + 1e-9 || Math.abs(-s * dx + c * dy) > part.height / 2 + 1e-9) add(`/joints/${index}/anchor`, "pivot_geometry", "Pivot must lie on its lever.");
  });
  machine.goals.forEach((goal, index) => {
    if (!["ball", "weight"].includes(parts.get(goal.bodyId)?.kind)) add(`/goals/${index}/bodyId`, "goal_reference", "Capture body must reference an existing ball or weight.");
    if (parts.get(goal.bucketId)?.kind !== "bucket") add(`/goals/${index}/bucketId`, "goal_reference", "Capture destination must reference an existing bucket.");
  });
  const assumptionPaths = new Set();
  machine.assumptions.forEach((assumption, index) => {
    if (assumptionPaths.has(assumption.path)) add(`/assumptions/${index}/path`, "duplicate_assumption", "Use one assumption record per value.");
    assumptionPaths.add(assumption.path);
    const value = resolvePointer(machine, assumption.path);
    if (typeof value !== "number" || !Number.isFinite(value)) add(`/assumptions/${index}/path`, "assumption_reference", "Assumption must reference a numeric machine value.");
  });
  const requiredAssumptions = ["/source/metersPerPixel", "/world/gravity/y"];
  machine.parts.forEach((_, index) => ["massKg", "friction", "restitution"].forEach((key) => requiredAssumptions.push(`/parts/${index}/material/${key}`)));
  for (const path of requiredAssumptions) if (!assumptionPaths.has(path)) add("/assumptions", "missing_assumption", `Declare the basis for ${path}; images cannot establish this physical value.`);
  machine.interpretation.unresolved.forEach((issue, index) => checkRegion(issue.sourceRegion, `/interpretation/unresolved/${index}/sourceRegion`));
  if (machine.interpretation.status !== "ready" || machine.interpretation.unresolved.length) add("/interpretation", "unresolved_interpretation", "Automatic interpretation must resolve uncertainties or report unsupported input before simulation.");
  return { valid: errors.length === 0, errors };
}

export function assertValidMachine(machine) {
  const result = validateMachine(machine);
  if (!result.valid) {
    const error = new Error("Invalid Paper Machines description");
    error.issues = result.errors;
    throw error;
  }
  return machine;
}

export function imagePointToWorld(point, source) {
  return { x: (point.x - source.originPx.x) * source.metersPerPixel, y: (point.y - source.originPx.y) * source.metersPerPixel };
}
