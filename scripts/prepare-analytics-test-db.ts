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
