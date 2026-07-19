import type { SVGProps } from 'react'

export type IconName =
  | 'timer'
  | 'calendar'
  | 'chart'
  | 'settings'
  | 'info'
  | 'coffee'
  | 'lunch'
  | 'play'
  | 'stop'
  | 'pip'
  | 'sun'
  | 'moon'
  | 'download'
  | 'upload'
  | 'plus'
  | 'edit'
  | 'trash'
  | 'chevron-left'
  | 'chevron-right'
  | 'check'
  | 'close'
  | 'bell'
  | 'volume'

const paths: Record<IconName, React.ReactNode> = {
  timer: <><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 1.5M9 2h6"/></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4m8-4v4M3 10h18"/></>,
  chart: <><path d="M4 20V10m6 10V4m6 16v-7m5 7H2"/></>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></>,
  info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/></>,
  coffee: <><path d="M4 8h13v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V8Zm13 2h1.5a2.5 2.5 0 0 1 0 5H17M7 4v1m4-2v2m4-1v1"/></>,
  lunch: <><path d="M5 3v7a2 2 0 0 0 2 2h1V3m-3 4h3m4-4v18m5-18c-2 2-2 7 0 9h2V3Z"/></>,
  play: <path d="m8 5 11 7-11 7Z"/>,
  stop: <rect x="5" y="5" width="14" height="14" rx="2"/>,
  pip: <><rect x="3" y="4" width="18" height="16" rx="2"/><rect x="11" y="11" width="8" height="6" rx="1"/></>,
  sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></>,
  moon: <path d="M20 15.4A8 8 0 0 1 8.6 4 8 8 0 1 0 20 15.4Z"/>,
  download: <><path d="M12 3v12m-4-4 4 4 4-4M4 19h16"/></>,
  upload: <><path d="M12 16V4m-4 4 4-4 4 4M4 20h16"/></>,
  plus: <path d="M12 5v14M5 12h14"/>,
  edit: <><path d="m14 5 5 5M4 20l3.5-.8L19 7.7 16.3 5 4.8 16.5Z"/></>,
  trash: <><path d="M4 7h16m-10-3h4l1 3M7 7l1 14h8l1-14M10 11v6m4-6v6"/></>,
  'chevron-left': <path d="m15 18-6-6 6-6"/>,
  'chevron-right': <path d="m9 18 6-6-6-6"/>,
  check: <path d="m5 12 4 4L19 6"/>,
  close: <path d="M6 6l12 12M18 6 6 18"/>,
  bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></>,
  volume: <><path d="M4 10v4h4l5 4V6L8 10Zm13-2a6 6 0 0 1 0 8m2-11a10 10 0 0 1 0 14"/></>,
}

export function Icon({ name, ...props }: SVGProps<SVGSVGElement> & { name: IconName }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      {paths[name]}
    </svg>
  )
}
