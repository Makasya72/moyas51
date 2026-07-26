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
    <div
      className="mini-timer"
      style={{
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        margin: 0,
        padding: '8px',
        backgroundColor: '#191919',
        color: '#f6f6f2',
        fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}
    >
      <div className="mini-timer-main" style={{ margin: 'auto 0' }}>
        <div
          className={`timer-display ${pauseOvertime ? 'timer-display--danger' : ''}`}
          style={{
            color: pauseOvertime ? '#ff6b66' : '#f6f6f2',
            fontSize: '34px',
            fontWeight: 780,
            lineHeight: 1,
            letterSpacing: '-0.065em',
            fontVariantNumeric: 'tabular-nums',
            whiteSpace: 'nowrap',
          }}
        >
          {formatDuration(value)}
        </div>
        <p
          className="timer-subtitle"
          style={{
            margin: '4px 0 0',
            color: '#c9c9c3',
            fontSize: '10px',
            fontWeight: 600,
            lineHeight: 1.3,
          }}
        >
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
