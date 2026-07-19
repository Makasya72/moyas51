import { HOUR_MS } from './defaults'
import { BO_RATE_SUBKOPECKS, SUBKOPECKS_PER_KOPECK } from './types'
import type {
  BoSubunits,
  BreakTimerSnapshot,
  DateRange,
  DurationMs,
  Kopecks,
  RateSubkopecks,
  RuntimeShiftStatus,
  Shift,
  ShiftBreak,
  ShiftEarnings,
  ShiftMetrics,
  StatisticsBucket,
  StatisticsSummary,
  SupportStatistics,
  TimerSnapshot,
  Timestamp,
} from './types'

const ZERO_METRICS: Omit<ShiftMetrics, 'expectedEndAt'> = {
  elapsedMs: 0,
  netWorkMs: 0,
  breakMs: 0,
  lunchMs: 0,
  totalPauseMs: 0,
  remainingMs: 0,
  overtimeMs: 0,
  undertimeMs: 0,
  progress: 0,
  breakCount: 0,
  lunchCount: 0,
}

function finite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback
}

function nonNegative(value: number): number {
  return Math.max(0, finite(value))
}

function integerKopecks(value: number): Kopecks {
  return Math.round(finite(value))
}

/** Fixed conversion used for new earnings records. */
export const BO_SCALE = 10_000

export function boToSubunits(bo: number): BoSubunits {
  return Math.round(finite(bo) * BO_SCALE)
}

export function boSubunitsToBo(subunits: BoSubunits): number {
  return Math.round(finite(subunits)) / BO_SCALE
}

export function boSubunitsToKopecks(
  subunits: BoSubunits,
  rateSubkopecks: RateSubkopecks = BO_RATE_SUBKOPECKS,
): Kopecks {
  const normalizedSubunits = Math.max(0, Math.round(finite(subunits)))
  const normalizedRate = Math.max(0, Math.round(finite(rateSubkopecks)))
  const denominator = BigInt(BO_SCALE * SUBKOPECKS_PER_KOPECK)
  const numerator = BigInt(normalizedSubunits) * BigInt(normalizedRate)
  const rounded = (numerator + denominator / 2n) / denominator
  const result = Number(rounded)
  if (!Number.isSafeInteger(result)) {
    throw new RangeError('Начисление за БО выходит за безопасный диапазон')
  }
  return result
}

export function boToKopecks(bo: number): Kopecks {
  return boSubunitsToKopecks(boToSubunits(bo))
}

export function kopecksToBo(
  kopecks: Kopecks,
  rateSubkopecks: RateSubkopecks = BO_RATE_SUBKOPECKS,
): number {
  return (
    (integerKopecks(kopecks) * SUBKOPECKS_PER_KOPECK) /
    Math.round(finite(rateSubkopecks))
  )
}

export function boRateSubkopecksToRubles(
  rateSubkopecks: RateSubkopecks,
): number {
  return Math.round(finite(rateSubkopecks)) / 10_000
}

export function calculatePlannedEndAt(
  startedAt: Timestamp,
  plannedDurationMs: DurationMs,
): Timestamp {
  return startedAt + nonNegative(plannedDurationMs)
}

export function calculateEarnings(
  baseKopecks: Kopecks,
  bonusKopecks = 0,
  deductionKopecks = 0,
  isBaseEstimated = false,
): ShiftEarnings {
  const base = integerKopecks(baseKopecks)
  const bonus = integerKopecks(bonusKopecks)
  const deduction = integerKopecks(deductionKopecks)

  return {
    baseBoSubunits: null,
    boRateSubkopecks: BO_RATE_SUBKOPECKS,
    baseKopecks: base,
    bonusKopecks: bonus,
    deductionKopecks: deduction,
    totalKopecks: base + bonus - deduction,
    isBaseEstimated,
  }
}

export function calculateEarningsFromBo(
  baseBo: number | null,
  bonusKopecks = 0,
  deductionKopecks = 0,
  options: {
    fallbackBaseKopecks?: Kopecks
    isBaseEstimated?: boolean
    boRateSubkopecks?: RateSubkopecks
  } = {},
): ShiftEarnings {
  if (baseBo === null) {
    return calculateEarnings(
      options.fallbackBaseKopecks ?? 0,
      bonusKopecks,
      deductionKopecks,
      options.isBaseEstimated ?? false,
    )
  }
  return calculateEarningsFromBoSubunits(
    boToSubunits(nonNegative(baseBo)),
    bonusKopecks,
    deductionKopecks,
    options.boRateSubkopecks ?? BO_RATE_SUBKOPECKS,
    options.isBaseEstimated ?? false,
  )
}

