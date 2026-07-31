/**
 * Two-way session sync (child working copy ↔ parent persisted props).
 *
 * Without an echo guard, this pattern oscillates forever after a local update:
 *   1. Child sets local=M while parent prop is still A
 *   2. Sync-down effect writes A back into local
 *   3. Push-up effect writes M into parent
 *   4. Next render: local=A, parent=M → swap again → Maximum update depth
 *
 * Track the last value we pushed (or accepted from parent). Skip sync-down when
 * the prop is still that echo; skip push-up when local hasn't moved past it.
 */
export function shouldSyncDownFromParent<T>(
  incoming: T,
  lastPushed: T,
): boolean {
  return !Object.is(incoming, lastPushed);
}

export function shouldPushUpToParent<T>(local: T, lastPushed: T): boolean {
  return !Object.is(local, lastPushed);
}
