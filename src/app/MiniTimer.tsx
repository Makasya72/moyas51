import { getTimerSnapshot } from '../domain'
import type { Shift } from '../domain'
import { formatDuration } from '../ui/format'

interface MiniTimerProps {
  shift: Shift
  now: number
}

export function MiniTimer({ shift, now }: MiniTimerProps) {
  const snapshot = getTimerSnapshot(shift, now)
  const pause = snapshot.activeBreak
  const pauseOvertime = (pause?.overtimeMs ?? 0) > 0
  const value = snapshot.status === 'completed'
    ? snapshot.overtimeMs || snapshot.undertimeMs
    : pause
    ? pauseOvertime ? pause.overtimeMs : pause.remainingMs
    : snapshot.status === 'overtime' ? snapshot.overtimeMs : snapshot.remainingMs

  return (
    <div className="mini-timer">
      <div className="mini-timer-main">
        <div className={`timer-display ${pauseOvertime ? 'timer-display--danger' : ''}`}>{formatDuration(value)}</div>
        <p className="timer-subtitle">
          {pause
            ? pauseOvertime
              ? 'Пора вернуться к работе'
              : `До возвращения — ${formatDuration(pause.remainingMs)}`
            : 'Перерыв и обед запускаются вручную'}
        </p>
      </div>
    </div>
  )
}
