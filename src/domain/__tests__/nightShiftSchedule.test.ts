import { describe, expect, it } from 'vitest'
import { getNextNightShiftPause, getNightShiftSchedule, getCurrentNightShiftStartAt, NIGHT_SHIFT_DURATION_MS } from '../nightShiftSchedule'
import { makeShift } from './fixtures'

function localTime(day: number, hour: number, minute = 0): number {
  return new Date(2026, 6, day, hour, minute, 0).getTime()
}

function activeNightShift() {
  return makeShift({
    status: 'active',
    activity: 'work',
    startedAt: localTime(20, 21),
    plannedStartAt: localTime(20, 21),
    plannedDurationMs: NIGHT_SHIFT_DURATION_MS,
    endedAt: null,
  })
}

describe('night shift schedule', () => {
  it('anchors an overnight shift to 21:00 and keeps its duration at 12 hours', () => {
    expect(getCurrentNightShiftStartAt(localTime(20, 23))).toBe(localTime(20, 21))
    expect(getCurrentNightShiftStartAt(localTime(21, 2))).toBe(localTime(20, 21))
    expect(NIGHT_SHIFT_DURATION_MS).toBe(12 * 60 * 60 * 1000)
  })

  it('creates the fixed 21:00–09:00 pause schedule across midnight', () => {
    const schedule = getNightShiftSchedule(activeNightShift())

    expect(schedule.map((pause) => [pause.label, pause.startAt, pause.endAt])).toEqual([
      ['Перерыв', localTime(20, 22, 15), localTime(20, 22, 30)],
      ['Перерыв', localTime(21, 0, 30), localTime(21, 0, 45)],
      ['Обед', localTime(21, 2, 45), localTime(21, 3, 15)],
      ['Перерыв', localTime(21, 5, 0), localTime(21, 5, 15)],
      ['Перерыв', localTime(21, 7, 5), localTime(21, 7, 20)],
    ])
  })

  it('keeps the current pause visible until its scheduled end and then advances', () => {
    const shift = activeNightShift()

    expect(getNextNightShiftPause(shift, localTime(20, 22, 16))).toMatchObject({
      type: 'break',
      startAt: localTime(20, 22, 15),
    })
    expect(getNextNightShiftPause(shift, localTime(20, 22, 30))).toMatchObject({
      type: 'break',
      startAt: localTime(21, 0, 30),
    })
  })

  it('moves to the next item after a scheduled pause was confirmed', () => {
    const schedule = getNightShiftSchedule(activeNightShift())
    const firstPause = schedule[0]
    const shift = activeNightShift()
    shift.breaks = [{
      id: 'confirmed-break',
      type: 'break',
      startedAt: firstPause.startAt,
      plannedDurationMs: firstPause.plannedDurationMs,
      plannedEndAt: firstPause.endAt,
      endedAt: firstPause.endAt,
      actualDurationMs: firstPause.plannedDurationMs,
      overtimeMs: 0,
    }]

    expect(getNextNightShiftPause(shift, localTime(20, 22, 20))).toMatchObject({
      startAt: localTime(21, 0, 30),
    })
  })
})
