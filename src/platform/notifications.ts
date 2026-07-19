export type NotificationCapabilityPermission = NotificationPermission | 'unsupported'

export interface NotificationCapability {
  supported: boolean
  secureContext: boolean
  permission: NotificationCapabilityPermission
}

export interface LocalNotification {
  title: string
  body: string
  tag?: string
  icon?: string
  badge?: string
  requireInteraction?: boolean
  silent?: boolean
  data?: unknown
  onClick?: () => void
}

export type NotificationDelivery = 'system' | 'in-app' | 'none'

export interface NotificationDeliveryResult {
  delivery: NotificationDelivery
  permission: NotificationCapabilityPermission
  reason?: 'unsupported' | 'permission-default' | 'permission-denied' | 'delivery-failed'
  notification?: Notification
}

export interface ShowNotificationOptions {
  ownerWindow?: Window
  serviceWorkerRegistration?: ServiceWorkerRegistration | null
  inAppFallback?: (notification: LocalNotification) => void
}

export type SoundCue = 'reminder' | 'warning' | 'success'

export interface DeliverAlertOptions extends ShowNotificationOptions {
  sound?: SoundCue | false
  volume?: number
}

type WindowWithWebkitAudio = Window &
  typeof globalThis & {
    webkitAudioContext?: typeof AudioContext
  }

type WindowWithNotification = Window & {
  Notification?: typeof Notification
}

function resolveWindow(candidate?: Window): Window | null {
  if (candidate) return candidate
  return typeof window !== 'undefined' ? window : null
}

export function getNotificationCapability(candidate?: Window): NotificationCapability {
  const ownerWindow = resolveWindow(candidate)
  const NotificationConstructor = (ownerWindow as WindowWithNotification | null)?.Notification
  const supported = typeof NotificationConstructor === 'function'
  return {
    supported,
    secureContext: Boolean(ownerWindow?.isSecureContext),
    permission: supported ? NotificationConstructor!.permission : 'unsupported',
  }
}

/** Must be called only after a clear user action (for example, a settings button). */
export async function requestNotificationPermission(candidate?: Window): Promise<NotificationCapability> {
  const ownerWindow = resolveWindow(candidate)
  const capability = getNotificationCapability(ownerWindow ?? undefined)
  if (!ownerWindow || !capability.supported) return capability

  try {
    await (ownerWindow as WindowWithNotification).Notification!.requestPermission()
  } catch {
    // Some policy-managed browsers reject instead of returning "denied".
  }
  return getNotificationCapability(ownerWindow)
}

function deliverInAppFallback(
  notification: LocalNotification,
  options: ShowNotificationOptions,
  result: Omit<NotificationDeliveryResult, 'delivery'>,
): NotificationDeliveryResult {
  if (!options.inAppFallback) return { ...result, delivery: 'none' }
  options.inAppFallback(notification)
  return { ...result, delivery: 'in-app' }
}

function toNotificationOptions(notification: LocalNotification): NotificationOptions {
  return {
    body: notification.body,
    tag: notification.tag,
    icon: notification.icon ?? '/icons/app-icon.svg',
    badge: notification.badge ?? '/icons/notification-badge.svg',
    requireInteraction: notification.requireInteraction,
    silent: notification.silent,
    data: notification.data,
  }
}

async function resolveServiceWorkerRegistration(
  ownerWindow: Window,
  explicitRegistration?: ServiceWorkerRegistration | null,
): Promise<ServiceWorkerRegistration | null> {
  if (explicitRegistration) return explicitRegistration
  if (!('serviceWorker' in ownerWindow.navigator)) return null

  try {
    return (await ownerWindow.navigator.serviceWorker.getRegistration()) ?? null
  } catch {
    return null
  }
}

/**
 * Sends a local system notification while the application is open. If permission is absent,
 * it returns normally and invokes the optional in-app fallback instead of producing repeated errors.
 */
