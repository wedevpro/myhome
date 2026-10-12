/** Each browser entry carries only a cursor; page snapshots stay in this tab. */
const STATE_KEY = "__myhomeia_navigation";
let nextSession = 0;

type Cursor = { session: string; index: number };
type NavigationHost = Pick<Window, "history" | "location" | "addEventListener" | "removeEventListener">;

export type AppNavigationHistory<T> = {
  /** Add a visit after the current page, discarding its forward branch. */
  record(scene: T): void;
  /** Remember edits and scroll position without creating another visit. */
  checkpoint(scene: T): void;
  back(): void;
  /** Start a new scope, for example after switching households. */
  reset(scene: T): void;
  dispose(): void;
};

type Options<T> = {
  initial: T;
  onRestore(scene: T): void;
  /** Return true when Back closed an overlay instead of changing pages. */
  onBeforeBack?(): boolean;
};

function cursorFromState(state: unknown): Cursor | undefined {
  if (!state || typeof state !== "object") return;
  const value = (state as Record<string, unknown>)[STATE_KEY];
  if (!value || typeof value !== "object") return;
  const cursor = value as Partial<Cursor>;
  if (typeof cursor.session === "string" && Number.isInteger(cursor.index) && cursor.index! >= 0) {
    return cursor as Cursor;
  }
}

/**
 * Native history for pages rendered inside the application's single Next route.
 * A same-URL entry before the first page keeps ordinary Back inside the app.
 * Existing Next router state must survive every push and replace.
 */
export function createAppNavigationHistory<T>(host: NavigationHost, options: Options<T>): AppNavigationHistory<T> {
  let session = "";
  let index = 1;
  let current = options.initial;
  let disposed = false;
  let returningTo: number | null = null;
  const scenes = new Map<number, T>();

  function stateFor(nextIndex: number) {
    const state = host.history.state;
    return {
      ...(state && typeof state === "object" ? state : {}),
      [STATE_KEY]: { session, index: nextIndex } satisfies Cursor,
    };
  }

  function startScope(scene: T) {
    session = `${Date.now().toString(36)}-${++nextSession}`;
    current = scene;
    index = 1;
    returningTo = null;
    scenes.clear();
    scenes.set(index, scene);
    host.history.replaceState(stateFor(0), "", host.location.href);
    host.history.pushState(stateFor(index), "", host.location.href);
  }

  function restoreBrowserPosition(fromIndex: number, targetIndex: number) {
    returningTo = targetIndex;
    host.history.go(targetIndex - fromIndex);
  }

  function onPopState(event: PopStateEvent) {
    if (disposed) return;
    const cursor = cursorFromState(event.state);
    if (!cursor || cursor.session !== session || (cursor.index !== 0 && !scenes.has(cursor.index))) {
      // Reload, a previous household, or a previous React effect owns this entry.
      // It cannot restore a snapshot from the current scope.
      startScope(current);
      return;
    }

    if (returningTo !== null) {
      if (cursor.index === returningTo) returningTo = null;
      else restoreBrowserPosition(cursor.index, returningTo);
      return;
    }

    if (cursor.index === index) return;
    const backward = cursor.index < index;
    if (backward && options.onBeforeBack?.()) {
      restoreBrowserPosition(cursor.index, index);
      return;
    }

    if (cursor.index === 0) {
      // Returning forward preserves real forward visits and avoids repeated
      // presses adding more sentinel entries to the browser history.
      if (index !== 1) {
        index = 1;
        current = scenes.get(1)!;
        options.onRestore(current);
      }
      restoreBrowserPosition(0, 1);
      return;
    }

    index = cursor.index;
    current = scenes.get(index)!;
    options.onRestore(current);
  }

  startScope(options.initial);
  host.addEventListener("popstate", onPopState);

  return {
    record(scene) {
      if (disposed) return;
      // A navigation triggered while a boundary/overlay restoration is in
      // flight replaces that restoration with its own safe scope.
      if (returningTo !== null) {
        startScope(scene);
        return;
      }
      for (const key of scenes.keys()) if (key > index) scenes.delete(key);
      current = scene;
      scenes.set(++index, scene);
      host.history.pushState(stateFor(index), "", host.location.href);
    },
    checkpoint(scene) {
      if (disposed) return;
      current = scene;
      scenes.set(index, scene);
    },
    back() {
      if (disposed || returningTo !== null) return;
      host.history.back();
    },
    reset(scene) {
      if (!disposed) startScope(scene);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      host.removeEventListener("popstate", onPopState);
      scenes.clear();
    },
  };
}
