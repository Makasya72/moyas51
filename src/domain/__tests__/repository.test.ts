import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ActiveShiftConflictError,
  MoyaSmenaRepository,
} from '../../data/repository'
import { createDefaultSettings, HOUR_MS, MINUTE_MS } from '../defaults'
import { calculateEarningsFromBo } from '../calculations'
import { createShiftPlan } from '../transitions'
import { BACKUP_FORMAT, BACKUP_VERSION, type BackupDocument } from '../types'
import { BASE_TIME, makeShift } from './fixtures'

describe('Dexie-репозиторий', () => {
  let databaseName: string
  let repositories: MoyaSmenaRepository[]

  beforeEach(() => {
    databaseName = `moya-smena-test-${crypto.randomUUID()}`
    repositories = []
  })

  afterEach(async () => {
    for (const repository of repositories) repository.close()
    await Dexie.delete(databaseName)
  })

  async function openRepository(): Promise<MoyaSmenaRepository> {
    const repository = new MoyaSmenaRepository(databaseName)
    repositories.push(repository)
    await repository.initialize()
    return repository
  }

  async function start(repository: MoyaSmenaRepository, id = 'active'): Promise<void> {
    await repository.startShift({
      id,
      at: BASE_TIME,
      plannedDurationMs: 12 * HOUR_MS,
      extendByBreaks: false,
    })
  }

  it('создаёт настройки по умолчанию в пустой базе', async () => {
    const repository = await openRepository()
    const settings = await repository.getSettings()
    expect(settings.standardShiftDurationMs).toBe(12 * HOUR_MS)
    expect(settings.standardBreakDurationMs).toBe(15 * MINUTE_MS)
  })

  it('сохраняет и восстанавливает активную смену после нового подключения', async () => {
    const first = await openRepository()
    await start(first)
    first.close()
    repositories = repositories.filter((item) => item !== first)

    const reopened = await openRepository()
    expect((await reopened.getActiveShift())?.id).toBe('active')
  })

  it('запрещает последовательный запуск второй активной смены', async () => {
    const repository = await openRepository()
    await start(repository, 'first')
    await expect(
      repository.startShift({
        id: 'second',
        at: BASE_TIME + MINUTE_MS,
        plannedDurationMs: HOUR_MS,
      }),
    ).rejects.toBeInstanceOf(ActiveShiftConflictError)
    expect((await repository.listShifts()).map((shift) => shift.id)).toEqual(['first'])
  })

  it('транзакционно защищает активную смену при двух одновременных подключениях', async () => {
    const first = await openRepository()
    const second = await openRepository()
    const attempts = await Promise.allSettled([
      first.startShift({
        id: 'from-first-tab',
        at: BASE_TIME,
        plannedDurationMs: HOUR_MS,
      }),
      second.startShift({
        id: 'from-second-tab',
        at: BASE_TIME,
        plannedDurationMs: HOUR_MS,
      }),
    ])
    expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1)
    expect(attempts.filter((attempt) => attempt.status === 'rejected')).toHaveLength(1)
    expect((await first.listShifts()).filter((shift) => shift.status === 'active')).toHaveLength(1)
  })

  it('сохраняет и восстанавливает активный перерыв', async () => {
    const repository = await openRepository()
    await start(repository)
    await repository.startBreak({
      id: 'pause',
      type: 'break',
      at: BASE_TIME + HOUR_MS,
      plannedDurationMs: 15 * MINUTE_MS,
    })
    const restored = await repository.getActiveShift()
    expect(restored?.activity).toBe('break')
    expect(restored?.breaks[0]).toMatchObject({ id: 'pause', endedAt: null })
  })

  it('возвращает к работе и сохраняет фактический перерыв', async () => {
    const repository = await openRepository()
    await start(repository)
    await repository.startBreak({
      id: 'pause',
      type: 'break',
      at: BASE_TIME + HOUR_MS,
      plannedDurationMs: 15 * MINUTE_MS,
    })
    const resumed = await repository.resumeWork(
      BASE_TIME + HOUR_MS + 20 * MINUTE_MS,
    )
    expect(resumed.activity).toBe('work')
    expect(resumed.breaks[0].actualDurationMs).toBe(20 * MINUTE_MS)
    expect(resumed.breaks[0].overtimeMs).toBe(5 * MINUTE_MS)
  })

  it('завершает смену и удаляет только активную блокировку', async () => {
    const repository = await openRepository()
    await start(repository)
    const completed = await repository.finishShift(BASE_TIME + 12 * HOUR_MS)
    expect(completed.status).toBe('completed')
    expect(await repository.getActiveShift()).toBeNull()
    expect((await repository.getShift('active'))?.status).toBe('completed')
  })

  it('закрывает активный обед при завершении смены', async () => {
    const repository = await openRepository()
    await start(repository)
    await repository.startBreak({
      id: 'lunch',
      type: 'lunch',
      at: BASE_TIME + 10 * HOUR_MS,
      plannedDurationMs: 30 * MINUTE_MS,
    })
    const completed = await repository.finishShift(
      BASE_TIME + 10 * HOUR_MS + 10 * MINUTE_MS,
    )
    expect(completed.breaks[0].endedAt).toBe(
      BASE_TIME + 10 * HOUR_MS + 10 * MINUTE_MS,
    )
    expect(completed.activity).toBe('completed')
  })

  it('не позволяет saveShift обойти защиту второй активной смены', async () => {
    const repository = await openRepository()
    await start(repository, 'first')
    await expect(
      repository.saveShift(
        makeShift({
          id: 'second',
          status: 'active',
          activity: 'work',
          endedAt: null,
        }),
      ),
    ).rejects.toBeInstanceOf(ActiveShiftConflictError)
  })

  it('создаёт, редактирует, фильтрует и удаляет смену', async () => {
    const repository = await openRepository()
    await repository.saveShift(makeShift({ id: 'history' }))
    const updated = await repository.updateShift('history', { note: 'исправлено' })
    expect(updated.note).toBe('исправлено')
    expect(
      await repository.listShifts({
        startAt: BASE_TIME,
        endAt: BASE_TIME + 2 * HOUR_MS,
      }),
    ).toHaveLength(1)
    await repository.deleteShift('history')
    expect(await repository.getShift('history')).toBeNull()
  })

  it('редактирует заработок и всегда пересчитывает итог', async () => {
    const repository = await openRepository()
    await repository.saveShift(makeShift({ id: 'paid' }))
    const updated = await repository.setShiftEarnings(
      'paid',
      {
        baseBoSubunits: null,
        boRateSubkopecks: 8_696,
        baseKopecks: 100_000,
        bonusKopecks: 15_000,
        deductionKopecks: 4_000,
        isBaseEstimated: false,
      },
      BASE_TIME + 13 * HOUR_MS,
    )
    expect(updated.earnings.totalKopecks).toBe(111_000)
    expect((await repository.getShift('paid'))?.earnings.totalKopecks).toBe(111_000)
  })

  it('сохраняет и удаляет планы будущих смен', async () => {
    const repository = await openRepository()
    const plan = createShiftPlan({
      id: 'plan',
      startAt: BASE_TIME + 7 * 24 * HOUR_MS,
      durationMs: 8 * HOUR_MS,
    })
    await repository.savePlan(plan)
    expect((await repository.listPlans())[0].id).toBe('plan')
    expect((await repository.getPlan('plan'))?.durationMs).toBe(8 * HOUR_MS)
    await repository.deletePlan('plan')
    expect(await repository.getPlan('plan')).toBeNull()
  })

  it('частично обновляет и нормализует настройки', async () => {
    const repository = await openRepository()
    const saved = await repository.saveSettings({
      theme: 'dark',
      hourlyRateKopecks: 12_345,
      savedBreakDurationsMs: [20 * MINUTE_MS, 10 * MINUTE_MS, 20 * MINUTE_MS],
    })
    expect(saved.theme).toBe('dark')
    expect(saved.hourlyRateKopecks).toBe(12_345)
    expect(saved.savedBreakDurationsMs).toEqual([10 * MINUTE_MS, 20 * MINUTE_MS])
    expect(saved.standardShiftDurationMs).toBe(12 * HOUR_MS)
  })

  it('экспортирует и заменяет полную резервную копию', async () => {
    const repository = await openRepository()
    await repository.saveShift(makeShift({ id: 'exported', note: 'сохранено' }))
    const json = await repository.exportBackupJson()
    await repository.clearAll()
    expect(await repository.listShifts()).toHaveLength(0)
    const preview = await repository.importBackup(json, 'replace')
    expect(preview.shiftCount).toBe(1)
    expect((await repository.getShift('exported'))?.note).toBe('сохранено')
  })

  it('при объединении выбирает более свежую версию записи', async () => {
    const repository = await openRepository()
    await repository.saveShift(
      makeShift({ id: 'same', note: 'локальная', updatedAt: BASE_TIME + HOUR_MS }),
    )
    const imported = makeShift({
      id: 'same',
      note: 'из копии',
      updatedAt: BASE_TIME + 2 * HOUR_MS,
    })
    const document: BackupDocument = {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: BASE_TIME + 3 * HOUR_MS,
      shifts: [imported],
      plans: [],
      settings: createDefaultSettings(),
    }
    await repository.importBackup(document, 'merge')
    expect((await repository.getShift('same'))?.note).toBe('из копии')
  })

  it('отменяет объединение целиком при конфликте активных смен', async () => {
    const repository = await openRepository()
    await start(repository, 'local-active')
    const importedActive = makeShift({
      id: 'imported-active',
      status: 'active',
      activity: 'work',
      endedAt: null,
      updatedAt: BASE_TIME + HOUR_MS,
    })
    const document: BackupDocument = {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: BASE_TIME + 2 * HOUR_MS,
      shifts: [importedActive],
      plans: [],
      settings: createDefaultSettings(),
    }
    await expect(repository.importBackup(document, 'merge')).rejects.toBeInstanceOf(
      ActiveShiftConflictError,
    )
    expect(await repository.getShift('imported-active')).toBeNull()
    expect((await repository.getActiveShift())?.id).toBe('local-active')
  })

  it('экспортирует CSV с BOM и безопасным экранированием', async () => {
    const repository = await openRepository()
    await repository.saveShift(makeShift({ id: 'csv', note: 'текст; "кавычки"', earnings: calculateEarningsFromBo(350) }))
    const csv = await repository.exportShiftsCsv()
    expect(csv.startsWith('\uFEFFID;')).toBe(true)
    expect(csv).toContain('"текст; ""кавычки"""')
    expect(csv).toContain('Итого, коп')
    expect(csv).toContain('Количество БО')
    expect(csv).toContain('350;0,8696;30436;30436')
  })

  it('рассылает локальные события после изменения данных', async () => {
    const repository = await openRepository()
    const changes: string[] = []
    const unsubscribe = repository.subscribe((change) => changes.push(change.kind))
    await repository.saveShift(makeShift({ id: 'event' }))
    await repository.saveSettings({ theme: 'light' })
    unsubscribe()
    expect(changes).toEqual(['shift', 'settings'])
  })

  it('мигрирует старую запись версии 1 и восстанавливает её блокировку', async () => {
    const legacy = new Dexie(databaseName)
    legacy.version(1).stores({
      shifts: '&id,status,startedAt,endedAt,updatedAt',
      settings: '&key',
    })
    await legacy.open()
    await legacy.table('shifts').add({
      id: 'legacy-active',
      status: 'active',
      activity: 'work',
      startedAt: BASE_TIME,
      endedAt: null,
      updatedAt: BASE_TIME,
      createdAt: BASE_TIME,
      breaks: [],
    })
    legacy.close()

    const repository = await openRepository()
    const restored = await repository.getActiveShift()
    expect(restored?.id).toBe('legacy-active')
    expect(restored?.plannedDurationMs).toBe(12 * HOUR_MS)
    expect(restored?.earnings.totalKopecks).toBe(0)
    expect(restored?.earnings.baseBoSubunits).toBeNull()
    expect(restored?.earnings.boRateSubkopecks).toBe(8_696)
  })

  it('мигрирует курс БО из версии 4, не меняя рублёвую запись', async () => {
    const legacy = new Dexie(databaseName)
    legacy.version(4).stores({
      shifts:
        '&id,status,activity,startedAt,endedAt,updatedAt,[status+updatedAt]',
      plans: '&id,startAt,updatedAt',
      settings: '&key,updatedAt',
      meta: '&key,updatedAt',
    })

    const boShift = structuredClone(
      makeShift({ id: 'legacy-bo' }),
    ) as unknown as { earnings: Record<string, unknown> }
    boShift.earnings = {
      baseBoSubunits: 3_500_000,
      boRateKopecks: 80,
      baseKopecks: 28_000,
      bonusKopecks: 0,
      deductionKopecks: 0,
      totalKopecks: 28_000,
      isBaseEstimated: false,
    }

    const rubleShift = structuredClone(
      makeShift({ id: 'legacy-rubles' }),
    ) as unknown as { earnings: Record<string, unknown> }
    rubleShift.earnings = {
      baseBoSubunits: null,
      boRateKopecks: 80,
      baseKopecks: 123_456,
      bonusKopecks: 0,
      deductionKopecks: 0,
      totalKopecks: 123_456,
      isBaseEstimated: false,
    }

    await legacy.open()
    await legacy.table('shifts').bulkAdd([boShift, rubleShift])
    legacy.close()

    const repository = await openRepository()
    expect((await repository.getShift('legacy-bo'))?.earnings).toMatchObject({
      baseBoSubunits: 3_500_000,
      boRateSubkopecks: 8_696,
      baseKopecks: 30_436,
      totalKopecks: 30_436,
    })
    expect((await repository.getShift('legacy-rubles'))?.earnings).toMatchObject({
      baseBoSubunits: null,
      boRateSubkopecks: 8_696,
      baseKopecks: 123_456,
      totalKopecks: 123_456,
    })
  })

  it('полная очистка удаляет данные, но восстанавливает безопасные настройки', async () => {
    const repository = await openRepository()
    await repository.saveShift(makeShift({ id: 'delete-me' }))
    await repository.savePlan(
      createShiftPlan({ id: 'plan', startAt: BASE_TIME, durationMs: HOUR_MS }),
    )
    await repository.clearAll()
    expect(await repository.listShifts()).toHaveLength(0)
    expect(await repository.listPlans()).toHaveLength(0)
    expect((await repository.getSettings()).standardShiftDurationMs).toBe(12 * HOUR_MS)
  })
})
