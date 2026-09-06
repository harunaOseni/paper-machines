import { OBJECT_VERSION, RUNTIME_VERSION } from '../../src/paper-machines/object-contract.mjs';

// Trusted, authored example. Not an image-recognition result or a security test.
export function bouncingBallFactory({ THREE }) {
  const root = new THREE.Group();
  const geometry = new THREE.SphereGeometry(0.5, 24, 16);
  const material = new THREE.MeshStandardMaterial({ color: '#e66b36', roughness: 0.7 });
  const ball = new THREE.Mesh(geometry, material);
  root.add(ball);
  return {
    root,
    update({ elapsedSeconds }) { ball.position.y = 0.5 + Math.abs(Math.sin(Math.PI * elapsedSeconds)) * 1.5; },
    dispose() { geometry.dispose(); material.dispose(); root.clear(); },
  };
}

export function createExampleObject() {
  const functionText = bouncingBallFactory.toString();
  return {
    schemaVersion: OBJECT_VERSION, runtimeVersion: RUNTIME_VERSION,
    creationId: 'orange-ball', revision: 1, requestId: 'example-request',
    source: { imageId: 'authored-ball-fixture', sha256: '0'.repeat(64), widthPx: 512, heightPx: 512 },
    subject: { summary: 'An orange hand-drawn ball', preservedFeatures: ['orange color', 'round silhouette'] },
    assumptions: [{ kind: 'depth', explanation: 'Interpret the drawn circle as a sphere.' }, { kind: 'motion', explanation: 'A playful bounce animation, not physical simulation.' }],
    bounds: { min: { x: -0.5, y: 0, z: -0.5 }, max: { x: 0.5, y: 2.5, z: 0.5 } },
    presentation: { floor: true },
    animation: { kind: 'animated', description: 'Bounce in place', durationSeconds: 2, loop: true, seed: 42 },
    // The executor supplies `THREE` and `random` parameters. The body is DATA here.
    code: { format: 'factory-body-v1', source: functionText.slice(functionText.indexOf(') {') + 3, functionText.lastIndexOf('}')).trim() },
  };
}
