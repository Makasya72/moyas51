import { useEffect, useRef, useState } from 'react'
import { BO_RATE_SUBKOPECKS } from '../domain'
import type { AppSettings, ImportMode, ImportPreview } from '../domain'
import { isDocumentPictureInPictureSupported, type PwaCapability } from '../platform'
import { Dialog } from '../ui/Dialog'
import { Icon } from '../ui/Icon'
import { formatBoRate, formatDate, formatMoney } from '../ui/format'

interface SettingsPageProps {
  settings: AppSettings
  pwaCapability: PwaCapability
  canInstallPwa: boolean
  onInstallPwa: () => Promise<void>
  onSave: (settings: AppSettings) => Promise<void>
  onExportBackup: () => Promise<void>
  onExportCsv: () => Promise<void>
  onPreviewImport: (json: string) => ImportPreview
  onImport: (preview: ImportPreview, mode: ImportMode) => Promise<void>
  onClearAll: () => Promise<void>
  notify: (title: string, description?: string, tone?: 'success' | 'warning' | 'danger') => void
}

const MINUTE = 60_000
const HOUR = 3_600_000

function Switch({ checked, onChange, title, description }: { checked: boolean; onChange: (checked: boolean) => void; title: string; description: string }) {
  return <label className="switch-row"><span className="switch-copy"><strong>{title}</strong><span>{description}</span></span><span className="switch"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span /></span></label>
}