export function calculateEarningsFromBoSubunits(
  baseBoSubunits: BoSubunits,
  bonusKopecks = 0,
  deductionKopecks = 0,
  boRateSubkopecks: RateSubkopecks = BO_RATE_SUBKOPECKS,
  isBaseEstimated = false,
): ShiftEarnings {
  const subunits = Math.max(0, Math.round(finite(baseBoSubunits)))
  const rate = Math.max(0, Math.round(finite(boRateSubkopecks)))
  const earnings = calculateEarnings(
    boSubunitsToKopecks(subunits, rate),
    bonusKopecks,
    deductionKopecks,
    isBaseEstimated,
  )
  return {
    ...earnings,
    baseBoSubunits: subunits,
    boRateSubkopecks: rate,
  }
}

export function estimateEarningsByHourlyRate(
  netWorkMs: DurationMs,
  hourlyRateKopecks: Kopecks | null,
): Kopecks | null {
  if (hourlyRateKopecks === null) return null
  return integerKopecks(
    (nonNegative(netWorkMs) / HOUR_MS) * integerKopecks(hourlyRateKopecks),
  )
}

export function getActiveBreak(shift: Shift): ShiftBreak | null {
  for (let index = shift.breaks.length - 1; index >= 0; index -= 1) {
    const candidate = shift.breaks[index]
    if (candidate.endedAt === null) return candidate
  }
  return null
}

export function calculateBreakDuration(
  pause: ShiftBreak,
  at: Timestamp,
  shiftEndAt: Timestamp | null = null,
): DurationMs {
  const rawEnd = pause.endedAt ?? at
  const end = shiftEndAt === null ? rawEnd : Math.min(rawEnd, shiftEndAt)
  return nonNegative(end - pause.startedAt)
}

export function calculateBreakOvertime(
  pause: ShiftBreak,
  at: Timestamp,
): DurationMs {
  return nonNegative(calculateBreakDuration(pause, at) - pause.plannedDurationMs)
}

function calculatePauseTotals(
  shift: Shift,
  at: Timestamp,
  shiftEndAt: Timestamp | null,
): {
  breakMs: DurationMs
  lunchMs: DurationMs
  breakCount: number
  lunchCount: number
} {
  let breakMs = 0
  let lunchMs = 0
  let breakCount = 0
  let lunchCount = 0

  for (const pause of shift.breaks) {
    const duration = calculateBreakDuration(pause, at, shiftEndAt)
    if (pause.type === 'lunch') {
      lunchMs += duration
      lunchCount += 1
    } else {
      breakMs += duration
      breakCount += 1
    }
  }

  return { breakMs, lunchMs, breakCount, lunchCount }
}

export function calculateShiftMetrics(
  shift: Shift,
  at: Timestamp = Date.now(),
): ShiftMetrics {
  if (shift.startedAt === null) {
    return {
      ...ZERO_METRICS,
      expectedEndAt:
        shift.plannedStartAt === null
          ? null
          : calculatePlannedEndAt(
              shift.plannedStartAt,
              shift.plannedDurationMs,
            ),
    }
  }

  const clockEnd = shift.endedAt ?? Math.max(at, shift.startedAt)
  const elapsedMs = nonNegative(clockEnd - shift.startedAt)
  const pauses = calculatePauseTotals(shift, clockEnd, shift.endedAt)
  const totalPauseMs = pauses.breakMs + pauses.lunchMs
  const netWorkMs = nonNegative(elapsedMs - totalPauseMs)
  const extensionMs = shift.extendByBreaks ? totalPauseMs : 0
  const expectedEndAt = calculatePlannedEndAt(
    shift.startedAt,
    shift.plannedDurationMs + extensionMs,
  )
  const difference = clockEnd - expectedEndAt
  const isCompleted = shift.status === 'completed' && shift.endedAt !== null
  const remainingMs = isCompleted
    ? 0
    : nonNegative(expectedEndAt - Math.max(at, shift.startedAt))
  const overtimeMs = nonNegative(difference)
  const undertimeMs = isCompleted ? nonNegative(-difference) : 0
  const progressBasis = shift.extendByBreaks ? netWorkMs : elapsedMs
  const progress =
    shift.plannedDurationMs > 0
      ? Math.min(1, nonNegative(progressBasis) / shift.plannedDurationMs)
      : 1

  return {
    elapsedMs,
    netWorkMs,
    breakMs: pauses.breakMs,
    lunchMs: pauses.lunchMs,
    totalPauseMs,
    expectedEndAt,
    remainingMs,
    overtimeMs,
    undertimeMs,
    progress,
    breakCount: pauses.breakCount,
    lunchCount: pauses.lunchCount,
  }
}

