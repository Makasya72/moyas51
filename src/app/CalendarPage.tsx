import { useEffect, useMemo, useState } from 'react'
import { boSubunitsToBo, calculateEarningsFromBo, calculateShiftMetrics, createEmptyEarnings, createEmptySupportMetrics, HOUR_MS, MINUTE_MS } from '../domain'
import type { AppSettings, BreakType, Shift, ShiftBreak } from '../domain'
import { Dialog } from '../ui/Dialog'
import { Icon } from '../ui/Icon'
import {
  formatClock,
  formatBo,
  formatDate,
  formatDuration,
  formatMoney,
  formatMonth,
  fromLocalDateTimeInput,
  monthGrid,
  sameLocalDay,
  toLocalDateTimeInput,
} from '../ui/format'

interface CalendarPageProps {
  shifts: Shift[]
  settings: AppSettings
  focusShiftId?: string | null
  onSave: (shift: Shift) => Promise<Shift>
  onDelete: (id: string) => Promise<void>
  notify: (title: string, description?: string) => void
}

interface PauseDraft {
  id: string
  type: BreakType
  startedAt: string
  endedAt: string
  plannedMinutes: number
}

interface ShiftDraft {
  id: string
  mode: 'planned' | 'completed'
  originalStatus: Shift['status'] | null
  startAt: string
  endAt: string
  plannedHours: number
  extendByBreaks: boolean
  baseBo: string
  legacyBaseKopecks: number
  boRateKopecks: number
  bonusRubles: string
  deductionRubles: string
  note: string
  breaks: PauseDraft[]
  handledRequests: string
  chats: string
  calls: string
  qualityScore: string
  averageResponseMinutes: string
  complexCases: string
  learningNote: string
  summaryNote: string
  createdAt: number
}

