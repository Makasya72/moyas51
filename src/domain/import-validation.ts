import {
  calculateBreakDuration,
  calculateBreakOvertime,
  calculateEarnings,
  calculateEarningsFromBoSubunits,
  calculatePlannedEndAt,
} from './calculations'
import {
  createDefaultSettings,
  createEmptySupportMetrics,
  HOUR_MS,
  MINUTE_MS,
} from './defaults'
import type {
  AppSettings,
  BackupDocument,
  BreakType,
  ImportPreview,
  SchedulePattern,
  Shift,
  ShiftBreak,
  ShiftPlan,
  SupportMetrics,
  Timestamp,
} from './types'
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  BO_RATE_SUBKOPECKS,
} from './types'

export class ImportValidationError extends Error {
  readonly issues: string[]

  constructor(issues: string[]) {
    super(issues.join('\n'))
    this.name = 'ImportValidationError'
    this.issues = issues
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new ImportValidationError([`${path}: ожидался объект`])
  }
  return value
}

function nonEmptyString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ImportValidationError([`${path}: ожидалась непустая строка`])
  }
  return value.trim()
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function finiteNumber(
  value: unknown,
  path: string,
  options: { min?: number; max?: number; integer?: boolean } = {},
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ImportValidationError([`${path}: ожидалось конечное число`])
  }
  if (options.min !== undefined && value < options.min) {
    throw new ImportValidationError([`${path}: число меньше ${options.min}`])
  }
  if (options.max !== undefined && value > options.max) {
    throw new ImportValidationError([`${path}: число больше ${options.max}`])
  }
  return options.integer ? Math.round(value) : value
}

function optionalNumber(
  value: unknown,
  fallback: number,
  path: string,
  options: { min?: number; max?: number; integer?: boolean } = {},
): number {
  return value === undefined || value === null
    ? fallback
    : finiteNumber(value, path, options)
}

function timestamp(value: unknown, path: string): Timestamp {
  if (typeof value === 'number') {
    return finiteNumber(value, path, { min: 0, integer: true })
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return parsed
  }
  throw new ImportValidationError([`${path}: некорректная дата или временная метка`])
}