export function deriveRuntimeStatus(
  shift: Shift | null,
  at: Timestamp = Date.now(),
): RuntimeShiftStatus {
  if (shift === null || shift.status === 'planned') return 'not_started'
  if (shift.status === 'completed') return 'completed'
  if (shift.activity === 'break' || shift.activity === 'lunch') {
    return shift.activity
  }
  return calculateShiftMetrics(shift, at).remainingMs === 0
    ? 'overtime'
    : 'work'
}

export function getTimerSnapshot(
  shift: Shift | null,
  at: Timestamp = Date.now(),
): TimerSnapshot {
  if (shift === null) {
    return {
      ...ZERO_METRICS,
      expectedEndAt: null,
      status: 'not_started',
      activeBreak: null,
    }
  }

  const metrics = calculateShiftMetrics(shift, at)
  const pause = getActiveBreak(shift)
  let activeBreak: BreakTimerSnapshot | null = null

  if (pause !== null) {
    const difference = pause.plannedEndAt - at
    activeBreak = {
      breakId: pause.id,
      type: pause.type,
      expectedReturnAt: pause.plannedEndAt,
      remainingMs: nonNegative(difference),
      overtimeMs: nonNegative(-difference),
    }
  }

  return {
    ...metrics,
    status: deriveRuntimeStatus(shift, at),
    activeBreak,
  }
}

function isShiftInRange(shift: Shift, range?: DateRange): boolean {
  if (range === undefined) return true
  const anchor = shift.endedAt ?? shift.startedAt ?? shift.plannedStartAt
  return anchor !== null && anchor >= range.startAt && anchor < range.endAt
}

function completedShifts(shifts: readonly Shift[], range?: DateRange): Shift[] {
  return shifts.filter(
    (shift) =>
      shift.status === 'completed' &&
      shift.startedAt !== null &&
      shift.endedAt !== null &&
      isShiftInRange(shift, range),
  )
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + finite(value), 0)
}

function calculateSupportStatistics(shifts: readonly Shift[]): SupportStatistics | null {
  const withSupport = shifts.filter(
    (shift) => shift.support !== null,
  )
  if (withSupport.length === 0) return null

  const totalNetWorkMs = sum(
    withSupport.map((shift) => calculateShiftMetrics(shift).netWorkMs),
  )
  const handled = withSupport.map(
    (shift) => shift.support?.handledRequests ?? 0,
  )
  const qualityPoints = withSupport
    .filter((shift) => shift.support?.qualityScore !== null)
    .sort(
      (left, right) =>
        (left.endedAt ?? left.updatedAt) - (right.endedAt ?? right.updatedAt),
    )
    .map((shift) => shift.support?.qualityScore)
    .filter((score): score is number => score !== null && score !== undefined)

  return {
    shiftsWithMetrics: withSupport.length,
    totalHandledRequests: sum(handled),
    totalChats: sum(withSupport.map((shift) => shift.support?.chats ?? 0)),
    totalCalls: sum(withSupport.map((shift) => shift.support?.calls ?? 0)),
    totalComplexCases: sum(
      withSupport.map((shift) => shift.support?.complexCases ?? 0),
    ),
    requestsPerNetHour:
      totalNetWorkMs > 0 ? sum(handled) / (totalNetWorkMs / HOUR_MS) : 0,
    averageRequestsPerShift: sum(handled) / withSupport.length,
    averageQualityScore:
      qualityPoints.length > 0
        ? sum(qualityPoints) / qualityPoints.length
        : null,
    qualityScoreChange:
      qualityPoints.length > 1
        ? qualityPoints[qualityPoints.length - 1] - qualityPoints[0]
        : null,
  }
}

