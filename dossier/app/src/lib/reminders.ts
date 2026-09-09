/**
 * Best-effort local reminder notifications (§4.4). The in-app Upcoming
 * view is the guaranteed path; this fires at most one notification per
 * day, and its text is always generic — never a person's name or fact
 * (§6.5: notifications must not out the app's contents).
 */
import { daysUntilDue, daysUntilNext } from './dates'
import type { DomainRecord, Person } from './models'

export function todayStamp(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/** Anything due today (or overdue): birthdays and dated follow-ups. */
export function hasDueItems(records: Map<string, DomainRecord>, now: Date = new Date()): boolean {
  const people = new Map<string, Person>()
  for (const r of records.values()) {
    if (r.kind === 'person') people.set(r.id, r)
  }
  for (const r of records.values()) {
    if (r.kind === 'person' && r.birthday && daysUntilNext(r.birthday, now) === 0) return true
    if (r.kind === 'followUp' && !r.done && r.dueDate && people.has(r.personId)) {
      const days = daysUntilDue(r.dueDate, now)
      if (days !== null && days <= 0) return true
    }
  }
  return false
}

export function notificationsSupported(): boolean {
  return typeof Notification !== 'undefined'
}

export function notificationsGranted(): boolean {
  return notificationsSupported() && Notification.permission === 'granted'
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (!notificationsSupported()) return false
  return (await Notification.requestPermission()) === 'granted'
}

/** Fire the one generic notification. Best-effort; failures are silent. */
export async function showGenericReminder(): Promise<void> {
  try {
    const registration = await navigator.serviceWorker?.ready
    if (registration?.showNotification) {
      await registration.showNotification('Ledger', {
        body: 'You have a reminder.',
        tag: 'ledger-reminder',
      })
      return
    }
    new Notification('Ledger', { body: 'You have a reminder.', tag: 'ledger-reminder' })
  } catch {
    // The in-app Upcoming view is the reliable fallback.
  }
}
