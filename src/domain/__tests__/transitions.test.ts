import { describe, expect, it } from 'vitest'
import { calculateEarnings } from '../calculations'
import { HOUR_MS, MINUTE_MS } from '../defaults'
import {
  createPlannedShift,
  createShiftPlan,
  DomainTransitionError,
  getAvailableActions,
  transitionTracker,
  updateShiftEarnings,
} from '../transitions'
import type { Shift, TrackerState } from '../types'
import { BASE_TIME, makeShift } from './fixtures'

function startShift(at = BASE_TIME): Shift {
  return transitionTracker(
    { activeShift: null },
    {
      type: 'START_SHIFT',
      id: 'active',
      at,
      plannedDurationMs: 12 * HOUR_MS,
      extendByBreaks: false,
    },
  ).changedShift
}

function expectTransitionCode(run: () => unknown, code: string): void {
  try {
    run()
    throw new Error('Ожидалась ошибка перехода')
  } catch (error) {
    expect(error).toBeInstanceOf(DomainTransitionError)
    expect((error as DomainTransitionError).code).toBe(code)
  }
}

describe('конечный автомат смены', () => {
  it('переходит из отсутствующей смены в работу', () => {
    const result = transitionTracker(
      { activeShift: null },
      {
        type: 'START_SHIFT',
        id: 'shift-new',
        at: BASE_TIME,
        plannedDurationMs: 12 * HOUR_MS,
        extendByBreaks: true,
      },
    )
    expect(result.changedShift).toMatchObject({
      id: 'shift-new',
      status: 'active',
      activity: 'work',
      startedAt: BASE_TIME,
      plannedEndAt: BASE_TIME + 12 * HOUR_MS,
      extendByBreaks: true,
    })
    expect(result.state.activeShift?.id).toBe('shift-new')
  })

  it('запрещает вторую активную смену', () => {
    const state: TrackerState = { activeShift: startShift() }
    expectTransitionCode(
      () =>
        transitionTracker(state, {
          type: 'START_SHIFT',
          id: 'second',
          at: BASE_TIME + MINUTE_MS,
          plannedDurationMs: HOUR_MS,
          extendByBreaks: false,
        }),
      'ACTIVE_SHIFT_EXISTS',
    )
  })

  it('переходит из работы в обычный перерыв', () => {
    const result = transitionTracker(
      { activeShift: startShift() },
      {
        type: 'START_BREAK',
        id: 'break-one',
        breakType: 'break',
        at: BASE_TIME + HOUR_MS,
        plannedDurationMs: 15 * MINUTE_MS,
      },
    )
    expect(result.changedShift.activity).toBe('break')
    expect(result.changedShift.breaks[0]).toMatchObject({
      id: 'break-one',
      type: 'break',
      plannedEndAt: BASE_TIME + HOUR_MS + 15 * MINUTE_MS,
      endedAt: null,
    })
  })

  it('переходит из работы в обед', () => {
    const result = transitionTracker(
      { activeShift: startShift() },
      {
        type: 'START_BREAK',
        id: 'lunch-one',
        breakType: 'lunch',
        at: BASE_TIME + HOUR_MS,
        plannedDurationMs: 30 * MINUTE_MS,
      },
    )
    expect(result.changedShift.activity).toBe('lunch')
    expect(result.changedShift.breaks[0].type).toBe('lunch')
  })

  it('возвращается к работе и фиксирует фактическую длительность', () => {
    const paused = transitionTracker(
      { activeShift: startShift() },
      {
        type: 'START_BREAK',
        id: 'break-one',
        breakType: 'break',
        at: BASE_TIME + HOUR_MS,
        plannedDurationMs: 15 * MINUTE_MS,
      },
    ).changedShift
    const resumed = transitionTracker(
      { activeShift: paused },
      { type: 'RESUME_WORK', at: BASE_TIME + HOUR_MS + 12 * MINUTE_MS },
    ).changedShift
    expect(resumed.activity).toBe('work')
    expect(resumed.breaks[0].actualDurationMs).toBe(12 * MINUTE_MS)
    expect(resumed.breaks[0].overtimeMs).toBe(0)
  })

  it('фиксирует превышение перерыва', () => {
    const paused = transitionTracker(
      { activeShift: startShift() },
      {
        type: 'START_BREAK',
        id: 'break-one',
        breakType: 'break',
        at: BASE_TIME + HOUR_MS,
        plannedDurationMs: 15 * MINUTE_MS,
      },
    ).changedShift
    const resumed = transitionTracker(
      { activeShift: paused },
      { type: 'RESUME_WORK', at: BASE_TIME + HOUR_MS + 18 * MINUTE_MS },
    ).changedShift
    expect(resumed.breaks[0].overtimeMs).toBe(3 * MINUTE_MS)
  })

  it('разрешает несколько последовательных обычных перерывов', () => {
    let shift = startShift()
    shift = transitionTracker(
      { activeShift: shift },
      {
        type: 'START_BREAK',
        id: 'first',
        breakType: 'break',
        at: BASE_TIME + HOUR_MS,
        plannedDurationMs: 10 * MINUTE_MS,
      },
    ).changedShift
    shift = transitionTracker(
      { activeShift: shift },
      { type: 'RESUME_WORK', at: BASE_TIME + HOUR_MS + 10 * MINUTE_MS },
    ).changedShift
    shift = transitionTracker(
      { activeShift: shift },
      {
        type: 'START_BREAK',
        id: 'second',
        breakType: 'break',
        at: BASE_TIME + 3 * HOUR_MS,
        plannedDurationMs: 15 * MINUTE_MS,
      },
    ).changedShift
    expect(shift.breaks).toHaveLength(2)
    expect(shift.activity).toBe('break')
  })

  it('запрещает два одновременных перерыва', () => {
    const paused = transitionTracker(
      { activeShift: startShift() },
      {
        type: 'START_BREAK',
        id: 'first',
        breakType: 'break',
        at: BASE_TIME + HOUR_MS,
        plannedDurationMs: 10 * MINUTE_MS,
      },
    ).changedShift
    expectTransitionCode(
      () =>
        transitionTracker(
          { activeShift: paused },
          {
            type: 'START_BREAK',
            id: 'second',
            breakType: 'lunch',
            at: BASE_TIME + HOUR_MS + MINUTE_MS,
            plannedDurationMs: 30 * MINUTE_MS,
          },
        ),
      'BREAK_ALREADY_ACTIVE',
    )
  })

  it('запрещает возврат к работе без перерыва', () => {
    expectTransitionCode(
      () =>
        transitionTracker(
          { activeShift: startShift() },
          { type: 'RESUME_WORK', at: BASE_TIME + HOUR_MS },
        ),
      'NO_ACTIVE_BREAK',
    )
  })

  it('закрывает активный перерыв при завершении смены', () => {
    const paused = transitionTracker(
      { activeShift: startShift() },
      {
        type: 'START_BREAK',
        id: 'last-break',
        breakType: 'break',
        at: BASE_TIME + 11 * HOUR_MS,
        plannedDurationMs: 15 * MINUTE_MS,
      },
    ).changedShift
    const result = transitionTracker(
      { activeShift: paused },
      { type: 'FINISH_SHIFT', at: BASE_TIME + 11 * HOUR_MS + 5 * MINUTE_MS },
    )
    expect(result.changedShift.status).toBe('completed')
    expect(result.changedShift.activity).toBe('completed')
    expect(result.changedShift.breaks[0].endedAt).toBe(
      BASE_TIME + 11 * HOUR_MS + 5 * MINUTE_MS,
    )
    expect(result.state.activeShift).toBeNull()
  })

  it('запрещает повторное завершение', () => {
    expectTransitionCode(
      () =>
        transitionTracker(
          { activeShift: makeShift() },
          { type: 'FINISH_SHIFT', at: BASE_TIME + 13 * HOUR_MS },
        ),
      'SHIFT_ALREADY_COMPLETED',
    )
  })

  it('отвергает неположительную длительность и время до старта', () => {
    expectTransitionCode(
      () =>
        transitionTracker(
          { activeShift: null },
          {
            type: 'START_SHIFT',
            id: 'bad',
            at: BASE_TIME,
            plannedDurationMs: 0,
            extendByBreaks: false,
          },
        ),
      'INVALID_DURATION',
    )
    expectTransitionCode(
      () =>
        transitionTracker(
          { activeShift: startShift() },
          { type: 'FINISH_SHIFT', at: BASE_TIME - 1 },
        ),
      'INVALID_TIMESTAMP',
    )
  })

  it('возвращает только доступные действия для каждого состояния', () => {
    expect(getAvailableActions(null)).toEqual(['START_SHIFT'])
    expect(getAvailableActions(startShift())).toEqual([
      'START_BREAK',
      'START_LUNCH',
      'FINISH_SHIFT',
    ])
    const paused = transitionTracker(
      { activeShift: startShift() },
      {
        type: 'START_BREAK',
        id: 'pause',
        breakType: 'break',
        at: BASE_TIME + HOUR_MS,
        plannedDurationMs: 10 * MINUTE_MS,
      },
    ).changedShift
    expect(getAvailableActions(paused)).toEqual(['RESUME_WORK', 'FINISH_SHIFT'])
  })
})

