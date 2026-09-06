import { validateRuntimeMessage } from '../paper-machines/object-contract.mjs';

export function acceptsRuntimeEvent(event, frameWindow, expected) {
  return event.source === frameWindow && event.origin === 'null' &&
    validateRuntimeMessage(event.data, expected).valid;
}

export function acceptsCommand(message, expected, lastSequence) {
  if (!message || message.executionId !== expected.executionId || message.requestId !== expected.requestId ||
    !Number.isSafeInteger(message.sequence) || message.sequence <= lastSequence || message.sequence > 1000000000) return false;
  return ['tick','dispose'].includes(message.type) && Object.keys(message).length === 4;
}
