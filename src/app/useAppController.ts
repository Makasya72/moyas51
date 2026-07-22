import { useCallback, useEffect, useMemo, useState } from 'react'
import { createRepository } from '../data'
import { createDefaultSettings } from '../domain'
import type { AppSettings, ImportMode, ImportPreview, Shift } from '../domain'
import type { AppController } from './types'

const repository = createRepository()

function errorMessage(reason: unknown): string {
  if (reason instanceof Error) return reason.message
  return 'Произошла непредвиденная ошибка локального хранилища'
}

export function useAppController(): AppController {
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [shifts, setShifts] = useState<Shift[]>([])
  const [settings, setSettings] = useState<AppSettings>(createDefaultSettings())

  const reload = useCallback(async () => {
    try {
      const [nextShifts, nextSettings] = await Promise.all([
        repository.listShifts(),
        repository.getSettings(),
      ])
      setShifts(nextShifts)
      setSettings(nextSettings)
      setError(null)
    } catch (reason) {
      setError(errorMessage(reason))
      throw reason
    }
  }, [])

  useEffect(() => {
    let alive = true
    const initialize = async () => {
      try {
        await repository.initialize()
        if (alive) await reload()
      } catch (reason) {
        if (alive) setError(errorMessage(reason))
      } finally {
        if (alive) setLoading(false)
      }
    }
    const unsubscribe = repository.subscribe(() => {
      if (alive) void reload().catch(() => undefined)
    })
    void initialize()
    return () => {
      alive = false
      unsubscribe()
    }
  }, [reload])

  const mutate = useCallback(async <T,>(operation: () => Promise<T>): Promise<T> => {
    if (busy) throw new Error('Предыдущее действие ещё сохраняется')
    setBusy(true)
    setError(null)
    try {
      const result = await operation()
      await reload()
      return result
    } catch (reason) {
      setError(errorMessage(reason))
      throw reason
    } finally {
      setBusy(false)
    }
  }, [busy, reload])

  const activeShift = useMemo(() => shifts.find((shift) => shift.status === 'active') ?? null, [shifts])

  return {
    loading,
    busy,
    error,
    shifts,
    activeShift,
    settings,
    startShift: () => mutate(() => {
      const now = Date.now()
      return repository.startShift({
        at: now,
        plannedStartAt: now,
        plannedDurationMs: settings.standardShiftDurationMs,
        extendByBreaks: settings.extendShiftByBreaks,
      })
    }),
    startBreak: (type, durationMs) => mutate(() => repository.startBreak({ type, plannedDurationMs: durationMs })),
    resumeWork: () => mutate(() => repository.resumeWork()),
    finishShift: () => mutate(() => repository.finishShift()),
    saveShift: (shift) => mutate(() => repository.saveShift(shift)),
    deleteShift: (id) => mutate(() => repository.deleteShift(id)),
    updateSettings: (nextSettings) => mutate(async () => { await repository.saveSettings(nextSettings) }),
    exportBackup: () => repository.exportBackupJson(true),
    exportCsv: () => repository.exportShiftsCsv(),
    previewImport: (json: string): ImportPreview => repository.previewImport(json),
    importBackup: (preview: ImportPreview, mode: ImportMode) => mutate(async () => { await repository.importBackup(preview, mode) }),
    clearAllData: () => mutate(() => repository.clearAll()),
    reload,
  }
}
