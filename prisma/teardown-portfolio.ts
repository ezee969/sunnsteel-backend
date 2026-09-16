import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, unlinkSync } from 'node:fs'

import { PrismaClient } from '@prisma/client'

import { rebuildAnalytics } from './portfolio-seed.analytics'
import {
	MANIFEST_PATH,
	OWNER_EMAIL,
	SEED_VERSION,
	SeedManifest,
} from './portfolio-seed.constants'
import { resetPortfolioSeed } from './portfolio-seed.reset'

const prisma = new PrismaClient()

function reportDatabaseHost(): void {
	let host = 'unknown'
	try {
		host = new URL(process.env.DATABASE_URL ?? '').host
	} catch {
		/* leave as unknown */
	}
	console.log(`Database host : ${host}`)
	console.log(`Seed version  : ${SEED_VERSION}`)
}

function readManifest(): SeedManifest | null {
	if (!existsSync(MANIFEST_PATH)) return null
	try {
		return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as SeedManifest
	} catch {
		return null
	}
}

async function main() {
	reportDatabaseHost()

	const manifest = readManifest()
	const owner = await prisma.user.findFirst({
		where: manifest
			? { OR: [{ id: manifest.ownerUserId }, { email: OWNER_EMAIL }] }
			: { email: OWNER_EMAIL },
		select: { id: true, timeZone: true },
	})

	const removed = await resetPortfolioSeed(prisma, owner?.id ?? null)

	console.log('\nRemoved')
	for (const [table, value] of Object.entries(removed)) {
		console.log(`  ${table.padEnd(18)} ${value}`)
	}

	// The seed's analytics generation is gone. Rebuild one over whatever real
	// history is left; an account that had neither analytics nor history goes
	// back to having no generation at all.
	if (owner) {
		const [remainingSessions, otherProjections] = await Promise.all([
			prisma.workoutSession.count({
				where: { userId: owner.id, status: 'COMPLETED' },
			}),
			prisma.workoutAnalyticsProjection.count({ where: { userId: owner.id } }),
		])
		const hadProjection =
			manifest?.ownerBefore?.hadProjection ?? otherProjections > 0
		if (remainingSessions > 0 || hadProjection) {
			const timeZone =
				manifest?.ownerBefore?.timeZone ??
				owner.timeZone ??
				Intl.DateTimeFormat().resolvedOptions().timeZone
			const rebuilt = await rebuildAnalytics(
				prisma,
				owner.id,
				timeZone,
				randomUUID(),
			)
			console.log(
				`\n  analytics rebuilt  ${rebuilt.sessions} sessions (${timeZone})`,
			)
		} else if (manifest?.ownerBefore) {
			await prisma.user.update({
				where: { id: owner.id },
				data: { timeZone: manifest.ownerBefore.timeZone },
			})
		}
	}

	if (existsSync(MANIFEST_PATH)) {
		unlinkSync(MANIFEST_PATH)
		console.log(`\n  manifest deleted   ${MANIFEST_PATH}`)
	}

	console.log(
		'\nThe real user account, the exercise catalogue and any routine not created by this seed were left untouched.',
	)
}

main()
	.catch((error: unknown) => {
		console.error(
			`\nTeardown failed: ${error instanceof Error ? error.message : String(error)}`,
		)
		process.exitCode = 1
	})
	.finally(() => {
		void prisma.$disconnect()
	})
