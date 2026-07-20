export interface DocumentPictureInPictureOptions {
  width?: number
  height?: number
  disallowReturnToOpener?: boolean
  preferInitialWindowPlacement?: boolean
}

export interface DocumentPictureInPictureApi {
  readonly window: Window | null
  requestWindow(options?: DocumentPictureInPictureOptions): Promise<Window>
}

type WindowWithDocumentPictureInPicture = Window & {
  documentPictureInPicture?: DocumentPictureInPictureApi
}

export type FloatingWindowMode = 'document-picture-in-picture' | 'popup'

export type FloatingWindowErrorCode =
  | 'unsupported'
  | 'permission-denied'
  | 'aborted'
  | 'invalid-state'
  | 'popup-blocked'
  | 'open-failed'

const ERROR_MESSAGES: Record<FloatingWindowErrorCode, string> = {
  unsupported:
    'Этот браузер не поддерживает Document Picture-in-Picture. Обновите браузер или используйте обычное компактное окно.',
  'permission-denied':
    'Браузер запретил открыть окно поверх остальных. Проверьте разрешения сайта и запускайте мини-таймер только нажатием кнопки.',
  aborted: 'Открытие мини-таймера было отменено.',
  'invalid-state':
    'Мини-таймер сейчас нельзя открыть. Закройте уже открытое окно и повторите попытку.',
  'popup-blocked':
    'Браузер заблокировал запасное окно. Разрешите всплывающие окна для этого локального сайта и повторите попытку.',
  'open-failed': 'Не удалось открыть мини-таймер. Повторите попытку из основного окна.',
}

export class FloatingWindowError extends Error {
  readonly code: FloatingWindowErrorCode
  override readonly cause?: unknown

  constructor(code: FloatingWindowErrorCode, cause?: unknown, message = ERROR_MESSAGES[code]) {
    super(message)
    this.name = 'FloatingWindowError'
    this.code = code
    this.cause = cause
  }
}

export interface FloatingWindowSupport {
  documentPictureInPicture: boolean
  popup: boolean
}

export interface StyleTransferResult {
  copiedNodes: number
  copiedConstructedSheets: number
  failedSheets: number
}

export interface OpenFloatingTimerOptions {
  ownerWindow?: Window
  width?: number
  height?: number
  title?: string
  containerId?: string
  popupName?: string
  fallback?: 'popup' | 'error'
  fallbackOnRequestFailure?: boolean
  forcePopup?: boolean
  reuseExisting?: boolean
  copyStyles?: boolean
}

export interface FloatingTimerWindow {
  readonly mode: FloatingWindowMode
  readonly window: Window
  readonly document: Document
  readonly container: HTMLElement
  readonly limitation: string | null
  readonly styleTransfer: StyleTransferResult
  isClosed(): boolean
  focus(): void
  close(): void
  onClose(listener: () => void): () => void
}

const DEFAULT_WIDTH = 160
const DEFAULT_HEIGHT = 160
const DEFAULT_CONTAINER_ID = 'moya-smena-mini-timer'

export const FALLBACK_LIMITATION =
  'Настоящий режим «поверх всех окон» недоступен: браузер не поддерживает Document Picture-in-Picture. Открыто обычное компактное окно, которое может скрываться за другими программами. Обновите браузер. Основной сайт или установленное PWA должны оставаться открытыми.'

function resolveWindow(candidate?: Window): Window {
  if (candidate) return candidate
  if (typeof window !== 'undefined') return window
  throw new FloatingWindowError('open-failed')
}

export function getDocumentPictureInPictureApi(
  candidate?: Window | null,
): DocumentPictureInPictureApi | null {
  if (!candidate || !('documentPictureInPicture' in candidate)) return null

  const api = (candidate as WindowWithDocumentPictureInPicture).documentPictureInPicture
  return api && typeof api.requestWindow === 'function' ? api : null
}

