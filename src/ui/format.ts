const NUMBER = new Intl.NumberFormat('ru-RU')
const BO_NUMBER = new Intl.NumberFormat('ru-RU', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 4,
})
const BO_RATE_NUMBER = new Intl.NumberFormat('ru-RU', {
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
})
const MONEY = new Intl.NumberFormat('ru-RU', {
  style: 'currency',
  currency: 'RUB',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})

export function formatDuration(milliseconds: number, showDays = false): string {
  const safe = Math.max(0, Math.round(milliseconds / 1000))
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  const seconds = safe % 60
  if (showDays && hours >= 24) {
    const days = Math.floor(hours / 24)
    return `${days} д ${String(hours % 24).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export function formatHours(milliseconds: number): string {
  const hours = milliseconds / 3_600_000
  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(hours)} ч`
}

export function formatClock(timestamp: number | null, use24Hour = true): string {
  if (timestamp === null || !Number.isFinite(timestamp)) return '—'
  return new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    second: undefined,
    hour12: !use24Hour,
  }).format(timestamp)
}

export function formatDateLong(timestamp: number): string {
  const formatted = new Intl.DateTimeFormat('ru-RU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(timestamp)
  return formatted[0].toUpperCase() + formatted.slice(1)
}

export function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(timestamp)
}

export function formatMonth(timestamp: number): string {
  const text = new Intl.DateTimeFormat('ru-RU', {
    month: 'long',
    year: 'numeric',
  }).format(timestamp)
  return text[0].toUpperCase() + text.slice(1)
}

export function formatMoney(kopecks: number): string {
  return MONEY.format(kopecks / 100)
}

export function formatNumber(value: number): string {
  return NUMBER.format(value)
}

export function formatBo(value: number): string {
  return `${BO_NUMBER.format(value)} БО`
}

export function formatBoRate(rateSubkopecks: number): string {
  return `${BO_RATE_NUMBER.format(rateSubkopecks / 10_000)} ₽`
}

export function toLocalDateTimeInput(timestamp: number | null): string {
  if (timestamp === null) return ''
  const date = new Date(timestamp)
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(timestamp - offset).toISOString().slice(0, 19)
}

export function fromLocalDateTimeInput(value: string): number | null {
  if (!value) return null
  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) ? timestamp : null
}

export function toDateInput(timestamp: number): string {
  const date = new Date(timestamp)
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(timestamp - offset).toISOString().slice(0, 10)
}

export function startOfLocalDay(timestamp: number): number {
  const date = new Date(timestamp)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

export function endOfLocalDay(timestamp: number): number {
  const date = new Date(timestamp)
  date.setHours(23, 59, 59, 999)
  return date.getTime()
}

export function monthGrid(anchor: number): number[] {
  const first = new Date(anchor)
  first.setDate(1)
  first.setHours(0, 0, 0, 0)
  const mondayIndex = (first.getDay() + 6) % 7
  first.setDate(first.getDate() - mondayIndex)
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(first)
    day.setDate(first.getDate() + index)
    return day.getTime()
  })
}

export function sameLocalDay(left: number, right: number): boolean {
  const a = new Date(left)
  const b = new Date(right)
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

export function downloadText(filename: string, content: string, type: string): void {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
