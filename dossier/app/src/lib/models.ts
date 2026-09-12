/**
 * Domain model (REQUIREMENTS.md §8). These are the decrypted, in-memory
 * shapes; at rest each is one encrypted record row.
 */

export interface PartialDate {
  year?: number
  month?: number // 1–12
  day?: number
}

export interface Person {
  kind: 'person'
  id: string
  displayName: string
  nicknames: string[]
  pronouns?: string
  jobTitle?: string
  employer?: string
  location?: string
  birthday?: PartialDate
  howWeMet?: string
  contact?: { phone?: string; email?: string; other?: string }
  likes: string[]
  dislikes: string[]
  tags: string[]
  /** True for the implicit "me" node graph queries anchor on (§11 Q2). */
  isSelf?: boolean
  createdAt: number
  updatedAt: number
}

export interface NoteEntry {
  kind: 'note'
  id: string
  personId: string
  body: string
  /** Person ids extracted from @mentions in `body`. */
  mentions: string[]
  createdAt: number
}

export interface FollowUp {
  kind: 'followUp'
  id: string
  personId: string
  text: string
  dueDate?: PartialDate
  done: boolean
  createdAt: number
}

export type RelationshipOrigin = 'explicit' | 'mention'

export interface Relationship {
  kind: 'relationship'
  id: string
  fromId: string
  toId: string
  typeId: string
  directed: boolean
  note?: string
  startDate?: PartialDate
  origin: RelationshipOrigin
  createdAt: number
}

export interface RelationshipType {
  kind: 'relationshipType'
  id: string
  label: string
  color: string
  directed: boolean
  builtIn: boolean
}

export interface Photo {
  kind: 'photo'
  id: string
  personId: string
  isAvatar: boolean
  mimeType: string
  /** Encrypted separately as a binary record; this row carries metadata only. */
  blobRecordId: string
  createdAt: number
}

/** Singleton per-vault preferences, stored as an encrypted record. */
export interface Settings {
  kind: 'settings'
  id: string
  /** When the user last exported an encrypted backup (§4.5 nagging). */
  lastExportAt?: number
  /** Inactivity auto-lock in minutes; 0 disables (§6.3). Default 2. */
  autoLockMinutes?: number
  /** Grace period before backgrounding locks, in seconds. Default 30. */
  backgroundGraceSeconds?: number
  /** Shake the device to panic-lock (§6.4). Default off. */
  shakeToLock?: boolean
  /** Generic "You have a reminder" notifications (§4.4/§6.5). Default off. */
  remindersEnabled?: boolean
  /** Day-stamp (yyyy-mm-dd) of the last reminder notification shown. */
  lastReminderDay?: string
  /** Dossiers opened most recently, newest first (§4.4 "Recent" row).
   * Device-local like the rest of Settings: a restored backup starts
   * the row again from what was recently updated. */
  recentIds?: string[]
  /** "Looks like people" chips after saving a note (§4.2). Default on. */
  nameSuggestions?: boolean
}

/** How many recently opened dossiers the home screen remembers. */
export const RECENT_LIMIT = 8

export const DEFAULT_AUTO_LOCK_MINUTES = 2
export const DEFAULT_BACKGROUND_GRACE_SECONDS = 30

export const SETTINGS_ID = 'settings'

/**
 * A named group of people ("college friends", "DC polycule") drawn as a
 * translucent bubble on the graph (§4.6). Many-to-many and flat: a person
 * can be in any number of circles; circles never nest. Empty circles
 * persist until deleted explicitly.
 */
export interface Circle {
  kind: 'circle'
  id: string
  name: string
  color: string
  memberIds: string[]
  createdAt: number
  updatedAt: number
}

export type DomainRecord =
  | Circle
  | Person
  | NoteEntry
  | FollowUp
  | Relationship
  | RelationshipType
  | Photo
  | Settings

// Hues chosen to stay distinguishable from one another under the common
// color-vision deficiencies; chips pair each color with its label as the
// legend, so color is never the only signal.
export const BUILT_IN_RELATIONSHIP_TYPES: Omit<RelationshipType, 'id'>[] = [
  { kind: 'relationshipType', label: 'friend', color: '#4f9cf9', directed: false, builtIn: true },
  { kind: 'relationshipType', label: 'partner', color: '#e2567a', directed: false, builtIn: true },
  { kind: 'relationshipType', label: 'married', color: '#c23d3d', directed: false, builtIn: true },
  { kind: 'relationshipType', label: 'ex', color: '#8a8a94', directed: false, builtIn: true },
  { kind: 'relationshipType', label: 'sibling', color: '#4fbf8b', directed: false, builtIn: true },
  { kind: 'relationshipType', label: 'parent of', color: '#2aa8b8', directed: true, builtIn: true },
  { kind: 'relationshipType', label: 'coworker', color: '#c9a23f', directed: false, builtIn: true },
  { kind: 'relationshipType', label: 'boss of', color: '#e0763c', directed: true, builtIn: true },
  { kind: 'relationshipType', label: 'roommate', color: '#9a6fd0', directed: false, builtIn: true },
  { kind: 'relationshipType', label: 'mentioned', color: '#55555e', directed: true, builtIn: true },
]

/** Circle bubble hues — muted so translucent fills stay readable behind
 * nodes and edges; auto-assigned in order, user-overridable. */
export const CIRCLE_COLORS = [
  '#8aa4ff',
  '#f08aa8',
  '#6fcfb0',
  '#e07ad6',
  '#b48ef0',
  '#f0a06a',
  '#7fd0e8',
  '#a8d070',
]

/** Spoken names for swatches — "orchid", not "hash e zero seven a d six". */
const COLOR_NAMES: Record<string, string> = {
  '#8aa4ff': 'periwinkle',
  '#f08aa8': 'rose',
  '#6fcfb0': 'mint',
  '#e07ad6': 'orchid',
  '#b48ef0': 'lavender',
  '#f0a06a': 'apricot',
  '#7fd0e8': 'sky',
  '#a8d070': 'lime',
  '#d84f9f': 'magenta',
  '#5fd04f': 'green',
  '#4fd0c3': 'teal',
  '#d0c34f': 'yellow',
  '#7a8ff0': 'blue',
  '#f08f7a': 'coral',
}
export function colorName(hex: string): string {
  return COLOR_NAMES[hex.toLowerCase()] ?? hex
}

/** Swatches offered when creating a custom relationship type (§4.2). */
export const CUSTOM_TYPE_COLORS = [
  '#d84f9f',
  '#5fd04f',
  '#4fd0c3',
  '#d0c34f',
  '#7a8ff0',
  '#f08f7a',
]
