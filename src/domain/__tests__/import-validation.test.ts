import { describe, expect, it } from 'vitest'
import { createDefaultSettings, HOUR_MS, MINUTE_MS } from '../defaults'
import {
  ImportValidationError,
  normalizeAppSettings,
  normalizeShift,
  normalizeShiftPlan,
  parseBackupJson,
  validateAndNormalizeBackup,
} from '../import-validation'
import { BACKUP_FORMAT, BACKUP_VERSION } from '../types'
import { BASE_TIME, makeBreak, makeShift } from './fixtures'

function backup(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: BASE_TIME,
    shifts: [makeShift()],
    plans: [],
    settings: createDefaultSettings(),
    ...overrides,
  }
}

function expectImportIssue(run: () => unknown, fragment: string): void {
  try {
    run()
    throw new Error('Ожидалась ошибка импорта')
  } catch (error) {
    expect(error).toBeInstanceOf(ImportValidationError)
    expect((error as ImportValidationError).issues.join('\n')).toContain(fragment)
  }
}

describe('проверка и нормализация импорта', () => {
  it('принимает корректную полную резервную копию и строит превью', () => {
    const preview = validateAndNormalizeBackup(backup())
    expect(preview.shiftCount).toBe(1)
    expect(preview.completedShiftCount).toBe(1)
    expect(preview.activeShiftCount).toBe(0)
    expect(preview.backup.version).toBe(BACKUP_VERSION)
  })

  it('отклоняет повреждённый JSON с понятной ошибкой', () => {
    expectImportIssue(() => parseBackupJson('{"shifts": ['), 'JSON повреждён')
  })

  it('отклоняет неверный формат резервной копии', () => {
    expectImportIssue(
      () => validateAndNormalizeBackup(backup({ format: 'foreign-app' })),
      'backup.format',
    )
  })

  it('отклоняет неподдерживаемую будущую версию', () => {
    expectImportIssue(
      () => validateAndNormalizeBackup(backup({ version: 99 })),
      'не поддерживается',
    )
  })

  it('обновляет резервную копию версии 1 и предупреждает пользователя', () => {
    const preview = validateAndNormalizeBackup(backup({ version: 1 }))
    expect(preview.backup.version).toBe(BACKUP_VERSION)
    expect(preview.warnings.join(' ')).toContain('версии 1')
  })

  it('сохраняет старую рублёвую сумму при обновлении резервной копии версии 2', () => {
    const legacyShift = structuredClone(makeShift()) as unknown as {
      earnings: Record<string, unknown>
    }
    legacyShift.earnings.baseKopecks = 28_000
    legacyShift.earnings.totalKopecks = 28_000
    delete legacyShift.earnings.baseBoSubunits
    delete legacyShift.earnings.boRateKopecks

    const preview = validateAndNormalizeBackup(
      backup({ version: 2, shifts: [legacyShift] }),
    )
    expect(preview.backup.version).toBe(BACKUP_VERSION)
    expect(preview.backup.shifts[0].earnings.baseKopecks).toBe(28_000)
    expect(preview.backup.shifts[0].earnings.baseBoSubunits).toBeNull()
    expect(preview.warnings.join(' ')).toContain('версии 2')
  })

  it('восстанавливает начисление из сохранённого количества БО', () => {
    const warnings: string[] = []
    const normalized = normalizeShift(
      makeShift({
        earnings: {
          baseBoSubunits: 3_500_000,
          boRateKopecks: 80,
          baseKopecks: 1,
          bonusKopecks: 0,
          deductionKopecks: 0,
          totalKopecks: 1,
          isBaseEstimated: false,
        },
      }),
      'shift',
      (warning) => warnings.push(warning),
    )
    expect(normalized.earnings.baseKopecks).toBe(28_000)
    expect(normalized.earnings.totalKopecks).toBe(28_000)
    expect(warnings.join(' ')).toContain('начисление за БО пересчитано')
  })

  it('отклоняет повторяющиеся идентификаторы смен', () => {
    expectImportIssue(
      () =>
        validateAndNormalizeBackup(
          backup({ shifts: [makeShift(), makeShift()] }),
        ),
      'повторяющийся id',
    )
  })

  it('отклоняет две активные смены', () => {
    const active = makeShift({
      status: 'active',
      activity: 'work',
      endedAt: null,
    })
    expectImportIssue(
      () =>
        validateAndNormalizeBackup(
          backup({
            shifts: [active, { ...active, id: 'second-active' }],
          }),
        ),
      'несколько активных смен',
    )
  })

  it('нормализует ISO-даты и старые имена полей', () => {
    const start = new Date(BASE_TIME).toISOString()
    const end = new Date(BASE_TIME + 8 * HOUR_MS).toISOString()
    const normalized = normalizeShift({
      id: 'legacy',
      status: 'finished',
      startAt: start,
      endAt: end,
      plannedDurationMinutes: 480,
      breaks: [],
      base: 100_000,
      bonus: 5_000,
      deduction: 2_000,
    })
    expect(normalized.startedAt).toBe(BASE_TIME)
    expect(normalized.plannedDurationMs).toBe(8 * HOUR_MS)
    expect(normalized.earnings.totalKopecks).toBe(103_000)
  })

  it('пересчитывает недостоверную итоговую сумму денег', () => {
    const warnings: string[] = []
    const normalized = normalizeShift(
      makeShift({
        earnings: {
          baseBoSubunits: null,
          boRateKopecks: 80,
          baseKopecks: 100_000,
          bonusKopecks: 20_000,
          deductionKopecks: 5_000,
          totalKopecks: 1,
          isBaseEstimated: false,
        },
      }),
      'shift',
      (warning) => warnings.push(warning),
    )
    expect(normalized.earnings.totalKopecks).toBe(115_000)
    expect(warnings.join(' ')).toContain('пересчитана')
  })

  it('закрывает незавершённый перерыв временем завершённой смены', () => {
    const openPause = makeBreak({ endedAt: null, actualDurationMs: null })
    const warnings: string[] = []
    const normalized = normalizeShift(
      makeShift({ breaks: [openPause] }),
      'shift',
      (warning) => warnings.push(warning),
    )
    expect(normalized.breaks[0].endedAt).toBe(normalized.endedAt)
    expect(normalized.breaks[0].actualDurationMs).toBe(10 * HOUR_MS)
    expect(warnings.join(' ')).toContain('завершён вместе со сменой')
  })

  it('отклоняет окончание смены раньше начала', () => {
    expectImportIssue(
      () => normalizeShift(makeShift({ endedAt: BASE_TIME - MINUTE_MS })),
      'окончание раньше начала',
    )
  })

  it('отклоняет пересекающиеся перерывы', () => {
    const first = makeBreak({
      id: 'first',
      startedAt: BASE_TIME + HOUR_MS,
      endedAt: BASE_TIME + HOUR_MS + 20 * MINUTE_MS,
      actualDurationMs: 20 * MINUTE_MS,
    })
    const second = makeBreak({
      id: 'second',
      startedAt: BASE_TIME + HOUR_MS + 10 * MINUTE_MS,
      endedAt: BASE_TIME + HOUR_MS + 30 * MINUTE_MS,
      actualDurationMs: 20 * MINUTE_MS,
    })
    expectImportIssue(
      () => normalizeShift(makeShift({ breaks: [first, second] })),
      'перерывы пересекаются',
    )
  })

  it('отклоняет несколько открытых перерывов активной смены', () => {
    const first = makeBreak({ id: 'first', endedAt: null, actualDurationMs: null })
    const second = makeBreak({
      id: 'second',
      startedAt: first.startedAt + HOUR_MS,
      endedAt: null,
      actualDurationMs: null,
    })
    expectImportIssue(
      () =>
        normalizeShift(
          makeShift({
            status: 'active',
            activity: 'break',
            endedAt: null,
            breaks: [first, second],
          }),
        ),
      'несколько активных перерывов',
    )
  })

  it('нормализует настройки, удаляя дубликаты длительностей', () => {
    const settings = normalizeAppSettings({
      savedBreakDurationsMs: [15 * MINUTE_MS, 10 * MINUTE_MS, 15 * MINUTE_MS],
      soundVolume: 0.25,
      theme: 'dark',
    })
    expect(settings.savedBreakDurationsMs).toEqual([
      10 * MINUTE_MS,
      15 * MINUTE_MS,
    ])
    expect(settings.soundVolume).toBe(0.25)
    expect(settings.theme).toBe('dark')
    expect(settings.standardShiftDurationMs).toBe(12 * HOUR_MS)
  })

  it('проверяет структуру будущего плана', () => {
    const plan = normalizeShiftPlan({
      id: 'plan-one',
      startAt: BASE_TIME,
      durationMs: 8 * HOUR_MS,
      patternId: null,
      note: 'вечерняя',
    })
    expect(plan).toMatchObject({
      id: 'plan-one',
      startAt: BASE_TIME,
      durationMs: 8 * HOUR_MS,
    })
    expectImportIssue(
      () => normalizeShiftPlan({ id: 'bad', startAt: BASE_TIME, durationMs: 0 }),
      'durationMs',
    )
  })

  it('проверяет показатели поддержки и не принимает отрицательные счётчики', () => {
    expectImportIssue(
      () =>
        normalizeShift(
          makeShift({
            support: {
              handledRequests: -1,
              chats: 0,
              calls: 0,
              qualityScore: 100,
              averageResponseTimeMs: null,
              complexCases: 0,
              learningNote: '',
              summaryNote: '',
            },
          }),
        ),
      'handledRequests',
    )
  })
})
