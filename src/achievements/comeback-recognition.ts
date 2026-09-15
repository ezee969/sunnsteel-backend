import {
  COMEBACK_MIN_INACTIVE_DAYS,
  COMEBACK_RECOGNITION_LIMIT,
  COMEBACK_REQUIRED_ACTIVE_DAYS,
  COMEBACK_WINDOW_DAYS,
  ComebackRecognitionSummary,
} from '@sunsteel/contracts';

export interface CompletedSessionEvent {
  id: string;
  sessionId: string | null;
  occurredAt: Date;
}

interface ActiveTrainingDay {
  date: string;
  eventId: string;
  sessionId: string;
  occurredAt: Date;
}

const dayDifference = (later: string, earlier: string) =>
  Math.round(
    (Date.parse(`${later}T00:00:00Z`) - Date.parse(`${earlier}T00:00:00Z`)) /
      86_400_000,
  );

function localDate(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const part = (type: string) =>
    parts.find(candidate => candidate.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function activeTrainingDays(
  events: CompletedSessionEvent[],
  timeZone: string,
): ActiveTrainingDay[] {
  const sorted = [...events]
    .filter((event): event is CompletedSessionEvent & { sessionId: string } =>
      Boolean(event.sessionId),
    )
    .sort(
      (left, right) =>
        left.occurredAt.getTime() - right.occurredAt.getTime() ||
        left.id.localeCompare(right.id),
    );
  const days: ActiveTrainingDay[] = [];
  for (const event of sorted) {
    const date = localDate(event.occurredAt, timeZone);
    if (days.at(-1)?.date === date) continue;
    days.push({
      date,
      eventId: event.id,
      sessionId: event.sessionId,
      occurredAt: event.occurredAt,
    });
  }
  return days;
}

/**
 * A comeback starts after fourteen full inactive local dates and is recognized
 * only after three distinct active dates inside an inclusive fourteen-day
 * window. It is derived from immutable completion events, so reads are stable.
 */
export function comebackRecognitionSummary(
  events: CompletedSessionEvent[],
  timeZone: string,
  historyTruncated: boolean,
): ComebackRecognitionSummary {
  const days = activeTrainingDays(events, timeZone);
  const recognitions: ComebackRecognitionSummary['recognitions'] = [];
  let candidate:
    | {
        returned: ActiveTrainingDay;
        inactiveDays: number;
        activeDays: number;
      }
    | undefined;

  for (let index = 1; index < days.length; index += 1) {
    const previous = days[index - 1];
    const current = days[index];
    const inactiveDays = dayDifference(current.date, previous.date) - 1;

    if (inactiveDays >= COMEBACK_MIN_INACTIVE_DAYS) {
      candidate = { returned: current, inactiveDays, activeDays: 1 };
      continue;
    }
    if (!candidate) continue;

    const windowDays = dayDifference(current.date, candidate.returned.date) + 1;
    if (windowDays > COMEBACK_WINDOW_DAYS) {
      candidate = undefined;
      continue;
    }

    candidate.activeDays += 1;
    if (candidate.activeDays < COMEBACK_REQUIRED_ACTIVE_DAYS) continue;

    recognitions.push({
      id: `comeback:${candidate.returned.eventId}:${current.eventId}:v1`,
      inactiveDays: candidate.inactiveDays,
      returnedAt: candidate.returned.occurredAt.toISOString(),
      recognizedAt: current.occurredAt.toISOString(),
      sourceSessionId: current.sessionId,
      activeDays: candidate.activeDays,
      windowDays,
    });
    candidate = undefined;
  }

  return {
    minimumInactiveDays: COMEBACK_MIN_INACTIVE_DAYS,
    requiredActiveDays: COMEBACK_REQUIRED_ACTIVE_DAYS,
    windowDays: COMEBACK_WINDOW_DAYS,
    recognitions: [...recognitions]
      .reverse()
      .slice(0, COMEBACK_RECOGNITION_LIMIT),
    historyTruncated,
  };
}