export function isDocumentPictureInPictureSupported(candidate?: Window | null): boolean {
  const resolved = candidate ?? (typeof window !== 'undefined' ? window : null)
  return getDocumentPictureInPictureApi(resolved) !== null
}

export function detectFloatingWindowSupport(candidate?: Window | null): FloatingWindowSupport {
  const resolved = candidate ?? (typeof window !== 'undefined' ? window : null)
  return {
    documentPictureInPicture: isDocumentPictureInPictureSupported(resolved),
    popup: Boolean(resolved && typeof resolved.open === 'function'),
  }
}

function classifyRequestError(error: unknown): FloatingWindowError {
  if (error instanceof FloatingWindowError) return error

  const name =
    typeof error === 'object' && error !== null && 'name' in error
      ? String((error as { name: unknown }).name)
      : ''

  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return new FloatingWindowError('permission-denied', error)
  }
  if (name === 'NotSupportedError') return new FloatingWindowError('unsupported', error)
  if (name === 'AbortError') return new FloatingWindowError('aborted', error)
  if (name === 'InvalidStateError') return new FloatingWindowError('invalid-state', error)
  return new FloatingWindowError('open-failed', error)
}

/**
 * Thin, testable wrapper around requestWindow. Call it synchronously from a user click handler.
 */
export async function requestDocumentPictureInPictureWindow(
  ownerWindow: Window,
  options: DocumentPictureInPictureOptions = {},
): Promise<Window> {
  const api = getDocumentPictureInPictureApi(ownerWindow)
  if (!api) throw new FloatingWindowError('unsupported')

  try {
    return await api.requestWindow(options)
  } catch (error) {
    throw classifyRequestError(error)
  }
}

function cloneStyleNode(node: Element, targetDocument: Document): void {
  const clone = node.cloneNode(true) as Element
  clone.setAttribute('data-floating-window-owned', 'true')
  if (node.tagName === 'LINK') {
    const absoluteHref = (node as HTMLLinkElement).href
    if (absoluteHref) clone.setAttribute('href', absoluteHref)
  }
  targetDocument.head.append(clone)
}

function copyRootPresentation(sourceDocument: Document, targetDocument: Document): void {
  targetDocument.documentElement.lang = sourceDocument.documentElement.lang || 'ru'
  targetDocument.documentElement.dir = sourceDocument.documentElement.dir

  const rootClassName = sourceDocument.documentElement.getAttribute('class')
  if (rootClassName) targetDocument.documentElement.setAttribute('class', rootClassName)

  const sourceTheme = sourceDocument.documentElement.getAttribute('data-theme')
  if (sourceTheme) targetDocument.documentElement.setAttribute('data-theme', sourceTheme)

  const view = sourceDocument.defaultView
  if (!view) return

  const computed = view.getComputedStyle(sourceDocument.documentElement)
  for (let index = 0; index < computed.length; index += 1) {
    const property = computed[index]
    if (property.startsWith('--')) {
      targetDocument.documentElement.style.setProperty(
        property,
        computed.getPropertyValue(property),
        computed.getPropertyPriority(property),
      )
    }
  }

  targetDocument.documentElement.style.colorScheme = computed.colorScheme
}

/** Copies local and bundled styles without depending on external CDNs. */
export function copyDocumentStyles(
  sourceDocument: Document,
  targetDocument: Document,
): StyleTransferResult {
  let copiedNodes = 0
  let copiedConstructedSheets = 0
  let failedSheets = 0

  const sourceNodes = sourceDocument.querySelectorAll('link[rel="stylesheet"], style')
  sourceNodes.forEach((node) => {
    cloneStyleNode(node, targetDocument)
    copiedNodes += 1
  })

  const copiedOwners = new Set(
    Array.from(sourceNodes, (node) => node),
  )

  Array.from(sourceDocument.styleSheets).forEach((sheet) => {
    if (sheet.ownerNode && copiedOwners.has(sheet.ownerNode as Element)) return

    try {
      const cssText = Array.from(sheet.cssRules, (rule) => rule.cssText).join('\n')
      if (!cssText) return
      const style = targetDocument.createElement('style')
      style.dataset.floatingWindowStyle = 'constructed'
      style.dataset.floatingWindowOwned = 'true'
      style.textContent = cssText
      targetDocument.head.append(style)
      copiedConstructedSheets += 1
    } catch {
      // Cross-origin sheets cannot expose cssRules. A matching link is already cloned above.
      failedSheets += 1
    }
  })

  copyRootPresentation(sourceDocument, targetDocument)
  return { copiedNodes, copiedConstructedSheets, failedSheets }
}

