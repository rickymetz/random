/**
 * Best-effort local reminder notifications (§4.4). The in-app Upcoming
 * view is the guaranteed path; this fires at most one notification per
 * day, and its text is always generic — never a person's name or fact
 * (§6.5: notifications must not out the app's contents).
 */
import { daysUntilDue, daysUntilNext } from './dates'
import { currentDisguise } from './disguise'
import type { DomainRecord, Person } from './models'

export function todayStamp(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/**
 * Overdue follow-ups only count for a week — a follow-up abandoned in
 * 2024 must not produce a daily notification forever (a recurring banner
 * is itself the persistent signal §6.5 avoids).
 */
const OVERDUE_WINDOW_DAYS = 7

/** Anything due today (or recently overdue): birthdays and follow-ups. */
export function hasDueItems(records: Map<string, DomainRecord>, now: Date = new Date()): boolean {
  const people = new Map<string, Person>()
  for (const r of records.values()) {
    if (r.kind === 'person') people.set(r.id, r)
  }
  for (const r of records.values()) {
    if (r.kind === 'person' && r.birthday && daysUntilNext(r.birthday, now) === 0) return true
    if (r.kind === 'followUp' && !r.done && r.dueDate && people.has(r.personId)) {
      const days = daysUntilDue(r.dueDate, now)
      if (days !== null && days <= 0 && days >= -OVERDUE_WINDOW_DAYS) return true
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

/**
 * Fire the one generic notification. Returns whether it was actually
 * shown, so the caller only stamps the day on success. serviceWorker.ready
 * never rejects and can hang forever with no active SW, so it races a
 * short timeout before falling back to a plain Notification.
 */
export async function showGenericReminder(): Promise<boolean> {
  try {
    const registration = navigator.serviceWorker
      ? await Promise.race([
          navigator.serviceWorker.ready,
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500)),
        ])
      : null
    // Title matches the installed disguise, not a fixed product name (§6.5).
    const title = currentDisguise().name
    if (registration?.showNotification) {
      await registration.showNotification(title, {
        body: 'You have a reminder.',
        tag: 'ledger-reminder',
      })
      return true
    }
    new Notification(title, { body: 'You have a reminder.', tag: 'ledger-reminder' })
    return true
  } catch {
    // The in-app Upcoming view is the reliable fallback.
    return false
  }
}
