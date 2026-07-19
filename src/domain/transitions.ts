import {
  calculateBreakDuration,
  calculateBreakOvertime,
  calculateEarnings,
  calculateEarningsFromBoSubunits,
  calculatePlannedEndAt,
  getActiveBreak,
} from './calculations'
import { createEmptyEarnings } from './defaults'
import type {
  AvailableTrackerAction,
  BreakType,
  DurationMs,
  Shift,
  ShiftBreak,
  ShiftEarnings,
  ShiftId,
  ShiftPlan,
  Timestamp,
  TrackerAction,
  TrackerState,
  TransitionResult,
} from './types'

export type TransitionErrorCode =
  | 'ACTIVE_SHIFT_EXISTS'
  | 'NO_ACTIVE_SHIFT'
  | 'INVALID_DURATION'
  | 'INVALID_TIMESTAMP'
  | 'BREAK_ALREADY_ACTIVE'
  | 'NO_ACTIVE_BREAK'
  | 'SHIFT_ALREADY_COMPLETED'
  | 'DUPLICATE_BREAK_ID'

export class DomainTransitionError extends Error {
  readonly code: TransitionErrorCode

  constructor(code: TransitionErrorCode, message: string) {
    super(message)
    this.name = 'DomainTransitionError'
    this.code = code
  }
}

function assertTimestamp(at: Timestamp, notBefore?: Timestamp): void {
  if (!Number.isFinite(at) || (notBefore !== undefined && at < notBefore)) {
    throw new DomainTransitionError(
      'INVALID_TIMESTAMP',
      'Временная метка не может предшествовать текущему событию смены',
    )
  }
}

function assertDuration(durationMs: DurationMs): void {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new DomainTransitionError(
      'INVALID_DURATION',
      'Продолжительность должна быть положительным числом',
    )
  }
}

function cloneShift(shift: Shift): Shift {
  return {
    ...shift,
    breaks: shift.breaks.map((pause) => ({ ...pause })),
    earnings: { ...shift.earnings },
    support: shift.support === null ? null : { ...shift.support },
  }
}

function createActiveShift(action: Extract<TrackerAction, { type: 'START_SHIFT' }>): Shift {
  assertTimestamp(action.at)
  assertDuration(action.plannedDurationMs)

  return {
    id: action.id,
    status: 'active',
    activity: 'work',
    plannedStartAt: action.plannedStartAt ?? action.at,
    startedAt: action.at,
    plannedDurationMs: action.plannedDurationMs,
    plannedEndAt: calculatePlannedEndAt(action.at, action.plannedDurationMs),
    endedAt: null,
    extendByBreaks: action.extendByBreaks,
    breaks: [],
    earnings: createEmptyEarnings(),
    support: null,
    note: '',
    createdAt: action.at,
    updatedAt: action.at,
  }
}

function startPause(
  source: Shift,
  id: string,
  type: BreakType,
  at: Timestamp,
  plannedDurationMs: DurationMs,
): Shift {
  if (source.status === 'completed') {
    throw new DomainTransitionError(
      'SHIFT_ALREADY_COMPLETED',
      'Завершённую смену нельзя перевести на перерыв',
    )
  }
  if (source.status !== 'active') {
    throw new DomainTransitionError(
      'NO_ACTIVE_SHIFT',
      'Для перерыва нужна активная смена',
    )
  }
  if (source.activity !== 'work' || getActiveBreak(source) !== null) {
    throw new DomainTransitionError(
      'BREAK_ALREADY_ACTIVE',
      'В смене уже идёт перерыв или обед',
    )
  }
  if (source.breaks.some((pause) => pause.id === id)) {
    throw new DomainTransitionError(
      'DUPLICATE_BREAK_ID',
      'Перерыв с таким идентификатором уже существует',
    )
  }
  assertDuration(plannedDurationMs)
  assertTimestamp(at, source.startedAt ?? undefined)

  const pause: ShiftBreak = {
    id,
    type,
    startedAt: at,
    plannedDurationMs,
    plannedEndAt: at + plannedDurationMs,
    endedAt: null,
    actualDurationMs: null,
    overtimeMs: 0,
  }
  const shift = cloneShift(source)
  shift.breaks.push(pause)
  shift.activity = type
  shift.updatedAt = at
  return shift
}

function finishPause(source: Shift, at: Timestamp): Shift {
  if (source.status !== 'active') {
    throw new DomainTransitionError(
      'NO_ACTIVE_SHIFT',
      'Нет активной смены для возврата к работе',
    )
  }
  const activePause = getActiveBreak(source)
  if (activePause === null) {
    throw new DomainTransitionError(
      'NO_ACTIVE_BREAK',
      'Нет активного перерыва или обеда',
    )
  }
  assertTimestamp(at, activePause.startedAt)

  const shift = cloneShift(source)
  const pause = shift.breaks.find((candidate) => candidate.id === activePause.id)
  if (pause === undefined) {
    throw new DomainTransitionError(
      'NO_ACTIVE_BREAK',
      'Активный перерыв не найден',
    )
  }
  pause.endedAt = at
  pause.actualDurationMs = calculateBreakDuration(pause, at)
  pause.overtimeMs = calculateBreakOvertime(pause, at)
  shift.activity = 'work'
  shift.updatedAt = at
  return shift
}

