import { describe, expect, it } from 'vitest'
import {
  calculateBreakOvertime,
  calculateCompletedShiftStreak,
  calculateEarnings,
  calculateEarningsFromBo,
  boSubunitsToBo,
  calculatePlannedEndAt,
  calculateShiftMetrics,
  calculateStatistics,
  deriveRuntimeStatus,
  estimateEarningsByHourlyRate,
  boToKopecks,
  boToSubunits,
  getTimerSnapshot,
  groupStatistics,
  kopecksToBo,
} from '../calculations'
import { DAY_MS, HOUR_MS, MINUTE_MS } from '../defaults'
import { BASE_TIME, makeBreak, makeShift } from './fixtures'

describe('расчёты смены и таймера', () => {
  it('рассчитывает окончание 12-часовой смены от фактического начала', () => {
    expect(calculatePlannedEndAt(BASE_TIME, 12 * HOUR_MS)).toBe(
      BASE_TIME + 12 * HOUR_MS,
    )
  })

  it('восстанавливает таймер по абсолютной метке, а не счётчику тиков', () => {
    const shift = makeShift({ status: 'active', activity: 'work', endedAt: null })
    const snapshot = getTimerSnapshot(shift, BASE_TIME + 3 * HOUR_MS + 7_000)
    expect(snapshot.elapsedMs).toBe(3 * HOUR_MS + 7_000)
    expect(snapshot.remainingMs).toBe(9 * HOUR_MS - 7_000)
  })

  it('не показывает отрицательный остаток после конца смены', () => {
    const shift = makeShift({ status: 'active', activity: 'work', endedAt: null })
    const snapshot = getTimerSnapshot(shift, BASE_TIME + 13 * HOUR_MS)
    expect(snapshot.remainingMs).toBe(0)
    expect(snapshot.overtimeMs).toBe(HOUR_MS)
    expect(snapshot.status).toBe('overtime')
  })

  it('вычитает обычный перерыв из чистого рабочего времени', () => {
    const pause = makeBreak({ plannedDurationMs: 20 * MINUTE_MS })
    const shift = makeShift({ breaks: [pause] })
    const metrics = calculateShiftMetrics(shift)
    expect(metrics.breakMs).toBe(20 * MINUTE_MS)
    expect(metrics.lunchMs).toBe(0)
    expect(metrics.netWorkMs).toBe(12 * HOUR_MS - 20 * MINUTE_MS)
  })

  it('учитывает обед отдельно', () => {
    const lunch = makeBreak({
      id: 'lunch-1',
      type: 'lunch',
      plannedDurationMs: 30 * MINUTE_MS,
    })
    const metrics = calculateShiftMetrics(makeShift({ breaks: [lunch] }))
    expect(metrics.breakMs).toBe(0)
    expect(metrics.lunchMs).toBe(30 * MINUTE_MS)
    expect(metrics.lunchCount).toBe(1)
  })

  it('оставляет окончание фиксированным, когда перерывы входят в смену', () => {
    const shift = makeShift({
      status: 'active',
      activity: 'work',
      endedAt: null,
      breaks: [makeBreak()],
      extendByBreaks: false,
    })
    expect(calculateShiftMetrics(shift, BASE_TIME + 5 * HOUR_MS).expectedEndAt).toBe(
      BASE_TIME + 12 * HOUR_MS,
    )
  })

  it('сдвигает окончание на фактическое время перерыва в режиме продления', () => {
    const pause = makeBreak({
      plannedDurationMs: 15 * MINUTE_MS,
      endedAt: BASE_TIME + 2 * HOUR_MS + 22 * MINUTE_MS,
      actualDurationMs: 22 * MINUTE_MS,
    })
    const shift = makeShift({
      status: 'active',
      activity: 'work',
      endedAt: null,
      breaks: [pause],
      extendByBreaks: true,
    })
    expect(calculateShiftMetrics(shift, BASE_TIME + 3 * HOUR_MS).expectedEndAt).toBe(
      BASE_TIME + 12 * HOUR_MS + 22 * MINUTE_MS,
    )
  })

  it('во время продлевающего перерыва сохраняет остаток рабочего времени', () => {
    const pause = makeBreak({
      endedAt: null,
      actualDurationMs: null,
      startedAt: BASE_TIME + 2 * HOUR_MS,
    })
    const shift = makeShift({
      status: 'active',
      activity: 'break',
      endedAt: null,
      breaks: [pause],
      extendByBreaks: true,
    })
    const first = calculateShiftMetrics(shift, BASE_TIME + 2 * HOUR_MS + 5 * MINUTE_MS)
    const later = calculateShiftMetrics(shift, BASE_TIME + 2 * HOUR_MS + 10 * MINUTE_MS)
    expect(first.remainingMs).toBe(later.remainingMs)
  })

  it('показывает обратный отсчёт и превышение активного перерыва', () => {
    const pause = makeBreak({ endedAt: null, actualDurationMs: null })
    const shift = makeShift({
      status: 'active',
      activity: 'break',
      endedAt: null,
      breaks: [pause],
    })
    expect(
      getTimerSnapshot(shift, pause.plannedEndAt - MINUTE_MS).activeBreak,
    ).toMatchObject({ remainingMs: MINUTE_MS, overtimeMs: 0 })
    expect(
      getTimerSnapshot(shift, pause.plannedEndAt + 3 * MINUTE_MS).activeBreak,
    ).toMatchObject({ remainingMs: 0, overtimeMs: 3 * MINUTE_MS })
  })

  it('рассчитывает превышение перерыва', () => {
    const pause = makeBreak({ endedAt: BASE_TIME + 3 * HOUR_MS })
    expect(calculateBreakOvertime(pause, pause.endedAt ?? 0)).toBe(
      45 * MINUTE_MS,
    )
  })

  it('рассчитывает переработку завершённой смены', () => {
    const shift = makeShift({ endedAt: BASE_TIME + 12 * HOUR_MS + 35 * MINUTE_MS })
    expect(calculateShiftMetrics(shift).overtimeMs).toBe(35 * MINUTE_MS)
    expect(calculateShiftMetrics(shift).undertimeMs).toBe(0)
  })

  it('рассчитывает недоработку завершённой смены', () => {
    const shift = makeShift({ endedAt: BASE_TIME + 11 * HOUR_MS })
    expect(calculateShiftMetrics(shift).undertimeMs).toBe(HOUR_MS)
    expect(calculateShiftMetrics(shift).overtimeMs).toBe(0)
  })

  it('правильно считает смену, прошедшую через полночь', () => {
    const start = new Date(2026, 6, 1, 20, 0).getTime()
    const shift = makeShift({
      startedAt: start,
      plannedStartAt: start,
      plannedEndAt: start + 12 * HOUR_MS,
      endedAt: start + 12 * HOUR_MS,
    })
    expect(calculateShiftMetrics(shift).elapsedMs).toBe(12 * HOUR_MS)
  })

  it('возвращает ожидаемые runtime-статусы', () => {
    expect(deriveRuntimeStatus(null, BASE_TIME)).toBe('not_started')
    expect(deriveRuntimeStatus(makeShift(), BASE_TIME)).toBe('completed')
    expect(
      deriveRuntimeStatus(
        makeShift({ status: 'active', activity: 'lunch', endedAt: null }),
        BASE_TIME,
      ),
    ).toBe('lunch')
  })
})