function optionalTimestamp(
  value: unknown,
  fallback: Timestamp | null,
  path: string,
): Timestamp | null {
  return value === undefined || value === null ? fallback : timestamp(value, path)
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function normalizeBreakType(value: unknown, path: string): BreakType {
  if (value === 'break' || value === 'pause') return 'break'
  if (value === 'lunch' || value === 'meal') return 'lunch'
  throw new ImportValidationError([`${path}: неизвестный тип перерыва`])
}

function normalizeShiftBreak(
  input: unknown,
  path: string,
  index: number,
  completedShiftEnd: Timestamp | null,
  warn: (message: string) => void,
): ShiftBreak {
  const source = record(input, path)
  const startedAt = timestamp(source.startedAt ?? source.startAt, `${path}.startedAt`)
  const legacyMinutes = source.plannedDurationMinutes
  const plannedDurationMs = finiteNumber(
    source.plannedDurationMs ??
      source.durationMs ??
      (typeof legacyMinutes === 'number' ? legacyMinutes * MINUTE_MS : undefined),
    `${path}.plannedDurationMs`,
    { min: 1, integer: true },
  )
  let endedAt = optionalTimestamp(
    source.endedAt ?? source.endAt,
    null,
    `${path}.endedAt`,
  )
  if (endedAt === null && completedShiftEnd !== null) {
    endedAt = completedShiftEnd
    warn(`${path}: незакрытый перерыв завершён вместе со сменой`)
  }
  if (endedAt !== null && endedAt < startedAt) {
    throw new ImportValidationError([`${path}.endedAt: окончание раньше начала`])
  }

  const id =
    typeof source.id === 'string' && source.id.trim() !== ''
      ? source.id.trim()
      : `imported-break-${startedAt}-${index}`
  if (source.id === undefined) warn(`${path}: создан отсутствующий идентификатор`)
  const pause: ShiftBreak = {
    id,
    type: normalizeBreakType(source.type, `${path}.type`),
    startedAt,
    plannedDurationMs,
    plannedEndAt: calculatePlannedEndAt(startedAt, plannedDurationMs),
    endedAt,
    actualDurationMs: null,
    overtimeMs: 0,
  }
  if (endedAt !== null) {
    pause.actualDurationMs = calculateBreakDuration(pause, endedAt)
    pause.overtimeMs = calculateBreakOvertime(pause, endedAt)
  }
  return pause
}

function normalizeSupportMetrics(
  input: unknown,
  path: string,
): SupportMetrics | null {
  if (input === undefined || input === null) return null
  const source = record(input, path)
  const result = createEmptySupportMetrics()
  const countFields = [
    'handledRequests',
    'chats',
    'calls',
    'complexCases',
  ] as const
  for (const field of countFields) {
    result[field] =
      source[field] === undefined || source[field] === null
        ? null
        : finiteNumber(source[field], `${path}.${field}`, {
            min: 0,
            integer: true,
          })
  }
  result.qualityScore =
    source.qualityScore === undefined || source.qualityScore === null
      ? null
      : finiteNumber(source.qualityScore, `${path}.qualityScore`, {
          min: 0,
          max: 100,
        })
  result.averageResponseTimeMs =
    source.averageResponseTimeMs === undefined ||
    source.averageResponseTimeMs === null
      ? null
      : finiteNumber(
          source.averageResponseTimeMs,
          `${path}.averageResponseTimeMs`,
          { min: 0, integer: true },
        )
  result.learningNote = text(source.learningNote)
  result.summaryNote = text(source.summaryNote)
  return result
}

export function normalizeShift(
  input: unknown,
  path = 'shift',
  warn: (message: string) => void = () => undefined,
): Shift {
  const source = record(input, path)
  const id = nonEmptyString(source.id, `${path}.id`)
  const startedAt = optionalTimestamp(
    source.startedAt ?? source.startAt,
    null,
    `${path}.startedAt`,
  )
  const endedAt = optionalTimestamp(
    source.endedAt ?? source.endAt,
    null,
    `${path}.endedAt`,
  )
  const plannedStartAt = optionalTimestamp(
    source.plannedStartAt,
    startedAt,
    `${path}.plannedStartAt`,
  )
  const legacyDurationMinutes = source.plannedDurationMinutes
  const plannedDurationMs = finiteNumber(
    source.plannedDurationMs ??
      source.durationMs ??
      (typeof legacyDurationMinutes === 'number'
        ? legacyDurationMinutes * MINUTE_MS
        : undefined),
    `${path}.plannedDurationMs`,
    { min: 1, integer: true },
  )

  let status: Shift['status']
  const rawStatus = source.status
  if (rawStatus === 'planned') status = 'planned'
  else if (rawStatus === 'active' || rawStatus === 'running') status = 'active'
  else if (rawStatus === 'completed' || rawStatus === 'finished') status = 'completed'
  else if (endedAt !== null) status = 'completed'
  else if (startedAt !== null) status = 'active'
  else status = 'planned'

  if (status === 'planned' && plannedStartAt === null) {
    throw new ImportValidationError([`${path}.plannedStartAt: дата плана отсутствует`])
  }
  if (status !== 'planned' && startedAt === null) {
    throw new ImportValidationError([`${path}.startedAt: начало смены отсутствует`])
  }
  if (status === 'completed' && endedAt === null) {
    throw new ImportValidationError([`${path}.endedAt: окончание смены отсутствует`])
  }
  if (startedAt !== null && endedAt !== null && endedAt < startedAt) {
    throw new ImportValidationError([`${path}.endedAt: окончание раньше начала`])
  }
  if (status === 'active' && endedAt !== null) {
    status = 'completed'
    warn(`${path}: статус исправлен на завершённый по времени окончания`)
  }

  const rawBreaks = source.breaks ?? []
  if (!Array.isArray(rawBreaks)) {
    throw new ImportValidationError([`${path}.breaks: ожидался массив`])
  }
  const completedEnd = status === 'completed' ? endedAt : null
  const pauses = rawBreaks.map((pause, index) =>
    normalizeShiftBreak(
      pause,
      `${path}.breaks[${index}]`,
      index,
      completedEnd,
      warn,
    ),
  )
  const breakIds = new Set<string>()
  let previousEnd = startedAt
  let openBreakCount = 0
  for (const pause of [...pauses].sort((left, right) => left.startedAt - right.startedAt)) {
    if (breakIds.has(pause.id)) {
      throw new ImportValidationError([`${path}.breaks: повторяющийся id ${pause.id}`])
    }
    breakIds.add(pause.id)
    if (startedAt !== null && pause.startedAt < startedAt) {
      throw new ImportValidationError([`${path}.breaks: перерыв начался до смены`])
    }
    if (endedAt !== null && pause.startedAt > endedAt) {
      throw new ImportValidationError([`${path}.breaks: перерыв начался после смены`])
    }
    if (previousEnd !== null && pause.startedAt < previousEnd) {
      throw new ImportValidationError([`${path}.breaks: перерывы пересекаются`])
    }
    if (pause.endedAt === null) openBreakCount += 1
    previousEnd = pause.endedAt
  }
  if (openBreakCount > 1) {
    throw new ImportValidationError([`${path}.breaks: найдено несколько активных перерывов`])
  }
  if (status !== 'active' && openBreakCount > 0) {
    throw new ImportValidationError([`${path}.breaks: активный перерыв вне активной смены`])
  }

  const earningsSource = isRecord(source.earnings) ? source.earnings : source
  const baseKopecks = optionalNumber(
    earningsSource.baseKopecks ?? earningsSource.base,
    0,
    `${path}.earnings.baseKopecks`,
    { min: 0, integer: true },
  )
  const bonusKopecks = optionalNumber(
    earningsSource.bonusKopecks ?? earningsSource.bonus,
    0,
    `${path}.earnings.bonusKopecks`,
    { min: 0, integer: true },
  )
  const deductionKopecks = optionalNumber(
    earningsSource.deductionKopecks ?? earningsSource.deduction,
    0,
    `${path}.earnings.deductionKopecks`,
    { min: 0, integer: true },
  )
  const rawBoSubunits = earningsSource.baseBoSubunits
  const hasBo = rawBoSubunits !== undefined && rawBoSubunits !== null
  const isBaseEstimated = booleanValue(earningsSource.isBaseEstimated, false)
  const importedRate = hasBo
    ? optionalNumber(
        earningsSource.boRateSubkopecks ?? earningsSource.boRateKopecks,
        BO_RATE_SUBKOPECKS,
        `${path}.earnings.boRateSubkopecks`,
        { min: 1, max: Number.MAX_SAFE_INTEGER, integer: true },
      )
    : BO_RATE_SUBKOPECKS
  const earnings = hasBo
    ? calculateEarningsFromBoSubunits(
        optionalNumber(
          rawBoSubunits,
          0,
          `${path}.earnings.baseBoSubunits`,
          { min: 0, max: Number.MAX_SAFE_INTEGER, integer: true },
        ),
        bonusKopecks,
        deductionKopecks,
        BO_RATE_SUBKOPECKS,
        isBaseEstimated,
      )
    : calculateEarnings(
        baseKopecks,
        bonusKopecks,
        deductionKopecks,
        isBaseEstimated,
      )
  if (hasBo && importedRate !== BO_RATE_SUBKOPECKS) {
    warn(`${path}.earnings: курс БО обновлён до 0,8696 ₽`)
  }
  if (hasBo && baseKopecks !== earnings.baseKopecks) {
    warn(`${path}.earnings: начисление за БО пересчитано`)
  }
  if (
    typeof earningsSource.totalKopecks === 'number' &&
    earningsSource.totalKopecks !== earnings.totalKopecks
  ) {
    warn(`${path}.earnings: итоговая сумма пересчитана`)
  }

  const nowFallback = endedAt ?? startedAt ?? plannedStartAt ?? 0
  const createdAt = optionalTimestamp(
    source.createdAt,
    nowFallback,
    `${path}.createdAt`,
  ) as Timestamp
  const updatedAt = optionalTimestamp(
    source.updatedAt,
    endedAt ?? createdAt,
    `${path}.updatedAt`,
  ) as Timestamp
  const activePause = pauses.find((pause) => pause.endedAt === null)
  const activity: Shift['activity'] =
    status === 'planned'
      ? 'not_started'
      : status === 'completed'
        ? 'completed'
        : activePause?.type ?? 'work'

  return {
    id,
    status,
    activity,
    plannedStartAt,
    startedAt,
    plannedDurationMs,
    plannedEndAt:
      (startedAt ?? plannedStartAt) === null
        ? null
        : calculatePlannedEndAt(
            (startedAt ?? plannedStartAt) as Timestamp,
            plannedDurationMs,
          ),
    endedAt,
    extendByBreaks: booleanValue(
      source.extendByBreaks ?? source.extendShiftByBreaks,
      false,
    ),
    breaks: pauses.sort((left, right) => left.startedAt - right.startedAt),
    earnings,
    support: normalizeSupportMetrics(source.support, `${path}.support`),
    note: text(source.note),
    createdAt,
    updatedAt,
  }
}

function normalizePattern(value: unknown): SchedulePattern {
  if (!isRecord(value)) return { type: 'none' }
  if (value.type === 'two_on_two_off' || value.type === 'five_on_two_off') {
    return {
      type: value.type,
      anchorDate: text(value.anchorDate, new Date().toISOString().slice(0, 10)),
    }
  }
  if (value.type === 'weekdays' && Array.isArray(value.weekdays)) {
    const weekdays = value.weekdays
      .filter((day): day is number => Number.isInteger(day) && day >= 0 && day <= 6)
      .filter((day, index, values) => values.indexOf(day) === index)
    return weekdays.length > 0 ? { type: 'weekdays', weekdays } : { type: 'none' }
  }
  if (value.type === 'sequence' && Array.isArray(value.days)) {
    const days = value.days.filter((day): day is boolean => typeof day === 'boolean')
    if (days.length === value.days.length && days.length > 0) {
      return {
        type: 'sequence',
        days,
        anchorDate: text(value.anchorDate, new Date().toISOString().slice(0, 10)),
      }
    }
  }
  return { type: 'none' }
}

function normalizeDurationList(value: unknown, fallback: number[]): number[] {
  if (!Array.isArray(value)) return [...fallback]
  const normalized = value
    .filter((item): item is number => typeof item === 'number' && Number.isFinite(item) && item > 0)
    .map(Math.round)
    .filter((item, index, values) => values.indexOf(item) === index)
    .sort((left, right) => left - right)
  return normalized.length > 0 ? normalized : [...fallback]
}

export function normalizeAppSettings(input: unknown): AppSettings {
  const defaults = createDefaultSettings()
  if (!isRecord(input)) return defaults
  const source = isRecord(input.value) ? input.value : input
  const theme =
    source.theme === 'light' || source.theme === 'dark' || source.theme === 'system'
      ? source.theme
      : defaults.theme
  return {
    standardShiftDurationMs: optionalNumber(
      source.standardShiftDurationMs,
      defaults.standardShiftDurationMs,
      'settings.standardShiftDurationMs',
      { min: MINUTE_MS, integer: true },
    ),
    standardBreakDurationMs: optionalNumber(
      source.standardBreakDurationMs,
      defaults.standardBreakDurationMs,
      'settings.standardBreakDurationMs',
      { min: MINUTE_MS, integer: true },
    ),
    standardLunchDurationMs: optionalNumber(
      source.standardLunchDurationMs,
      defaults.standardLunchDurationMs,
      'settings.standardLunchDurationMs',
      { min: MINUTE_MS, integer: true },
    ),
    savedBreakDurationsMs: normalizeDurationList(
      source.savedBreakDurationsMs,
      defaults.savedBreakDurationsMs,
    ),
    savedLunchDurationsMs: normalizeDurationList(
      source.savedLunchDurationsMs,
      defaults.savedLunchDurationsMs,
    ),
    extendShiftByBreaks: booleanValue(
      source.extendShiftByBreaks,
      defaults.extendShiftByBreaks,
    ),
    notificationLeadMinutes: normalizeDurationList(
      source.notificationLeadMinutes,
      defaults.notificationLeadMinutes,
    ).filter((minutes) => minutes <= 24 * 60),
    systemNotifications: booleanValue(
      source.systemNotifications,
      defaults.systemNotifications,
    ),
    soundEnabled: booleanValue(source.soundEnabled, defaults.soundEnabled),
    preliminaryReminders: booleanValue(
      source.preliminaryReminders,
      defaults.preliminaryReminders,
    ),
    soundVolume: optionalNumber(
      source.soundVolume,
      defaults.soundVolume,
      'settings.soundVolume',
      { min: 0, max: 1 },
    ),
    theme,
    hourlyRateKopecks:
      source.hourlyRateKopecks === null || source.hourlyRateKopecks === undefined
        ? null
        : finiteNumber(source.hourlyRateKopecks, 'settings.hourlyRateKopecks', {
            min: 0,
            integer: true,
          }),
    monthlyGoalKopecks:
      source.monthlyGoalKopecks === null || source.monthlyGoalKopecks === undefined
        ? null
        : finiteNumber(source.monthlyGoalKopecks, 'settings.monthlyGoalKopecks', {
            min: 0,
            integer: true,
          }),
    supportMetricsEnabled: booleanValue(
      source.supportMetricsEnabled,
      defaults.supportMetricsEnabled,
    ),
    use24HourTime: booleanValue(source.use24HourTime, defaults.use24HourTime),
    confirmShiftFinish: booleanValue(
      source.confirmShiftFinish,
      defaults.confirmShiftFinish,
    ),
    offerMiniTimerOnShiftStart: booleanValue(
      source.offerMiniTimerOnShiftStart,
      defaults.offerMiniTimerOnShiftStart,
    ),
    schedulePattern: normalizePattern(source.schedulePattern),
  }
}

export function normalizeShiftPlan(input: unknown, path = 'plan'): ShiftPlan {
  const source = record(input, path)
  const startAt = timestamp(source.startAt, `${path}.startAt`)
  const createdAt = optionalTimestamp(
    source.createdAt,
    startAt,
    `${path}.createdAt`,
  ) as Timestamp
  return {
    id: nonEmptyString(source.id, `${path}.id`),
    startAt,
    durationMs: finiteNumber(source.durationMs, `${path}.durationMs`, {
      min: MINUTE_MS,
      integer: true,
    }),
    note: text(source.note),
    patternId:
      source.patternId === null || source.patternId === undefined
        ? null
        : nonEmptyString(source.patternId, `${path}.patternId`),
    createdAt,
    updatedAt: optionalTimestamp(
      source.updatedAt,
      createdAt,
      `${path}.updatedAt`,
    ) as Timestamp,
  }
}

export function validateAndNormalizeBackup(
  input: unknown,
  now: Timestamp = Date.now(),
): ImportPreview {
  const source = record(input, 'backup')
  const issues: string[] = []
  const warnings: string[] = []
  const format = source.format
  const version = source.version
  if (format !== BACKUP_FORMAT) {
    issues.push(`backup.format: ожидалось «${BACKUP_FORMAT}»`)
  }
  if (
    version !== 1 &&
    version !== 2 &&
    version !== 3 &&
    version !== BACKUP_VERSION
  ) {
    issues.push(`backup.version: версия ${String(version)} не поддерживается`)
  }
  if (version === 1 || version === 2 || version === 3) {
    warnings.push(`Резервная копия версии ${version} будет обновлена до версии ${BACKUP_VERSION}`)
  }
  if (!Array.isArray(source.shifts)) issues.push('backup.shifts: ожидался массив')
  if (source.plans !== undefined && !Array.isArray(source.plans)) {
    issues.push('backup.plans: ожидался массив')
  }
  if (issues.length > 0) throw new ImportValidationError(issues)

  const shifts: Shift[] = []
  for (const [index, item] of (source.shifts as unknown[]).entries()) {
    try {
      shifts.push(
        normalizeShift(item, `backup.shifts[${index}]`, (warning) =>
          warnings.push(warning),
        ),
      )
    } catch (error) {
      if (error instanceof ImportValidationError) issues.push(...error.issues)
      else throw error
    }
  }
  const plans: ShiftPlan[] = []
  for (const [index, item] of ((source.plans as unknown[] | undefined) ?? []).entries()) {
    try {
      plans.push(normalizeShiftPlan(item, `backup.plans[${index}]`))
    } catch (error) {
      if (error instanceof ImportValidationError) issues.push(...error.issues)
      else throw error
    }
  }

  const shiftIds = new Set<string>()
  for (const shift of shifts) {
    if (shiftIds.has(shift.id)) issues.push(`backup.shifts: повторяющийся id ${shift.id}`)
    shiftIds.add(shift.id)
  }
  const planIds = new Set<string>()
  for (const plan of plans) {
    if (planIds.has(plan.id)) issues.push(`backup.plans: повторяющийся id ${plan.id}`)
    planIds.add(plan.id)
  }
  const activeShiftCount = shifts.filter((shift) => shift.status === 'active').length
  if (activeShiftCount > 1) {
    issues.push('backup.shifts: резервная копия содержит несколько активных смен')
  }
  if (issues.length > 0) throw new ImportValidationError(issues)

  const backup: BackupDocument = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: optionalTimestamp(
      source.exportedAt,
      now,
      'backup.exportedAt',
    ) as Timestamp,
    shifts,
    plans,
    settings: normalizeAppSettings(source.settings),
  }
  const anchors = shifts
    .map((shift) => shift.startedAt ?? shift.plannedStartAt)
    .filter((value): value is number => value !== null)

  return {
    backup,
    warnings,
    shiftCount: shifts.length,
    activeShiftCount,
    completedShiftCount: shifts.filter((shift) => shift.status === 'completed').length,
    plannedShiftCount: shifts.filter((shift) => shift.status === 'planned').length,
    planCount: plans.length,
    totalEarningsKopecks: shifts.reduce(
      (total, shift) => total + shift.earnings.totalKopecks,
      0,
    ),
    dateRange:
      anchors.length === 0
        ? null
        : { startAt: Math.min(...anchors), endAt: Math.max(...anchors) },
  }
}

export function parseBackupJson(
  json: string,
  now: Timestamp = Date.now(),
): ImportPreview {
  let parsed: unknown
  try {
    parsed = JSON.parse(json) as unknown
  } catch {
    throw new ImportValidationError(['JSON повреждён или имеет неверный синтаксис'])
  }
  return validateAndNormalizeBackup(parsed, now)
}

export function createLegacyShiftForMigration(input: unknown): Shift {
  const source = isRecord(input) ? { ...input } : input
  if (isRecord(source) && source.plannedDurationMs === undefined) {
    source.plannedDurationMs = 12 * HOUR_MS
  }
  return normalizeShift(source, 'migration.shift')
}
