/** Contract test adapter for TRUSTED factories only. Never eval model code here.
 * Production may instantiate this adapter only inside the M3 isolated executor.
 * Synchronous runaway factories cannot be stopped by this module.
 */
import { validateObjectPackage } from './object-contract.mjs';

export const FIXED_STEP_SECONDS = 1 / 60;
export function seededRandom(seed) {
  let state = seed >>> 0;
  return () => { state = (Math.imul(1664525, state) + 1013904223) >>> 0; return state / 4294967296; };
}

export function createTrustedLifecycle({ definition, factory, THREE, stage }) {
  const checked = validateObjectPackage(definition);
  if (!checked.valid) throw Object.assign(new Error('Invalid generated-object package'), { issues: checked.issues });
  if (typeof factory !== 'function' || !stage || typeof stage.attach !== 'function' || typeof stage.detach !== 'function') throw new TypeError('Trusted factory and stage attach/detach hooks required.');
  // Snapshot metadata so outside edits cannot change an active execution.
  const config = structuredClone(definition);
  let instance, state = 'new', attached = false, tick = 0, failure = null;
  const diagnostics = [];
  const report = (phase, error) => { diagnostics.push({ phase, code: 'lifecycle_error', message: String(error?.message ?? error).slice(0, 1000) }); if (diagnostics.length > 100) diagnostics.shift(); };
  function requireSync(result, hook) {
    if (result && typeof result.then === 'function') {
      // Observe rejected promises even though asynchronous hooks are invalid.
      Promise.resolve(result).catch(() => {});
      throw new TypeError(`${hook} must be synchronous.`);
    }
  }
  function cleanup() {
    if (attached) { attached = false; try { stage.detach(instance.root); } catch (error) { report('detach', error); } }
    const previous = instance; instance = undefined;
    if (typeof previous?.dispose === 'function') try { requireSync(previous.dispose(), 'dispose'); } catch (error) { report('dispose', error); }
  }
  function fail(phase, error) { failure = phase; report(phase, error); cleanup(); state = 'failed'; }
  function build() {
    try {
      instance = factory(Object.freeze({ THREE, random: seededRandom(config.animation.seed) }));
      requireSync(instance, 'factory');
      if (!instance || !instance.root?.isObject3D || typeof instance.update !== 'function' || typeof instance.dispose !== 'function') throw new TypeError('Factory must synchronously return { root: Object3D, update, dispose }.');
      const initial = instance.update(Object.freeze({ elapsedSeconds: 0, deltaSeconds: 0, tick: 0 }));
      requireSync(initial, 'update');
      // Treat attach as potentially partially successful so failure still detaches.
      attached = true; stage.attach(instance.root); state = 'paused';
    } catch (error) { fail('build', error); }
  }
  build();
  return Object.freeze({
    get state() { return state; },
    get tick() { return tick; },
    get diagnostics() { return structuredClone(diagnostics); },
    get failure() { return failure; },
    play() { if (state === 'paused') state = 'playing'; },
    pause() { if (state === 'playing') state = 'paused'; },
    step() {
      if (state !== 'playing') return;
      const durationTicks = Math.max(1, Math.round(config.animation.durationSeconds / FIXED_STEP_SECONDS));
      tick++;
      const sampleTick = config.animation.loop ? tick % durationTicks : Math.min(tick, durationTicks);
      try {
        const result = instance.update(Object.freeze({ elapsedSeconds: sampleTick * FIXED_STEP_SECONDS, deltaSeconds: FIXED_STEP_SECONDS, tick: sampleTick }));
        requireSync(result, 'update');
        if (!config.animation.loop && tick >= durationTicks) state = 'paused';
      } catch (error) { fail('update', error); }
    },
    restart() { if (state === 'disposed') return; cleanup(); tick = 0; failure = null; build(); },
    dispose() { if (state === 'disposed') return; cleanup(); state = 'disposed'; },
  });
}