function uid(prefix: string): string {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`
}

function newDraft(day: number, settings: AppSettings, mode: ShiftDraft['mode']): ShiftDraft {
  const start = new Date(day)
  start.setHours(9, 0, 0, 0)
  const end = new Date(start.getTime() + settings.standardShiftDurationMs)
  return {
    id: uid('shift'), mode, originalStatus: null,
    startAt: toLocalDateTimeInput(start.getTime()),
    endAt: mode === 'completed' ? toLocalDateTimeInput(end.getTime()) : '',
    plannedHours: settings.standardShiftDurationMs / HOUR_MS,
    extendByBreaks: settings.extendShiftByBreaks,
    baseBo: '', legacyBaseKopecks: 0, boRateKopecks: 80, bonusRubles: '', deductionRubles: '', note: '', breaks: [],
    handledRequests: '', chats: '', calls: '', qualityScore: '', averageResponseMinutes: '', complexCases: '', learningNote: '', summaryNote: '',
    createdAt: Date.now(),
  }
}

function draftFromShift(shift: Shift): ShiftDraft {
  return {
    id: shift.id,
    mode: shift.status === 'planned' ? 'planned' : 'completed',
    originalStatus: shift.status,
    startAt: toLocalDateTimeInput(shift.startedAt ?? shift.plannedStartAt),
    endAt: toLocalDateTimeInput(shift.endedAt),
    plannedHours: shift.plannedDurationMs / HOUR_MS,
    extendByBreaks: shift.extendByBreaks,
    baseBo: shift.earnings.baseBoSubunits === null ? '' : String(boSubunitsToBo(shift.earnings.baseBoSubunits)),
    legacyBaseKopecks: shift.earnings.baseBoSubunits === null ? shift.earnings.baseKopecks : 0,
    boRateKopecks: shift.earnings.boRateKopecks,
    bonusRubles: shift.earnings.bonusKopecks ? String(shift.earnings.bonusKopecks / 100) : '',
    deductionRubles: shift.earnings.deductionKopecks ? String(shift.earnings.deductionKopecks / 100) : '',
    note: shift.note,
    breaks: shift.breaks.map((pause) => ({ id: pause.id, type: pause.type, startedAt: toLocalDateTimeInput(pause.startedAt), endedAt: toLocalDateTimeInput(pause.endedAt), plannedMinutes: pause.plannedDurationMs / MINUTE_MS })),
    handledRequests: shift.support?.handledRequests === null || shift.support?.handledRequests === undefined ? '' : String(shift.support.handledRequests),
    chats: shift.support?.chats === null || shift.support?.chats === undefined ? '' : String(shift.support.chats),
    calls: shift.support?.calls === null || shift.support?.calls === undefined ? '' : String(shift.support.calls),
    qualityScore: shift.support?.qualityScore === null || shift.support?.qualityScore === undefined ? '' : String(shift.support.qualityScore),
    averageResponseMinutes: shift.support?.averageResponseTimeMs === null || shift.support?.averageResponseTimeMs === undefined ? '' : String(shift.support.averageResponseTimeMs / MINUTE_MS),
    complexCases: shift.support?.complexCases === null || shift.support?.complexCases === undefined ? '' : String(shift.support.complexCases),
    learningNote: shift.support?.learningNote ?? '', summaryNote: shift.support?.summaryNote ?? '',
    createdAt: shift.createdAt,
  }
}

function shiftFromDraft(draft: ShiftDraft, settings: AppSettings): Shift {
  const startAt = fromLocalDateTimeInput(draft.startAt)
  if (startAt === null) throw new Error('Укажите корректное время начала')
  if (!Number.isFinite(draft.plannedHours) || draft.plannedHours <= 0) throw new Error('Плановая длительность должна быть больше нуля')
  const plannedDurationMs = Math.round(draft.plannedHours * HOUR_MS)
  const decimal = (value: string) => Number(value.replace(',', '.')) || 0
  const rubles = (value: string) => Math.round(Math.max(0, decimal(value)) * 100)

  if (draft.mode === 'planned') {
    return {
      id: draft.id, status: 'planned', activity: 'not_started', plannedStartAt: startAt,
      startedAt: null, plannedDurationMs, plannedEndAt: startAt + plannedDurationMs, endedAt: null,
      extendByBreaks: draft.extendByBreaks, breaks: [], earnings: createEmptyEarnings(), support: null,
      note: draft.note, createdAt: draft.createdAt, updatedAt: Date.now(),
    }
  }

  const endedAt = fromLocalDateTimeInput(draft.endAt)
  if (endedAt === null || endedAt <= startAt) throw new Error('Окончание должно быть позже начала')
  const pauses: ShiftBreak[] = draft.breaks.map((pause) => {
    const pauseStart = fromLocalDateTimeInput(pause.startedAt)
    const pauseEnd = fromLocalDateTimeInput(pause.endedAt)
    if (pauseStart === null || pauseEnd === null || pauseEnd <= pauseStart || pauseStart < startAt || pauseEnd > endedAt) throw new Error('Проверьте время перерывов: они должны находиться внутри смены')
    const planned = Math.round(pause.plannedMinutes * MINUTE_MS)
    const actual = pauseEnd - pauseStart
    return { id: pause.id, type: pause.type, startedAt: pauseStart, plannedDurationMs: planned, plannedEndAt: pauseStart + planned, endedAt: pauseEnd, actualDurationMs: actual, overtimeMs: Math.max(0, actual - planned) }
  })
  const support = settings.supportMetricsEnabled ? {
    ...createEmptySupportMetrics(),
    handledRequests: draft.handledRequests === '' ? null : Number(draft.handledRequests),
    chats: draft.chats === '' ? null : Number(draft.chats),
    calls: draft.calls === '' ? null : Number(draft.calls),
    qualityScore: draft.qualityScore === '' ? null : Number(draft.qualityScore),
    averageResponseTimeMs: draft.averageResponseMinutes === '' ? null : Math.round(Number(draft.averageResponseMinutes) * MINUTE_MS),
    complexCases: draft.complexCases === '' ? null : Number(draft.complexCases),
    learningNote: draft.learningNote,
    summaryNote: draft.summaryNote,
  } : null
  return {
    id: draft.id, status: 'completed', activity: 'completed', plannedStartAt: startAt, startedAt: startAt,
    plannedDurationMs, plannedEndAt: startAt + plannedDurationMs, endedAt,
    extendByBreaks: draft.extendByBreaks, breaks: pauses,
    earnings: calculateEarningsFromBo(
      draft.baseBo.trim() === '' ? null : Math.max(0, decimal(draft.baseBo)),
      rubles(draft.bonusRubles),
      rubles(draft.deductionRubles),
      {
        fallbackBaseKopecks: draft.legacyBaseKopecks,
        boRateKopecks: draft.boRateKopecks,
      },
    ),
    support, note: draft.note, createdAt: draft.createdAt, updatedAt: Date.now(),
  }
}

function ShiftEditor({ draft, settings, onChange, onClose, onSave }: { draft: ShiftDraft | null; settings: AppSettings; onChange: (draft: ShiftDraft) => void; onClose: () => void; onSave: () => void }) {
  if (!draft) return null
  const set = <K extends keyof ShiftDraft>(key: K, value: ShiftDraft[K]) => onChange({ ...draft, [key]: value })
  const addPause = () => {
    const shiftStart = fromLocalDateTimeInput(draft.startAt) ?? Date.now()
    const start = shiftStart + 2 * HOUR_MS
    set('breaks', [...draft.breaks, { id: uid('break'), type: 'break', startedAt: toLocalDateTimeInput(start), endedAt: toLocalDateTimeInput(start + settings.standardBreakDurationMs), plannedMinutes: settings.standardBreakDurationMs / MINUTE_MS }])
  }
  const updatePause = (index: number, patch: Partial<PauseDraft>) => set('breaks', draft.breaks.map((pause, pauseIndex) => pauseIndex === index ? { ...pause, ...patch } : pause))
  const estimated = draft.mode === 'completed' ? (() => { try { return shiftFromDraft(draft, settings) } catch { return null } })() : null
  const enteredBo = draft.baseBo.trim() === '' ? null : Math.max(0, Number(draft.baseBo.replace(',', '.')) || 0)

  return (
    <Dialog open wide title={draft.originalStatus ? 'Редактировать смену' : draft.mode === 'planned' ? 'Запланировать смену' : 'Добавить смену'} description="Все изменения сразу попадут в календарь, финансы и статистику." onClose={onClose} footer={<><button className="button button--secondary" type="button" onClick={onClose}>Отмена</button><button className="button button--primary" type="button" onClick={onSave}>Сохранить</button></>}>
      <div className="form-grid">
        <div className="field field--wide"><span className="field-label">Тип записи</span><div className="segmented"><button type="button" aria-pressed={draft.mode === 'planned'} onClick={() => set('mode', 'planned')}>Запланированная</button><button type="button" aria-pressed={draft.mode === 'completed'} onClick={() => set('mode', 'completed')}>Завершённая</button></div></div>
        <div className="field"><label htmlFor="edit-start">{draft.mode === 'planned' ? 'Плановое начало' : 'Фактическое начало'}</label><input id="edit-start" type="datetime-local" step="1" value={draft.startAt} onChange={(event) => set('startAt', event.target.value)} /></div>
        {draft.mode === 'completed' && <div className="field"><label htmlFor="edit-end">Фактическое окончание</label><input id="edit-end" type="datetime-local" step="1" value={draft.endAt} onChange={(event) => set('endAt', event.target.value)} /></div>}
        <div className="field"><label htmlFor="edit-duration">Плановая длительность, ч</label><input id="edit-duration" type="number" min="0.5" max="36" step="0.5" value={draft.plannedHours} onChange={(event) => set('plannedHours', Number(event.target.value))} /></div>
        <div className="field"><span className="field-label">Продление</span><label className="switch-row"><span className="switch-copy"><strong>Продлевать на перерывы</strong><span>По фактической длительности</span></span><span className="switch"><input type="checkbox" checked={draft.extendByBreaks} onChange={(event) => set('extendByBreaks', event.target.checked)} /><span /></span></label></div>
      </div>
      {draft.mode === 'completed' && <>
        <div className="section-title" style={{ marginTop: 24 }}><h3>Перерывы и обед</h3><button className="button button--secondary button--small" type="button" onClick={addPause}><Icon name="plus" />Добавить</button></div>
        {draft.breaks.length === 0 ? <div className="notice">Перерывы не указаны. Добавьте пропущенный перерыв при необходимости.</div> : <div className="break-list">{draft.breaks.map((pause, index) => <div className="card card-pad" key={pause.id}>
          <div className="form-grid">
            <div className="field"><label>Тип</label><select value={pause.type} onChange={(event) => updatePause(index, { type: event.target.value as BreakType })}><option value="break">Перерыв</option><option value="lunch">Обед</option></select></div>
            <div className="field"><label>План, мин</label><input type="number" min="1" value={pause.plannedMinutes} onChange={(event) => updatePause(index, { plannedMinutes: Number(event.target.value) })} /></div>
            <div className="field"><label>Начало</label><input type="datetime-local" step="1" value={pause.startedAt} onChange={(event) => updatePause(index, { startedAt: event.target.value })} /></div>
            <div className="field"><label>Окончание</label><input type="datetime-local" step="1" value={pause.endedAt} onChange={(event) => updatePause(index, { endedAt: event.target.value })} /></div>
          </div>
          <button className="button button--ghost button--small" style={{ marginTop: 10 }} type="button" onClick={() => set('breaks', draft.breaks.filter((_, pauseIndex) => pauseIndex !== index))}><Icon name="trash" />Удалить перерыв</button>
        </div>)}</div>}
        <div className="form-grid" style={{ marginTop: 24 }}>
          <div className="field"><label htmlFor="edit-base">Количество БО за смену</label><input id="edit-base" type="number" min="0" step="0.01" inputMode="decimal" value={draft.baseBo} onChange={(event) => set('baseBo', event.target.value)} placeholder="Например, 350" /><span className="field-help">1 БО = 0,80 ₽</span></div>
          <div className="field"><span className="field-label">{enteredBo === null && draft.legacyBaseKopecks > 0 ? 'Ранее указанная сумма' : 'Начислено за БО'}</span><div className="input"><strong>{enteredBo === null && draft.legacyBaseKopecks === 0 ? '—' : estimated ? formatMoney(estimated.earnings.baseKopecks) : '—'}</strong></div><span className="field-help">{enteredBo === null ? (draft.legacyBaseKopecks > 0 ? 'Старая сумма сохранена до ввода БО' : 'БО пока не указаны') : `${formatBo(enteredBo)} × 0,80 ₽`}</span></div>
          <div className="field"><label htmlFor="edit-bonus">Премия / доплата, ₽</label><input id="edit-bonus" type="number" min="0" step="0.01" inputMode="decimal" value={draft.bonusRubles} onChange={(event) => set('bonusRubles', event.target.value)} /></div>
          <div className="field"><label htmlFor="edit-deduction">Удержание, ₽</label><input id="edit-deduction" type="number" min="0" step="0.01" inputMode="decimal" value={draft.deductionRubles} onChange={(event) => set('deductionRubles', event.target.value)} /></div>
          <div className="field"><span className="field-label">Итоговый заработок</span><div className="input"><strong>{estimated ? formatMoney(estimated.earnings.totalKopecks) : '—'}</strong></div><span className="field-help">Начисление за БО + премия − удержание</span></div>
          {settings.supportMetricsEnabled && <>
            <div className="field"><label>Обращений</label><input type="number" min="0" value={draft.handledRequests} onChange={(event) => set('handledRequests', event.target.value)} /></div>
            <div className="field"><label>Чатов</label><input type="number" min="0" value={draft.chats} onChange={(event) => set('chats', event.target.value)} /></div>
            <div className="field"><label>Звонков</label><input type="number" min="0" value={draft.calls} onChange={(event) => set('calls', event.target.value)} /></div>
            <div className="field"><label>Оценка качества</label><input type="number" min="0" max="100" step="0.1" value={draft.qualityScore} onChange={(event) => set('qualityScore', event.target.value)} /></div>
            <div className="field"><label>Среднее время ответа, минут</label><input type="number" min="0" step="0.1" value={draft.averageResponseMinutes} onChange={(event) => set('averageResponseMinutes', event.target.value)} /></div>
            <div className="field"><label>Сложных случаев</label><input type="number" min="0" value={draft.complexCases} onChange={(event) => set('complexCases', event.target.value)} /></div>
            <div className="field field--wide"><label>Что повторить или изучить</label><textarea value={draft.learningNote} onChange={(event) => set('learningNote', event.target.value)} /></div>
            <div className="field field--wide"><label>Общий итог работы</label><textarea value={draft.summaryNote} onChange={(event) => set('summaryNote', event.target.value)} /></div>
            <div className="privacy-banner field--wide"><Icon name="info" /><strong>Не сохраняйте здесь персональные данные клиентов и содержимое обращений.</strong></div>
          </>}
        </div>
        {estimated && <div className="summary-grid" style={{ marginTop: 20 }}><div className="summary-item"><span>Всего</span><strong>{formatDuration(calculateShiftMetrics(estimated).elapsedMs)}</strong></div><div className="summary-item"><span>Чистая работа</span><strong>{formatDuration(calculateShiftMetrics(estimated).netWorkMs)}</strong></div><div className="summary-item"><span>{calculateShiftMetrics(estimated).overtimeMs ? 'Переработка' : 'Недоработка'}</span><strong>{formatDuration(calculateShiftMetrics(estimated).overtimeMs || calculateShiftMetrics(estimated).undertimeMs)}</strong></div></div>}
      </>}
      <div className="field" style={{ marginTop: 20 }}><label htmlFor="edit-note">Заметка</label><textarea id="edit-note" value={draft.note} onChange={(event) => set('note', event.target.value)} /></div>
    </Dialog>
  )
}

export function CalendarPage({ shifts, settings, focusShiftId, onSave, onDelete, notify }: CalendarPageProps) {
  const [anchor, setAnchor] = useState(() => { const date = new Date(); date.setDate(1); return date.getTime() })
  const [selectedDay, setSelectedDay] = useState<number | null>(null)
  const [draft, setDraft] = useState<ShiftDraft | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Shift | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!focusShiftId) return
    const shift = shifts.find((candidate) => candidate.id === focusShiftId)
    const timestamp = shift?.startedAt ?? shift?.plannedStartAt
    if (!shift || timestamp == null) return
    const date = new Date(timestamp)
    setAnchor(new Date(date.getFullYear(), date.getMonth(), 1).getTime())
    setSelectedDay(timestamp)
  }, [focusShiftId, shifts])

  const days = useMemo(() => monthGrid(anchor), [anchor])
  const month = new Date(anchor).getMonth()
  const dayShifts = selectedDay === null ? [] : shifts.filter((shift) => {
    const timestamp = shift.startedAt ?? shift.plannedStartAt
    return timestamp !== null && sameLocalDay(timestamp, selectedDay)
  })
  const moveMonth = (offset: number) => { const date = new Date(anchor); date.setMonth(date.getMonth() + offset); setAnchor(date.getTime()) }
  const saveDraft = async () => {
    if (!draft) return
    try {
      const saved = await onSave(shiftFromDraft(draft, settings))
      setDraft(null); setSelectedDay(saved.startedAt ?? saved.plannedStartAt); setError(null)
      notify(saved.status === 'planned' ? 'Смена запланирована' : 'Смена сохранена', 'Календарь и статистика пересчитаны.')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось сохранить смену') }
  }

  return (
    <section className="page" aria-labelledby="calendar-title">
      <header className="page-header"><div><p className="eyebrow">История и планы</p><h1 id="calendar-title">Календарь</h1><p>Исправляйте прошлые смены и планируйте будущие.</p></div><button className="button button--primary" type="button" onClick={() => setDraft(newDraft(Date.now(), settings, 'planned'))}><Icon name="plus" />Запланировать смену</button></header>
      <div className="card card-pad">
        <div className="calendar-toolbar"><button className="button button--secondary button--small" type="button" onClick={() => { const now = new Date(); setAnchor(new Date(now.getFullYear(), now.getMonth(), 1).getTime()) }}>Сегодня</button><div className="calendar-heading"><button className="icon-button" type="button" onClick={() => moveMonth(-1)} aria-label="Предыдущий месяц"><Icon name="chevron-left" /></button><h2>{formatMonth(anchor)}</h2><button className="icon-button" type="button" onClick={() => moveMonth(1)} aria-label="Следующий месяц"><Icon name="chevron-right" /></button></div><span className="muted">{shifts.filter((shift) => { const time = shift.startedAt ?? shift.plannedStartAt; return time !== null && new Date(time).getMonth() === month }).length} записей</span></div>
        <div className="calendar-grid" role="grid" aria-label={formatMonth(anchor)}>
          {['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map((weekday) => <div className="calendar-weekday" role="columnheader" key={weekday}>{weekday}</div>)}
          {days.map((day) => {
            const entries = shifts.filter((shift) => { const timestamp = shift.startedAt ?? shift.plannedStartAt; return timestamp !== null && sameLocalDay(timestamp, day) })
            const dailyMoney = entries.reduce((total, shift) => total + shift.earnings.totalKopecks, 0)
            return <button type="button" role="gridcell" key={day} className={`calendar-day ${new Date(day).getMonth() !== month ? 'calendar-day--outside' : ''} ${sameLocalDay(day, Date.now()) ? 'calendar-day--today' : ''}`} onClick={() => setSelectedDay(day)} aria-label={`${formatDate(day)}, ${entries.length} смен`}><span className="day-number">{new Date(day).getDate()}</span><span className="day-events">{entries.slice(0, 2).map((shift) => { const metrics = calculateShiftMetrics(shift); return <span key={shift.id} className={`day-event day-event--${shift.status === 'active' ? 'active' : shift.status === 'planned' ? 'planned' : metrics.overtimeMs > 0 ? 'overtime' : 'complete'}`}>{shift.status === 'planned' ? 'План' : shift.status === 'active' ? 'Идёт смена' : formatDuration(metrics.elapsedMs).slice(0,5)}</span> })}</span>{dailyMoney !== 0 && <span className="day-money">{formatMoney(dailyMoney)}</span>}</button>
          })}
        </div>
        <div className="calendar-legend"><span><i className="legend-dot legend-dot--planned" />Запланирована</span><span><i className="legend-dot legend-dot--active" />Активна</span><span><i className="legend-dot legend-dot--complete" />Завершена</span><span><i className="legend-dot" />Без смен</span></div>
      </div>

      <Dialog open={selectedDay !== null && draft === null} title={selectedDay ? formatDate(selectedDay) : 'День'} description={dayShifts.length ? `${dayShifts.length} записей за день` : 'В этот день пока нет смен'} onClose={() => setSelectedDay(null)} footer={<><button className="button button--secondary" type="button" onClick={() => selectedDay && setDraft(newDraft(selectedDay, settings, 'completed'))}>Добавить прошедшую</button><button className="button button--primary" type="button" onClick={() => selectedDay && setDraft(newDraft(selectedDay, settings, 'planned'))}>Запланировать</button></>}>
        {dayShifts.length === 0 ? <div className="empty-state" style={{ minHeight: 180 }}><div><div className="empty-state-icon"><Icon name="calendar" /></div><h3>Свободный день</h3><p>Добавьте смену вручную или запланируйте будущую.</p></div></div> : <div className="break-list">{dayShifts.map((shift) => { const metrics = calculateShiftMetrics(shift); return <div className="break-row" key={shift.id}><div><strong>{shift.status === 'planned' ? 'Запланированная смена' : shift.status === 'active' ? 'Активная смена' : 'Завершённая смена'}</strong><span>{formatClock(shift.startedAt ?? shift.plannedStartAt, settings.use24HourTime)}{shift.endedAt ? ` — ${formatClock(shift.endedAt, settings.use24HourTime)}` : ''} · {formatDuration(shift.status === 'planned' ? shift.plannedDurationMs : metrics.elapsedMs)}</span></div><div><strong>{formatMoney(shift.earnings.totalKopecks)}</strong><span className="muted">{shift.earnings.baseBoSubunits === null ? 'БО не указаны' : `${formatBo(boSubunitsToBo(shift.earnings.baseBoSubunits))} → ${formatMoney(shift.earnings.baseKopecks)}`}</span></div><div>{shift.status === 'active' ? <span className="status-pill status-pill--active">Редактируется на экране смены</span> : <><button className="icon-button" type="button" onClick={() => setDraft(draftFromShift(shift))} aria-label="Редактировать смену"><Icon name="edit" /></button><button className="icon-button" type="button" onClick={() => setDeleteTarget(shift)} aria-label="Удалить смену"><Icon name="trash" /></button></>}</div></div> })}</div>}
      </Dialog>

      {error && <div className="toast-region"><div className="toast"><Icon name="info" /><div><strong>Проверьте данные</strong><span>{error}</span></div></div></div>}
      <ShiftEditor draft={draft} settings={settings} onChange={(next) => { setDraft(next); setError(null) }} onClose={() => { setDraft(null); setError(null) }} onSave={() => void saveDraft()} />
      <Dialog open={deleteTarget !== null} danger title="Удалить запись?" description="Это действие нельзя отменить. Перед удалением при необходимости создайте резервную копию." onClose={() => setDeleteTarget(null)} footer={<><button className="button button--secondary" type="button" onClick={() => setDeleteTarget(null)}>Отмена</button><button className="button button--danger" type="button" onClick={() => { if (!deleteTarget) return; void onDelete(deleteTarget.id).then(() => { setDeleteTarget(null); notify('Запись удалена'); }).catch((reason: unknown) => notify('Не удалось удалить запись', reason instanceof Error ? reason.message : undefined)) }}>Удалить</button></>}><div className="notice notice--danger">Смена за {deleteTarget ? formatDate(deleteTarget.startedAt ?? deleteTarget.plannedStartAt ?? deleteTarget.createdAt) : ''} будет удалена из календаря, статистики и финансов.</div></Dialog>
    </section>
  )
}
