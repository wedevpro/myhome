export const DEVICE_DASHBOARD_STORAGE_KEY = "myhomeia-device-dashboard"

export type DeviceDashboardSettings = Readonly<{
  showElectricity: boolean
  showWaste: boolean
}>
export type DeviceDashboardVisibility = keyof DeviceDashboardSettings

export const DEFAULT_DEVICE_DASHBOARD: DeviceDashboardSettings = Object.freeze({
  showElectricity: true,
  showWaste: true,
})

/** Keep only the two device preferences, with visible cards as the default. */
export function parseDeviceDashboard(value: string | null): DeviceDashboardSettings {
  let data: unknown
  try { data = value === null ? null : JSON.parse(value) } catch { return DEFAULT_DEVICE_DASHBOARD }
  if (!data || typeof data !== "object" || Array.isArray(data)) return DEFAULT_DEVICE_DASHBOARD
  const settings = data as Record<string, unknown>
  const showElectricity = typeof settings.showElectricity === "boolean" ? settings.showElectricity : true
  const showWaste = typeof settings.showWaste === "boolean" ? settings.showWaste : true
  return showElectricity && showWaste ? DEFAULT_DEVICE_DASHBOARD : Object.freeze({ showElectricity, showWaste })
}

type DeviceStorage = {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}
type DeviceStorageChange = { key: string | null; newValue: string | null }
type DeviceDashboardEnvironment = {
  getStorage: () => DeviceStorage | null
  subscribeStorage?: (listener: (event: DeviceStorageChange) => void) => () => void
}

/** One store per browser bundle; the injected environment also permits Node tests. */
export function createDeviceDashboardStore(environment: DeviceDashboardEnvironment) {
  let snapshot = DEFAULT_DEVICE_DASHBOARD
  let initialized = false
  let memoryOnly = false
  let releaseStorage: (() => void) | undefined
  const listeners = new Set<() => void>()

  const publish = (next: DeviceDashboardSettings) => {
    if (next.showElectricity === snapshot.showElectricity && next.showWaste === snapshot.showWaste) return
    snapshot = next
    for (const listener of [...listeners]) listener()
  }
  const readStorage = () => {
    initialized = true
    // A failed write must not be overwritten by older persisted values when
    // the UI unmounts and subscribes again during this browsing session.
    if (memoryOnly) return
    try {
      const storage = environment.getStorage()
      if (!storage) { memoryOnly = true; return }
      publish(parseDeviceDashboard(storage.getItem(DEVICE_DASHBOARD_STORAGE_KEY)))
    } catch { memoryOnly = true }
  }
  const onStorage = (event: DeviceStorageChange) => {
    if (event.key !== null && event.key !== DEVICE_DASHBOARD_STORAGE_KEY) return
    initialized = true
    memoryOnly = false
    publish(parseDeviceDashboard(event.key === null ? null : event.newValue))
  }

  return {
    getSnapshot: () => snapshot,
    getServerSnapshot: () => DEFAULT_DEVICE_DASHBOARD,
    getInitializationSnapshot: () => initialized,
    getServerInitializationSnapshot: () => false,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      if (listeners.size === 1) {
        try { releaseStorage = environment.subscribeStorage?.(onStorage) } catch { /* Storage events are optional. */ }
        readStorage()
      }
      return () => {
        listeners.delete(listener)
        if (!listeners.size) {
          releaseStorage?.()
          releaseStorage = undefined
        }
      }
    },
    setVisibility: (key: DeviceDashboardVisibility, value: boolean) => {
      if ((key !== "showElectricity" && key !== "showWaste") || typeof value !== "boolean") return
      if (!initialized) readStorage()
      const next = Object.freeze({ ...snapshot, [key]: value })
      try {
        const storage = environment.getStorage()
        if (!storage) memoryOnly = true
        else {
          storage.setItem(DEVICE_DASHBOARD_STORAGE_KEY, JSON.stringify(next))
          memoryOnly = false
        }
      } catch { memoryOnly = true }
      publish(next)
    },
  }
}