describe('фабрики и редактирование', () => {
  it('создаёт будущую запланированную смену', () => {
    const planned = createPlannedShift({
      id: 'planned',
      startAt: BASE_TIME,
      durationMs: 8 * HOUR_MS,
      createdAt: BASE_TIME - HOUR_MS,
    })
    expect(planned).toMatchObject({
      status: 'planned',
      activity: 'not_started',
      startedAt: null,
      plannedEndAt: BASE_TIME + 8 * HOUR_MS,
    })
  })

  it('создаёт отдельный календарный план', () => {
    expect(
      createShiftPlan({
        id: 'plan',
        startAt: BASE_TIME,
        durationMs: 12 * HOUR_MS,
        patternId: 'two-two',
      }),
    ).toMatchObject({ id: 'plan', patternId: 'two-two' })
  })

  it('пересчитывает итог заработка при ручном редактировании', () => {
    const updated = updateShiftEarnings(
      makeShift(),
      {
        baseBoSubunits: null,
        boRateKopecks: 80,
        baseKopecks: 100_000,
        bonusKopecks: 20_000,
        deductionKopecks: 5_000,
        isBaseEstimated: false,
      },
      BASE_TIME + 13 * HOUR_MS,
    )
    expect(updated.earnings).toEqual(calculateEarnings(100_000, 20_000, 5_000))
    expect(updated.updatedAt).toBe(BASE_TIME + 13 * HOUR_MS)
  })
})
