/**
 * Local-clock helpers for NOTIF-04 and NOTIF-05.
 *
 * Everything reads the wall clock *forwards* — "what is the local time now" —
 * and never converts a local time back to an instant. Reverse conversion is
 * where daylight saving bites: 02:30 happens twice in autumn and not at all in
 * spring, so a reminder built by mapping a chosen minute onto UTC would fire
 * twice or never on those two days a year. Matching a window against the
 * current local minute has no such day.
 */

const PART_FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let existing = PART_FORMATTERS.get(timeZone);
  if (!existing) {
    existing = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    PART_FORMATTERS.set(timeZone, existing);
  }
  return existing;
}

export interface LocalClock {
  /** `YYYY-MM-DD` in the given zone. */
  date: string;
  /** Minutes from local midnight, 0 to 1439. */
  minuteOfDay: number;
}

export function localClock(at: Date, timeZone: string): LocalClock {
  const parts = formatter(timeZone).formatToParts(at);
  const part = (type: string) =>
    parts.find((candidate) => candidate.type === type)?.value ?? '00';
  // `hour12: false` yields 24 in some engines for midnight; normalise it.
  const hour = Number(part('hour')) % 24;
  return {
    date: `${part('year')}-${part('month')}-${part('day')}`,
    minuteOfDay: hour * 60 + Number(part('minute')),
  };
}

export function localMinuteOfDay(at: Date, timeZone: string): number {
  return localClock(at, timeZone).minuteOfDay;
}

export function localDate(at: Date, timeZone: string): string {
  return localClock(at, timeZone).date;
}

/**
 * True when the current local minute is inside the catch-up window that starts
 * at the chosen time. The window exists so a restart, a slow tick or a deploy
 * does not silently drop the day's reminder; the per-date dedupe key is what
 * stops the same reminder going out twice within it.
 */
export function isWithinReminderWindow(
  currentMinuteOfDay: number,
  reminderMinuteOfDay: number,
  windowMinutes: number,
): boolean {
  const delta = currentMinuteOfDay - reminderMinuteOfDay;
  // Never matches across midnight: a reminder set at 23:55 is simply missed if
  // nothing runs before midnight, rather than arriving on the wrong date.
  return delta >= 0 && delta < windowMinutes;
}
