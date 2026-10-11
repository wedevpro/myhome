"use client"

import { useSyncExternalStore } from "react"
import { createDeviceDashboardStore } from "@/lib/device-dashboard"

// The adapter functions are called only by subscription/event handlers. Neither
// module initialization nor server rendering reads window or localStorage.
const store = createDeviceDashboardStore({
  getStorage: () => window.localStorage,
  subscribeStorage: listener => {
    const onStorage = (event: StorageEvent) => {
      try {
        // Ignore sessionStorage events; clear() has a null key and resets both cards.
        if (event.storageArea && event.storageArea !== window.localStorage) return
      } catch { return }
      listener({ key: event.key, newValue: event.newValue })
    }
    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  },
})
export function useDeviceDashboard() {
  const settings = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot)
  const hydrated = useSyncExternalStore(store.subscribe, store.getInitializationSnapshot, store.getServerInitializationSnapshot)
  return { settings, setVisibility: store.setVisibility, hydrated }
}
