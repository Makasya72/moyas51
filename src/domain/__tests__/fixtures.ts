import { HOUR_MS, MINUTE_MS } from '../defaults'
import type { Shift, ShiftBreak } from '../types'

export const BASE_TIME = new Date(2026, 6, 1, 8, 0, 0).getTime()

export function makeBreak(overrides: Partial<ShiftBreak> = {}): ShiftBreak {
  const startedAt = overrides.startedAt ?? BASE_TIME + 2 * HOUR_MS
  const plannedDurationMs = overrides.plannedDurationMs ?? 15 * MINUTE_MS
  const endedAt = overrides.endedAt === undefined ? startedAt + plannedDurationMs : overrides.endedAt
  const actualDurationMs =
    overrides.actualDurationMs === undefined
      ? endedAt === null
        ? null
        : endedAt - startedAt
      : overrides.actualDurationMs
  return {
    id: 'break-1',
    type: 'break',
    startedAt,
    plannedDurationMs,
    plannedEndAt: startedAt + plannedDurationMs,
    endedAt,
    actualDurationMs,
    overtimeMs:
      overrides.overtimeMs ??
      (actualDurationMs === null
        ? 0
        : Math.max(0, actualDurationMs - plannedDurationMs)),
    ...overrides,
  }
}

export function makeShift(overrides: Partial<Shift> = {}): Shift {
  const startedAt = overrides.startedAt === undefined ? BASE_TIME : overrides.startedAt
  const plannedDurationMs = overrides.plannedDurationMs ?? 12 * HOUR_MS
  const status = overrides.status ?? 'completed'
  const endedAt =
    overrides.endedAt === undefined
      ? status === 'completed' && startedAt !== null
        ? startedAt + plannedDurationMs
        : null
      : overrides.endedAt
  return {
    id: 'shift-1',
    status,
    activity:
      overrides.activity ??
      (status === 'completed'
        ? 'completed'
        : status === 'planned'
          ? 'not_started'
          : 'work'),
    plannedStartAt: overrides.plannedStartAt ?? startedAt,
    startedAt,
    plannedDurationMs,
    plannedEndAt: startedAt === null ? null : startedAt + plannedDurationMs,
    endedAt,
    extendByBreaks: false,
    breaks: [],
    earnings: {
      baseBoSubunits: null,
      boRateKopecks: 80,
      baseKopecks: 0,
      bonusKopecks: 0,
      deductionKopecks: 0,
      totalKopecks: 0,
      isBaseEstimated: false,
    },
    support: null,
    note: '',
    createdAt: BASE_TIME,
    updatedAt: endedAt ?? BASE_TIME,
    ...overrides,
  }
}