function ensureMeta(targetDocument: Document, name: string, content: string): void {
  const existing = targetDocument.head.querySelector(`meta[name="${name}"]`)
  if (existing) {
    existing.setAttribute('content', content)
    return
  }

  const meta = targetDocument.createElement('meta')
  meta.name = name
  meta.content = content
  targetDocument.head.append(meta)
}

function prepareDocument(
  targetWindow: Window,
  sourceDocument: Document,
  mode: FloatingWindowMode,
  options: Required<Pick<OpenFloatingTimerOptions, 'title' | 'containerId' | 'copyStyles'>>,
  limitation: string | null,
): { container: HTMLElement; styleTransfer: StyleTransferResult } {
  const targetDocument = targetWindow.document
  targetDocument.title = options.title
  ensureMeta(targetDocument, 'viewport', 'width=device-width, initial-scale=1')
  targetDocument.body.replaceChildren()
  targetDocument.body.dataset.floatingWindowMode = mode
  targetDocument.head
    .querySelectorAll('[data-floating-window-owned="true"]')
    .forEach((node) => node.remove())

  const baseStyle = targetDocument.createElement('style')
  baseStyle.dataset.floatingWindowBase = 'true'
  baseStyle.dataset.floatingWindowOwned = 'true'
  baseStyle.textContent = `
    :root { color-scheme: light dark; }
    html, body { width: 100%; height: 100%; min-width: 0 !important; min-height: 0 !important; margin: 0; overflow: hidden !important; }
    body { background: #191919; }
    #${options.containerId}, #${options.containerId} .mini-timer { width: 100%; height: 100%; min-height: 0; }
    .floating-window-limitation {
      box-sizing: border-box;
      margin: 0;
      padding: 10px 14px;
      font: 500 12px/1.45 system-ui, sans-serif;
      color: #241f00;
      background: #ffe66b;
      border-bottom: 1px solid #d4b800;
    }
  `
  const styleTransfer = options.copyStyles
    ? copyDocumentStyles(sourceDocument, targetDocument)
    : { copiedNodes: 0, copiedConstructedSheets: 0, failedSheets: 0 }

  targetDocument.head.append(baseStyle)

  if (limitation) {
    const notice = targetDocument.createElement('p')
    notice.className = 'floating-window-limitation'
    notice.setAttribute('role', 'status')
    notice.textContent = limitation
    targetDocument.body.append(notice)
  }

  const container = targetDocument.createElement('div')
  container.id = options.containerId
  targetDocument.body.append(container)
  return { container, styleTransfer }
}

function popupFeatures(ownerWindow: Window, width: number, height: number): string {
  const left = Math.max(0, ownerWindow.screenX + ownerWindow.outerWidth - width - 24)
  const top = Math.max(0, ownerWindow.screenY + ownerWindow.outerHeight - height - 24)
  return [
    'popup=yes',
    `width=${Math.round(width)}`,
    `height=${Math.round(height)}`,
    `left=${Math.round(left)}`,
    `top=${Math.round(top)}`,
    'resizable=yes',
    'scrollbars=yes',
  ].join(',')
}

