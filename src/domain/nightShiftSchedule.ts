import { HOUR_MS, MINUTE_MS } from './defaults'
import type { BreakType, DurationMs, Shift, Timestamp } from './types'

export interface ScheduledPause {
  id: string
  type: BreakType
  label: 'Перерыв' | 'Обед'
  startAt: Timestamp
  endAt: Timestamp
  plannedDurationMs: DurationMs
}

type PauseDefinition = {
  id: string
  type: BreakType
  hour: number
  minute: number
  durationMinutes: number
}

const NIGHT_SHIFT_PAUSES: readonly PauseDefinition[] = [
  { id: 'break-2215', type: 'break', hour: 22, minute: 15, durationMinutes: 15 },
  { id: 'break-0030', type: 'break', hour: 0, minute: 30, durationMinutes: 15 },
  { id: 'lunch-0245', type: 'lunch', hour: 2, minute: 45, durationMinutes: 30 },
  { id: 'break-0500', type: 'break', hour: 5, minute: 0, durationMinutes: 15 },
  { id: 'break-0705', type: 'break', hour: 7, minute: 5, durationMinutes: 15 },
]

export const NIGHT_SHIFT_DURATION_MS = 12 * HOUR_MS

/** Start of the night shift currently in progress: 21:00–09:00 local time. */
export function getCurrentNightShiftStartAt(at: Timestamp = Date.now()): Timestamp {
  const start = new Date(at)
  if (start.getHours() < 9) start.setDate(start.getDate() - 1)
  start.setHours(21, 0, 0, 0)
  return start.getTime()
}

export function isNightShiftStartTime(at: Timestamp = Date.now()): boolean {
  const hour = new Date(at).getHours()
  return hour >= 21 || hour < 9
}

function nightShiftStartDay(at: Timestamp): Date {
  const day = new Date(at)
  if (day.getHours() < 12) day.setDate(day.getDate() - 1)
  day.setHours(0, 0, 0, 0)
  return day
}

function atShiftClock(startDay: Date, hour: number, minute: number): Timestamp {
  const date = new Date(startDay)
  if (hour < 12) date.setDate(date.getDate() + 1)
  date.setHours(hour, minute, 0, 0)
  return date.getTime()
}

/**
 * Fixed pauses for a night shift from 21:00 until 09:00 in the device's local time.
 * A pause is consumed only after a matching break or lunch was actually started.
 */
export function getNightShiftSchedule(shift: Shift, at: Timestamp = Date.now()): ScheduledPause[] {
  const anchor = shift.startedAt ?? shift.plannedStartAt ?? at
  const startDay = nightShiftStartDay(anchor)

  return NIGHT_SHIFT_PAUSES.map((definition) => {
    const startAt = atShiftClock(startDay, definition.hour, definition.minute)
    const plannedDurationMs = definition.durationMinutes * MINUTE_MS
    return {
      id: `${definition.id}-${startDay.getTime()}`,
      type: definition.type,
      label: definition.type === 'lunch' ? 'Обед' : 'Перерыв',
      startAt,
      endAt: startAt + plannedDurationMs,
      plannedDurationMs,
    }
  })
}

function isConfirmedPause(shift: Shift, scheduled: ScheduledPause): boolean {
  return shift.breaks.some(
    (pause) =>
      pause.type === scheduled.type &&
      pause.startedAt >= scheduled.startAt &&
      pause.startedAt < scheduled.endAt,
  )
}

/** Returns the current or next scheduled pause that has not been used yet. */
export function getNextNightShiftPause(
  shift: Shift,
  at: Timestamp = Date.now(),
): ScheduledPause | null {
  return (
    getNightShiftSchedule(shift, at).find(
      (scheduled) => scheduled.endAt > at && !isConfirmedPause(shift, scheduled),
    ) ?? null
  )
}
