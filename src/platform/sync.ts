const SYNC_PROTOCOL = 'moya-smena-sync/v1' as const
const DEFAULT_CHANNEL_NAME = 'moya-smena-state'

export type SyncTransportKind = 'broadcast-channel' | 'storage' | 'memory'

export type SyncEnvelope<State, EventPayload> =
  | {
      protocol: typeof SYNC_PROTOCOL
      id: string
      sourceId: string
      sentAt: number
      sequence: number
      kind: 'state'
      payload: State
    }
  | {
      protocol: typeof SYNC_PROTOCOL
      id: string
      sourceId: string
      sentAt: number
      sequence: number
      kind: 'event'
      payload: EventPayload
    }
  | {
      protocol: typeof SYNC_PROTOCOL
      id: string
      sourceId: string
      sentAt: number
      sequence: number
      kind: 'request-state'
    }

export interface CrossWindowSyncOptions<State> {
  channelName?: string
  sourceId?: string
  ownerWindow?: Window
  getState?: () => State | Promise<State>
  onError?: (error: unknown) => void
}

export type SyncListener<State, EventPayload> = (
  message: SyncEnvelope<State, EventPayload>,
) => void

interface SyncTransport {
  readonly kind: SyncTransportKind
  post(message: unknown): void
  subscribe(listener: (message: unknown) => void): () => void
  close(): void
}

type MemoryListener = (message: unknown) => void
const memoryChannels = new Map<string, Set<MemoryListener>>()

