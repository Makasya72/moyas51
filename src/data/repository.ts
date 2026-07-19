import Dexie from 'dexie'
import {
  boSubunitsToBo,
  calculateEarnings,
  calculateShiftMetrics,
} from '../domain/calculations'
import { createDefaultSettings } from '../domain/defaults'
import {
  normalizeAppSettings,
  normalizeShift,
  normalizeShiftPlan,
  parseBackupJson,
  validateAndNormalizeBackup,
} from '../domain/import-validation'
import {
  transitionTracker,
  updateShiftEarnings,
} from '../domain/transitions'
import type {
  AppSettings,
  BackupDocument,
  BreakType,
  DateRange,
  ImportMode,
  ImportPreview,
  RepositoryChange,
  Shift,
  ShiftEarnings,
  ShiftId,
  ShiftPlan,
  Timestamp,
  TrackerAction,
} from '../domain/types'
import { BACKUP_FORMAT, BACKUP_VERSION } from '../domain/types'
import {
  ACTIVE_SHIFT_META_KEY,
  createDatabase,
  type MoyaSmenaDatabase,
} from './db'

export class ActiveShiftConflictError extends Error {
  readonly activeShiftId: string | null

  constructor(activeShiftId: string | null) {
    super('Одновременно может существовать только одна активная смена')
    this.name = 'ActiveShiftConflictError'
    this.activeShiftId = activeShiftId
  }
}

export class RecordNotFoundError extends Error {
  constructor(entity: 'shift' | 'plan', id: string) {
    super(`${entity === 'shift' ? 'Смена' : 'План'} ${id} не найдена`)
    this.name = 'RecordNotFoundError'
  }
}

export interface StartShiftInput {
  id?: string
  at?: Timestamp
  plannedDurationMs: number
  extendByBreaks?: boolean
  plannedStartAt?: Timestamp | null
}

export interface StartBreakInput {
  id?: string
  type: BreakType
  at?: Timestamp
  plannedDurationMs: number
}

type RepositoryListener = (change: RepositoryChange) => void

function generateId(prefix: string): string {
  const randomId = globalThis.crypto?.randomUUID?.()
  return randomId === undefined
    ? `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`
    : `${prefix}-${randomId}`
}

function cloneShift(shift: Shift): Shift {
  return {
    ...shift,
    breaks: shift.breaks.map((pause) => ({ ...pause })),
    earnings: { ...shift.earnings },
    support: shift.support === null ? null : { ...shift.support },
  }
}

