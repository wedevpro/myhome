"use client";

import { useCallback, useEffect, useRef } from "react";
import { createRotationTimer } from "@/lib/kitchen-rotation";

export function useKitchenRotation({ enabled, busy, delayMs, selectionKey, onRotate }: {
  enabled: boolean;
  busy: boolean;
  delayMs: number;
  selectionKey: string;
  onRotate: () => void;
}) {
  const timerRef = useRef<ReturnType<typeof createRotationTimer> | null>(null);
  const reset = useCallback(() => timerRef.current?.reset(), []);

  useEffect(() => {
    if (!enabled || busy) return;
    const timer = createRotationTimer({
      delayMs,
      onRotate,
      isPaused: () => {
        const focused = document.activeElement;
        return document.visibilityState !== "visible"
          || !!document.querySelector('[role="dialog"],[role="alertdialog"],[role="menu"]')
          || (focused instanceof HTMLElement && !!focused.closest(".panel")
            && focused.matches('input,textarea,select,[role="combobox"]'));
      },
    });
    timerRef.current = timer;
    const resume = () => { if (document.visibilityState === "visible") timer.reset(); };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("focus", resume);
    return () => {
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("focus", resume);
      timer.dispose();
      if (timerRef.current === timer) timerRef.current = null;
    };
  }, [enabled, busy, delayMs, selectionKey, onRotate]);

  return reset;
}
