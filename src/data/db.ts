import Dexie, { type Table } from 'dexie'
import { createLegacyShiftForMigration } from '../domain/import-validation'
import { calculateEarningsFromBoSubunits } from '../domain/calculations'
import { BO_RATE_SUBKOPECKS } from '../domain/types'
import type {
  MetaRecord,
  SettingsRecord,
  Shift,
  ShiftPlan,
} from '../domain/types'

export const DATABASE_NAME = 'moya-smena'
export const DATABASE_VERSION = 5
export const ACTIVE_SHIFT_META_KEY = 'activeShiftId'

export class MoyaSmenaDatabase extends Dexie {
  shifts!: Table<Shift, string>
  plans!: Table<ShiftPlan, string>
  settings!: Table<SettingsRecord, string>
  meta!: Table<MetaRecord, string>

  constructor(name = DATABASE_NAME) {
    super(name)

    this.version(1).stores({
      shifts: '&id,status,startedAt,endedAt,updatedAt',
      settings: '&key',
    })

    this.version(2)
      .stores({
        shifts: '&id,status,activity,startedAt,endedAt,updatedAt',
        plans: '&id,startAt,updatedAt',
        settings: '&key,updatedAt',
        meta: '&key,updatedAt',
      })
      .upgrade(async (transaction) => {
        await transaction
          .table('shifts')
          .toCollection()
          .modify((raw: Record<string, unknown>) => {
            try {
              Object.assign(raw, createLegacyShiftForMigration(raw))
            } catch {
              // Keep the original record recoverable; integrity repair will surface it.
            }
          })
      })

    this.version(3)
      .stores({
        shifts:
          '&id,status,activity,startedAt,endedAt,updatedAt,[status+updatedAt]',
        plans: '&id,startAt,updatedAt',
        settings: '&key,updatedAt',
        meta: '&key,updatedAt',
      })
      .upgrade(async (transaction) => {
        const shiftTable = transaction.table<Shift, string>('shifts')
        const metaTable = transaction.table<MetaRecord, string>('meta')
        const active = (await shiftTable.toArray())
          .filter((shift) => shift.status === 'active')
          .sort((left, right) => right.updatedAt - left.updatedAt)

        if (active.length === 0) {
          await metaTable.delete(ACTIVE_SHIFT_META_KEY)
          return
        }

        const [current, ...duplicates] = active
        for (const duplicate of duplicates) {
          const endedAt = Math.max(
            duplicate.startedAt ?? duplicate.updatedAt,
            duplicate.updatedAt,
          )
          duplicate.status = 'completed'
          duplicate.activity = 'completed'
          duplicate.endedAt = endedAt
          duplicate.breaks = duplicate.breaks.map((pause) =>
            pause.endedAt === null
              ? {
                  ...pause,
                  endedAt,
                  actualDurationMs: Math.max(0, endedAt - pause.startedAt),
                  overtimeMs: Math.max(0, endedAt - pause.plannedEndAt),
                }
              : pause,
          )
          await shiftTable.put(duplicate)
        }
        await metaTable.put({
          key: ACTIVE_SHIFT_META_KEY,
          value: current.id,
          updatedAt: current.updatedAt,
        })
      })

    this.version(4)
      .stores({
        shifts:
          '&id,status,activity,startedAt,endedAt,updatedAt,[status+updatedAt]',
        plans: '&id,startAt,updatedAt',
        settings: '&key,updatedAt',
        meta: '&key,updatedAt',
      })
      .upgrade(async (transaction) => {
        await transaction
          .table('shifts')
          .toCollection()
          .modify((raw: Record<string, unknown>) => {
            const earnings = raw.earnings
            if (typeof earnings !== 'object' || earnings === null) return
            const record = earnings as Record<string, unknown>
            if (!('baseBoSubunits' in record)) record.baseBoSubunits = null
            if (!('boRateKopecks' in record)) {
              record.boRateKopecks = 80
            }
          })
      })

    this.version(DATABASE_VERSION)
      .stores({
        shifts:
          '&id,status,activity,startedAt,endedAt,updatedAt,[status+updatedAt]',
        plans: '&id,startAt,updatedAt',
        settings: '&key,updatedAt',
        meta: '&key,updatedAt',
      })
      .upgrade(async (transaction) => {
        await transaction
          .table('shifts')
          .toCollection()
          .modify((raw: Record<string, unknown>) => {
            const earnings = raw.earnings
            if (typeof earnings !== 'object' || earnings === null) return

            const record = earnings as Record<string, unknown>
            const baseBoSubunits = record.baseBoSubunits
            if (
              typeof baseBoSubunits === 'number' &&
              Number.isFinite(baseBoSubunits)
            ) {
              const normalized = calculateEarningsFromBoSubunits(
                baseBoSubunits,
                typeof record.bonusKopecks === 'number'
                  ? record.bonusKopecks
                  : 0,
                typeof record.deductionKopecks === 'number'
                  ? record.deductionKopecks
                  : 0,
                BO_RATE_SUBKOPECKS,
                record.isBaseEstimated === true,
              )
              Object.assign(record, normalized)
            } else {
              // Records entered directly in rubles keep their original amount.
              record.baseBoSubunits = null
              record.boRateSubkopecks = BO_RATE_SUBKOPECKS
            }
            delete record.boRateKopecks
          })
      })
  }
}

export function createDatabase(name = DATABASE_NAME): MoyaSmenaDatabase {
  return new MoyaSmenaDatabase(name)
}