function csvCell(value: string | number): string {
  const text = String(value)
  return /[;"\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function iso(timestamp: Timestamp | null): string {
  return timestamp === null ? '' : new Date(timestamp).toISOString()
}

export class MoyaSmenaRepository {
  readonly db: MoyaSmenaDatabase
  private readonly listeners = new Set<RepositoryListener>()
  private readonly channel: BroadcastChannel | null

  constructor(database: MoyaSmenaDatabase | string = createDatabase()) {
    this.db =
      typeof database === 'string' ? createDatabase(database) : database
    this.channel =
      typeof BroadcastChannel === 'undefined'
        ? null
        : new BroadcastChannel(`moya-smena:${this.db.name}`)
    if (this.channel !== null) {
      this.channel.onmessage = (event: MessageEvent<RepositoryChange>) => {
        this.emit(event.data, false)
      }
    }
  }

  async initialize(): Promise<void> {
    await this.db.open()
    await this.db.transaction(
      'rw',
      this.db.shifts,
      this.db.meta,
      this.db.settings,
      async () => {
        await this.repairActiveLockInTransaction()
        const settings = await this.db.settings.get('settings')
        if (settings === undefined) {
          await this.db.settings.put({
            key: 'settings',
            value: createDefaultSettings(),
            updatedAt: Date.now(),
          })
        }
      },
    )
  }

  close(): void {
    this.channel?.close()
    this.db.close()
  }

  subscribe(listener: RepositoryListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(change: RepositoryChange, broadcast = true): void {
    for (const listener of this.listeners) listener(change)
    if (broadcast) this.channel?.postMessage(change)
  }

  private notify(
    kind: RepositoryChange['kind'],
    entityId: string | null,
  ): void {
    this.emit({ kind, entityId, at: Date.now() })
  }

  private async repairActiveLockInTransaction(): Promise<Shift | null> {
    const active = (await this.db.shifts.where('status').equals('active').toArray()).sort(
      (left, right) => right.updatedAt - left.updatedAt,
    )
    if (active.length === 0) {
      await this.db.meta.delete(ACTIVE_SHIFT_META_KEY)
      return null
    }

    const [current, ...duplicates] = active
    for (const duplicate of duplicates) {
      const endAt = Math.max(duplicate.startedAt ?? duplicate.updatedAt, duplicate.updatedAt)
      const completed = transitionTracker(
        { activeShift: duplicate },
        { type: 'FINISH_SHIFT', at: endAt },
      ).changedShift
      await this.db.shifts.put(completed)
    }
    await this.db.meta.put({
      key: ACTIVE_SHIFT_META_KEY,
      value: current.id,
      updatedAt: current.updatedAt,
    })
    return current
  }

  async listShifts(range?: DateRange): Promise<Shift[]> {
    const shifts = await this.db.shifts.toArray()
    return shifts
      .filter((shift) => {
        if (range === undefined) return true
        const anchor = shift.startedAt ?? shift.plannedStartAt
        return anchor !== null && anchor >= range.startAt && anchor < range.endAt
      })
      .sort(
        (left, right) =>
          (right.startedAt ?? right.plannedStartAt ?? 0) -
          (left.startedAt ?? left.plannedStartAt ?? 0),
      )
  }

  async getShift(id: ShiftId): Promise<Shift | null> {
    return (await this.db.shifts.get(id)) ?? null
  }

  async getActiveShift(): Promise<Shift | null> {
    return this.db.transaction('rw', this.db.shifts, this.db.meta, () =>
      this.repairActiveLockInTransaction(),
    )
  }

  async startShift(input: StartShiftInput): Promise<Shift> {
    const at = input.at ?? Date.now()
    const id = input.id ?? generateId('shift')
    const action: TrackerAction = {
      type: 'START_SHIFT',
      id,
      at,
      plannedDurationMs: input.plannedDurationMs,
      extendByBreaks: input.extendByBreaks ?? false,
      plannedStartAt: input.plannedStartAt,
    }
    const shift = await this.db.transaction(
      'rw',
      this.db.shifts,
      this.db.meta,
      async () => {
        const lock = await this.db.meta.get(ACTIVE_SHIFT_META_KEY)
        const lockedShift =
          typeof lock?.value === 'string'
            ? await this.db.shifts.get(lock.value)
            : undefined
        if (lockedShift?.status === 'active') {
          throw new ActiveShiftConflictError(lockedShift.id)
        }
        const active = await this.db.shifts.where('status').equals('active').first()
        if (active !== undefined) throw new ActiveShiftConflictError(active.id)

        const result = transitionTracker({ activeShift: null }, action).changedShift
        await this.db.shifts.add(result)
        await this.db.meta.put({
          key: ACTIVE_SHIFT_META_KEY,
          value: result.id,
          updatedAt: at,
        })
        return result
      },
    )
    this.notify('shift', shift.id)
    return shift
  }

  private async transitionActive(action: TrackerAction): Promise<Shift> {
    const changed = await this.db.transaction(
      'rw',
      this.db.shifts,
      this.db.meta,
      async () => {
        const active = await this.repairActiveLockInTransaction()
        if (active === null) {
          return transitionTracker({ activeShift: null }, action).changedShift
        }
        const result = transitionTracker({ activeShift: active }, action)
        await this.db.shifts.put(result.changedShift)
        if (result.state.activeShift === null) {
          await this.db.meta.delete(ACTIVE_SHIFT_META_KEY)
        } else {
          await this.db.meta.put({
            key: ACTIVE_SHIFT_META_KEY,
            value: result.changedShift.id,
            updatedAt: result.changedShift.updatedAt,
          })
        }
        return result.changedShift
      },
    )
    this.notify('shift', changed.id)
    return changed
  }

  startBreak(input: StartBreakInput): Promise<Shift> {
    return this.transitionActive({
      type: 'START_BREAK',
      id: input.id ?? generateId(input.type),
      at: input.at ?? Date.now(),
      plannedDurationMs: input.plannedDurationMs,
      breakType: input.type,
    })
  }

  resumeWork(at: Timestamp = Date.now()): Promise<Shift> {
    return this.transitionActive({ type: 'RESUME_WORK', at })
  }

  finishShift(at: Timestamp = Date.now()): Promise<Shift> {
    return this.transitionActive({ type: 'FINISH_SHIFT', at })
  }

  async saveShift(input: Shift): Promise<Shift> {
    const shift = normalizeShift(input)
    await this.db.transaction('rw', this.db.shifts, this.db.meta, async () => {
      if (shift.status === 'active') {
        const active = await this.db.shifts.where('status').equals('active').first()
        if (active !== undefined && active.id !== shift.id) {
          throw new ActiveShiftConflictError(active.id)
        }
        await this.db.meta.put({
          key: ACTIVE_SHIFT_META_KEY,
          value: shift.id,
          updatedAt: shift.updatedAt,
        })
      } else {
        const lock = await this.db.meta.get(ACTIVE_SHIFT_META_KEY)
        if (lock?.value === shift.id) await this.db.meta.delete(ACTIVE_SHIFT_META_KEY)
      }
      await this.db.shifts.put(shift)
    })
    this.notify('shift', shift.id)
    return shift
  }

  async updateShift(
    id: ShiftId,
    updater: Partial<Shift> | ((shift: Shift) => Shift | Partial<Shift>),
  ): Promise<Shift> {
    const existing = await this.getShift(id)
    if (existing === null) throw new RecordNotFoundError('shift', id)
    const draft = cloneShift(existing)
    const change = typeof updater === 'function' ? updater(draft) : updater
    return this.saveShift({ ...draft, ...change, id, updatedAt: Date.now() })
  }

  async setShiftEarnings(
    id: ShiftId,
    earnings: Omit<ShiftEarnings, 'totalKopecks'>,
    at: Timestamp = Date.now(),
  ): Promise<Shift> {
    const existing = await this.getShift(id)
    if (existing === null) throw new RecordNotFoundError('shift', id)
    return this.saveShift(updateShiftEarnings(existing, earnings, at))
  }

  async deleteShift(id: ShiftId): Promise<void> {
    await this.db.transaction('rw', this.db.shifts, this.db.meta, async () => {
      await this.db.shifts.delete(id)
      const lock = await this.db.meta.get(ACTIVE_SHIFT_META_KEY)
      if (lock?.value === id) await this.db.meta.delete(ACTIVE_SHIFT_META_KEY)
    })
    this.notify('shift', id)
  }

  async listPlans(): Promise<ShiftPlan[]> {
    return this.db.plans.orderBy('startAt').toArray()
  }

  async getPlan(id: string): Promise<ShiftPlan | null> {
    return (await this.db.plans.get(id)) ?? null
  }

  async savePlan(input: ShiftPlan): Promise<ShiftPlan> {
    const plan = normalizeShiftPlan(input)
    await this.db.plans.put(plan)
    this.notify('plan', plan.id)
    return plan
  }

  async deletePlan(id: string): Promise<void> {
    await this.db.plans.delete(id)
    this.notify('plan', id)
  }

  async getSettings(): Promise<AppSettings> {
    const stored = await this.db.settings.get('settings')
    return normalizeAppSettings(stored?.value)
  }

  async saveSettings(input: AppSettings | Partial<AppSettings>): Promise<AppSettings> {
    const current = await this.getSettings()
    const settings = normalizeAppSettings({ ...current, ...input })
    await this.db.settings.put({
      key: 'settings',
      value: settings,
      updatedAt: Date.now(),
    })
    this.notify('settings', 'settings')
    return settings
  }

  async exportBackup(at: Timestamp = Date.now()): Promise<BackupDocument> {
    const [shifts, plans, settings] = await Promise.all([
      this.db.shifts.toArray(),
      this.db.plans.toArray(),
      this.getSettings(),
    ])
    return {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: at,
      shifts,
      plans,
      settings,
    }
  }

  async exportBackupJson(pretty = true): Promise<string> {
    return JSON.stringify(await this.exportBackup(), null, pretty ? 2 : undefined)
  }

  previewImport(input: string | unknown): ImportPreview {
    return typeof input === 'string'
      ? parseBackupJson(input)
      : validateAndNormalizeBackup(input)
  }

  async importBackup(
    input: ImportPreview | BackupDocument | string | unknown,
    mode: ImportMode,
  ): Promise<ImportPreview> {
    const preview =
      typeof input === 'string'
        ? parseBackupJson(input)
        : typeof input === 'object' &&
            input !== null &&
            'backup' in input &&
            'shiftCount' in input
          ? (input as ImportPreview)
          : validateAndNormalizeBackup(input)
    const { backup } = preview

    await this.db.transaction(
      'rw',
      this.db.shifts,
      this.db.plans,
      this.db.settings,
      this.db.meta,
      async () => {
        if (mode === 'replace') {
          await Promise.all([
            this.db.shifts.clear(),
            this.db.plans.clear(),
            this.db.settings.clear(),
            this.db.meta.clear(),
          ])
          await this.db.shifts.bulkPut(backup.shifts)
          await this.db.plans.bulkPut(backup.plans)
        } else {
          const existing = await this.db.shifts.toArray()
          const byId = new Map(existing.map((shift) => [shift.id, shift]))
          for (const imported of backup.shifts) {
            const local = byId.get(imported.id)
            if (local === undefined || imported.updatedAt >= local.updatedAt) {
              byId.set(imported.id, imported)
            }
          }
          const active = [...byId.values()].filter((shift) => shift.status === 'active')
          if (active.length > 1) {
            throw new ActiveShiftConflictError(active[0]?.id ?? null)
          }
          await this.db.shifts.bulkPut([...byId.values()])

          const existingPlans = new Map(
            (await this.db.plans.toArray()).map((plan) => [plan.id, plan]),
          )
          for (const imported of backup.plans) {
            const local = existingPlans.get(imported.id)
            if (local === undefined || imported.updatedAt >= local.updatedAt) {
              existingPlans.set(imported.id, imported)
            }
          }
          await this.db.plans.bulkPut([...existingPlans.values()])
        }

        await this.db.settings.put({
          key: 'settings',
          value: backup.settings,
          updatedAt: backup.exportedAt,
        })
        const active = await this.db.shifts.where('status').equals('active').first()
        if (active === undefined) {
          await this.db.meta.delete(ACTIVE_SHIFT_META_KEY)
        } else {
          await this.db.meta.put({
            key: ACTIVE_SHIFT_META_KEY,
            value: active.id,
            updatedAt: active.updatedAt,
          })
        }
      },
    )
    this.notify('import', null)
    return preview
  }

  async exportShiftsCsv(): Promise<string> {
    const header = [
      'ID',
      'Статус',
      'Начало',
      'Окончание',
      'План, мин',
      'Всего, мин',
      'Чистая работа, мин',
      'Перерывы, мин',
      'Обед, мин',
      'Переработка, мин',
      'Недоработка, мин',
      'Количество БО',
      'Ставка за 1 БО, коп',
      'Начислено за БО, коп',
      'Основная сумма, коп',
      'Премия, коп',
      'Удержание, коп',
      'Итого, коп',
      'Итого, ₽',
      'Заметка',
    ]
    const rows = (await this.listShifts()).map((shift) => {
      const metrics = calculateShiftMetrics(shift)
      return [
        shift.id,
        shift.status,
        iso(shift.startedAt),
        iso(shift.endedAt),
        Math.round(shift.plannedDurationMs / 60_000),
        Math.round(metrics.elapsedMs / 60_000),
        Math.round(metrics.netWorkMs / 60_000),
        Math.round(metrics.breakMs / 60_000),
        Math.round(metrics.lunchMs / 60_000),
        Math.round(metrics.overtimeMs / 60_000),
        Math.round(metrics.undertimeMs / 60_000),
        shift.earnings.baseBoSubunits === null
          ? ''
          : String(boSubunitsToBo(shift.earnings.baseBoSubunits)).replace('.', ','),
        shift.earnings.boRateKopecks,
        shift.earnings.baseBoSubunits === null ? '' : shift.earnings.baseKopecks,
        shift.earnings.baseKopecks,
        shift.earnings.bonusKopecks,
        shift.earnings.deductionKopecks,
        shift.earnings.totalKopecks,
        (shift.earnings.totalKopecks / 100).toFixed(2).replace('.', ','),
        shift.note,
      ]
    })
    return `\uFEFF${[header, ...rows]
      .map((row) => row.map(csvCell).join(';'))
      .join('\r\n')}`
  }

  async clearAll(): Promise<void> {
    await this.db.transaction(
      'rw',
      this.db.shifts,
      this.db.plans,
      this.db.settings,
      this.db.meta,
      async () => {
        await Promise.all([
          this.db.shifts.clear(),
          this.db.plans.clear(),
          this.db.settings.clear(),
          this.db.meta.clear(),
        ])
        await this.db.settings.put({
          key: 'settings',
          value: createDefaultSettings(),
          updatedAt: Date.now(),
        })
      },
    )
    this.notify('import', null)
  }
}

export function createRepository(
  database?: MoyaSmenaDatabase | string,
): MoyaSmenaRepository {
  return new MoyaSmenaRepository(database)
}

export { calculateEarnings, Dexie }
