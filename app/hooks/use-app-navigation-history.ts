"use client";

import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { createAppNavigationHistory, type AppNavigationHistory } from "@/lib/app-navigation-history";

type Options<T> = {
  scene: T;
  sceneKey: string;
  scope: string | undefined;
  ready: boolean;
  capture: (scene: T) => T;
  onRestore: (scene: T) => void;
  onBeforeBack: () => boolean;
};

/** Keep native Back in sync with the screens of the single-page application. */
export function useAppNavigationHistory<T>(options: Options<T>) {
  const controller = useRef<AppNavigationHistory<T> | null>(null);
  const latest = useRef(options);
  const currentKey = useRef(options.sceneKey);
  const currentScope = useRef(options.scope);
  const restoring = useRef(false);
  const mounted = useRef(false);
  useLayoutEffect(() => { latest.current = options; }, [options]);

  useEffect(() => {
    if (!options.ready) return;
    mounted.current = true;
    const coarsePointer = window.matchMedia("(pointer: coarse)");
    const activate = () => {
      if (controller.current || (window.innerWidth >= 768 && !coarsePointer.matches)) return;
      const value = latest.current;
      currentKey.current = value.sceneKey;
      currentScope.current = value.scope;
      controller.current = createAppNavigationHistory(window, {
        initial: value.capture(value.scene),
        onRestore: scene => { restoring.current = true; latest.current.onRestore(scene); },
        onBeforeBack: () => latest.current.onBeforeBack(),
      });
    };
    const rememberScroll = () => {
      const value = latest.current;
      if (!restoring.current && value.sceneKey === currentKey.current && value.scope === currentScope.current) {
        controller.current?.checkpoint(value.capture(value.scene));
      }
    };
    activate();
    window.addEventListener("resize", activate);
    coarsePointer.addEventListener("change", activate);
    window.addEventListener("scroll", rememberScroll, { passive: true });
    return () => {
      mounted.current = false;
      window.removeEventListener("resize", activate);
      coarsePointer.removeEventListener("change", activate);
      window.removeEventListener("scroll", rememberScroll);
      // React Strict Mode immediately sets up the same effect again. Reuse
      // its controller rather than inserting another pair of root entries.
      queueMicrotask(() => {
        if (!mounted.current) { controller.current?.dispose(); controller.current = null; }
      });
    };
  }, [options.ready]);

  useEffect(() => {
    const navigation = controller.current;
    if (!navigation) return;
    const value = latest.current;
    const captured = value.capture(value.scene);
    if (value.scope !== currentScope.current) {
      navigation.reset(captured);
      currentScope.current = value.scope;
      restoring.current = false;
    } else if (restoring.current) {
      restoring.current = false;
      navigation.checkpoint(captured);
    } else if (value.sceneKey !== currentKey.current) navigation.record(captured);
    else navigation.checkpoint(captured);
    currentKey.current = value.sceneKey;
  }, [options.scene, options.sceneKey, options.scope]);

  return useCallback(() => {
    if (!controller.current) return false;
    controller.current.back();
    return true;
  }, []);
}
