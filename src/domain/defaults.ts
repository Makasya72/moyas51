import {
  BO_RATE_SUBKOPECKS,
  type AppSettings,
  type ShiftEarnings,
  type SupportMetrics,
} from './types'

export const MINUTE_MS = 60_000
export const HOUR_MS = 60 * MINUTE_MS
export const DAY_MS = 24 * HOUR_MS

const DEFAULT_SETTINGS_VALUE = {
  standardShiftDurationMs: 12 * HOUR_MS,
  standardBreakDurationMs: 15 * MINUTE_MS,
  standardLunchDurationMs: 30 * MINUTE_MS,
  savedBreakDurationsMs: [10, 15, 20].map((minutes) => minutes * MINUTE_MS),
  savedLunchDurationsMs: [30, 45, 60].map((minutes) => minutes * MINUTE_MS),
  extendShiftByBreaks: false,
  notificationLeadMinutes: [5, 1],
  systemNotifications: false,
  soundEnabled: true,
  preliminaryReminders: true,
  soundVolume: 0.6,
  theme: 'system',
  hourlyRateKopecks: null,
  monthlyGoalKopecks: null,
  supportMetricsEnabled: true,
  use24HourTime: true,
  confirmShiftFinish: true,
  offerMiniTimerOnShiftStart: true,
  schedulePattern: { type: 'none' },
} satisfies AppSettings

export const DEFAULT_SETTINGS: Readonly<AppSettings> = Object.freeze(
  DEFAULT_SETTINGS_VALUE,
)

export function createDefaultSettings(): AppSettings {
  return {
    ...DEFAULT_SETTINGS,
    savedBreakDurationsMs: [...DEFAULT_SETTINGS.savedBreakDurationsMs],
    savedLunchDurationsMs: [...DEFAULT_SETTINGS.savedLunchDurationsMs],
    notificationLeadMinutes: [...DEFAULT_SETTINGS.notificationLeadMinutes],
    schedulePattern: { ...DEFAULT_SETTINGS.schedulePattern },
  }
}

export function createEmptyEarnings(): ShiftEarnings {
  return {
    baseBoSubunits: null,
    boRateSubkopecks: BO_RATE_SUBKOPECKS,
    baseKopecks: 0,
    bonusKopecks: 0,
    deductionKopecks: 0,
    totalKopecks: 0,
    isBaseEstimated: false,
  }
}

export function createEmptySupportMetrics(): SupportMetrics {
  return {
    handledRequests: null,
    chats: null,
    calls: null,
    qualityScore: null,
    averageResponseTimeMs: null,
    complexCases: null,
    learningNote: '',
    summaryNote: '',
  }
}
