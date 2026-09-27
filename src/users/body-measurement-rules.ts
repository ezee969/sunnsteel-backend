import {
  BODY_MEASUREMENT_FIELD_KEYS,
  BODY_PROGRESS_RANGES,
  bodyProgressRangeStart,
  summarizeBodyProgress,
  type BodyMeasurement,
  type BodyMeasurementValues,
  type BodyProgressRange,
  type BodyProgressResponse,
  type UpsertBodyMeasurementRequest,
} from '@sunsteel/contracts';

/** A stored row as Prisma returns it; `date` is a `@db.Date` at UTC midnight. */
export type BodyMeasurementRow = BodyMeasurementValues & {
  date: Date;
  createdAt: Date;
  updatedAt: Date;
};

export const BODY_MEASUREMENT_SELECT = {
  date: true,
  weightKg: true,
  waistCm: true,
  hipsCm: true,
  chestCm: true,
  armCm: true,
  thighCm: true,
  bodyFatPercent: true,
  createdAt: true,
  updatedAt: true,
} as const;

export const DEFAULT_BODY_PROGRESS_RANGE: BodyProgressRange = '90D';

export function columnDate(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

export function rowDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function parseBodyProgressRange(
  value: string | undefined,
): BodyProgressRange | null {
  if (value === undefined || value === '') return DEFAULT_BODY_PROGRESS_RANGE;
  return (BODY_PROGRESS_RANGES as readonly string[]).includes(value)
    ? (value as BodyProgressRange)
    : null;
}

/**
 * An entry may be dated up to one day after the member's local today, which
 * absorbs a device clock or time zone that runs ahead; never further.
 */
export function isAllowedEntryDate(date: string, today: string): boolean {
  const limit = columnDate(today);
  limit.setUTCDate(limit.getUTCDate() + 1);
  return columnDate(date).getTime() <= limit.getTime();
}

/** Every field written on a PUT: a missing one clears that value. */
export function entryValues(
  input: UpsertBodyMeasurementRequest,
): BodyMeasurementValues {
  const values = {} as BodyMeasurementValues;
  for (const key of BODY_MEASUREMENT_FIELD_KEYS) values[key] = input[key] ?? null;
  return values;
}

export function toBodyMeasurement(row: BodyMeasurementRow): BodyMeasurement {
  return {
    date: rowDate(row.date),
    ...entryValues(row),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Rows in any order; the summary reads all of them, entries only the range's. */
export function buildBodyProgress(
  rows: BodyMeasurementRow[],
  range: BodyProgressRange,
  today: string,
): BodyProgressResponse {
  const rangeStart = bodyProgressRangeStart(range, today);
  const all = rows
    .map(toBodyMeasurement)
    .sort((a, b) => a.date.localeCompare(b.date));
  return {
    range,
    rangeStart,
    entries: all.filter((entry) => rangeStart === null || entry.date >= rangeStart),
    summary: summarizeBodyProgress(all, rangeStart),
  };
}

/** Kilogram weights closer than this are the same value (two-decimal pound noise). */
const SAME_WEIGHT_KG = 0.005;

export function isSameWeight(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a === b;
  return Math.abs(a - b) < SAME_WEIGHT_KG;
}
