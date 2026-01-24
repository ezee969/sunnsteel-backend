import { PrismaClient, MuscleGroup } from '@prisma/client'

const prisma = new PrismaClient()

type ExerciseSeed = {
	name: string
	primaryMuscles: MuscleGroup[]
	secondaryMuscles: MuscleGroup[]
	equipment: string
}

/**
 * Add new exercises to the database without affecting existing ones.
 * This script uses upsert to safely add exercises while preserving IDs.
 * 
 * Usage:
 * 1. Add your new exercises to the `newExercises` array below
 * 2. Run: npx tsx prisma/add-exercises.ts
 */
const newExercises: ExerciseSeed[] = [
	{
		name: 'Leg Press',
		primaryMuscles: [MuscleGroup.QUADRICEPS],
		secondaryMuscles: [MuscleGroup.GLUTES, MuscleGroup.HAMSTRINGS],
		equipment: 'machine',
	},
	{
		name: 'Back Extension (Hamstring Bias)',
		primaryMuscles: [MuscleGroup.HAMSTRINGS],
		secondaryMuscles: [MuscleGroup.ERECTOR_SPINAE, MuscleGroup.GLUTES],
		equipment: 'bodyweight',
	},
	{
		name: 'Seated Leg Extension (Unilateral)',
		primaryMuscles: [MuscleGroup.QUADRICEPS],
		secondaryMuscles: [],
		equipment: 'machine',
	},
	{
		name: 'Hip Adduction Machine',
		primaryMuscles: [MuscleGroup.ADDUCTOR],
		secondaryMuscles: [],
		equipment: 'machine',
	},
	{
		name: 'Pause Squat',
		primaryMuscles: [MuscleGroup.QUADRICEPS],
		secondaryMuscles: [MuscleGroup.GLUTES, MuscleGroup.HAMSTRINGS],
		equipment: 'barbell',
	},
]

async function main() {
	console.log('➕ Adding new exercises...')

	if (newExercises.length === 0) {
		console.log('⚠️  No exercises to add. Add exercises to the newExercises array.')
		return
	}

	let created = 0
	let skipped = 0

	for (const exercise of newExercises) {
		const result = await prisma.exercise.upsert({
			where: { name: exercise.name },
			update: {
				// Don't update if exists - just skip
			},
			create: exercise,
		})

		// Check if this was a create or update
		const isNew = result.createdAt.getTime() === result.updatedAt.getTime()
		if (isNew) {
			created++
			console.log(`  ✅ Created: ${exercise.name}`)
		} else {
			skipped++
			console.log(`  ⏭️  Skipped (already exists): ${exercise.name}`)
		}
	}

	console.log('\n📊 Summary:')
	console.log(`  - Created: ${created}`)
	console.log(`  - Skipped: ${skipped}`)
	console.log(`  - Total processed: ${newExercises.length}`)
}

main()
	.catch((e) => {
		console.error('❌ Failed to add exercises:', e)
		process.exit(1)
	})
	.finally(() => {
		void prisma.$disconnect()
	})