function finishShift(source: Shift, at: Timestamp): Shift {
  if (source.status === 'completed') {
    throw new DomainTransitionError(
      'SHIFT_ALREADY_COMPLETED',
      'Смена уже завершена',
    )
  }
  if (source.status !== 'active' || source.startedAt === null) {
    throw new DomainTransitionError(
      'NO_ACTIVE_SHIFT',
      'Нет активной смены для завершения',
    )
  }
  assertTimestamp(at, source.startedAt)

  let shift = cloneShift(source)
  if (getActiveBreak(shift) !== null) {
    shift = finishPause(shift, at)
  }
  shift.status = 'completed'
  shift.activity = 'completed'
  shift.endedAt = at
  shift.updatedAt = at
  return shift
}

export function transitionTracker(
  state: TrackerState,
  action: TrackerAction,
): TransitionResult {
  if (action.type === 'START_SHIFT') {
    if (state.activeShift !== null) {
      throw new DomainTransitionError(
        'ACTIVE_SHIFT_EXISTS',
        'Одновременно может существовать только одна активная смена',
      )
    }
    const changedShift = createActiveShift(action)
    return { state: { activeShift: changedShift }, changedShift }
  }

  if (state.activeShift === null) {
    throw new DomainTransitionError(
      'NO_ACTIVE_SHIFT',
      'Активная смена не найдена',
    )
  }

  let changedShift: Shift
  switch (action.type) {
    case 'START_BREAK':
      changedShift = startPause(
        state.activeShift,
        action.id,
        action.breakType,
        action.at,
        action.plannedDurationMs,
      )
      break
    case 'RESUME_WORK':
      changedShift = finishPause(state.activeShift, action.at)
      break
    case 'FINISH_SHIFT':
      changedShift = finishShift(state.activeShift, action.at)
      break
  }

  return {
    state: {
      activeShift: changedShift.status === 'active' ? changedShift : null,
    },
    changedShift,
  }
}

export function getAvailableActions(
  activeShift: Shift | null,
): AvailableTrackerAction[] {
  if (activeShift === null) return ['START_SHIFT']
  if (activeShift.status !== 'active') return []
  if (getActiveBreak(activeShift) !== null) {
    return ['RESUME_WORK', 'FINISH_SHIFT']
  }
  return ['START_BREAK', 'START_LUNCH', 'FINISH_SHIFT']
}

export interface PlannedShiftInput {
  id: ShiftId
  startAt: Timestamp
  durationMs: DurationMs
  extendByBreaks?: boolean
  note?: string
  createdAt?: Timestamp
}

export function createPlannedShift(input: PlannedShiftInput): Shift {
  assertTimestamp(input.startAt)
  assertDuration(input.durationMs)
  const createdAt = input.createdAt ?? Date.now()
  return {
    id: input.id,
    status: 'planned',
    activity: 'not_started',
    plannedStartAt: input.startAt,
    startedAt: null,
    plannedDurationMs: input.durationMs,
    plannedEndAt: calculatePlannedEndAt(input.startAt, input.durationMs),
    endedAt: null,
    extendByBreaks: input.extendByBreaks ?? false,
    breaks: [],
    earnings: createEmptyEarnings(),
    support: null,
    note: input.note ?? '',
    createdAt,
    updatedAt: createdAt,
  }
}

export function createShiftPlan(
  input: PlannedShiftInput & { patternId?: string | null },
): ShiftPlan {
  assertTimestamp(input.startAt)
  assertDuration(input.durationMs)
  const createdAt = input.createdAt ?? Date.now()
  return {
    id: input.id,
    startAt: input.startAt,
    durationMs: input.durationMs,
    note: input.note ?? '',
    patternId: input.patternId ?? null,
    createdAt,
    updatedAt: createdAt,
  }
}

export function updateShiftEarnings(
  source: Shift,
  earnings: Omit<ShiftEarnings, 'totalKopecks'>,
  at: Timestamp = Date.now(),
): Shift {
  assertTimestamp(at)
  const shift = cloneShift(source)
  shift.earnings = earnings.baseBoSubunits === null
    ? calculateEarnings(
        earnings.baseKopecks,
        earnings.bonusKopecks,
        earnings.deductionKopecks,
        earnings.isBaseEstimated,
      )
    : calculateEarningsFromBoSubunits(
        earnings.baseBoSubunits,
        earnings.bonusKopecks,
        earnings.deductionKopecks,
        earnings.boRateKopecks,
        earnings.isBaseEstimated,
      )
  shift.updatedAt = at
  return shift
}
