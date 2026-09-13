import { PrismaClient } from '@prisma/client'

import { EXERCISE_CATALOG } from './exercise-catalog'

const prisma = new PrismaClient()

/**
 * Upserts the exercise catalog by name so IDs and references are preserved
 * across runs. This is the idempotent seed used by `npm run db:seed` /
 * `db:add-exercises` and the Prisma migrate seed hook.
 *
 * To add exercises: append entries to `EXERCISE_CATALOG` in
 * `prisma/exercise-catalog.ts` (with their EXER-09 metadata), then run
 * `npx tsx prisma/add-exercises.ts` (or `npm run db:seed`). Existing
 * databases pick up metadata changes from this seed; a production backfill
 * needs a migration generated with `buildExerciseMetadataSql`.
 */
async function main() {
	console.log('🌱 Seeding exercise catalog...')

	let created = 0
	let updated = 0

	for (const exercise of EXERCISE_CATALOG) {
		const data = {
			primaryMuscles: exercise.primaryMuscles,
			secondaryMuscles: exercise.secondaryMuscles,
			equipment: exercise.equipment,
			movementPattern: exercise.movementPattern,
			mechanic: exercise.mechanic,
			equipmentRequired: exercise.equipmentRequired,
			substitutionGroup: exercise.substitutionGroup,
		}
		const result = await prisma.exercise.upsert({
			where: { name: exercise.name },
			update: data,
			create: { name: exercise.name, ...data },
		})

		const isNew = result.createdAt.getTime() === result.updatedAt.getTime()
		if (isNew) {
			created++
		} else {
			updated++
		}
	}

	console.log(`✅ Seeding completed: ${created} created, ${updated} updated`)
	console.log(`📊 Total exercises: ${EXERCISE_CATALOG.length}`)
}

main()
	.catch((e) => {
		console.error('❌ Seed failed:', e)
		process.exit(1)
	})
	.finally(() => {
		void prisma.$disconnect()
	})
