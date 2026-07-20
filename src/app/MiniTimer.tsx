import { getTimerSnapshot } from '../domain'
import type { AppSettings, Shift } from '../domain'
import { formatClock, formatDuration } from '../ui/format'

interface MiniTimerProps {
  shift: Shift
  now: number
  settings: AppSettings
}

export function MiniTimer({ shift, now, settings }: MiniTimerProps) {
  const snapshot = getTimerSnapshot(shift, now)
  const pause = snapshot.activeBreak
  const pauseOvertime = (pause?.overtimeMs ?? 0) > 0
  const completed = snapshot.status === 'completed'
  const value = completed
    ? snapshot.overtimeMs || snapshot.undertimeMs
    : pause
    ? pauseOvertime ? pause.overtimeMs : pause.remainingMs
    : snapshot.status === 'overtime' ? snapshot.overtimeMs : snapshot.remainingMs

  return (
    <div className="mini-timer">
      <div className="mini-timer-main">
        <div className={`timer-display ${pauseOvertime ? 'timer-display--danger' : ''}`}>{formatDuration(value)}</div>
        <p className="timer-subtitle">Окончание в {formatClock(snapshot.expectedEndAt, settings.use24HourTime)}</p>
      </div>
    </div>
  )
}