export function calculateStatistics(
  shifts: readonly Shift[],
  range?: DateRange,
  financialGoalKopecks: Kopecks | null = null,
): StatisticsSummary {
  const selected = completedShifts(shifts, range)
  const metrics = selected.map((shift) => calculateShiftMetrics(shift))
  const totalElapsedMs = sum(metrics.map((metric) => metric.elapsedMs))
  const totalNetWorkMs = sum(metrics.map((metric) => metric.netWorkMs))
  const totalBreakMs = sum(metrics.map((metric) => metric.breakMs))
  const totalLunchMs = sum(metrics.map((metric) => metric.lunchMs))
  const totalOvertimeMs = sum(metrics.map((metric) => metric.overtimeMs))
  const totalUndertimeMs = sum(metrics.map((metric) => metric.undertimeMs))
  const totalEarningsKopecks = integerKopecks(
    sum(selected.map((shift) => shift.earnings.totalKopecks)),
  )
  const pauseCount = sum(
    metrics.map((metric) => metric.breakCount + metric.lunchCount),
  )
  const longest = [...selected].sort(
    (left, right) =>
      calculateShiftMetrics(right).elapsedMs -
      calculateShiftMetrics(left).elapsedMs,
  )[0]
  const mostProfitable = [...selected].sort(
    (left, right) =>
      right.earnings.totalKopecks - left.earnings.totalKopecks,
  )[0]

  return {
    shiftCount: selected.length,
    totalElapsedMs,
    totalNetWorkMs,
    totalBreakMs,
    totalLunchMs,
    overtimeShiftCount: metrics.filter((metric) => metric.overtimeMs > 0)
      .length,
    totalOvertimeMs,
    totalUndertimeMs,
    averageShiftMs: selected.length > 0 ? totalElapsedMs / selected.length : 0,
    totalEarningsKopecks,
    averageEarningsKopecks:
      selected.length > 0
        ? integerKopecks(totalEarningsKopecks / selected.length)
        : 0,
    averageEarningsPerNetHourKopecks:
      totalNetWorkMs > 0
        ? integerKopecks(totalEarningsKopecks / (totalNetWorkMs / HOUR_MS))
        : 0,
    financialGoalKopecks,
    financialGoalProgress:
      financialGoalKopecks !== null && financialGoalKopecks > 0
        ? totalEarningsKopecks / financialGoalKopecks
        : null,
    longestShiftId: longest?.id ?? null,
    mostProfitableShiftId: mostProfitable?.id ?? null,
    averagePauseMs:
      pauseCount > 0 ? (totalBreakMs + totalLunchMs) / pauseCount : 0,
    support: calculateSupportStatistics(selected),
  }
}

export type StatisticsGranularity = 'day' | 'week' | 'month'

function startOfLocalDay(timestamp: Timestamp): Timestamp {
  const date = new Date(timestamp)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

function bucketBounds(
  timestamp: Timestamp,
  granularity: StatisticsGranularity,
): { key: string; startAt: Timestamp; endAt: Timestamp } {
  const date = new Date(timestamp)
  if (granularity === 'day') {
    const startAt = startOfLocalDay(timestamp)
    const next = new Date(startAt)
    next.setDate(next.getDate() + 1)
    return {
      key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
      startAt,
      endAt: next.getTime(),
    }
  }

  if (granularity === 'week') {
    const start = new Date(startOfLocalDay(timestamp))
    const mondayOffset = (start.getDay() + 6) % 7
    start.setDate(start.getDate() - mondayOffset)
    const end = new Date(start)
    end.setDate(end.getDate() + 7)
    return {
      key: `week-${start.toISOString().slice(0, 10)}`,
      startAt: start.getTime(),
      endAt: end.getTime(),
    }
  }

  const start = new Date(date.getFullYear(), date.getMonth(), 1)
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 1)
  return {
    key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`,
    startAt: start.getTime(),
    endAt: end.getTime(),
  }
}

export function groupStatistics(
  shifts: readonly Shift[],
  granularity: StatisticsGranularity,
  financialGoalKopecks: Kopecks | null = null,
): StatisticsBucket[] {
  const buckets = new Map<
    string,
    { startAt: Timestamp; endAt: Timestamp; shifts: Shift[] }
  >()

  for (const shift of completedShifts(shifts)) {
    const anchor = shift.endedAt ?? shift.startedAt
    if (anchor === null) continue
    const bounds = bucketBounds(anchor, granularity)
    const bucket = buckets.get(bounds.key) ?? {
      startAt: bounds.startAt,
      endAt: bounds.endAt,
      shifts: [],
    }
    bucket.shifts.push(shift)
    buckets.set(bounds.key, bucket)
  }

  return [...buckets.entries()]
    .map(([key, bucket]) => ({
      key,
      startAt: bucket.startAt,
      endAt: bucket.endAt,
      ...calculateStatistics(
        bucket.shifts,
        undefined,
        granularity === 'month' ? financialGoalKopecks : null,
      ),
    }))
    .sort((left, right) => left.startAt - right.startAt)
}

export function calculateCompletedShiftStreak(shifts: readonly Shift[]): number {
  const days = [
    ...new Set(
      completedShifts(shifts)
        .map((shift) => shift.endedAt)
        .filter((value): value is number => value !== null)
        .map(startOfLocalDay),
    ),
  ].sort((left, right) => right - left)
  if (days.length === 0) return 0

  let streak = 1
  for (let index = 1; index < days.length; index += 1) {
    const cursor = new Date(days[index - 1])
    cursor.setDate(cursor.getDate() - 1)
    if (cursor.getTime() !== days[index]) break
    streak += 1
  }
  return streak
}
