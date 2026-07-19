export interface PwaCapability {
  serviceWorker: boolean
  installPrompt: boolean
  standalone: boolean
  secureContext: boolean
}

export interface ServiceWorkerRegistrationOptions {
  scriptUrl?: string
  scope?: string
  updateIntervalMs?: number
  reloadOnUpdate?: boolean
  onUpdateReady?: (
    registration: ServiceWorkerRegistration,
    activateUpdate: () => boolean,
  ) => void
  onOfflineReady?: (registration: ServiceWorkerRegistration) => void
  onControllerChange?: () => void
  onError?: (error: unknown) => void
}

export interface ServiceWorkerUpdateController {
  readonly supported: boolean
  readonly registration: ServiceWorkerRegistration | null
  hasWaitingUpdate(): boolean
  activateUpdate(): boolean
  checkForUpdate(): Promise<boolean>
  clearRuntimeCache(): boolean
  dispose(): void
}

export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[]
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
  prompt(): Promise<void>
}

export interface PwaInstallController {
  isAvailable(): boolean
  prompt(): Promise<'accepted' | 'dismissed' | 'unavailable'>
  dispose(): void
}

type NavigatorWithStandalone = Navigator & { standalone?: boolean }

function resolveWindow(candidate?: Window): Window | null {
  if (candidate) return candidate
  return typeof window !== 'undefined' ? window : null
}

export function isRunningStandalone(candidate?: Window): boolean {
  const ownerWindow = resolveWindow(candidate)
  if (!ownerWindow) return false
  return (
    ownerWindow.matchMedia('(display-mode: standalone)').matches ||
    Boolean((ownerWindow.navigator as NavigatorWithStandalone).standalone)
  )
}

export function getPwaCapability(candidate?: Window): PwaCapability {
  const ownerWindow = resolveWindow(candidate)
  return {
    serviceWorker: Boolean(ownerWindow && 'serviceWorker' in ownerWindow.navigator),
    installPrompt: Boolean(ownerWindow && 'onbeforeinstallprompt' in ownerWindow),
    standalone: isRunningStandalone(ownerWindow ?? undefined),
    secureContext: Boolean(ownerWindow?.isSecureContext),
  }
}

function unsupportedController(): ServiceWorkerUpdateController {
  return {
    supported: false,
    registration: null,
    hasWaitingUpdate: () => false,
    activateUpdate: () => false,
    checkForUpdate: async () => false,
    clearRuntimeCache: () => false,
    dispose: () => undefined,
  }
}

/**
 * Registers the local service worker and exposes an explicit update activation step. This lets
 * the UI defer reloading until the user has saved or completed the current action.
 */
