/**
 * Disguise picker (§6.5): the app installs under a neutral name and icon
 * the user chooses. The choice itself is deliberately public state — it
 * IS the outward-facing disguise — so plain localStorage is fine here
 * (nothing about vault contents is derivable from it).
 *
 * Mechanics: the PWA manifest link and title metas are swapped at boot
 * and on change, before any install prompt reads them. Limitation: iOS
 * reads the apple-touch-icon at Add-to-Home-Screen time, so an already-
 * installed tile keeps its icon until re-added; the Settings copy says so.
 */

export interface Disguise {
  id: string
  name: string
  manifest: string
  icon: string
  appleIcon: string
}

export const DISGUISES: Disguise[] = [
  {
    id: 'ledger',
    name: 'Ledger',
    manifest: 'manifest.webmanifest', // the build's default manifest
    icon: 'icon-192.png',
    appleIcon: 'apple-touch-icon.png',
  },
  {
    id: 'planner',
    name: 'Planner',
    manifest: 'manifest-planner.webmanifest',
    icon: 'icon-planner-192.png',
    appleIcon: 'apple-touch-icon-planner.png',
  },
  {
    id: 'grid',
    name: 'Grid',
    manifest: 'manifest-grid.webmanifest',
    icon: 'icon-grid-192.png',
    appleIcon: 'apple-touch-icon-grid.png',
  },
]

const STORAGE_KEY = 'appearance'

export function currentDisguise(): Disguise {
  try {
    const id = localStorage.getItem(STORAGE_KEY)
    return DISGUISES.find((d) => d.id === id) ?? DISGUISES[0]
  } catch {
    return DISGUISES[0]
  }
}

export function setDisguise(id: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, id)
  } catch {
    // Private windows may refuse; the swap below still applies this session.
  }
  applyDisguise()
}

/** Swap the manifest/title/icons to the chosen disguise. Call at boot. */
export function applyDisguise(): void {
  const disguise = currentDisguise()
  const base = import.meta.env.BASE_URL
  document.title = disguise.name
  const manifestLink = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')
  if (manifestLink) manifestLink.href = `${base}${disguise.manifest}`
  const appleIcon = document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]')
  if (appleIcon) appleIcon.href = `${base}${disguise.appleIcon}`
  const favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
  if (favicon) favicon.href = `${base}${disguise.icon}`
  const appleTitle = document.querySelector<HTMLMetaElement>(
    'meta[name="apple-mobile-web-app-title"]',
  )
  if (appleTitle) appleTitle.content = disguise.name
}
