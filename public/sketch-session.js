/** Owns a single revision-bound capture and generation handoff. No network calls. */
export class SketchSession {
  constructor() { this.capture = null; this.snapshot = null; this.request = null; }
  invalidate() {
    this.request?.controller.abort();
    this.capture = this.snapshot = this.request = null;
  }
  begin(sketchId, revision) {
    this.invalidate();
    return this.capture = Object.freeze({ sketchId, revision });
  }
  isCurrent(token, sketchId, revision) {
    return this.capture === token && token.sketchId === sketchId && token.revision === revision;
  }
  complete(token, snapshot, sketchId, revision) {
    if (!this.isCurrent(token, sketchId, revision)) return false;
    if (snapshot.creationId !== token.sketchId || snapshot.revision !== token.revision) return false;
    this.snapshot = snapshot;
    return true;
  }
  startRequest() {
    if (!this.snapshot) return null;
    this.request?.controller.abort();
    const controller = new AbortController();
    this.request = { controller, envelope: Object.freeze({
      requestId: 'request-' + crypto.randomUUID(),
      creationId: this.snapshot.creationId, revision: this.snapshot.revision,
      source: this.snapshot.source, blob: this.snapshot.blob,
    }) };
    return { ...this.request.envelope, signal: controller.signal };
  }
  accepts(result) {
    const request = this.request?.envelope;
    return !!request && !this.request.controller.signal.aborted &&
      result.requestId === request.requestId && result.creationId === request.creationId &&
      result.revision === request.revision && result.source?.imageId === request.source.imageId &&
      result.source?.sha256 === request.source.sha256;
  }
}
