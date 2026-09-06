import { LIMITS } from '../paper-machines/object-contract.mjs';

// Limits on trusted rendering work, not a browser/process heap quota.
export const RUNTIME_LIMITS = Object.freeze({
  startupMs: 5000,
  frameMs: 1000,
  cleanupMs: 250,
  framesPerSecond: 30,
  nodes: 128,
  depth: 32,
  vertices: LIMITS.maxVertices,
  indices: 600000,
  materials: 128,
  drawCalls: LIMITS.maxDrawCalls,
  geometryBytes: 8 * 1024 * 1024,
});