export async function registerLocalServiceWorker(
  options: ServiceWorkerRegistrationOptions = {},
  candidate?: Window,
): Promise<ServiceWorkerUpdateController> {
  const ownerWindow = resolveWindow(candidate)
  if (!ownerWindow || !('serviceWorker' in ownerWindow.navigator)) {
    return unsupportedController()
  }

  const serviceWorkers = ownerWindow.navigator.serviceWorker
  const reloadOnUpdate = options.reloadOnUpdate ?? true
  let registration: ServiceWorkerRegistration

  try {
    registration = await serviceWorkers.register(options.scriptUrl ?? '/sw.js', {
      scope: options.scope ?? '/',
    })
  } catch (error) {
    options.onError?.(error)
    return unsupportedController()
  }

  let disposed = false
  let activationRequested = false
  let announcedWorker: ServiceWorker | null = null
  let intervalId: number | null = null
  let trackedInstallingWorker: ServiceWorker | null = null

  const activateUpdate = (): boolean => {
    const waiting = registration.waiting
    if (!waiting) return false
    activationRequested = true
    waiting.postMessage({ type: 'SKIP_WAITING' })
    return true
  }

  const announceWaitingUpdate = () => {
    if (disposed || !registration.waiting || announcedWorker === registration.waiting) return
    announcedWorker = registration.waiting
    options.onUpdateReady?.(registration, activateUpdate)
  }

  const onInstallingStateChange = () => {
    const installing = trackedInstallingWorker
    if (!installing || installing.state !== 'installed') return
    if (serviceWorkers.controller) announceWaitingUpdate()
    else options.onOfflineReady?.(registration)
  }

  const onUpdateFound = () => {
    if (trackedInstallingWorker) {
      trackedInstallingWorker.removeEventListener('statechange', onInstallingStateChange)
    }
    trackedInstallingWorker = registration.installing
    trackedInstallingWorker?.addEventListener('statechange', onInstallingStateChange)
  }

  const onControllerChange = () => {
    options.onControllerChange?.()
    if (activationRequested && reloadOnUpdate && !disposed) ownerWindow.location.reload()
  }

  const checkForUpdate = async (): Promise<boolean> => {
    if (disposed) return false
    try {
      await registration.update()
      announceWaitingUpdate()
      return Boolean(registration.waiting)
    } catch (error) {
      options.onError?.(error)
      return false
    }
  }

  const onOnline = () => {
    void checkForUpdate()
  }

  const onVisibilityChange = () => {
    if (ownerWindow.document.visibilityState === 'visible') void checkForUpdate()
  }

  registration.addEventListener('updatefound', onUpdateFound)
  serviceWorkers.addEventListener('controllerchange', onControllerChange)
  ownerWindow.addEventListener('online', onOnline)
  ownerWindow.document.addEventListener('visibilitychange', onVisibilityChange)

  const updateIntervalMs = options.updateIntervalMs ?? 30 * 60 * 1000
  if (updateIntervalMs > 0) {
    intervalId = ownerWindow.setInterval(() => void checkForUpdate(), updateIntervalMs)
  }

  announceWaitingUpdate()

  return {
    supported: true,
    registration,
    hasWaitingUpdate: () => Boolean(registration.waiting),
    activateUpdate,
    checkForUpdate,
    clearRuntimeCache: () => {
      const target = registration.active ?? serviceWorkers.controller
      if (!target) return false
      target.postMessage({ type: 'CLEAR_RUNTIME_CACHE' })
      return true
    },
    dispose: () => {
      if (disposed) return
      disposed = true
      registration.removeEventListener('updatefound', onUpdateFound)
      serviceWorkers.removeEventListener('controllerchange', onControllerChange)
      ownerWindow.removeEventListener('online', onOnline)
      ownerWindow.document.removeEventListener('visibilitychange', onVisibilityChange)
      trackedInstallingWorker?.removeEventListener('statechange', onInstallingStateChange)
      if (intervalId !== null) ownerWindow.clearInterval(intervalId)
    },
  }
}

/** Captures the browser's one-shot PWA installation prompt for a later explicit button click. */
export function capturePwaInstallPrompt(
  onAvailabilityChange?: (available: boolean) => void,
  candidate?: Window,
): PwaInstallController {
  const ownerWindow = resolveWindow(candidate)
  let deferredPrompt: BeforeInstallPromptEvent | null = null

  if (!ownerWindow) {
    return {
      isAvailable: () => false,
      prompt: async () => 'unavailable',
      dispose: () => undefined,
    }
  }

  const onBeforeInstallPrompt = (event: Event) => {
    event.preventDefault()
    deferredPrompt = event as BeforeInstallPromptEvent
    onAvailabilityChange?.(true)
  }

  const onInstalled = () => {
    deferredPrompt = null
    onAvailabilityChange?.(false)
  }

  ownerWindow.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
  ownerWindow.addEventListener('appinstalled', onInstalled)

  return {
    isAvailable: () => deferredPrompt !== null,
    prompt: async () => {
      const promptEvent = deferredPrompt
      if (!promptEvent) return 'unavailable'

      deferredPrompt = null
      onAvailabilityChange?.(false)
      await promptEvent.prompt()
      const choice = await promptEvent.userChoice
      return choice.outcome
    },
    dispose: () => {
      deferredPrompt = null
      ownerWindow.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
      ownerWindow.removeEventListener('appinstalled', onInstalled)
    },
  }
}
