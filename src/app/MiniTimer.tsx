import { getNextNightShiftPause, getTimerSnapshot } from '../domain'
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
  const completed = snapshot.status === 'completed'
  const shiftStartAt = shift.startedAt
  const waitingForShiftStart = shiftStartAt !== null && now < shiftStartAt
  const scheduledPause = pause || completed ? null : getNextNightShiftPause(shift, now)
  const value = completed
    ? snapshot.overtimeMs || snapshot.undertimeMs
    : pause
    ? pauseOvertime ? pause.overtimeMs : pause.remainingMs
    : waitingForShiftStart ? shiftStartAt - now
    : snapshot.status === 'overtime' ? snapshot.overtimeMs : snapshot.remainingMs
  const nextPauseName = scheduledPause?.type === 'lunch' ? 'обеда' : 'перерыва'

  return (
    <div className="mini-timer">
      <div className="mini-timer-main">
        <div className={`timer-display ${pauseOvertime ? 'timer-display--danger' : ''}`}>{formatDuration(value)}</div>
        <p className="timer-subtitle">
          {pause
            ? pauseOvertime
              ? 'Пора вернуться к работе'
              : `До возвращения — ${formatDuration(pause.remainingMs)}`
            : scheduledPause
              ? scheduledPause.startAt <= now
                ? `Время: ${scheduledPause.label.toLowerCase()} — подтвердите на сайте`
                : `До ${nextPauseName} — ${formatDuration(scheduledPause.startAt - now)}`
              : 'Перерывы по расписанию завершены'}
        </p>
      </div>
    </div>
  )
}
