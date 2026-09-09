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

export type DomainRecord =
  | Person
  | NoteEntry
  | FollowUp
  | Relationship
  | RelationshipType
  | Photo

export const BUILT_IN_RELATIONSHIP_TYPES: Omit<RelationshipType, 'id'>[] = [
  { kind: 'relationshipType', label: 'friend', color: '#4f9cf9', directed: false, builtIn: true },
  { kind: 'relationshipType', label: 'partner', color: '#e2567a', directed: false, builtIn: true },
  { kind: 'relationshipType', label: 'married', color: '#c04868', directed: false, builtIn: true },
  { kind: 'relationshipType', label: 'ex', color: '#8a8a94', directed: false, builtIn: true },
  { kind: 'relationshipType', label: 'sibling', color: '#4fbf8b', directed: false, builtIn: true },
  { kind: 'relationshipType', label: 'parent of', color: '#3d9970', directed: true, builtIn: true },
  { kind: 'relationshipType', label: 'coworker', color: '#c9a23f', directed: false, builtIn: true },
  { kind: 'relationshipType', label: 'boss of', color: '#a8842c', directed: true, builtIn: true },
  { kind: 'relationshipType', label: 'roommate', color: '#9a6fd0', directed: false, builtIn: true },
  { kind: 'relationshipType', label: 'mentioned', color: '#55555e', directed: true, builtIn: true },
]
