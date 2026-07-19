import { useEffect, useMemo, useState } from 'react'
import {
  calculateEarningsFromBo,
  calculateShiftMetrics,
  boSubunitsToBo,
  createEmptySupportMetrics,
  getTimerSnapshot,
} from '../domain'
import type { AppSettings, BreakType, Shift, SupportMetrics } from '../domain'
import { Dialog } from '../ui/Dialog'
import { Icon } from '../ui/Icon'
import { formatBo, formatBoRate, formatClock, formatDate, formatDateLong, formatDuration, formatMoney } from '../ui/format'

interface ShiftPageProps {
  activeShift: Shift | null
  lastShift: Shift | null
  settings: AppSettings
  now: number
  busy: boolean
  onStartShift: (durationMs: number) => Promise<Shift>
  onStartBreak: (type: BreakType, durationMs: number) => Promise<Shift>
  onResumeWork: () => Promise<Shift>
  onFinishShift: () => Promise<Shift>
  onSaveShift: (shift: Shift) => Promise<Shift>
  onOpenFloating: () => void
  onOpenCalendar: (shift: Shift) => void
  notify: (title: string, description?: string, tone?: 'success' | 'warning' | 'danger') => void
}

const HOUR = 3_600_000
const MINUTE = 60_000

const STATUS_LABELS = {
  not_started: 'Смена не начата',
  work: 'Работа',
  break: 'Перерыв',
  lunch: 'Обед',
  completed: 'Смена завершена',
  overtime: 'Переработка',
} as const

function Timeline({ shift, use24Hour }: { shift: Shift; use24Hour: boolean }) {
  const events = useMemo(() => {
    const result: { at: number; title: string; detail: string }[] = []
    if (shift.startedAt !== null) {
      result.push({ at: shift.startedAt, title: 'Смена начата', detail: 'Рабочее время' })
    }
    for (const pause of shift.breaks) {
      result.push({
        at: pause.startedAt,
        title: pause.type === 'lunch' ? 'Начат обед' : 'Начат перерыв',
        detail: `План: ${Math.round(pause.plannedDurationMs / MINUTE)} мин`,
      })
      if (pause.endedAt !== null) {
        result.push({
          at: pause.endedAt,
          title: 'Возвращение к работе',
          detail: pause.overtimeMs > 0 ? `Превышение ${formatDuration(pause.overtimeMs)}` : 'Вовремя',
        })
      }
    }
    if (shift.endedAt !== null) {
      result.push({ at: shift.endedAt, title: 'Смена завершена', detail: 'Результат сохранён' })
    }
    return result.sort((left, right) => right.at - left.at)
  }, [shift])

  return (
    <div className="timeline">
      {events.map((event, index) => (
        <div className="timeline-item" key={`${event.at}-${index}`}>
          <span className="timeline-dot" />
          <div className="timeline-copy"><strong>{event.title}</strong><span>{event.detail}</span></div>
          <time className="timeline-time">{formatClock(event.at, use24Hour)}</time>
        </div>
      ))}
    </div>
  )
}

