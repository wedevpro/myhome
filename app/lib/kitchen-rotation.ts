type TimeoutHandle = ReturnType<typeof setTimeout> | number;

export interface RotationClock {
  setTimeout(callback: () => void, delayMs: number): TimeoutHandle;
  clearTimeout(handle: TimeoutHandle): void;
}

type RotationOptions = {
  delayMs: number;
  onRotate: () => void;
  isPaused: () => boolean;
  clock?: RotationClock;
};

const defaultClock: RotationClock = {
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: handle => globalThis.clearTimeout(handle),
};

/** Relative timeouts keep rotation independent of changes to the wall clock. */
export function createRotationTimer({ delayMs, onRotate, isPaused, clock = defaultClock }: RotationOptions) {
  if (!Number.isFinite(delayMs) || delayMs <= 0) throw new RangeError("Rotation delay must be positive and finite");

  let handle: TimeoutHandle | undefined;
  let generation = 0;
  let disposed = false;
  let waitingForResume = false;

  function cancel() {
    generation++;
    if (handle !== undefined) clock.clearTimeout(handle);
    handle = undefined;
  }

  function schedule(delay: number) {
    const scheduledGeneration = ++generation;
    handle = clock.setTimeout(() => {
      if (disposed || scheduledGeneration !== generation) return;
      handle = undefined;

      const paused = isPaused();
      if (disposed || scheduledGeneration !== generation) return;
      if (paused) {
        waitingForResume = true;
        schedule(250);
        return;
      }
      if (waitingForResume) {
        waitingForResume = false;
        schedule(delayMs);
        return;
      }

      try {
        onRotate();
      } finally {
        // onRotate may itself reset or dispose the timer.
        if (!disposed && scheduledGeneration === generation) schedule(delayMs);
      }
    }, delay);
  }

  function reset() {
    if (disposed) return;
    cancel();
    waitingForResume = false;
    schedule(delayMs);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    cancel();
  }

  schedule(delayMs);
  return { reset, dispose };
}

export function getSwipeDirection({ dx, dy, durationMs }: { dx: number; dy: number; durationMs: number }): -1 | 0 | 1 {
  if (![dx, dy, durationMs].every(Number.isFinite) || durationMs < 0 || durationMs > 1200) return 0;
  if (Math.abs(dx) < 50 || Math.abs(dx) <= 1.4 * Math.abs(dy)) return 0;
  return dx < 0 ? 1 : -1;
}
