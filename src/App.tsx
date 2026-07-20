import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { getTimerSnapshot } from './domain'
import type { Shift } from './domain'
import {
  capturePwaInstallPrompt,
  deliverUserAlert,
  getNotificationCapability,
  getPwaCapability,
  LocalSoundPlayer,
  openFloatingTimerWindow,
  registerLocalServiceWorker,
  requestNotificationPermission,
  type FloatingTimerWindow,
  type PwaInstallController,
} from './platform'
import { AboutPage } from './app/AboutPage'
import { CalendarPage } from './app/CalendarPage'
import { MiniTimer } from './app/MiniTimer'
import { SettingsPage } from './app/SettingsPage'
import { ShiftPage } from './app/ShiftPage'
import { StatisticsPage } from './app/StatisticsPage'
import type { AppPage, ToastMessage } from './app/types'
import { useAppController } from './app/useAppController'
import { Icon, type IconName } from './ui/Icon'
import { downloadText, formatClock, formatDateLong } from './ui/format'

const MINUTE = 60_000

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

function Toasts({ messages }: { messages: ToastMessage[] }) {
  return <div className="toast-region" role="status" aria-live="polite">{messages.map((message) => <div className="toast" key={message.id}><Icon name={message.tone === 'danger' ? 'info' : 'check'} /><div><strong>{message.title}</strong>{message.description && <span>{message.description}</span>}</div></div>)}</div>
}