function SummaryDialog({
  shift,
  settings,
  onClose,
  onSave,
}: {
  shift: Shift | null
  settings: AppSettings
  onClose: () => void
  onSave: (shift: Shift) => Promise<void>
}) {
  const [baseBo, setBaseBo] = useState('')
  const [bonusRubles, setBonusRubles] = useState('')
  const [deductionRubles, setDeductionRubles] = useState('')
  const [note, setNote] = useState('')
  const [support, setSupport] = useState<SupportMetrics>(createEmptySupportMetrics())
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    if (!shift) return
    setBaseBo(shift.earnings.baseBoSubunits === null ? '' : String(boSubunitsToBo(shift.earnings.baseBoSubunits)))
    setBonusRubles(shift.earnings.bonusKopecks ? String(shift.earnings.bonusKopecks / 100) : '')
    setDeductionRubles(shift.earnings.deductionKopecks ? String(shift.earnings.deductionKopecks / 100) : '')
    setNote(shift.note)
    setSupport(shift.support ?? createEmptySupportMetrics())
  }, [shift])

  if (!shift) return null
  const metrics = calculateShiftMetrics(shift)
  const decimalValue = (value: string) => Number(value.replace(',', '.')) || 0
  const baseBoValue = baseBo.trim() === '' ? null : Math.max(0, decimalValue(baseBo))
  const rublesToKopecks = (value: string) => Math.round(Math.max(0, decimalValue(value)) * 100)
  const earnings = calculateEarningsFromBo(
    baseBoValue,
    rublesToKopecks(bonusRubles),
    rublesToKopecks(deductionRubles),
    {
      fallbackBaseKopecks: shift.earnings.baseBoSubunits === null ? shift.earnings.baseKopecks : 0,
      boRateSubkopecks: shift.earnings.boRateSubkopecks,
    },
  )

  const boRateLabel = formatBoRate(shift.earnings.boRateSubkopecks)
  const save = async () => {
    setSaving(true)
    setSaveError(null)
    try {
      await onSave({
        ...shift,
        earnings,
        note,
        support: settings.supportMetricsEnabled ? support : null,
        updatedAt: Date.now(),
      })
    } catch (reason) {
      setSaveError(reason instanceof Error ? reason.message : 'Не удалось сохранить итог смены')
    } finally {
      setSaving(false)
    }
  }

  const setSupportNumber = (key: keyof SupportMetrics, value: string) => {
    setSupport((current) => ({ ...current, [key]: value === '' ? null : Number(value) }))
  }

  return (
    <Dialog
      open
      wide
      title="Итоги смены"
      description={`Укажите БО за смену — приложение пересчитает их по курсу 1 БО = ${boRateLabel}. Данные можно заполнить позже в календаре.`}
      onClose={onClose}
      footer={<><button className="button button--secondary" type="button" onClick={onClose}>Заполнить позже</button><button className="button button--primary" type="button" onClick={() => void save()} disabled={saving}>{saving ? 'Сохраняем…' : 'Сохранить итог'}</button></>}
    >
      <div className="summary-grid">
        <div className="summary-item"><span>Дата</span><strong>{formatDate(shift.startedAt ?? shift.createdAt)}</strong></div>
        <div className="summary-item"><span>Начало</span><strong>{formatClock(shift.startedAt, settings.use24HourTime)}</strong></div>
        <div className="summary-item"><span>Окончание</span><strong>{formatClock(shift.endedAt, settings.use24HourTime)}</strong></div>
        <div className="summary-item"><span>План</span><strong>{formatDuration(shift.plannedDurationMs)}</strong></div>
        <div className="summary-item"><span>Всего</span><strong>{formatDuration(metrics.elapsedMs)}</strong></div>
        <div className="summary-item"><span>Чистая работа</span><strong>{formatDuration(metrics.netWorkMs)}</strong></div>
        <div className="summary-item"><span>Обычные перерывы</span><strong>{formatDuration(metrics.breakMs)}</strong></div>
        <div className="summary-item"><span>Обед</span><strong>{formatDuration(metrics.lunchMs)}</strong></div>
        <div className="summary-item"><span>Количество пауз</span><strong>{metrics.breakCount + metrics.lunchCount}</strong></div>
        <div className="summary-item"><span>{metrics.overtimeMs > 0 ? 'Переработка' : 'Недоработка'}</span><strong>{formatDuration(metrics.overtimeMs || metrics.undertimeMs)}</strong></div>
      </div>
      {saveError && <div className="notice notice--danger" role="alert">{saveError}</div>}
      <div className="form-grid">
        <div className="field"><label htmlFor="summary-base">Количество БО за смену</label><input id="summary-base" type="number" min="0" step="0.01" inputMode="decimal" value={baseBo} onChange={(event) => setBaseBo(event.target.value)} placeholder="Например, 350" /><span className="field-help">1 БО = {boRateLabel}. Пустое поле можно заполнить позже.</span></div>
        <div className="field"><span className="field-label">{baseBoValue === null && shift.earnings.baseKopecks > 0 ? 'Ранее указанная сумма' : 'Начислено за БО'}</span><div className="input" aria-live="polite"><strong>{baseBoValue === null && earnings.baseKopecks === 0 ? '—' : formatMoney(earnings.baseKopecks)}</strong></div><span className="field-help">{baseBoValue === null ? (shift.earnings.baseKopecks > 0 ? 'Старая запись в рублях сохранена. Введите БО, чтобы заменить её.' : 'БО пока не указаны') : `${formatBo(baseBoValue)} × ${boRateLabel}`}</span></div>
        <div className="field"><label htmlFor="summary-bonus">Премия / доплата, ₽</label><input id="summary-bonus" type="number" min="0" step="0.01" inputMode="decimal" value={bonusRubles} onChange={(event) => setBonusRubles(event.target.value)} placeholder="0" /></div>
        <div className="field"><label htmlFor="summary-deduction">Удержание, ₽</label><input id="summary-deduction" type="number" min="0" step="0.01" inputMode="decimal" value={deductionRubles} onChange={(event) => setDeductionRubles(event.target.value)} placeholder="0" /></div>
        <div className="field"><span className="field-label">Итоговый заработок</span><div className="input" aria-live="polite"><strong>{formatMoney(earnings.totalKopecks)}</strong></div><span className="field-help">Начисление за БО + премия − удержание</span></div>
        {settings.supportMetricsEnabled && <>
          <div className="field"><label htmlFor="support-requests">Обработано обращений</label><input id="support-requests" type="number" min="0" value={support.handledRequests ?? ''} onChange={(event) => setSupportNumber('handledRequests', event.target.value)} /></div>
          <div className="field"><label htmlFor="support-chats">Чатов</label><input id="support-chats" type="number" min="0" value={support.chats ?? ''} onChange={(event) => setSupportNumber('chats', event.target.value)} /></div>
          <div className="field"><label htmlFor="support-calls">Звонков</label><input id="support-calls" type="number" min="0" value={support.calls ?? ''} onChange={(event) => setSupportNumber('calls', event.target.value)} /></div>
          <div className="field"><label htmlFor="support-quality">Оценка качества</label><input id="support-quality" type="number" min="0" max="100" step="0.1" value={support.qualityScore ?? ''} onChange={(event) => setSupportNumber('qualityScore', event.target.value)} /></div>
          <div className="field"><label htmlFor="support-response">Среднее время ответа, минут</label><input id="support-response" type="number" min="0" step="0.1" value={support.averageResponseTimeMs === null ? '' : support.averageResponseTimeMs / MINUTE} onChange={(event) => setSupport((current) => ({ ...current, averageResponseTimeMs: event.target.value === '' ? null : Math.round(Number(event.target.value) * MINUTE) }))} /></div>
          <div className="field"><label htmlFor="support-complex">Сложных случаев</label><input id="support-complex" type="number" min="0" value={support.complexCases ?? ''} onChange={(event) => setSupportNumber('complexCases', event.target.value)} /></div>
          <div className="field field--wide"><label htmlFor="support-learning">Что повторить или изучить</label><textarea id="support-learning" value={support.learningNote} onChange={(event) => setSupport((current) => ({ ...current, learningNote: event.target.value }))} /></div>
          <div className="field field--wide"><label htmlFor="support-summary">Общий итог работы</label><textarea id="support-summary" value={support.summaryNote} onChange={(event) => setSupport((current) => ({ ...current, summaryNote: event.target.value }))} /></div>
          <div className="privacy-banner field--wide"><Icon name="info" /><div><strong>Не сохраняйте здесь персональные данные клиентов и содержимое обращений.</strong></div></div>
        </>}
        <div className="field field--wide"><label htmlFor="summary-note">Заметка о смене</label><textarea id="summary-note" value={note} onChange={(event) => setNote(event.target.value)} /></div>
      </div>
    </Dialog>
  )
}

