import { useMemo, useState } from 'react'
import { BO_RATE_SUBKOPECKS, boSubunitsToBo, calculateStatistics, groupStatistics } from '../domain'
import type { AppSettings, DateRange, Shift } from '../domain'
import { Icon } from '../ui/Icon'
import { formatBo, formatBoRate, formatDate, formatDuration, formatHours, formatMoney, fromLocalDateTimeInput, toDateInput } from '../ui/format'

type Period = 'today' | 'week' | 'month' | 'quarter' | 'year' | 'all' | 'custom'

interface StatisticsPageProps {
  shifts: Shift[]
  settings: AppSettings
  onOpenShift: () => void
}

function periodRange(period: Period, customStart: string, customEnd: string): DateRange | undefined {
  if (period === 'all') return undefined
  if (period === 'custom') {
    const start = fromLocalDateTimeInput(`${customStart}T00:00`)
    const endBase = fromLocalDateTimeInput(`${customEnd}T00:00`)
    if (start === null || endBase === null) return undefined
    const end = new Date(endBase)
    end.setDate(end.getDate() + 1)
    return { startAt: start, endAt: end.getTime() }
  }
  const now = new Date()
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  let start: Date
  if (period === 'today') start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  else if (period === 'week') {
    start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7))
  } else if (period === 'month') start = new Date(now.getFullYear(), now.getMonth(), 1)
  else if (period === 'quarter') start = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1)
  else start = new Date(now.getFullYear(), 0, 1)
  return { startAt: start.getTime(), endAt: end.getTime() }
}