export function SettingsPage(props: SettingsPageProps) {
  const [draft, setDraft] = useState(props.settings)
  const [saving, setSaving] = useState(false)
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [clearOpen, setClearOpen] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const pipSupported = isDocumentPictureInPictureSupported()

  useEffect(() => setDraft(props.settings), [props.settings])
  const patch = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => setDraft((current) => ({ ...current, [key]: value }))
  const save = async () => {
    setSaving(true)
    try { await props.onSave(draft); props.notify('Настройки сохранены', 'Новые значения применены сразу.') }
    catch (reason) { props.notify('Не удалось сохранить настройки', reason instanceof Error ? reason.message : undefined, 'danger') }
    finally { setSaving(false) }
  }
  const runAction = async (action: () => Promise<void>, failureTitle: string) => {
    try { await action() }
    catch (reason) { props.notify(failureTitle, reason instanceof Error ? reason.message : undefined, 'danger') }
  }
  const parseDurations = (value: string) => [...new Set(value.split(',').map((item) => Number(item.trim())).filter((item) => Number.isFinite(item) && item > 0).map((item) => Math.round(item * MINUTE)))].sort((a,b) => a-b)
  const openImport = async (file: File | undefined) => {
    if (!file) return
    try { setImportPreview(props.onPreviewImport(await file.text())); setImportError(null) }
    catch (reason) { setImportPreview(null); setImportError(reason instanceof Error ? reason.message : 'Файл повреждён или имеет неверный формат') }
    if (fileRef.current) fileRef.current.value = ''
  }
  const runImport = async (mode: ImportMode) => {
    if (!importPreview) return
    await runAction(async () => {
      await props.onImport(importPreview, mode)
      setImportPreview(null)
      props.notify('Резервная копия восстановлена', mode === 'merge' ? 'Данные объединены без дублирования.' : 'Локальные данные заменены.')
    }, 'Не удалось восстановить резервную копию')
  }
  const clearAll = async () => runAction(async () => {
    await props.onClearAll()
    setClearOpen(false)
    props.notify('Локальные данные удалены')
  }, 'Не удалось удалить локальные данные')

  return (
    <section className="page" aria-labelledby="settings-title">
      <header className="page-header"><div><p className="eyebrow">Под ваши правила</p><h1 id="settings-title">Настройки</h1><p>Смена, внешний вид и локальные данные.</p></div><button className="button button--primary" type="button" disabled={saving} onClick={() => void save()}><Icon name="check" />{saving ? 'Сохраняем…' : 'Сохранить настройки'}</button></header>
      <div className="settings-grid">
        <div className="card settings-section"><div className="section-title"><div><p className="eyebrow">Рабочий день</p><h2>Смена и перерывы</h2></div><Icon name="timer" width="22" /></div><div className="settings-list">
          <div className="form-grid"><div className="field"><label htmlFor="setting-shift">Смена, часов</label><input id="setting-shift" type="number" min="1" max="36" step="0.5" value={draft.standardShiftDurationMs / HOUR} onChange={(event) => patch('standardShiftDurationMs', Number(event.target.value) * HOUR)} /></div><div className="field"><label htmlFor="setting-break">Перерыв, минут</label><input id="setting-break" type="number" min="1" max="240" value={draft.standardBreakDurationMs / MINUTE} onChange={(event) => patch('standardBreakDurationMs', Number(event.target.value) * MINUTE)} /></div><div className="field"><label htmlFor="setting-lunch">Обед, минут</label><input id="setting-lunch" type="number" min="1" max="240" value={draft.standardLunchDurationMs / MINUTE} onChange={(event) => patch('standardLunchDurationMs', Number(event.target.value) * MINUTE)} /></div></div>
          <div className="field"><label htmlFor="saved-breaks">Варианты перерыва, минут</label><input id="saved-breaks" defaultValue={draft.savedBreakDurationsMs.map((value) => value / MINUTE).join(', ')} onBlur={(event) => patch('savedBreakDurationsMs', parseDurations(event.target.value))} /><span className="field-help">Через запятую, например: 10, 15, 20</span></div>
          <div className="field"><label htmlFor="saved-lunches">Варианты обеда, минут</label><input id="saved-lunches" defaultValue={draft.savedLunchDurationsMs.map((value) => value / MINUTE).join(', ')} onBlur={(event) => patch('savedLunchDurationsMs', parseDurations(event.target.value))} /></div>
          <Switch checked={draft.extendShiftByBreaks} onChange={(value) => patch('extendShiftByBreaks', value)} title="Продлевать смену на перерывы" description="Окончание сдвигается на фактическую длительность пауз" />
          <Switch checked={draft.confirmShiftFinish} onChange={(value) => patch('confirmShiftFinish', value)} title="Подтверждать завершение" description="Защита от случайного нажатия" />
          <Switch checked={draft.offerMiniTimerOnShiftStart} onChange={(value) => patch('offerMiniTimerOnShiftStart', value)} title="Предлагать мини-таймер" description="После запуска новой смены" />
        </div></div>

        <div className="card settings-section"><div className="section-title"><div><p className="eyebrow">Интерфейс</p><h2>Внешний вид</h2></div><Icon name="sun" width="22" /></div><div className="settings-list">
          <div><span className="field-label">Тема</span><div className="segmented" style={{ marginTop: 8 }}><button type="button" aria-pressed={draft.theme === 'light'} onClick={() => patch('theme','light')}>Светлая</button><button type="button" aria-pressed={draft.theme === 'dark'} onClick={() => patch('theme','dark')}>Тёмная</button><button type="button" aria-pressed={draft.theme === 'system'} onClick={() => patch('theme','system')}>Системная</button></div></div>
          <Switch checked={draft.use24HourTime} onChange={(value) => patch('use24HourTime', value)} title="24-часовой формат" description="Например, 20:00 вместо 8:00 PM" />
          <div className="notice">Анимации автоматически отключаются, если в системе включено уменьшение движения.</div>
        </div></div>

        <div className="card settings-section"><div className="section-title"><div><p className="eyebrow">БО, рубли и показатели</p><h2>Финансы</h2></div><Icon name="chart" width="22" /></div><div className="settings-list">
          <div className="notice notice--success"><strong>Курс БО: 1 БО = {formatBoRate(BO_RATE_SUBKOPECKS)}</strong><br />Используется для расчёта основного начисления за смену.</div>
          <div className="field"><label htmlFor="hour-rate">Справочная почасовая ставка, ₽</label><input id="hour-rate" type="number" min="0" step="0.01" value={draft.hourlyRateKopecks === null ? '' : draft.hourlyRateKopecks / 100} onChange={(event) => patch('hourlyRateKopecks', event.target.value === '' ? null : Math.round(Number(event.target.value) * 100))} /><span className="field-help">Не заменяет расчёт по БО и используется только для сравнения.</span></div>
          <div className="field"><label htmlFor="month-goal">Финансовая цель на месяц, ₽</label><input id="month-goal" type="number" min="0" step="0.01" value={draft.monthlyGoalKopecks === null ? '' : draft.monthlyGoalKopecks / 100} onChange={(event) => patch('monthlyGoalKopecks', event.target.value === '' ? null : Math.round(Number(event.target.value) * 100))} />{draft.monthlyGoalKopecks !== null && <span className="field-help">Цель: {formatMoney(draft.monthlyGoalKopecks)}</span>}</div>
          <Switch checked={draft.supportMetricsEnabled} onChange={(value) => patch('supportMetricsEnabled', value)} title="Итоги работы поддержки" description="Обращения, чаты, звонки и оценка качества" />
          {draft.supportMetricsEnabled && <div className="privacy-banner"><Icon name="info" /><strong>Не сохраняйте здесь персональные данные клиентов и содержимое обращений.</strong></div>}
        </div></div>

        <div className="card settings-section settings-section--wide"><div className="section-title"><div><p className="eyebrow">Локальная работа</p><h2>Приложение и мини-таймер</h2></div><Icon name="pip" width="22" /></div><div className="grid-2">
          <div className={`notice ${pipSupported ? 'notice--success' : 'notice--warning'}`}><strong>{pipSupported ? 'Настоящий режим поверх окон доступен' : 'Доступно только обычное компактное окно'}</strong><br />{pipSupported ? 'Браузер предоставляет Document Picture-in-Picture.' : 'Обновите браузер. Запасное popup-окно может скрываться за другими программами.'}</div>
          <div className="notice"><strong>PWA: {props.pwaCapability.standalone ? 'установлено и запущено отдельно' : props.pwaCapability.serviceWorker ? 'поддерживается браузером' : 'недоступно'}</strong><br />Мини-таймер работает, пока открыт основной сайт или PWA.</div>
        </div>{props.canInstallPwa && <button className="button button--primary" style={{ marginTop: 16 }} type="button" onClick={() => void runAction(props.onInstallPwa, 'Не удалось установить приложение')}>Установить как приложение</button>}</div>

        <div className="card settings-section settings-section--wide"><div className="section-title"><div><p className="eyebrow">Резервная копия</p><h2>Локальные данные</h2></div><span className="status-pill status-pill--success">IndexedDB</span></div><p className="muted">Данные остаются в этом браузере и не передаются в интернет. Регулярно сохраняйте резервную копию.</p><div className="page-header-actions"><button className="button button--secondary" type="button" onClick={() => void runAction(props.onExportBackup, 'Не удалось экспортировать JSON')}><Icon name="download" />Экспорт JSON</button><button className="button button--secondary" type="button" onClick={() => void runAction(props.onExportCsv, 'Не удалось экспортировать CSV')}><Icon name="download" />Экспорт CSV</button><button className="button button--secondary" type="button" onClick={() => fileRef.current?.click()}><Icon name="upload" />Импорт JSON</button><input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(event) => void openImport(event.target.files?.[0])} /><button className="button button--ghost" type="button" onClick={() => setClearOpen(true)}><Icon name="trash" />Удалить все данные</button></div>{importError && <div className="notice notice--danger" style={{ marginTop: 16 }}>{importError}</div>}</div>
      </div>

      <Dialog open={importPreview !== null} title="Проверка резервной копии" description="Выберите безопасное объединение или полную замену текущих данных." onClose={() => setImportPreview(null)} footer={<><button className="button button--secondary" type="button" onClick={() => void runImport('merge')}>Объединить</button><button className="button button--danger" type="button" onClick={() => void runImport('replace')}>Заменить всё</button></>}>
        {importPreview && <><div className="summary-grid"><div className="summary-item"><span>Смен</span><strong>{importPreview.shiftCount}</strong></div><div className="summary-item"><span>Активных</span><strong>{importPreview.activeShiftCount}</strong></div><div className="summary-item"><span>Планов</span><strong>{importPreview.planCount}</strong></div><div className="summary-item"><span>Заработок</span><strong>{formatMoney(importPreview.totalEarningsKopecks)}</strong></div></div>{importPreview.dateRange && <div className="notice">Период данных: {formatDate(importPreview.dateRange.startAt)} — {formatDate(importPreview.dateRange.endAt)}</div>}{importPreview.warnings.length > 0 && <div className="notice notice--warning" style={{ marginTop: 12 }}>{importPreview.warnings.join(' ')}</div>}<div className="notice notice--danger" style={{ marginTop: 12 }}>«Заменить всё» удалит текущие записи перед восстановлением. Рекомендуем сначала экспортировать резервную копию.</div></>}
      </Dialog>
      <Dialog open={clearOpen} danger title="Удалить все локальные данные?" description="Смены, планы, настройки и заработок будут удалены из IndexedDB без возможности отмены." onClose={() => setClearOpen(false)} footer={<><button className="button button--secondary" type="button" onClick={() => setClearOpen(false)}>Отмена</button><button className="button button--danger" type="button" onClick={() => void clearAll()}>Удалить всё</button></>}><div className="notice notice--danger">Перед удалением сохраните JSON-резервную копию, если данные могут понадобиться.</div></Dialog>
    </section>
  )
}
