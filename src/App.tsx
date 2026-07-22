import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { getTimerSnapshot } from './domain'
import type { Shift } from './domain'
import {
  capturePwaInstallPrompt,
  getPwaCapability,
  openFloatingTimerWindow,
  registerLocalServiceWorker,
  type FloatingTimerWindow,
  type PwaInstallController,
} from './platform'
import { AboutPage } from './app/AboutPage'
import { CalendarPage } from './app/CalendarPage'
import { MiniTimer } from './app/MiniTimer'
import { SettingsPage } from './app/SettingsPage'
import { ShiftPage } from './app/ShiftPage'
import { StatisticsPage } from './app/StatisticsPage'
import type { AppPage } from './app/types'
import { useAppController } from './app/useAppController'
import { Icon, type IconName } from './ui/Icon'
import { downloadText, formatClock, formatDateLong } from './ui/format'

const NAVIGATION: { id: AppPage; label: string; icon: IconName }[] = [
  { id: 'shift', label: 'Смена', icon: 'timer' },
  { id: 'calendar', label: 'Календарь', icon: 'calendar' },
  { id: 'statistics', label: 'Статистика', icon: 'chart' },
  { id: 'settings', label: 'Настройки', icon: 'settings' },
  { id: 'about', label: 'О приложении', icon: 'info' },
]

function initialPage(): AppPage {
  const requested = new URLSearchParams(window.location.search).get('section')
  return NAVIGATION.some((item) => item.id === requested) ? requested as AppPage : 'shift'
}

function serviceWorkerScriptUrl(): string {
  const entry = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/"]')
  const buildId = entry?.src ? new URL(entry.src).pathname.split('/').pop() : 'local'
  return `/sw.js?v=${encodeURIComponent(buildId ?? 'local')}`
}

