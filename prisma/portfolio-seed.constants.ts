import { v5 as uuidv5 } from 'uuid'

/**
 * Shared identity rules for the portfolio seed.
 *
 * No table has a "seeded" column, so instead of adding a migration purely for
 * demo data every row this seed writes gets a **deterministic** id derived from
 * a fixed namespace. That makes the seed idempotent (a re-run addresses exactly
 * the same rows) and makes teardown unambiguous: anything whose id is not
 * reproducible from this namespace was not created by us and is left alone.
 */
export const PORTFOLIO_SEED_NAMESPACE = '3f1a7c60-9d24-5b8e-a7f3-2c5d8e1b40aa'

/** Bumping this abandons every previously seeded id — tear down first. */
export const SEED_VERSION = 'v1'

/**
 * Fabricated peer accounts live on a domain that cannot receive mail and can
 * never collide with a real Supabase signup. Teardown uses it as a second,
 * independent check alongside the deterministic ids.
 */
export const SEED_EMAIL_DOMAIN = 'seed.sunnsteel.invalid'

export function seedId(...parts: (string | number)[]): string {
	return uuidv5(
		[SEED_VERSION, ...parts.map(String)].join(':'),
		PORTFOLIO_SEED_NAMESPACE,
	)
}

/** Stable ids for the two routines attached to the real user. */
export const ROUTINE_IDS = {
	active: seedId('routine', 'upper-lower'),
	legacy: seedId('routine', 'full-body'),
} as const

export const MANIFEST_PATH = 'prisma/.portfolio-seed-manifest.json'

export interface SeedManifest {
	seedVersion: string
	generatedAt: string
	ownerUserId: string
	ownerEmail: string
	routineIds: string[]
	peerUserIds: string[]
	counts: Record<string, number>
}
