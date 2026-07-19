export type ShiftId = string
export type BreakId = string
export type PlanId = string

/** Absolute local-device time represented as Unix epoch milliseconds. */
export type Timestamp = number
export type DurationMs = number
/** Money is always stored as an integer number of kopecks. */
export type Kopecks = number
/** BO are stored as integer ten-thousandths to avoid floating-point drift. */
export type BoSubunits = number

export type ShiftStatus = 'planned' | 'active' | 'completed'
export type ShiftActivity =
  | 'not_started'
  | 'work'
  | 'break'
  | 'lunch'
  | 'completed'
export type RuntimeShiftStatus =
  | 'not_started'
  | 'work'
  | 'break'
  | 'lunch'
  | 'completed'
  | 'overtime'
export type BreakType = 'break' | 'lunch'

export interface ShiftBreak {
  id: BreakId
  type: BreakType
  startedAt: Timestamp
  plannedDurationMs: DurationMs
  plannedEndAt: Timestamp
  endedAt: Timestamp | null
  actualDurationMs: DurationMs | null
  overtimeMs: DurationMs
}

export interface ShiftEarnings {
  /** Null means that this legacy/manual record was entered directly in rubles. */
  baseBoSubunits: BoSubunits | null
  /** Conversion rate captured with the shift, in kopecks for one BO. */
  boRateKopecks: Kopecks
  baseKopecks: Kopecks
  bonusKopecks: Kopecks
  deductionKopecks: Kopecks
  totalKopecks: Kopecks
  isBaseEstimated: boolean
}

export interface SupportMetrics {
  handledRequests: number | null
  chats: number | null
  calls: number | null
  qualityScore: number | null
  averageResponseTimeMs: DurationMs | null
  complexCases: number | null
  learningNote: string
  summaryNote: string
}

export interface Shift {
  id: ShiftId
  status: ShiftStatus
  activity: ShiftActivity
  plannedStartAt: Timestamp | null
  startedAt: Timestamp | null
  plannedDurationMs: DurationMs
  /** Base planned end before optional break extension. */
  plannedEndAt: Timestamp | null
  endedAt: Timestamp | null
  extendByBreaks: boolean
  breaks: ShiftBreak[]
  earnings: ShiftEarnings
  support: SupportMetrics | null
  note: string
  createdAt: Timestamp
  updatedAt: Timestamp
}

export type SchedulePattern =
  | { type: 'none' }
  | { type: 'two_on_two_off'; anchorDate: string }
  | { type: 'five_on_two_off'; anchorDate: string }
  | { type: 'weekdays'; weekdays: number[] }
  | { type: 'sequence'; days: boolean[]; anchorDate: string }

export interface ShiftPlan {
  id: PlanId
  startAt: Timestamp
  durationMs: DurationMs
  note: string
  patternId: string | null
  createdAt: Timestamp
  updatedAt: Timestamp
}

export type ThemePreference = 'light' | 'dark' | 'system'

export interface AppSettings {
  standardShiftDurationMs: DurationMs
  standardBreakDurationMs: DurationMs
  standardLunchDurationMs: DurationMs
  savedBreakDurationsMs: DurationMs[]
  savedLunchDurationsMs: DurationMs[]
  extendShiftByBreaks: boolean
  notificationLeadMinutes: number[]
  systemNotifications: boolean
  soundEnabled: boolean
  preliminaryReminders: boolean
  soundVolume: number
  theme: ThemePreference
  hourlyRateKopecks: Kopecks | null
  monthlyGoalKopecks: Kopecks | null
  supportMetricsEnabled: boolean
  use24HourTime: boolean
  confirmShiftFinish: boolean
  offerMiniTimerOnShiftStart: boolean
  schedulePattern: SchedulePattern
}

