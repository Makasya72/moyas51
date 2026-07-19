import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  FloatingWindowError,
  copyDocumentStyles,
  getDocumentPictureInPictureApi,
  isDocumentPictureInPictureSupported,
  openFloatingTimerWindow,
  requestDocumentPictureInPictureWindow,
  type DocumentPictureInPictureApi,
} from '../pictureInPicture'

function installApi(api: DocumentPictureInPictureApi | undefined): void {
  Object.defineProperty(window, 'documentPictureInPicture', {
    configurable: true,
    value: api,
  })
}

afterEach(() => {
  Reflect.deleteProperty(window, 'documentPictureInPicture')
  vi.restoreAllMocks()
})

describe('Document Picture-in-Picture feature detection', () => {
  it('returns false when the capability is absent, regardless of the browser identity', () => {
    expect(isDocumentPictureInPictureSupported(window)).toBe(false)
    expect(getDocumentPictureInPictureApi(window)).toBeNull()
  })

  it('returns true only when requestWindow is callable', () => {
    installApi({ window: null, requestWindow: vi.fn() })
    expect(isDocumentPictureInPictureSupported(window)).toBe(true)

    installApi({ window: null, requestWindow: null } as unknown as DocumentPictureInPictureApi)
    expect(isDocumentPictureInPictureSupported(window)).toBe(false)
  })
})

describe('Document Picture-in-Picture opening', () => {
  it('passes the requested dimensions to the native API', async () => {
    const childWindow = {} as Window
    const requestWindow = vi.fn().mockResolvedValue(childWindow)
    installApi({ window: null, requestWindow })

    await expect(
      requestDocumentPictureInPictureWindow(window, { width: 420, height: 520 }),
    ).resolves.toBe(childWindow)
    expect(requestWindow).toHaveBeenCalledWith({ width: 420, height: 520 })
  })

  it('maps a browser permission rejection to a stable application error', async () => {
    const browserError = new DOMException('blocked by policy', 'NotAllowedError')
    installApi({ window: null, requestWindow: vi.fn().mockRejectedValue(browserError) })

    await expect(requestDocumentPictureInPictureWindow(window)).rejects.toEqual(
      expect.objectContaining<Partial<FloatingWindowError>>({ code: 'permission-denied' }),
    )
  })

  it('maps a disabled API rejection to an unsupported error', async () => {
    const browserError = new DOMException('disabled by browser settings', 'NotSupportedError')
    installApi({ window: null, requestWindow: vi.fn().mockRejectedValue(browserError) })

    await expect(requestDocumentPictureInPictureWindow(window)).rejects.toEqual(
      expect.objectContaining<Partial<FloatingWindowError>>({ code: 'unsupported' }),
    )
  })

  it('prepares a mount container and transfers application styles', async () => {
    const targetDocument = document.implementation.createHTMLDocument('Mini timer')
    const childWindow = {
      document: targetDocument,
      closed: false,
      addEventListener: vi.fn(),
      close: vi.fn(),
      focus: vi.fn(),
    } as unknown as Window
    installApi({ window: null, requestWindow: vi.fn().mockResolvedValue(childWindow) })

    const style = document.createElement('style')
    style.textContent = '.timer-test-style { color: rgb(1, 2, 3); }'
    document.head.append(style)

    const floating = await openFloatingTimerWindow({ ownerWindow: window })

    expect(floating.mode).toBe('document-picture-in-picture')
    expect(floating.container.id).toBe('moya-smena-mini-timer')
    expect(targetDocument.head.textContent).toContain('.timer-test-style')
    expect(floating.styleTransfer.copiedNodes).toBeGreaterThan(0)
    style.remove()
  })

  it('opens the popup synchronously on a dedicated retry instead of calling PiP again', async () => {
    const targetDocument = document.implementation.createHTMLDocument('Fallback timer')
    const childWindow = {
      document: targetDocument,
      closed: false,
      addEventListener: vi.fn(),
      close: vi.fn(),
      focus: vi.fn(),
    } as unknown as Window
    const requestWindow = vi.fn()
    installApi({ window: null, requestWindow })
    vi.spyOn(window, 'open').mockReturnValue(childWindow)

    const floating = await openFloatingTimerWindow({ ownerWindow: window, forcePopup: true })

    expect(requestWindow).not.toHaveBeenCalled()
    expect(window.open).toHaveBeenCalledOnce()
    expect(floating.mode).toBe('popup')
    expect(floating.limitation).toContain('не гарантирует режим поверх других программ')
  })
})

describe('style transfer', () => {
  it('copies inline style sheets into a separate document', () => {
    const source = document.implementation.createHTMLDocument('Source')
    const target = document.implementation.createHTMLDocument('Target')
    const style = source.createElement('style')
    style.textContent = ':root { --accent: #ffe045; }'
    source.head.append(style)

    const result = copyDocumentStyles(source, target)

    expect(result.copiedNodes).toBe(1)
    expect(target.head.textContent).toContain('--accent')
  })
})
