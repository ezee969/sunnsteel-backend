import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';

// Joining SQL files; named so a later patch cannot mangle an escape.
const NEWLINE = String.fromCharCode(10);

/** Prepare only an explicitly opted-in, empty, isolated local test database. */
async function main() {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (
    process.env.ANALYTICS_TEST_DATABASE !== 'isolated' ||
    url.hostname !== '127.0.0.1' ||
    url.pathname !== '/td27_test'
  ) {
    throw new Error(
      'Expected ANALYTICS_TEST_DATABASE=isolated and a loopback /td27_test database',
    );
  }
  const db = new PrismaClient();
  try {
    const tables = await db.$queryRaw<
      Array<{ tablename: string }>
    >`SELECT tablename FROM pg_tables WHERE schemaname='public'`;
    if (tables.length)
      throw new Error(
        'The test database must be empty; existing data is never reset',
      );
  } finally {
    await db.$disconnect();
  }
  const directory = mkdtempSync(join(tmpdir(), 'td27-schema-'));
  const sqlFile = join(directory, 'schema.sql');
  const prisma = (...args: string[]) =>
    execFileSync(
      process.execPath,
      ['node_modules/prisma/build/index.js', ...args],
      { windowsHide: true, stdio: 'pipe' },
    );
  try {
    prisma(
      'migrate',
      'diff',
      '--from-empty',
      '--to-schema-datamodel',
      'scripts/fixtures/analytics-before.prisma',
      '--script',
      '--output',
      sqlFile,
    );
    writeFileSync(
      sqlFile,
      readFileSync(sqlFile, 'utf8') +
        '\n' +
        readFileSync(
          'prisma/migrations/20250925150000_enforce_single_active_session/migration.sql',
          'utf8',
        ) +
        '\n' +
        readFileSync(
          'prisma/migrations/20260906180000_analytics_expand/migration.sql',
          'utf8',
				) +
				'\n' +
				readFileSync(
					'prisma/migrations/20260909090000_progression_changed_event/migration.sql',
					'utf8',
				) +
				'\n' +
				readFileSync(
					'prisma/migrations/20260909150000_unique_usernames/migration.sql',
					'utf8',
				) +
				'\n' +
				readFileSync(
					'prisma/migrations/20260909200000_profile_privacy/migration.sql',
					'utf8',
				) +
				'\n' +
				readFileSync(
					'prisma/migrations/20260909210000_profile_details/migration.sql',
					'utf8',
				) +
				'\n' +
				readFileSync(
					'prisma/migrations/20260909220000_training_identity/migration.sql',
					'utf8',
				) +
				'\n' +
				readFileSync(
					'prisma/migrations/20260910120000_profile_discovery/migration.sql',
					'utf8',
				) +
				'\n' +
				// SOC-07: `SessionShare`. The analytics fixture predates it and no
				// analytics test reads it, but later migrations ALTER the table --
				// TRUST-04 adds its hide column -- so the curated chain has to carry
				// it to stay self-consistent. Leaving it out failed CI with P1014,
				// "the underlying table for model SessionShare does not exist".
				readFileSync(
					'prisma/migrations/20260913180000_session_shares/migration.sql',
					'utf8',
				) +
				'\n' +
				// EXER-09: the integration test creates Exercise rows, and the
				// generated client selects every Exercise column.
				readFileSync(
					'prisma/migrations/20260913200000_exercise_metadata/migration.sql',
					'utf8',
				) +
				'\n' +
				// LIVE-11: the generated client selects the substitutions column.
				readFileSync(
					'prisma/migrations/20260914090000_session_exercise_substitutions/migration.sql',
					'utf8',
				) +
				'\n' +
				// ACH-01: analytics writes and reads the new event values.
				readFileSync(
					'prisma/migrations/20260914103000_milestone_achievements/migration.sql',
					'utf8',
				) +
				'\n' +
				// EXER-07: keeps the isolated schema aligned with the generated client.
				readFileSync(
					'prisma/migrations/20260914160000_starred_exercises/migration.sql',
					'utf8',
				) +
				'\n' +
				// PREF-05: the generated client selects every User column.
				readFileSync(
					'prisma/migrations/20260914210000_plateau_min_sessions/migration.sql',
					'utf8',
				) +
				'\n' +
				// ROUT-11: rotation routines and day names.
				readFileSync(
					'prisma/migrations/20260914230000_rotation_routines/migration.sql',
					'utf8',
				) +
				'\n' +
				// SCHED-07: planned rest weekdays on routines.
				readFileSync(
					'prisma/migrations/20260915090000_routine_rest_days/migration.sql',
					'utf8',
				) +
				'\n' +
				// ROUT-08: routine versions.
				readFileSync(
					'prisma/migrations/20260915150000_routine_versions/migration.sql',
					'utf8',
				) +
				'\n' +
				// SCHED-06: rotation training weekdays.
				readFileSync(
					'prisma/migrations/20260915170000_rotation_weekdays/migration.sql',
					'utf8',
				) +
				'\n' +
				// SCHED-04: schedule overrides.
				readFileSync(
					'prisma/migrations/20260915190000_schedule_overrides/migration.sql',
					'utf8',
				) +
				'\n' +
				// SCHED-05: skipped occurrences.
				readFileSync(
					'prisma/migrations/20260915210000_schedule_skip/migration.sql',
					'utf8',
				) +
				'\n' +
				// NOTIF-01: notifications.
				readFileSync(
					'prisma/migrations/20260915230000_notifications/migration.sql',
					'utf8',
				) +
				'\n' +
				// PROF-07: ordered featured profile selections.
				readFileSync(
					'prisma/migrations/20260916090000_featured_profile_items/migration.sql',
					'utf8',
				) +
				'\n' +
				// NOTIF-08/NOTIF-03: push subscriptions and scheduled alerts.
				readFileSync(
					'prisma/migrations/20260917074329_push_delivery/migration.sql',
					'utf8',
				) +
				'\n' +
				// NOTIF-05/NOTIF-04: notification controls and the reminder time.
				readFileSync(
					'prisma/migrations/20260917140000_notification_preferences/migration.sql',
					'utf8',
				) +
				NEWLINE +
				// NOTIF-06: the streak-at-risk category.
				readFileSync(
					'prisma/migrations/20260917170000_streak_at_risk_category/migration.sql',
					'utf8',
				) +
				NEWLINE +
				// ROUT-04: routine visibility and share links.
				readFileSync(
					'prisma/migrations/20260917200000_routine_sharing/migration.sql',
					'utf8',
				) +
				NEWLINE +
				// PROF-08: the ROUTINE featured-item kind.
				readFileSync(
					'prisma/migrations/20260918090000_featured_routine_kind/migration.sql',
					'utf8',
				) +
				NEWLINE +
				// PROF-10/ROUT-06: blocks, reports and clone lineage.
				readFileSync(
					'prisma/migrations/20260918140000_blocks_reports_lineage/migration.sql',
					'utf8',
				) +
				NEWLINE +
				// ROUT-07: owner-declared routine goal and experience level.
				readFileSync(
					'prisma/migrations/20260919100000_routine_classification/migration.sql',
					'utf8',
				) +
				NEWLINE +
				// SOC-03/SOC-04: activity sharing defaults, overrides and sharedAt.
				readFileSync(
					'prisma/migrations/20260919120000_activity_sharing/migration.sql',
					'utf8',
				) +
				NEWLINE +
				// SOC-05: themed reactions on an activity entry.
				readFileSync(
					'prisma/migrations/20260920120000_activity_reactions/migration.sql',
					'utf8',
				) +
				NEWLINE +
				// TRUST-04: the moderator flag, report review state, the hide
				// columns and the append-only enforcement log.
				readFileSync(
					'prisma/migrations/20260920160000_moderation_foundation/migration.sql',
					'utf8',
				) +
				NEWLINE +
				// SOC-06: comments on an activity entry, plus the COMMENT report
				// kind and the ACTIVITY_COMMENT notification kind.
				readFileSync(
					'prisma/migrations/20260921140000_activity_comments/migration.sql',
					'utf8',
				) +
				NEWLINE +
				// SOC-08: mutual partnerships and their independent grants.
				readFileSync(
					'prisma/migrations/20260922110000_training_partners/migration.sql',
					'utf8',
				) +
				NEWLINE +
				// TD-47: drops the pre-Supabase auth storage. The curated chain
				// above never created those tables, so only the User.password
				// drop does anything here -- and it must, because the generated
				// client no longer knows that column.
				readFileSync(
					'prisma/migrations/20260922140000_drop_legacy_auth/migration.sql',
					'utf8',
				),
    );
    prisma(
      'db',
      'execute',
      '--file',
      sqlFile,
      '--url',
      process.env.DATABASE_URL!,
    );
    console.log(
      'Isolated analytics database prepared with the legacy schema and analytics migrations.',
    );
  } finally {
    try {
      unlinkSync(sqlFile);
    } finally {
      rmdirSync(directory);
    }
  }
}
void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