export function ShiftPage(props: ShiftPageProps) {
  const { activeShift, lastShift, settings, now, busy } = props
  const [durationHours, setDurationHours] = useState(settings.standardShiftDurationMs / HOUR)
  const [breakType, setBreakType] = useState<BreakType | null>(null)
  const [breakMinutes, setBreakMinutes] = useState(15)
  const [finishOpen, setFinishOpen] = useState(false)
  const [summaryShift, setSummaryShift] = useState<Shift | null>(null)
  const [offerFloating, setOfferFloating] = useState(false)

  useEffect(() => setDurationHours(settings.standardShiftDurationMs / HOUR), [settings.standardShiftDurationMs])
  useEffect(() => {
    if (!breakType) return
    setBreakMinutes((breakType === 'lunch' ? settings.standardLunchDurationMs : settings.standardBreakDurationMs) / MINUTE)
  }, [breakType, settings.standardBreakDurationMs, settings.standardLunchDurationMs])

  const snapshot = getTimerSnapshot(activeShift, now)
  const activeBreak = snapshot.activeBreak
  const breakOvertime = (activeBreak?.overtimeMs ?? 0) > 0
  const timerLabel = activeBreak
    ? breakOvertime
      ? `${activeBreak.type === 'lunch' ? 'Обед' : 'Перерыв'} превышен`
      : 'Вернуться через'
    : snapshot.status === 'overtime'
      ? 'Переработка'
      : activeShift
        ? 'До конца смены'
        : 'Готовы начать?'
  const timerValue = activeBreak
    ? breakOvertime ? activeBreak.overtimeMs : activeBreak.remainingMs
    : snapshot.status === 'overtime' ? snapshot.overtimeMs : activeShift ? snapshot.remainingMs : durationHours * HOUR

  const openBreak = (type: BreakType) => setBreakType(type)
  const startBreak = async () => {
    if (!breakType || breakMinutes <= 0) return
    try {
      await props.onStartBreak(breakType, Math.round(breakMinutes * MINUTE))
      setBreakType(null)
      props.notify(breakType === 'lunch' ? 'Обед начат' : 'Перерыв начат', `Вернуться в ${formatClock(Date.now() + breakMinutes * MINUTE, settings.use24HourTime)}`)
    } catch (reason) {
      props.notify('Не удалось начать перерыв', reason instanceof Error ? reason.message : undefined, 'danger')
    }
  }
  const finish = async () => {
    try {
      const completed = await props.onFinishShift()
      setFinishOpen(false)
      setSummaryShift(completed)
    } catch (reason) {
      props.notify('Не удалось завершить смену', reason instanceof Error ? reason.message : undefined, 'danger')
    }
  }
  const startShift = async () => {
    try {
      await props.onStartShift(durationHours * HOUR)
      props.notify('Смена начата', `Плановая длительность ${durationHours} ч.`)
      setOfferFloating(settings.offerMiniTimerOnShiftStart)
    } catch (reason) {
      props.notify('Не удалось начать смену', reason instanceof Error ? reason.message : undefined, 'danger')
    }
  }
  const resumeWork = async () => {
    try {
      await props.onResumeWork()
      props.notify('Вы вернулись к работе')
    } catch (reason) {
      props.notify('Не удалось завершить перерыв', reason instanceof Error ? reason.message : undefined, 'danger')
    }
  }

  return (
    <section className="page" aria-labelledby="shift-title">
      <header className="page-header">
        <div><p className="eyebrow">{formatDateLong(now)}</p><h1 id="shift-title">Моя смена</h1><p>Рабочее время, перерывы и важные цифры — в одном месте.</p></div>
        {activeShift && <button className="button button--primary" type="button" onClick={props.onOpenFloating}><Icon name="pip" />Показать поверх всех окон</button>}
      </header>

      {!activeShift ? (
        <div className="section-stack">
          <div className="card timer-card">
            <span className="status-pill">Смена не начата</span>
            <div className="timer-label">Плановая длительность</div>
            <div className="timer-display">{formatDuration(durationHours * HOUR)}</div>
            <p className="timer-subtitle">Если начать сейчас, окончание в {formatClock(now + durationHours * HOUR, settings.use24HourTime)}</p>
            <div className="progress-track"><div className="progress-value" style={{ width: '0%' }} /></div>
            <div className="progress-copy"><span>Начало</span><span>12 часов по умолчанию</span></div>
          </div>
          <div className="card start-panel">
            <div>
              <h2>Продолжительность смены</h2>
              <p className="muted">Можно изменить только для этой смены. Настройка по умолчанию останется прежней.</p>
              <div className="duration-picker" role="group" aria-label="Продолжительность смены">
                {[8, 10, 12].map((hours) => <button key={hours} type="button" className="duration-chip" aria-pressed={durationHours === hours} onClick={() => setDurationHours(hours)}>{hours} часов</button>)}
                <label className="field" style={{ width: 130 }}><span className="field-label">Другое, ч</span><input type="number" min="1" max="24" step="0.5" value={durationHours} onChange={(event) => setDurationHours(Number(event.target.value))} /></label>
              </div>
            </div>
            <button className="button button--primary" type="button" disabled={busy || durationHours <= 0} onClick={() => void startShift()}><Icon name="play" />{busy ? 'Запускаем…' : 'Начать смену'}</button>
          </div>
          {lastShift && <div className="card card-pad">
            <div className="section-title"><div><p className="eyebrow">Последняя смена</p><h2>{new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(lastShift.startedAt ?? lastShift.createdAt)}</h2></div><button className="button button--secondary button--small" type="button" onClick={() => props.onOpenCalendar(lastShift)}>Открыть в календаре</button></div>
            <div className="summary-grid">
              <div className="summary-item"><span>Чистая работа</span><strong>{formatDuration(calculateShiftMetrics(lastShift).netWorkMs)}</strong></div>
              <div className="summary-item"><span>Перерывы</span><strong>{formatDuration(calculateShiftMetrics(lastShift).totalPauseMs)}</strong></div>
              <div className="summary-item"><span>Итоговый заработок</span><strong>{formatMoney(lastShift.earnings.totalKopecks)}</strong>{lastShift.earnings.baseBoSubunits !== null && <span>{formatBo(boSubunitsToBo(lastShift.earnings.baseBoSubunits))} за смену</span>}</div>
            </div>
          </div>}
        </div>
      ) : (
        <div className="section-stack">
          <div className="timer-layout">
            <div className="card timer-card">
              <span className={`status-pill ${breakOvertime ? 'status-pill--danger' : 'status-pill--active'}`}>{STATUS_LABELS[snapshot.status]}</span>
              <div className="timer-label">{timerLabel}</div>
              <div className={`timer-display ${breakOvertime ? 'timer-display--danger' : ''}`} aria-label={`${timerLabel} ${formatDuration(timerValue)}`}>{formatDuration(timerValue)}</div>
              <p className="timer-subtitle">{activeBreak ? `Вернуться в ${formatClock(activeBreak.expectedReturnAt, settings.use24HourTime)} · До конца смены ${formatDuration(snapshot.remainingMs)}` : `Окончание в ${formatClock(snapshot.expectedEndAt, settings.use24HourTime)}`}</p>
              <div className="progress-track" aria-label={`Прогресс смены ${Math.round(snapshot.progress * 100)} процентов`}><div className="progress-value" style={{ width: `${Math.round(snapshot.progress * 100)}%` }} /></div>
              <div className="progress-copy"><span>{Math.round(snapshot.progress * 100)}% смены</span><span>{snapshot.progress >= .5 ? 'Половина смены позади' : 'В рабочем ритме'}</span></div>
            </div>
            <div className="side-cards">
              <div className="card time-metrics">
                <div className="metric"><span className="metric-label">Начало</span><div className="metric-value">{formatClock(activeShift.startedAt, settings.use24HourTime)}</div><span className="metric-caption">Фактическое</span></div>
                <div className="metric"><span className="metric-label">Окончание</span><div className="metric-value">{formatClock(snapshot.expectedEndAt, settings.use24HourTime)}</div><span className="metric-caption">Ожидаемое</span></div>
                <div className="metric"><span className="metric-label">Прошло</span><div className="metric-value">{formatDuration(snapshot.elapsedMs)}</div><span className="metric-caption">С начала</span></div>
                <div className="metric"><span className="metric-label">Чистая работа</span><div className="metric-value">{formatDuration(snapshot.netWorkMs)}</div><span className="metric-caption">Без пауз</span></div>
              </div>
              <div className="card action-card">
                <h3>Управление сменой</h3>
                <div className="action-grid">
                  {activeBreak ? <button className="button button--primary" type="button" disabled={busy} onClick={() => void resumeWork()}><Icon name="play" />Вернуться к работе</button> : <div className="action-row"><button className="button button--secondary" type="button" disabled={busy} onClick={() => openBreak('break')}><Icon name="coffee" />Перерыв</button><button className="button button--secondary" type="button" disabled={busy} onClick={() => openBreak('lunch')}><Icon name="lunch" />Обед</button></div>}
                  <button className="button button--ghost" type="button" onClick={props.onOpenFloating}><Icon name="pip" />Мини-таймер</button>
                  <button className="button button--ghost" type="button" disabled={busy} onClick={() => settings.confirmShiftFinish ? setFinishOpen(true) : void finish()}><Icon name="stop" />Завершить смену</button>
                </div>
              </div>
            </div>
          </div>
          <div className="card card-pad"><div className="section-title"><h2>Хронология</h2><span className="muted">{activeShift.breaks.length} пауз</span></div><Timeline shift={activeShift} use24Hour={settings.use24HourTime} /></div>
        </div>
      )}

      <Dialog open={breakType !== null} title={breakType === 'lunch' ? 'Начать обед' : 'Начать перерыв'} description="Выберите плановую длительность. Таймер продолжит считать превышение, если вы не вернётесь вовремя." onClose={() => setBreakType(null)} footer={<><button className="button button--secondary" type="button" onClick={() => setBreakType(null)}>Отмена</button><button className="button button--primary" type="button" disabled={busy || breakMinutes <= 0} onClick={() => void startBreak()}>Начать</button></>}>
        <div className="duration-picker">
          {(breakType === 'lunch' ? settings.savedLunchDurationsMs : settings.savedBreakDurationsMs).map((duration) => <button className="duration-chip" type="button" key={duration} aria-pressed={breakMinutes === duration / MINUTE} onClick={() => setBreakMinutes(duration / MINUTE)}>{duration / MINUTE} мин</button>)}
        </div>
        <div className="field" style={{ marginTop: 16 }}><label htmlFor="break-minutes">Длительность вручную, минут</label><input id="break-minutes" type="number" min="1" max="240" value={breakMinutes} onChange={(event) => setBreakMinutes(Number(event.target.value))} /><span className="field-help">Плановое возвращение: {formatClock(now + breakMinutes * MINUTE, settings.use24HourTime)}</span></div>
      </Dialog>

      <Dialog open={finishOpen} danger title="Завершить смену?" description={activeBreak ? 'Текущий перерыв будет завершён тем же временем.' : 'После подтверждения смена перейдёт в историю, а итог можно будет дополнить.'} onClose={() => setFinishOpen(false)} footer={<><button className="button button--secondary" type="button" onClick={() => setFinishOpen(false)}>Продолжить работу</button><button className="button button--danger" type="button" disabled={busy} onClick={() => void finish()}>{busy ? 'Сохраняем…' : 'Завершить смену'}</button></>}>
        {activeShift && <div className="summary-grid"><div className="summary-item"><span>Завершение</span><strong>{formatClock(now, settings.use24HourTime)}</strong></div><div className="summary-item"><span>Чистая работа</span><strong>{formatDuration(snapshot.netWorkMs)}</strong></div><div className="summary-item"><span>{snapshot.overtimeMs ? 'Переработка' : 'Недоработка'}</span><strong>{formatDuration(snapshot.overtimeMs || Math.max(0, activeShift.plannedDurationMs - snapshot.elapsedMs))}</strong></div></div>}
      </Dialog>

      <Dialog open={offerFloating} title="Смена начата" description="Открыть компактный таймер поверх рабочих окон? Он будет синхронизирован с основным сайтом." onClose={() => setOfferFloating(false)} footer={<><button className="button button--secondary" type="button" onClick={() => setOfferFloating(false)}>Не сейчас</button><button className="button button--primary" type="button" onClick={() => { setOfferFloating(false); props.onOpenFloating() }}><Icon name="pip" />Открыть мини-таймер</button></>}><div className="notice">Настоящий режим поверх программ работает только при поддержке Document Picture-in-Picture и пока основной сайт или PWA остаётся открытым.</div></Dialog>

      <SummaryDialog shift={summaryShift} settings={settings} onClose={() => setSummaryShift(null)} onSave={async (shift) => { await props.onSaveShift(shift); setSummaryShift(null); props.notify('Итоги сохранены', 'Календарь и статистика обновлены.') }} />
    </section>
  )
}