export async function showLocalNotification(
  notification: LocalNotification,
  options: ShowNotificationOptions = {},
): Promise<NotificationDeliveryResult> {
  const ownerWindow = resolveWindow(options.ownerWindow)
  const capability = getNotificationCapability(ownerWindow ?? undefined)

  if (!ownerWindow || !capability.supported) {
    return deliverInAppFallback(notification, options, {
      permission: 'unsupported',
      reason: 'unsupported',
    })
  }

  if (capability.permission !== 'granted') {
    return deliverInAppFallback(notification, options, {
      permission: capability.permission,
      reason: capability.permission === 'denied' ? 'permission-denied' : 'permission-default',
    })
  }

  const notificationOptions = toNotificationOptions(notification)
  try {
    const registration = await resolveServiceWorkerRegistration(
      ownerWindow,
      options.serviceWorkerRegistration,
    )
    if (registration) {
      await registration.showNotification(notification.title, notificationOptions)
      return { delivery: 'system', permission: 'granted' }
    }

    const NotificationConstructor = (ownerWindow as WindowWithNotification).Notification!
    const instance = new NotificationConstructor(notification.title, notificationOptions)
    if (notification.onClick) {
      instance.addEventListener('click', () => {
        ownerWindow.focus()
        notification.onClick?.()
        instance.close()
      })
    }
    return { delivery: 'system', permission: 'granted', notification: instance }
  } catch {
    return deliverInAppFallback(notification, options, {
      permission: capability.permission,
      reason: 'delivery-failed',
    })
  }
}

function getAudioContextConstructor(candidate?: Window): typeof AudioContext | null {
  const ownerWindow = resolveWindow(candidate) as WindowWithWebkitAudio | null
  if (!ownerWindow) return null
  return ownerWindow.AudioContext ?? ownerWindow.webkitAudioContext ?? null
}

export function isSoundSupported(candidate?: Window): boolean {
  return getAudioContextConstructor(candidate) !== null
}

interface ToneStep {
  frequency: number
  duration: number
  offset: number
  type: OscillatorType
}

const SOUND_PATTERNS: Record<SoundCue, ToneStep[]> = {
  reminder: [
    { frequency: 659.25, duration: 0.14, offset: 0, type: 'sine' },
    { frequency: 783.99, duration: 0.2, offset: 0.16, type: 'sine' },
  ],
  warning: [
    { frequency: 440, duration: 0.16, offset: 0, type: 'triangle' },
    { frequency: 349.23, duration: 0.16, offset: 0.19, type: 'triangle' },
    { frequency: 293.66, duration: 0.24, offset: 0.38, type: 'triangle' },
  ],
  success: [
    { frequency: 523.25, duration: 0.12, offset: 0, type: 'sine' },
    { frequency: 659.25, duration: 0.12, offset: 0.13, type: 'sine' },
    { frequency: 783.99, duration: 0.25, offset: 0.26, type: 'sine' },
  ],
}

/** Local synthesized cues: no audio files, CDN or network access are used. */
export class LocalSoundPlayer {
  private context: AudioContext | null = null

  constructor(private readonly ownerWindow?: Window) {}

  /** Call once from a user click to satisfy browser autoplay rules. */
  async unlock(): Promise<boolean> {
    const AudioContextConstructor = getAudioContextConstructor(this.ownerWindow)
    if (!AudioContextConstructor) return false

    try {
      this.context ??= new AudioContextConstructor()
      if (this.context.state === 'suspended') await this.context.resume()
      return this.context.state === 'running'
    } catch {
      return false
    }
  }

  async play(cue: SoundCue, volume = 0.18): Promise<boolean> {
    if (!(await this.unlock()) || !this.context) return false

    const context = this.context
    const safeVolume = Math.min(1, Math.max(0, volume))
    const startAt = context.currentTime + 0.015

    SOUND_PATTERNS[cue].forEach((step) => {
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      const toneStart = startAt + step.offset
      const toneEnd = toneStart + step.duration

      oscillator.type = step.type
      oscillator.frequency.setValueAtTime(step.frequency, toneStart)
      gain.gain.setValueAtTime(0.0001, toneStart)
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, safeVolume), toneStart + 0.015)
      gain.gain.exponentialRampToValueAtTime(0.0001, toneEnd)
      oscillator.connect(gain)
      gain.connect(context.destination)
      oscillator.start(toneStart)
      oscillator.stop(toneEnd + 0.02)
    })
    return true
  }

  async close(): Promise<void> {
    const context = this.context
    this.context = null
    if (context && context.state !== 'closed') await context.close()
  }
}

let sharedSoundPlayer: LocalSoundPlayer | null = null

export async function playNotificationSound(cue: SoundCue, volume?: number): Promise<boolean> {
  sharedSoundPlayer ??= new LocalSoundPlayer()
  return sharedSoundPlayer.play(cue, volume)
}

export async function deliverUserAlert(
  notification: LocalNotification,
  options: DeliverAlertOptions = {},
): Promise<NotificationDeliveryResult> {
  const result = await showLocalNotification(notification, options)
  if (options.sound !== false) {
    await playNotificationSound(options.sound ?? 'reminder', options.volume)
  }
  return result
}