describe('деньги и статистика', () => {
  it('конвертирует БО в рубли по фиксированному курсу 1 БО = 0,8 ₽', () => {
    expect(boToKopecks(350)).toBe(28_000)
    expect(kopecksToBo(28_000)).toBe(350)
    expect(calculateEarningsFromBo(350, 10_000, 5_000)).toEqual({
      baseBoSubunits: 3_500_000,
      boRateKopecks: 80,
      baseKopecks: 28_000,
      bonusKopecks: 10_000,
      deductionKopecks: 5_000,
      totalKopecks: 33_000,
      isBaseEstimated: false,
    })
    expect(boToSubunits(350.125)).toBe(3_501_250)
    expect(boSubunitsToBo(3_501_250)).toBe(350.125)
    expect(calculateEarningsFromBo(null).baseBoSubunits).toBeNull()
    expect(calculateEarningsFromBo(0).baseBoSubunits).toBe(0)
  })

  it('хранит формулу денег в целых копейках', () => {
    expect(calculateEarnings(125_050, 10_001, 5_051)).toEqual({
      baseBoSubunits: null,
      boRateKopecks: 80,
      baseKopecks: 125_050,
      bonusKopecks: 10_001,
      deductionKopecks: 5_051,
      totalKopecks: 130_000,
      isBaseEstimated: false,
    })
  })

  it('оценивает заработок по чистым часам с округлением до копейки', () => {
    expect(estimateEarningsByHourlyRate(90 * MINUTE_MS, 12_345)).toBe(18_518)
    expect(estimateEarningsByHourlyRate(HOUR_MS, null)).toBeNull()
  })

  it('возвращает пустую статистику без демонстрационных данных', () => {
    const stats = calculateStatistics([])
    expect(stats.shiftCount).toBe(0)
    expect(stats.totalEarningsKopecks).toBe(0)
    expect(stats.support).toBeNull()
  })

  it('агрегирует время, переработки и деньги', () => {
    const first = makeShift({
      id: 'one',
      endedAt: BASE_TIME + 13 * HOUR_MS,
      earnings: calculateEarnings(100_000, 10_000, 0),
    })
    const second = makeShift({
      id: 'two',
      startedAt: BASE_TIME + DAY_MS,
      plannedStartAt: BASE_TIME + DAY_MS,
      plannedEndAt: BASE_TIME + DAY_MS + 12 * HOUR_MS,
      endedAt: BASE_TIME + DAY_MS + 11 * HOUR_MS,
      earnings: calculateEarnings(90_000),
    })
    const stats = calculateStatistics([first, second], undefined, 400_000)
    expect(stats.shiftCount).toBe(2)
    expect(stats.totalElapsedMs).toBe(24 * HOUR_MS)
    expect(stats.overtimeShiftCount).toBe(1)
    expect(stats.totalOvertimeMs).toBe(HOUR_MS)
    expect(stats.totalUndertimeMs).toBe(HOUR_MS)
    expect(stats.totalEarningsKopecks).toBe(200_000)
    expect(stats.financialGoalProgress).toBe(0.5)
  })

  it('фильтрует статистику по полуоткрытому периоду', () => {
    const first = makeShift({ id: 'one' })
    const second = makeShift({
      id: 'two',
      startedAt: BASE_TIME + DAY_MS,
      plannedStartAt: BASE_TIME + DAY_MS,
      endedAt: BASE_TIME + DAY_MS + 12 * HOUR_MS,
    })
    expect(
      calculateStatistics([first, second], {
        startAt: BASE_TIME,
        endAt: BASE_TIME + DAY_MS,
      }).shiftCount,
    ).toBe(1)
  })

  it('считает показатели поддержки по чистому рабочему часу', () => {
    const shift = makeShift({
      plannedDurationMs: 2 * HOUR_MS,
      plannedEndAt: BASE_TIME + 2 * HOUR_MS,
      endedAt: BASE_TIME + 2 * HOUR_MS,
      support: {
        handledRequests: 20,
        chats: 12,
        calls: 8,
        qualityScore: 95,
        averageResponseTimeMs: 30_000,
        complexCases: 2,
        learningNote: '',
        summaryNote: '',
      },
    })
    const support = calculateStatistics([shift]).support
    expect(support?.requestsPerNetHour).toBe(10)
    expect(support?.averageQualityScore).toBe(95)
  })

  it('группирует завершённые смены по локальным дням и месяцам', () => {
    const first = makeShift({ id: 'one' })
    const second = makeShift({
      id: 'two',
      startedAt: BASE_TIME + DAY_MS,
      plannedStartAt: BASE_TIME + DAY_MS,
      endedAt: BASE_TIME + DAY_MS + 12 * HOUR_MS,
    })
    expect(groupStatistics([first, second], 'day')).toHaveLength(2)
    expect(groupStatistics([first, second], 'month')).toHaveLength(1)
  })

  it('считает серию смен по соседним локальным дням', () => {
    const shifts = [0, 1, 2].map((offset) =>
      makeShift({
        id: `shift-${offset}`,
        startedAt: BASE_TIME + offset * DAY_MS,
        plannedStartAt: BASE_TIME + offset * DAY_MS,
        endedAt: BASE_TIME + offset * DAY_MS + 12 * HOUR_MS,
      }),
    )
    expect(calculateCompletedShiftStreak(shifts)).toBe(3)
  })
})