export function App() {
  const controller = useAppController()
  const [page, setPage] = useState<AppPage>(initialPage)
  const [calendarFocus, setCalendarFocus] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())
  const [toasts, setToasts] = useState<ToastMessage[]>([])
  const [floating, setFloating] = useState<FloatingTimerWindow | null>(null)
  const [notificationPermission, setNotificationPermission] = useState(getNotificationCapability().permission)
  const [canInstallPwa, setCanInstallPwa] = useState(false)
  const [updateReady, setUpdateReady] = useState<(() => boolean) | null>(null)
  const installController = useRef<PwaInstallController | null>(null)
  const soundPlayer = useRef<LocalSoundPlayer | null>(null)
  const remindersSent = useRef(new Set<string>())
  const forcePopupNext = useRef(false)

  const notify = useCallback((title: string, description?: string, tone: ToastMessage['tone'] = 'success') => {
    const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
    setToasts((current) => [...current.slice(-3), { id, title, description, tone }])
    window.setTimeout(() => setToasts((current) => current.filter((message) => message.id !== id)), 5200)
  }, [])

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
        onOfflineReady: () => notify('Приложение готово к работе офлайн'),
        onError: () => notify('Не удалось включить офлайн-режим', 'Основные данные по-прежнему доступны в этой вкладке.', 'warning'),
      }).then((registration) => { if (disposed) registration.dispose(); else disposeServiceWorker = registration.dispose }).catch(() => undefined)
    }
    return () => { disposed = true; disposeServiceWorker?.(); installController.current?.dispose() }
  }, [notify])

  const inAppAlert = useCallback((notification: { title: string; body: string }) => notify(notification.title, notification.body, 'warning'), [notify])

  useEffect(() => {
    const shift = controller.activeShift
    if (!shift || !controller.settings.preliminaryReminders) return
    const snapshot = getTimerSnapshot(shift, now)
    let alert: { key: string; title: string; body: string; sound: 'reminder' | 'warning' } | null = null
    if (snapshot.activeBreak) {
      const pause = snapshot.activeBreak
      if (pause.overtimeMs > 0) {
        alert = { key: `${pause.breakId}:overdue`, title: 'Пора вернуться к работе', body: `${pause.type === 'lunch' ? 'Обед' : 'Перерыв'} уже закончился.`, sound: 'warning' }
      } else {
        const lead = [...controller.settings.notificationLeadMinutes].sort((a,b) => a-b).find((minutes) => pause.remainingMs <= minutes * MINUTE)
        if (lead !== undefined) alert = { key: `${pause.breakId}:lead:${lead}`, title: `${pause.type === 'lunch' ? 'Обед' : 'Перерыв'} заканчивается`, body: `До возвращения ${lead} ${lead === 1 ? 'минута' : 'минут'}.`, sound: 'reminder' }
      }
    } else if (snapshot.remainingMs === 0) {
      alert = { key: `${shift.id}:shift-ended`, title: 'Плановое время смены закончилось', body: 'Завершите смену, чтобы сохранить результат.', sound: 'warning' }
    }
    if (!alert || remindersSent.current.has(alert.key)) return
    remindersSent.current.add(alert.key)
    if (controller.settings.systemNotifications) {
      void deliverUserAlert({ title: alert.title, body: alert.body, tag: alert.key }, { sound: controller.settings.soundEnabled ? alert.sound : false, volume: controller.settings.soundVolume, inAppFallback: inAppAlert }).catch(() => inAppAlert({ title: alert.title, body: alert.body }))
    } else {
      inAppAlert({ title: alert.title, body: alert.body })
      if (controller.settings.soundEnabled) void (soundPlayer.current ??= new LocalSoundPlayer()).play(alert.sound, controller.settings.soundVolume).catch(() => undefined)
    }
  }, [controller.activeShift, controller.settings, now, inAppAlert])

  const lastCompleted = useMemo(() => controller.shifts.find((shift) => shift.status === 'completed') ?? null, [controller.shifts])
  const floatingShift: Shift | null = controller.activeShift ?? lastCompleted

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
        <div className="topbar"><div className="topbar-time"><strong>{formatClock(now, controller.settings.use24HourTime)}</strong><span>{formatDateLong(now)}</span></div><div className="topbar-actions">{controller.activeShift && <span className="status-pill status-pill--active">Смена идёт</span>}{updateReady && <button className="button button--primary button--small" type="button" onClick={() => updateReady()}>Обновить приложение</button>}<button className="icon-button" type="button" onClick={() => setPage('settings')} aria-label="Открыть настройки"><Icon name={controller.settings.theme === 'dark' ? 'moon' : 'sun'} /></button></div></div>
        {controller.error && <div className="notice notice--danger" style={{ margin: '18px auto 0', width: 'min(1060px, calc(100% - 32px))' }}>{controller.error}</div>}
        {page === 'shift' && <ShiftPage activeShift={controller.activeShift} lastShift={lastCompleted} settings={controller.settings} now={now} busy={controller.busy} onStartShift={controller.startShift} onStartBreak={controller.startBreak} onResumeWork={controller.resumeWork} onFinishShift={controller.finishShift} onSaveShift={controller.saveShift} onOpenFloating={() => void openFloating()} onOpenCalendar={openCalendar} notify={notify} />}
        {page === 'calendar' && <CalendarPage shifts={controller.shifts} settings={controller.settings} focusShiftId={calendarFocus} onSave={controller.saveShift} onDelete={controller.deleteShift} notify={notify} />}
        {page === 'statistics' && <StatisticsPage shifts={controller.shifts} settings={controller.settings} onOpenShift={() => setPage('shift')} />}
        {page === 'settings' && <SettingsPage settings={controller.settings} notificationPermission={notificationPermission} pwaCapability={getPwaCapability()} canInstallPwa={canInstallPwa} onInstallPwa={async () => { const outcome = await installController.current?.prompt(); if (outcome === 'accepted') notify('Приложение установлено') }} onSave={controller.updateSettings} onRequestNotifications={async () => { const capability = await requestNotificationPermission(); setNotificationPermission(capability.permission); notify(capability.permission === 'granted' ? 'Уведомления разрешены' : 'Уведомления не разрешены', capability.permission === 'denied' ? 'Изменить разрешение можно в настройках браузера.' : undefined, capability.permission === 'granted' ? 'success' : 'warning') }} onTestNotification={async () => { await deliverUserAlert({ title: 'Моя смена', body: 'Тестовое уведомление работает.', tag: 'moya-smena-test' }, { sound: false, inAppFallback: inAppAlert }); setNotificationPermission(getNotificationCapability().permission) }} onTestSound={async () => { const played = await (soundPlayer.current ??= new LocalSoundPlayer()).play('success', controller.settings.soundVolume); notify(played ? 'Звуковой сигнал работает' : 'Браузер не разрешил звук', played ? undefined : 'Нажмите ещё раз или проверьте системную громкость.', played ? 'success' : 'warning') }} onExportBackup={async () => downloadText(`moya-smena-backup-${new Date().toISOString().slice(0,10)}.json`, await controller.exportBackup(), 'application/json;charset=utf-8')} onExportCsv={async () => downloadText(`moya-smena-${new Date().toISOString().slice(0,10)}.csv`, `\uFEFF${await controller.exportCsv()}`, 'text/csv;charset=utf-8')} onPreviewImport={controller.previewImport} onImport={controller.importBackup} onClearAll={controller.clearAllData} notify={notify} />}
        {page === 'about' && <AboutPage />}
      </main>
    </div>
    <Toasts messages={toasts} />
    {floating && floatingShift && !floating.isClosed() && createPortal(<MiniTimer shift={floatingShift} now={now} settings={controller.settings} />, floating.container)}
  </>
}
