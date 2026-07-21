import type { AppSettings, ImportMode, ImportPreview, Shift } from '../domain/types'

export type AppPage = 'shift' | 'calendar' | 'statistics' | 'settings' | 'about'

export interface AppController {
  loading: boolean
  busy: boolean
  error: string | null
  shifts: Shift[]
  activeShift: Shift | null
  settings: AppSettings
  startShift(): Promise<Shift>
  startBreak(type: 'break' | 'lunch', durationMs: number): Promise<Shift>
  resumeWork(): Promise<Shift>
  finishShift(): Promise<Shift>
  saveShift(shift: Shift): Promise<Shift>
  deleteShift(id: string): Promise<void>
  updateSettings(settings: AppSettings): Promise<void>
  exportBackup(): Promise<string>
  exportCsv(): Promise<string>
  previewImport(json: string): ImportPreview
  importBackup(preview: ImportPreview, mode: ImportMode): Promise<void>
  clearAllData(): Promise<void>
  reload(): Promise<void>
}

export interface ToastMessage {
  id: string
  title: string
  description?: string
  tone?: 'success' | 'warning' | 'danger'
}