function openFallbackPopup(
  ownerWindow: Window,
  name: string,
  width: number,
  height: number,
): Window {
  const popup = ownerWindow.open('', name, popupFeatures(ownerWindow, width, height))
  if (!popup) throw new FloatingWindowError('popup-blocked')
  return popup
}

function createHandle(
  mode: FloatingWindowMode,
  targetWindow: Window,
  container: HTMLElement,
  limitation: string | null,
  styleTransfer: StyleTransferResult,
): FloatingTimerWindow {
  const listeners = new Set<() => void>()
  let closeNotified = false

  const notifyClose = () => {
    if (closeNotified) return
    closeNotified = true
    listeners.forEach((listener) => listener())
    listeners.clear()
  }

  targetWindow.addEventListener('pagehide', notifyClose, { once: true })
  targetWindow.addEventListener('unload', notifyClose, { once: true })

  return {
    mode,
    window: targetWindow,
    document: targetWindow.document,
    container,
    limitation,
    styleTransfer,
    isClosed: () => targetWindow.closed,
    focus: () => targetWindow.focus(),
    close: () => {
      targetWindow.close()
      notifyClose()
    },
    onClose: (listener) => {
      if (closeNotified || targetWindow.closed) {
        listener()
        return () => undefined
      }
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

/**
 * Opens a true always-on-top Document PiP window when supported. The popup fallback is
 * deliberately honest: it is a normal browser window and cannot guarantee always-on-top.
 */
export async function openFloatingTimerWindow(
  options: OpenFloatingTimerOptions = {},
): Promise<FloatingTimerWindow> {
  const ownerWindow = resolveWindow(options.ownerWindow)
  const width = Math.max(160, Math.round(options.width ?? DEFAULT_WIDTH))
  const height = Math.max(120, Math.round(options.height ?? DEFAULT_HEIGHT))
  const title = options.title ?? 'Моя смена — мини-таймер'
  const containerId = options.containerId ?? DEFAULT_CONTAINER_ID
  const copyStyles = options.copyStyles ?? true
  const fallback = options.fallback ?? 'popup'
  const api = options.forcePopup ? null : getDocumentPictureInPictureApi(ownerWindow)

  let targetWindow: Window
  let mode: FloatingWindowMode
  let limitation: string | null = null

  if (api) {
    if (options.reuseExisting !== false && api.window && !api.window.closed) {
      targetWindow = api.window
      mode = 'document-picture-in-picture'
    } else {
      try {
        targetWindow = await requestDocumentPictureInPictureWindow(ownerWindow, {
          width,
          height,
          preferInitialWindowPlacement: true,
        })
        mode = 'document-picture-in-picture'
      } catch (error) {
        if (!options.fallbackOnRequestFailure || fallback === 'error') throw error
        targetWindow = openFallbackPopup(
          ownerWindow,
          options.popupName ?? 'moya-smena-mini-timer',
          width,
          height,
        )
        mode = 'popup'
        limitation = `${classifyRequestError(error).message} Открыто обычное компактное окно; оно не гарантирует режим поверх других программ.`
      }
    }
  } else {
    if (fallback === 'error') throw new FloatingWindowError('unsupported')
    targetWindow = openFallbackPopup(
      ownerWindow,
      options.popupName ?? 'moya-smena-mini-timer',
      width,
      height,
    )
    mode = 'popup'
    limitation = options.forcePopup
      ? 'Document Picture-in-Picture не открылся с первой попытки. Открыто обычное компактное окно; оно не гарантирует режим поверх других программ.'
      : FALLBACK_LIMITATION
  }

  const prepared = prepareDocument(
    targetWindow,
    ownerWindow.document,
    mode,
    { title, containerId, copyStyles },
    limitation,
  )
  targetWindow.focus()

  return createHandle(
    mode,
    targetWindow,
    prepared.container,
    limitation,
    prepared.styleTransfer,
  )
}

export function getFloatingWindowErrorMessage(error: unknown): string {
  return classifyRequestError(error).message
}
