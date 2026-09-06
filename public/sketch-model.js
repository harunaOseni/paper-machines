/** Drawing-only state. Coordinates are logical units, independent of display size. */
export const SKETCH_SIZE = 800;
export const HISTORY_LIMIT = 50;
export const MAX_POINTS = 100000;

export function canvasPoint(clientX, clientY, rect, clamp = false) {
  const scale = Math.min(rect.width, rect.height) / SKETCH_SIZE;
  if (!(scale > 0)) return null;
  const x = (clientX - rect.left - (rect.width - SKETCH_SIZE * scale) / 2) / scale;
  const y = (clientY - rect.top - (rect.height - SKETCH_SIZE * scale) / 2) / scale;
  if (!clamp && (x < 0 || y < 0 || x > SKETCH_SIZE || y > SKETCH_SIZE)) return null;
  return { x: Math.max(0, Math.min(SKETCH_SIZE, x)), y: Math.max(0, Math.min(SKETCH_SIZE, y)) };
}

export class SketchModel {
  constructor() {
    this.sketchId = "sketch-" + crypto.randomUUID();
    this.revision = 0;
    this.state = { sample: false, strokes: [] };
    this.past = [];
    this.future = [];
    this.active = null;
  }
  get canUndo() { return this.past.length > 0 && !this.active; }
  get canRedo() { return this.future.length > 0 && !this.active; }
  get hasContent() { return this.state.sample || this.state.strokes.length > 0; }
  commit(next) {
    // Completed strokes are immutable; snapshots share stroke data to bound memory.
    this.past.push(this.state);
    if (this.past.length > HISTORY_LIMIT) this.past.shift();
    this.state = next;
    this.revision++;
    this.future = [];
  }
  begin(pointerId, point, { color, eraser }) {
    if (this.active || !point) return false;
    const count = this.state.strokes.reduce((sum, s) => sum + s.points.length, 0);
    if (count >= MAX_POINTS) return false;
    this.active = { pointerId, color, eraser, width: eraser ? 32 : 5, points: [point], remaining: MAX_POINTS - count - 1 };
    return true;
  }
  move(pointerId, point) {
    const stroke = this.active;
    if (!stroke || stroke.pointerId !== pointerId || !point || stroke.remaining <= 0) return;
    const last = stroke.points.at(-1);
    if (Math.hypot(point.x - last.x, point.y - last.y) < 0.5) return;
    stroke.points.push(point);
    stroke.remaining--;
  }
  end(pointerId, cancelled = false) {
    if (!this.active || this.active.pointerId !== pointerId) return false;
    const { pointerId: ignored, remaining, ...stroke } = this.active;
    this.active = null;
    if (!cancelled) this.commit({ ...this.state, strokes: [...this.state.strokes, stroke] });
    return true;
  }
  undo() {
    if (!this.canUndo) return false;
    this.future.push(this.state);
    this.state = this.past.pop();
    this.revision++;
    return true;
  }
  redo() {
    if (!this.canRedo) return false;
    this.past.push(this.state);
    this.state = this.future.pop();
    this.revision++;
    return true;
  }
  clear() {
    if (this.active || !this.hasContent) return false;
    this.commit({ sample: false, strokes: [] });
    return true;
  }
  loadSample() {
    if (this.active) return false;
    this.commit({ sample: true, strokes: [] });
    return true;
  }
}
