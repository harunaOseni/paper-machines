/** Sketch to Life package contract. Validation NEVER executes source or proves it safe. */
export const OBJECT_VERSION = '1.0.0';
export const RUNTIME_VERSION = '1.0.0';
export const OBJECT_API_KEYS = Object.freeze([
  'Group', 'Mesh', 'BoxGeometry', 'SphereGeometry', 'CylinderGeometry',
  'ConeGeometry', 'TorusGeometry', 'PlaneGeometry', 'BufferGeometry',
  'Float32BufferAttribute', 'MeshStandardMaterial', 'MeshBasicMaterial',
  'Vector3', 'Euler', 'Quaternion', 'Color',
]);
export const LIMITS = Object.freeze({ packageBytes: 131072, sourceBytes: 65536, maxDurationSeconds: 60, maxVertices: 100000, maxDrawCalls: 128, maxTextureBytes: 16777216 });
export const EXECUTION_POLICY = Object.freeze({
  isolationRequired: true, hostDOM: false, credentials: false, storage: false,
  network: false, imports: false, navigation: false, downloads: false,
  generatedTimers: false, hostSceneAccess: false,
  capabilities: Object.freeze(['THREE_OBJECT_API_V1', 'SEEDED_RANDOM_V1']),
});

const text = (maxLength = 500) => ({ type: 'string', minLength: 1, maxLength });
const id = { ...text(64), pattern: '^[A-Za-z][A-Za-z0-9_-]*$' };
const num = (minimum, maximum) => ({ type: 'number', minimum, maximum });
const obj = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const vec = obj({ x: num(-1000, 1000), y: num(-1000, 1000), z: num(-1000, 1000) });
export const objectPackageSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', title: 'Sketch to Life generated object',
  ...obj({
    schemaVersion: { const: OBJECT_VERSION }, runtimeVersion: { const: RUNTIME_VERSION },
    creationId: id, revision: { type: 'integer', minimum: 1, maximum: 1000000 }, requestId: id,
    source: obj({ imageId: id, sha256: { ...text(64), pattern: '^[a-f0-9]{64}$' }, widthPx: { type: 'integer', minimum: 1, maximum: 20000 }, heightPx: { type: 'integer', minimum: 1, maximum: 20000 } }),
    subject: obj({ summary: text(), preservedFeatures: { type: 'array', minItems: 1, maxItems: 20, items: text() } }),
    assumptions: { type: 'array', minItems: 1, maxItems: 20, items: obj({ kind: { enum: ['depth', 'scale', 'appearance', 'motion'] }, explanation: text() }) },
    bounds: obj({ min: vec, max: vec }),
    presentation: obj({ floor: { type: 'boolean' } }),
    animation: obj({ kind: { enum: ['animated', 'static'] }, description: text(), durationSeconds: num(0.1, LIMITS.maxDurationSeconds), loop: { type: 'boolean' }, seed: { type: 'integer', minimum: 0, maximum: 4294967295 } }),
    code: obj({ format: { const: 'factory-body-v1' }, source: text(LIMITS.sourceBytes) }),
  }),
};

// Implements only the schema vocabulary above; not a general JSON Schema engine.
function check(value, schema, path, issues) {
  const fail = (code, message) => issues.push({ path: path || '/', code, message });
  if ('const' in schema && value !== schema.const) return fail('version_or_constant', `Expected ${JSON.stringify(schema.const)}.`);
  if (schema.enum && !schema.enum.includes(value)) return fail('unsupported_value', 'Value is not supported by this contract.');
  if (!schema.type) return;
  const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  if (schema.type === 'integer' ? !Number.isInteger(value) : schema.type !== type) return fail('type', `Expected ${schema.type}.`);
  if (['number', 'integer'].includes(schema.type) && (!Number.isFinite(value) || value < schema.minimum || value > schema.maximum)) fail('range', 'Expected a finite number inside the supported range.');
  if (schema.type === 'string' && (!value.trim() || value.length < schema.minLength || value.length > schema.maxLength || (schema.pattern && !new RegExp(schema.pattern).test(value)))) fail('format', 'String is empty, too long, or malformed.');
  if (schema.type === 'array') {
    if (value.length < schema.minItems || value.length > schema.maxItems) return fail('size', 'Array exceeds contract limits.');
    Array.from(value).forEach((item, i) => check(item, schema.items, `${path}/${i}`, issues));
  }
  if (schema.type === 'object') {
    if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) return fail('json_object', 'Expected a plain JSON object.');
    for (const key of Object.keys(value)) if (!Object.hasOwn(schema.properties, key)) issues.push({ path: `${path}/${key}`, code: 'unknown_field', message: 'Unexpected field.' });
    for (const key of schema.required) {
      if (!Object.hasOwn(value, key)) issues.push({ path: `${path}/${key}`, code: 'required', message: 'Required field missing.' });
      else check(value[key], schema.properties[key], `${path}/${key}`, issues);
    }
  }
}

export function validateObjectPackage(value) {
  const issues = [];
  check(value, objectPackageSchema, '', issues);
  if (!issues.length) {
    for (const axis of ['x', 'y', 'z']) if (value.bounds.min[axis] >= value.bounds.max[axis]) issues.push({ path: `/bounds/${axis}`, code: 'bounds', message: 'Bounds must have positive extent on every axis.' });
    if (!value.assumptions.some(a => a.kind === 'depth')) issues.push({ path: '/assumptions', code: 'depth_assumption', message: 'Explain depth inferred from the single drawing.' });
    if (new TextEncoder().encode(value.code.source).length > LIMITS.sourceBytes) issues.push({ path: '/code/source', code: 'source_size', message: 'Source exceeds UTF-8 byte budget.' });
    if (new TextEncoder().encode(JSON.stringify(value)).length > LIMITS.packageBytes) issues.push({ path: '/', code: 'package_size', message: 'Package exceeds UTF-8 byte budget.' });
  }
  return { valid: issues.length === 0, issues };
}

/** Entry point for serialized model output: enforce byte budget before parsing. */
export function parseObjectPackage(json) {
  if (typeof json !== 'string' || new TextEncoder().encode(json).length > LIMITS.packageBytes) return { valid: false, issues: [{ path: '/', code: 'package_size', message: 'Expected bounded JSON text.' }] };
  let value;
  try { value = JSON.parse(json); } catch { return { valid: false, issues: [{ path: '/', code: 'invalid_json', message: 'Response is not valid JSON.' }] }; }
  const result = validateObjectPackage(value);
  return result.valid ? { ...result, value } : result;
}

/** Pure protocol gate; the real transport must also check origin AND sender identity. */
export function validateRuntimeMessage(message, expected) {
  const issues = [];
  check(message, obj({ protocolVersion: { const: RUNTIME_VERSION }, requestId: id, executionId: id, sequence: { type: 'integer', minimum: 0, maximum: 1000000000 }, type: { enum: ['ready', 'frame', 'error', 'disposed'] }, diagnostic: text(1000) }), '', issues);
  if (!issues.length && (message.requestId !== expected.requestId || message.executionId !== expected.executionId || message.sequence <= expected.lastSequence)) issues.push({ path: '/', code: 'stale_message', message: 'Wrong execution or non-increasing sequence.' });
  return { valid: !issues.length, issues };
}