export function App() {
  const controller = useAppController()
  const [page, setPage] = useState<AppPage>(initialPage)
  const [calendarFocus, setCalendarFocus] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())
  const [floating, setFloating] = useState<FloatingTimerWindow | null>(null)
  const [canInstallPwa, setCanInstallPwa] = useState(false)
  const [updateReady, setUpdateReady] = useState<(() => boolean) | null>(null)
  const installController = useRef<PwaInstallController | null>(null)
  const forcePopupNext = useRef(false)

  const notify = useCallback((_title: string, _description?: string, _tone?: 'success' | 'warning' | 'danger') => undefined, [])

  useEffect(() => {
    const update = () => setNow(Date.now())
    const interval = window.setInterval(update, 1000)
    document.addEventListener('visibilitychange', update)
    window.addEventListener('focus', update)
    return () => { window.clearInterval(interval); document.removeEventListener('visibilitychange', update); window.removeEventListener('focus', update) }
  }, [])

  useEffect(() => {
    if (controller.settings.theme === 'system') document.documentElement.removeAttribute('data-theme')
    else document.documentElement.dataset.theme = controller.settings.theme
  }, [controller.settings.theme])

  useEffect(() => {
    installController.current = capturePwaInstallPrompt(setCanInstallPwa)
    let disposed = false
    let disposeServiceWorker: (() => void) | null = null
    if (import.meta.env.PROD) {
      void registerLocalServiceWorker({
        scriptUrl: serviceWorkerScriptUrl(),
        onUpdateReady: (_registration, activate) => { if (!disposed) setUpdateReady(() => activate) },
      }).then((registration) => { if (disposed) registration.dispose(); else disposeServiceWorker = registration.dispose }).catch(() => undefined)
    }
    return () => { disposed = true; disposeServiceWorker?.(); installController.current?.dispose() }
  }, [notify])

  const lastCompleted = useMemo(() => controller.shifts.find((shift) => shift.status === 'completed') ?? null, [controller.shifts])
  const floatingShift: Shift | null = controller.activeShift ?? lastCompleted
  const activeShiftStatus = getTimerSnapshot(controller.activeShift, now).status

  const openFloating = useCallback(async () => {
    if (!controller.activeShift) return
    try {
      if (floating && !floating.isClosed()) { floating.focus(); return }
      const opened = await openFloatingTimerWindow({ fallback: 'popup', fallbackOnRequestFailure: true, forcePopup: forcePopupNext.current, width: 160, height: 160 })
      forcePopupNext.current = false
      opened.onClose(() => setFloating(null))
      setFloating(opened)
      notify(opened.mode === 'document-picture-in-picture' ? 'Мини-таймер открыт поверх окон' : 'Открыто компактное окно', opened.limitation ?? 'Оно будет синхронизироваться с основной сменой.', opened.mode === 'popup' ? 'warning' : 'success')
    } catch (reason) {
      forcePopupNext.current = true
      notify('Не удалось открыть мини-таймер', `${reason instanceof Error ? reason.message : 'Проверьте разрешения браузера.'} Повторите нажатие: следующая попытка откроет обычное окно.`, 'danger')
    }
  }, [controller.activeShift, floating, notify])

  const openCalendar = (shift: Shift) => { setCalendarFocus(shift.id); setPage('calendar') }

  if (controller.loading) return <div className="loading-screen"><div className="loading-card"><div className="loading-mark"><Icon name="timer" width="28" /></div><strong>Восстанавливаем смены</strong><p>Данные загружаются из локального хранилища…</p></div></div>

  if (controller.error && controller.shifts.length === 0) return <div className="loading-screen"><div className="card card-pad" style={{ maxWidth: 520 }}><div className="notice notice--danger"><strong>Локальное хранилище временно недоступно</strong><br />{controller.error}</div><button className="button button--primary" style={{ marginTop: 16 }} type="button" onClick={() => void controller.reload().catch(() => undefined)}>Повторить</button></div></div>

  return <>
    <a className="skip-link" href="#main-content">К основному содержимому</a>
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark"><Icon name="timer" /></span><span className="brand-copy"><strong>Моя смена</strong><span>Личный трекер</span></span></div>
        <nav className="nav-list" aria-label="Основные разделы">{NAVIGATION.map((item) => <button className="nav-button" type="button" key={item.id} aria-current={page === item.id ? 'page' : undefined} onClick={() => setPage(item.id)}><Icon name={item.icon} /><span>{item.label}</span></button>)}</nav>
        <div className="sidebar-foot"><p className="privacy-note">Все данные хранятся локально в вашем браузере.</p></div>
      </aside>
      <main className="app-main" id="main-content">
        <div className="topbar"><div className="topbar-time"><strong>{formatClock(now, controller.settings.use24HourTime)}</strong><span>{formatDateLong(now)}</span></div><div className="topbar-actions">{controller.activeShift && <span className={`status-pill ${activeShiftStatus === 'not_started' ? '' : 'status-pill--active'}`}>{activeShiftStatus === 'not_started' ? 'Смена запланирована' : 'Смена идёт'}</span>}{updateReady && <button className="button button--primary button--small" type="button" onClick={() => updateReady()}>Обновить приложение</button>}<button className="icon-button" type="button" onClick={() => setPage('settings')} aria-label="Открыть настройки"><Icon name={controller.settings.theme === 'dark' ? 'moon' : 'sun'} /></button></div></div>
        {controller.error && <div className="notice notice--danger" style={{ margin: '18px auto 0', width: 'min(1060px, calc(100% - 32px))' }}>{controller.error}</div>}
        {page === 'shift' && <ShiftPage activeShift={controller.activeShift} lastShift={lastCompleted} settings={controller.settings} now={now} busy={controller.busy} onStartShift={controller.startShift} onStartBreak={controller.startBreak} onResumeWork={controller.resumeWork} onFinishShift={controller.finishShift} onSaveShift={controller.saveShift} onOpenFloating={() => void openFloating()} onOpenCalendar={openCalendar} notify={notify} />}
        {page === 'calendar' && <CalendarPage shifts={controller.shifts} settings={controller.settings} focusShiftId={calendarFocus} onSave={controller.saveShift} onDelete={controller.deleteShift} notify={notify} />}
        {page === 'statistics' && <StatisticsPage shifts={controller.shifts} settings={controller.settings} onOpenShift={() => setPage('shift')} />}
        {page === 'settings' && <SettingsPage settings={controller.settings} pwaCapability={getPwaCapability()} canInstallPwa={canInstallPwa} onInstallPwa={async () => { await installController.current?.prompt() }} onSave={controller.updateSettings} onExportBackup={async () => downloadText(`moya-smena-backup-${new Date().toISOString().slice(0,10)}.json`, await controller.exportBackup(), 'application/json;charset=utf-8')} onExportCsv={async () => downloadText(`moya-smena-${new Date().toISOString().slice(0,10)}.csv`, `\uFEFF${await controller.exportCsv()}`, 'text/csv;charset=utf-8')} onPreviewImport={controller.previewImport} onImport={controller.importBackup} onClearAll={controller.clearAllData} notify={notify} />}
        {page === 'about' && <AboutPage />}
      </main>
    </div>
    {floating && floatingShift && !floating.isClosed() && createPortal(<MiniTimer shift={floatingShift} now={now} />, floating.container)}
  </>
}
