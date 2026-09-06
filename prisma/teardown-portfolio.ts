import { existsSync, unlinkSync } from 'node:fs'

import { PrismaClient } from '@prisma/client'

import { MANIFEST_PATH, SEED_VERSION } from './portfolio-seed.constants'
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

async function main() {
	reportDatabaseHost()

	const removed = await resetPortfolioSeed(prisma)

	console.log('\nRemoved')
	for (const [table, value] of Object.entries(removed)) {
		console.log(`  ${table.padEnd(18)} ${value}`)
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