export function StatisticsPage({ shifts, settings, onOpenShift }: StatisticsPageProps) {
  const [period, setPeriod] = useState<Period>('month')
  const now = Date.now()
  const [customStart, setCustomStart] = useState(toDateInput(new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime()))
  const [customEnd, setCustomEnd] = useState(toDateInput(now))
  const range = useMemo(() => periodRange(period, customStart, customEnd), [period, customStart, customEnd])
  const summary = useMemo(() => calculateStatistics(shifts, range, settings.monthlyGoalKopecks), [shifts, range, settings.monthlyGoalKopecks])
  const visible = useMemo(() => shifts.filter((shift) => {
    if (shift.status !== 'completed') return false
    if (!range) return true
    const time = shift.endedAt ?? shift.startedAt ?? 0
    return time >= range.startAt && time < range.endAt
  }), [shifts, range])
  const granularity = period === 'year' || period === 'all' ? 'month' : period === 'quarter' ? 'week' : 'day'
  const buckets = useMemo(() => groupStatistics(visible, granularity, settings.monthlyGoalKopecks), [visible, granularity, settings.monthlyGoalKopecks])
  const maxEarned = Math.max(1, ...buckets.map((bucket) => bucket.totalEarningsKopecks))
  const supportBuckets = buckets.filter((bucket) => bucket.support !== null)
  const maxRequests = Math.max(1, ...supportBuckets.map((bucket) => bucket.support?.totalHandledRequests ?? 0))
  const shiftsWithBo = visible.filter((shift) => shift.earnings.baseBoSubunits !== null)
  const totalBo = shiftsWithBo.reduce((total, shift) => total + boSubunitsToBo(shift.earnings.baseBoSubunits ?? 0), 0)
  const accruedFromBoKopecks = shiftsWithBo.reduce((total, shift) => total + shift.earnings.baseKopecks, 0)

  return (
    <section className="page" aria-labelledby="statistics-title">
      <header className="page-header"><div><p className="eyebrow">Аналитика без облака</p><h1 id="statistics-title">Статистика</h1><p>Рабочее время, паузы, заработок и личные показатели.</p></div><div className="segmented" aria-label="Период статистики">{([['today','Сегодня'],['week','Неделя'],['month','Месяц'],['quarter','Квартал'],['year','Год'],['all','Всё']] as [Period,string][]).map(([value,label]) => <button type="button" key={value} aria-pressed={period === value} onClick={() => setPeriod(value)}>{label}</button>)}</div></header>
      <div className="card card-pad" style={{ marginBottom: 18 }}>
        <div className="switch-row"><div className="switch-copy"><strong>Выбранный период</strong><span>{range ? `${formatDate(range.startAt)} — ${formatDate(range.endAt - 1)}` : 'За всё время'}</span></div><button className="button button--secondary button--small" type="button" onClick={() => setPeriod('custom')}>Свой период</button></div>
        {period === 'custom' && <div className="form-grid" style={{ marginTop: 14 }}><div className="field"><label htmlFor="stats-start">С</label><input id="stats-start" type="date" value={customStart} onChange={(event) => setCustomStart(event.target.value)} /></div><div className="field"><label htmlFor="stats-end">По</label><input id="stats-end" type="date" value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} /></div></div>}
      </div>

      {summary.shiftCount === 0 ? <div className="card empty-state"><div><div className="empty-state-icon"><Icon name="chart" /></div><h2>Статистика появится после первой смены</h2><p>Завершите смену или добавьте прошедшую запись через календарь. Демонстрационные данные приложение не создаёт.</p><button className="button button--primary" type="button" onClick={onOpenShift}>Перейти к смене</button></div></div> : <div className="section-stack">
        <div className="kpi-grid">
          <div className="card kpi"><span className="kpi-icon"><Icon name="calendar" /></span><span className="kpi-label">Завершено смен</span><div className="kpi-value">{summary.shiftCount}</div></div>
          <div className="card kpi"><span className="kpi-icon"><Icon name="timer" /></span><span className="kpi-label">Чистая работа</span><div className="kpi-value">{formatHours(summary.totalNetWorkMs)}</div></div>
          <div className="card kpi"><span className="kpi-icon"><Icon name="chart" /></span><span className="kpi-label">Итоговый заработок</span><div className="kpi-value">{formatMoney(summary.totalEarningsKopecks)}</div></div>
          <div className="card kpi"><span className="kpi-icon"><Icon name="timer" /></span><span className="kpi-label">Переработка</span><div className="kpi-value">{formatDuration(summary.totalOvertimeMs)}</div></div>
        </div>
        <div className="grid-2">
          <div className="card chart-card"><div className="section-title"><div><p className="eyebrow">Динамика</p><h2>Заработок</h2></div><strong>{formatMoney(summary.totalEarningsKopecks)}</strong></div><div className="bar-chart" role="img" aria-label="Заработок по периодам">{buckets.map((bucket) => <div className="bar-column" key={bucket.key} title={`${formatDate(bucket.startAt)}: ${formatMoney(bucket.totalEarningsKopecks)}`}><div className="bar" style={{ height: `${Math.max(2, bucket.totalEarningsKopecks / maxEarned * 100)}%` }} /><span>{granularity === 'month' ? new Intl.DateTimeFormat('ru-RU', { month: 'short' }).format(bucket.startAt) : formatDate(bucket.startAt).slice(0,5)}</span></div>)}</div></div>
          <div className="card chart-card"><div className="section-title"><div><p className="eyebrow">Баланс времени</p><h2>Состав смен</h2></div></div><div className="summary-grid"><div className="summary-item"><span>Всего на сменах</span><strong>{formatDuration(summary.totalElapsedMs, true)}</strong></div><div className="summary-item"><span>Чистая работа</span><strong>{formatDuration(summary.totalNetWorkMs, true)}</strong></div><div className="summary-item"><span>Обычные перерывы</span><strong>{formatDuration(summary.totalBreakMs, true)}</strong></div><div className="summary-item"><span>Обед</span><strong>{formatDuration(summary.totalLunchMs, true)}</strong></div><div className="summary-item"><span>Средняя смена</span><strong>{formatDuration(summary.averageShiftMs)}</strong></div><div className="summary-item"><span>Средний перерыв</span><strong>{formatDuration(summary.averagePauseMs)}</strong></div></div></div>
        </div>
        <div className="grid-2">
          <div className="card card-pad"><div className="section-title"><h2>Финансы</h2><span className="status-pill status-pill--success">Текущий курс: 1 БО = {formatBoRate(BO_RATE_SUBKOPECKS)}</span></div><div className="settings-list"><div className="switch-row"><div className="switch-copy"><strong>Всего БО</strong><span>Указаны в {shiftsWithBo.length} из {summary.shiftCount} смен</span></div><strong>{formatBo(totalBo)}</strong></div><div className="switch-row"><div className="switch-copy"><strong>Начислено за БО</strong><span>До премий и удержаний</span></div><strong>{formatMoney(accruedFromBoKopecks)}</strong></div><div className="switch-row"><div className="switch-copy"><strong>Среднее БО за смену</strong><span>Только по заполненным сменам</span></div><strong>{shiftsWithBo.length ? formatBo(totalBo / shiftsWithBo.length) : '—'}</strong></div><div className="switch-row"><div className="switch-copy"><strong>Средний итог за смену</strong><span>{summary.shiftCount} завершённых записей</span></div><strong>{formatMoney(summary.averageEarningsKopecks)}</strong></div><div className="switch-row"><div className="switch-copy"><strong>Итог за чистый час</strong><span>По фактическому рабочему времени</span></div><strong>{formatMoney(summary.averageEarningsPerNetHourKopecks)}</strong></div>{summary.financialGoalKopecks !== null && <div><div className="switch-row"><div className="switch-copy"><strong>Финансовая цель</strong><span>{formatMoney(summary.totalEarningsKopecks)} из {formatMoney(summary.financialGoalKopecks)}</span></div><strong>{Math.round((summary.financialGoalProgress ?? 0) * 100)}%</strong></div><div className="progress-track" style={{ background: 'var(--surface-muted)', marginTop: 8 }}><div className="progress-value" style={{ width: `${Math.min(100, (summary.financialGoalProgress ?? 0) * 100)}%` }} /></div></div>}</div></div>
          <div className="card card-pad"><div className="section-title"><h2>Рабочий ритм</h2></div><div className="settings-list"><div className="switch-row"><div className="switch-copy"><strong>Смен с переработкой</strong><span>За выбранный период</span></div><strong>{summary.overtimeShiftCount}</strong></div><div className="switch-row"><div className="switch-copy"><strong>Общая недоработка</strong><span>По завершённым сменам</span></div><strong>{formatDuration(summary.totalUndertimeMs)}</strong></div>{settings.supportMetricsEnabled && summary.support && <><div className="switch-row"><div className="switch-copy"><strong>Обращений за час</strong><span>По чистому рабочему времени</span></div><strong>{summary.support.requestsPerNetHour.toFixed(1)}</strong></div><div className="switch-row"><div className="switch-copy"><strong>Средняя оценка качества</strong><span>{summary.support.shiftsWithMetrics} смен с итогами</span></div><strong>{summary.support.averageQualityScore?.toFixed(1) ?? '—'}</strong></div></>}</div></div>
        </div>
        {settings.supportMetricsEnabled && summary.support && <div className="card chart-card"><div className="section-title"><div><p className="eyebrow">Личные показатели</p><h2>Динамика поддержки</h2></div><strong>{summary.support.totalHandledRequests} обращений</strong></div><div className="summary-grid"><div className="summary-item"><span>В среднем за смену</span><strong>{summary.support.averageRequestsPerShift.toFixed(1)}</strong></div><div className="summary-item"><span>За чистый час</span><strong>{summary.support.requestsPerNetHour.toFixed(1)}</strong></div><div className="summary-item"><span>Среднее качество</span><strong>{summary.support.averageQualityScore?.toFixed(1) ?? '—'}</strong></div><div className="summary-item"><span>Изменение качества</span><strong>{summary.support.qualityScoreChange === null ? '—' : `${summary.support.qualityScoreChange > 0 ? '+' : ''}${summary.support.qualityScoreChange.toFixed(1)}`}</strong></div><div className="summary-item"><span>Сложных случаев</span><strong>{summary.support.totalComplexCases}</strong></div></div>{supportBuckets.length > 0 && <div className="bar-chart" role="img" aria-label="Обращения по периодам" style={{ marginTop: 24 }}>{supportBuckets.map((bucket) => <div className="bar-column" key={`support-${bucket.key}`} title={`${formatDate(bucket.startAt)}: ${bucket.support?.totalHandledRequests ?? 0} обращений`}><div className="bar" style={{ height: `${Math.max(2, ((bucket.support?.totalHandledRequests ?? 0) / maxRequests) * 100)}%` }} /><span>{granularity === 'month' ? new Intl.DateTimeFormat('ru-RU', { month: 'short' }).format(bucket.startAt) : formatDate(bucket.startAt).slice(0,5)}</span></div>)}</div>}</div>}
      </div>}
    </section>
  )
}