export interface ShiftMetrics {
  elapsedMs: DurationMs
  netWorkMs: DurationMs
  breakMs: DurationMs
  lunchMs: DurationMs
  totalPauseMs: DurationMs
  expectedEndAt: Timestamp | null
  remainingMs: DurationMs
  overtimeMs: DurationMs
  undertimeMs: DurationMs
  progress: number
  breakCount: number
  lunchCount: number
}

export interface BreakTimerSnapshot {
  breakId: BreakId
  type: BreakType
  expectedReturnAt: Timestamp
  remainingMs: DurationMs
  overtimeMs: DurationMs
}

export interface TimerSnapshot extends ShiftMetrics {
  status: RuntimeShiftStatus
  activeBreak: BreakTimerSnapshot | null
}

export interface DateRange {
  startAt: Timestamp
  endAt: Timestamp
}

export interface SupportStatistics {
  shiftsWithMetrics: number
  totalHandledRequests: number
  totalChats: number
  totalCalls: number
  totalComplexCases: number
  requestsPerNetHour: number
  averageRequestsPerShift: number
  averageQualityScore: number | null
  qualityScoreChange: number | null
}

export interface StatisticsSummary {
  shiftCount: number
  totalElapsedMs: DurationMs
  totalNetWorkMs: DurationMs
  totalBreakMs: DurationMs
  totalLunchMs: DurationMs
  overtimeShiftCount: number
  totalOvertimeMs: DurationMs
  totalUndertimeMs: DurationMs
  averageShiftMs: DurationMs
  totalEarningsKopecks: Kopecks
  averageEarningsKopecks: Kopecks
  averageEarningsPerNetHourKopecks: Kopecks
  financialGoalKopecks: Kopecks | null
  financialGoalProgress: number | null
  longestShiftId: ShiftId | null
  mostProfitableShiftId: ShiftId | null
  averagePauseMs: DurationMs
  support: SupportStatistics | null
}

export interface StatisticsBucket extends StatisticsSummary {
  key: string
  startAt: Timestamp
  endAt: Timestamp
}

export interface SettingsRecord {
  key: 'settings'
  value: AppSettings
  updatedAt: Timestamp
}

export interface MetaRecord {
  key: string
  value: string | number | boolean | null
  updatedAt: Timestamp
}

export const BACKUP_FORMAT = 'moya-smena-backup' as const
export const BACKUP_VERSION = 3 as const

export interface BackupDocument {
  format: typeof BACKUP_FORMAT
  version: typeof BACKUP_VERSION
  exportedAt: Timestamp
  shifts: Shift[]
  plans: ShiftPlan[]
  settings: AppSettings
}

export interface ImportPreview {
  backup: BackupDocument
  warnings: string[]
  shiftCount: number
  activeShiftCount: number
  completedShiftCount: number
  plannedShiftCount: number
  planCount: number
  totalEarningsKopecks: Kopecks
  dateRange: DateRange | null
}

export type ImportMode = 'replace' | 'merge'

export type TrackerAction =
  | {
      type: 'START_SHIFT'
      id: ShiftId
      at: Timestamp
      plannedDurationMs: DurationMs
      extendByBreaks: boolean
      plannedStartAt?: Timestamp | null
    }
  | {
      type: 'START_BREAK'
      id: BreakId
      at: Timestamp
      plannedDurationMs: DurationMs
      breakType: BreakType
    }
  | { type: 'RESUME_WORK'; at: Timestamp }
  | { type: 'FINISH_SHIFT'; at: Timestamp }

export interface TrackerState {
  activeShift: Shift | null
}

export interface TransitionResult {
  state: TrackerState
  changedShift: Shift
}

export type AvailableTrackerAction =
  | 'START_SHIFT'
  | 'START_BREAK'
  | 'START_LUNCH'
  | 'RESUME_WORK'
  | 'FINISH_SHIFT'

export interface RepositoryChange {
  kind: 'shift' | 'plan' | 'settings' | 'import'
  entityId: string | null
  at: Timestamp
}