function createId(prefix: string): string {
  const randomId = globalThis.crypto?.randomUUID?.()
  if (randomId) return `${prefix}-${randomId}`
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

class MemoryTransport implements SyncTransport {
  readonly kind: SyncTransportKind = 'memory'
  private readonly listeners = new Set<MemoryListener>()
  private closed = false

  constructor(private readonly name: string) {
    const channel = memoryChannels.get(name) ?? new Set<MemoryListener>()
    channel.add(this.receive)
    memoryChannels.set(name, channel)
  }

  private readonly receive = (message: unknown) => {
    if (this.closed) return
    this.listeners.forEach((listener) => listener(message))
  }

  post(message: unknown): void {
    if (this.closed) return
    memoryChannels.get(this.name)?.forEach((listener) => listener(message))
  }

  subscribe(listener: MemoryListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.listeners.clear()
    const channel = memoryChannels.get(this.name)
    channel?.delete(this.receive)
    if (channel?.size === 0) memoryChannels.delete(this.name)
  }
}

class BroadcastTransport implements SyncTransport {
  readonly kind: SyncTransportKind = 'broadcast-channel'
  private readonly channel: BroadcastChannel
  private readonly listenerMap = new Map<MemoryListener, (event: MessageEvent) => void>()

  constructor(name: string) {
    this.channel = new BroadcastChannel(name)
  }

  post(message: unknown): void {
    this.channel.postMessage(message)
  }

  subscribe(listener: MemoryListener): () => void {
    const wrapped = (event: MessageEvent) => listener(event.data)
    this.listenerMap.set(listener, wrapped)
    this.channel.addEventListener('message', wrapped)
    return () => {
      const registered = this.listenerMap.get(listener)
      if (!registered) return
      this.channel.removeEventListener('message', registered)
      this.listenerMap.delete(listener)
    }
  }

  close(): void {
    this.listenerMap.forEach((wrapped) => this.channel.removeEventListener('message', wrapped))
    this.listenerMap.clear()
    this.channel.close()
  }
}

class StorageTransport implements SyncTransport {
  readonly kind: SyncTransportKind = 'storage'
  private readonly key: string
  private readonly listeners = new Set<MemoryListener>()
  private readonly memory: MemoryTransport
  private readonly unsubscribeMemory: () => void

  constructor(
    name: string,
    private readonly ownerWindow: Window,
  ) {
    this.key = `__${name}__message`
    this.memory = new MemoryTransport(`storage:${name}`)
    this.unsubscribeMemory = this.memory.subscribe((message) => this.emit(message))
    ownerWindow.addEventListener('storage', this.onStorage)
  }

  private readonly emit = (message: unknown) => {
    this.listeners.forEach((listener) => listener(message))
  }

  private readonly onStorage = (event: StorageEvent) => {
    if (event.key !== this.key || !event.newValue) return
    try {
      this.emit(JSON.parse(event.newValue) as unknown)
    } catch {
      // Ignore messages that were not produced by this protocol.
    }
  }

  post(message: unknown): void {
    this.memory.post(message)
    try {
      const serialized = JSON.stringify(message)
      this.ownerWindow.localStorage.setItem(this.key, serialized)
      this.ownerWindow.localStorage.removeItem(this.key)
    } catch {
      // The in-memory transport still synchronizes same-realm windows.
    }
  }

  subscribe(listener: MemoryListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  close(): void {
    this.ownerWindow.removeEventListener('storage', this.onStorage)
    this.unsubscribeMemory()
    this.memory.close()
    this.listeners.clear()
  }
}

function canUseLocalStorage(ownerWindow: Window): boolean {
  try {
    const probe = '__moya_smena_sync_probe__'
    ownerWindow.localStorage.setItem(probe, '1')
    ownerWindow.localStorage.removeItem(probe)
    return true
  } catch {
    return false
  }
}

function createTransport(name: string, ownerWindow?: Window): SyncTransport {
  if (typeof BroadcastChannel === 'function') {
    try {
      return new BroadcastTransport(name)
    } catch {
      // Sandboxed documents can expose BroadcastChannel but reject construction.
    }
  }

  if (ownerWindow && canUseLocalStorage(ownerWindow)) {
    return new StorageTransport(name, ownerWindow)
  }

  return new MemoryTransport(name)
}

function isSyncEnvelope(value: unknown): value is SyncEnvelope<unknown, unknown> {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    candidate.protocol === SYNC_PROTOCOL &&
    typeof candidate.id === 'string' &&
    typeof candidate.sourceId === 'string' &&
    typeof candidate.sentAt === 'number' &&
    Number.isFinite(candidate.sentAt) &&
    typeof candidate.sequence === 'number' &&
    Number.isSafeInteger(candidate.sequence) &&
    (candidate.kind === 'state' ||
      candidate.kind === 'event' ||
      candidate.kind === 'request-state')
  )
}

/**
 * Synchronizes snapshots and user actions between tabs, popup/PiP windows and the PWA.
 * IndexedDB remains the source of truth; this channel only makes updates visible immediately.
 */
export class CrossWindowSync<State, EventPayload = never> {
  readonly sourceId: string
  readonly transportKind: SyncTransportKind

  private readonly transport: SyncTransport
  private readonly getState?: () => State | Promise<State>
  private readonly onError?: (error: unknown) => void
  private readonly listeners = new Set<SyncListener<State, EventPayload>>()
  private readonly lastSequenceBySource = new Map<string, number>()
  private readonly recentMessageIds = new Set<string>()
  private readonly unsubscribeTransport: () => void
  private sequence = 0
  private closed = false

  constructor(options: CrossWindowSyncOptions<State> = {}) {
    this.sourceId = options.sourceId ?? createId('client')
    this.getState = options.getState
    this.onError = options.onError
    this.transport = createTransport(
      options.channelName ?? DEFAULT_CHANNEL_NAME,
      options.ownerWindow ?? (typeof window !== 'undefined' ? window : undefined),
    )
    this.transportKind = this.transport.kind
    this.unsubscribeTransport = this.transport.subscribe(this.receive)
  }

  private createBase(kind: SyncEnvelope<State, EventPayload>['kind']) {
    this.sequence += 1
    return {
      protocol: SYNC_PROTOCOL,
      id: createId('message'),
      sourceId: this.sourceId,
      sentAt: Date.now(),
      sequence: this.sequence,
      kind,
    }
  }

  private rememberMessage(id: string): void {
    this.recentMessageIds.add(id)
    if (this.recentMessageIds.size <= 256) return
    const oldest = this.recentMessageIds.values().next().value
    if (typeof oldest === 'string') this.recentMessageIds.delete(oldest)
  }

  private readonly receive = (value: unknown) => {
    if (this.closed || !isSyncEnvelope(value)) return
    if (value.sourceId === this.sourceId || this.recentMessageIds.has(value.id)) return

    const lastSequence = this.lastSequenceBySource.get(value.sourceId) ?? 0
    if (value.sequence <= lastSequence) return
    this.lastSequenceBySource.set(value.sourceId, value.sequence)
    this.rememberMessage(value.id)

    const message = value as SyncEnvelope<State, EventPayload>
    if (message.kind === 'request-state' && this.getState) {
      void this.respondWithCurrentState()
    }
    this.listeners.forEach((listener) => listener(message))
  }

  private async respondWithCurrentState(): Promise<void> {
    try {
      const state = await this.getState?.()
      if (state !== undefined && !this.closed) this.publishState(state)
    } catch (error) {
      this.onError?.(error)
    }
  }

  private send(message: SyncEnvelope<State, EventPayload>): string {
    if (this.closed) throw new Error('Канал синхронизации уже закрыт.')
    this.rememberMessage(message.id)
    this.transport.post(message)
    return message.id
  }

  publishState(state: State): string {
    return this.send({ ...this.createBase('state'), kind: 'state', payload: state })
  }

  publishEvent(payload: EventPayload): string {
    return this.send({ ...this.createBase('event'), kind: 'event', payload })
  }

  requestState(): string {
    return this.send({ ...this.createBase('request-state'), kind: 'request-state' })
  }

  subscribe(listener: SyncListener<State, EventPayload>): () => void {
    if (this.closed) throw new Error('Канал синхронизации уже закрыт.')
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.unsubscribeTransport()
    this.transport.close()
    this.listeners.clear()
    this.lastSequenceBySource.clear()
    this.recentMessageIds.clear()
  }
}

export function isBroadcastChannelSupported(): boolean {
  return typeof BroadcastChannel === 'function'
}

export function createCrossWindowSync<State, EventPayload = never>(
  options: CrossWindowSyncOptions<State> = {},
): CrossWindowSync<State, EventPayload> {
  return new CrossWindowSync<State, EventPayload>(options)
}
