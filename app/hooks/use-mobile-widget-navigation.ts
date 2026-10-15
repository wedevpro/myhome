"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { mobileWidgetPath, parseMobileWidgetLink, pendingWidgetStorageKey, readPendingWidgetLink, storePendingWidgetLink, type MobileWidgetRequest } from "@/lib/mobile-widget-navigation";

type Navigation = { hydrated: boolean; request: MobileWidgetRequest | null; error: string; needsLogin: boolean; applied: boolean };

/** Resume a safe widget destination after AuthForm's normal redirect to '/'. */
export function useMobileWidgetNavigation(userId: string | undefined) {
  const [navigation, setNavigation] = useState<Navigation>({ hydrated: false, request: null, error: "", needsLogin: false, applied: false });
  const consumed = useRef(false);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      consumed.current = false;
      const parsed = parseMobileWidgetLink(window.location.href, window.location.origin);
      let pending: string | null = null;
      try { pending = sessionStorage.getItem(pendingWidgetStorageKey); } catch {}
      const request = parsed.status === "valid" ? parsed.request : parsed.status === "absent" && userId ? readPendingWidgetLink(pending, window.location.origin) : null;
      if (parsed.status === "invalid") {
        try { sessionStorage.removeItem(pendingWidgetStorageKey); } catch {}
        setNavigation({ hydrated: true, request: null, error: parsed.error, needsLogin: false, applied: false });
        return;
      }
      if (request) {
        try { sessionStorage.setItem(pendingWidgetStorageKey, storePendingWidgetLink(request)); } catch {}
        setNavigation({ hydrated: true, request, error: "", needsLogin: !userId, applied: false });
      } else {
        if (userId) try { sessionStorage.removeItem(pendingWidgetStorageKey); } catch {}
        setNavigation({ hydrated: true, request: null, error: "", needsLogin: false, applied: false });
      }
    });
    return () => { active = false; };
  }, [userId]);

  const consume = useCallback((request: MobileWidgetRequest) => {
    if (consumed.current) return false;
    consumed.current = true;
    try { sessionStorage.removeItem(pendingWidgetStorageKey); } catch {}
    // Keep the list on reload, but never reopen an old scanner or confirmation.
    window.history.replaceState(window.history.state, "", mobileWidgetPath({ ...request, action: "open", itemId: undefined }));
    setNavigation(value => ({ ...value, applied: true }));
    return true;
  }, []);
  const fail = useCallback((error: string) => setNavigation(value => ({ ...value, error })), []);
  const dismiss = useCallback(() => {
    consumed.current = true;
    try { sessionStorage.removeItem(pendingWidgetStorageKey); } catch {}
    window.history.replaceState(window.history.state, "", "/");
    setNavigation({ hydrated: true, request: null, error: "", needsLogin: false, applied: false });
  }, []);
  return { ...navigation, consume, fail, dismiss };
}
