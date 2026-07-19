import { getTimerSnapshot } from '../domain'
import type { AppSettings, Shift } from '../domain'
import { Icon } from '../ui/Icon'
import { formatClock, formatDuration } from '../ui/format'

interface MiniTimerProps {
  shift: Shift
  now: number
  settings: AppSettings
  onResume: () => void
  onOpenMain: () => void
}

export function MiniTimer({ shift, now, settings, onResume, onOpenMain }: MiniTimerProps) {
  const snapshot = getTimerSnapshot(shift, now)
  const pause = snapshot.activeBreak
  const pauseOvertime = (pause?.overtimeMs ?? 0) > 0
  const completed = snapshot.status === 'completed'
  const label = completed
    ? 'Смена завершена'
    : pause
    ? pauseOvertime ? `${pause.type === 'lunch' ? 'Обед' : 'Перерыв'} превышен` : 'Вернуться через'
    : snapshot.status === 'overtime' ? 'Смена завершена по плану' : 'До конца смены'
  const value = completed
    ? snapshot.overtimeMs || snapshot.undertimeMs
    : pause
    ? pauseOvertime ? pause.overtimeMs : pause.remainingMs
    : snapshot.status === 'overtime' ? snapshot.overtimeMs : snapshot.remainingMs
  const status = completed ? 'Смена завершена' : pause ? pause.type === 'lunch' ? 'Обед' : 'Перерыв' : snapshot.status === 'overtime' ? 'Переработка' : 'Работа'

  return (
    <div className="mini-timer">
      <span className={`status-pill ${pauseOvertime ? 'status-pill--danger' : 'status-pill--active'}`}>{status}</span>
      <div className="mini-timer-main">
        <p className="timer-label">{label}</p>
        <div className={`timer-display ${pauseOvertime ? 'timer-display--danger' : ''}`}>{formatDuration(value)}</div>
        <p className="timer-subtitle">{completed ? `${snapshot.overtimeMs > 0 ? 'Переработка' : 'Недоработка'}: ${formatDuration(snapshot.overtimeMs || snapshot.undertimeMs)}` : pause ? `Вернуться в ${formatClock(pause.expectedReturnAt, settings.use24HourTime)}` : `Окончание в ${formatClock(snapshot.expectedEndAt, settings.use24HourTime)}`}</p>
        {pause && <p className="timer-subtitle">До конца смены: {formatDuration(snapshot.remainingMs)}</p>}
        <div className="progress-track"><div className="progress-value" style={{ width: `${Math.round(snapshot.progress * 100)}%` }} /></div>
        <div className="progress-copy"><span>{Math.round(snapshot.progress * 100)}% смены</span><span>{snapshot.overtimeMs > 0 ? `Переработка ${formatDuration(snapshot.overtimeMs)}` : ''}</span></div>
      </div>
      <div className="mini-actions">
        {pause && !completed && <button className="button button--primary" type="button" onClick={onResume}><Icon name="play" />К работе</button>}
        <button className="button button--secondary" type="button" onClick={onOpenMain}><Icon name="pip" />К сайту</button>
      </div>
    </div>
  )
}
