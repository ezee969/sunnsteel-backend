import { ProgressionScheme, RepType } from '@prisma/client'

/**
 * The training program the seed replays.
 *
 * Weights are kg for an intermediate lifter and hold sane inter-lift ratios
 * (deadlift > squat > bench > overhead press). Dumbbell entries are per-hand.
 */
export interface SetSpec {
	repType: RepType
	/** FIXED prescriptions. */
	reps?: number
	/** RANGE prescriptions -- `maxReps` is the progression target. */
	minReps?: number
	maxReps?: number
	rir?: number
}

export interface ExerciseSpec {
	/** Must match a name in the canonical catalogue (prisma/add-exercises.ts). */
	name: string
	scheme: ProgressionScheme
	restSeconds: number
	note?: string
	setCount: number
	set: SetSpec
	startWeight: number
	increment: number
	/** Barbell lifts take the mid-block deload; accessories do not. */
	deloads?: boolean
}

export interface DaySpec {
	label: string
	exercises: ExerciseSpec[]
}

const range = (minReps: number, maxReps: number, rir = 2): SetSpec => ({
	repType: RepType.RANGE,
	minReps,
	maxReps,
	rir,
})

const fixed = (reps: number, rir = 2): SetSpec => ({
	repType: RepType.FIXED,
	reps,
	rir,
})

/** 4-day upper/lower -- the current block. */
export const ACTIVE_DAYS: DaySpec[] = [
	{
		label: 'Upper A - Horizontal',
		exercises: [
			{
				name: 'Bench Press',
				scheme: ProgressionScheme.DOUBLE_PROGRESSION,
				restSeconds: 180,
				note: 'Pause on the chest, no bounce.',
				setCount: 4,
				set: range(5, 7, 1),
				startWeight: 72.5,
				increment: 2.5,
				deloads: true,
			},
			{
				name: 'Bent-over Row',
				scheme: ProgressionScheme.DOUBLE_PROGRESSION,
				restSeconds: 150,
				setCount: 4,
				set: range(6, 8),
				startWeight: 62.5,
				increment: 2.5,
				deloads: true,
			},
			{
				name: 'Overhead Press',
				scheme: ProgressionScheme.DYNAMIC_DOUBLE_PROGRESSION,
				restSeconds: 120,
				setCount: 3,
				set: range(6, 9),
				startWeight: 45,
				increment: 2.5,
				deloads: true,
			},
			{
				name: 'Lat Pulldown',
				scheme: ProgressionScheme.NONE,
				restSeconds: 90,
				setCount: 3,
				set: fixed(10),
				startWeight: 65,
				increment: 5,
			},
			{
				name: 'Tricep Pushdown',
				scheme: ProgressionScheme.NONE,
				restSeconds: 60,
				setCount: 3,
				set: fixed(12, 1),
				startWeight: 32.5,
				increment: 2.5,
			},
		],
	},
	{
		label: 'Lower A - Squat focus',
		exercises: [
			{
				name: 'Squat',
				scheme: ProgressionScheme.DOUBLE_PROGRESSION,
				restSeconds: 210,
				note: 'Belt from the third set.',
				setCount: 4,
				set: range(5, 7, 1),
				startWeight: 90,
				increment: 2.5,
				deloads: true,
			},
			{
				name: 'Romanian Deadlift',
				scheme: ProgressionScheme.DOUBLE_PROGRESSION,
				restSeconds: 150,
				setCount: 3,
				set: range(8, 10),
				startWeight: 80,
				increment: 2.5,
				deloads: true,
			},
			{
				name: 'Leg Press',
				scheme: ProgressionScheme.NONE,
				restSeconds: 120,
				setCount: 3,
				set: fixed(12),
				startWeight: 180,
				increment: 10,
			},
			{
				name: 'Seated Leg Curl',
				scheme: ProgressionScheme.NONE,
				restSeconds: 75,
				setCount: 3,
				set: fixed(12, 1),
				startWeight: 47.5,
				increment: 2.5,
			},
			{
				name: 'Standing Calf Raise',
				scheme: ProgressionScheme.NONE,
				restSeconds: 60,
				setCount: 4,
				set: fixed(12, 1),
				startWeight: 70,
				increment: 5,
			},
		],
	},
	{
		label: 'Upper B - Vertical',
		exercises: [
			{
				name: 'Incline Dumbbell Press',
				scheme: ProgressionScheme.DYNAMIC_DOUBLE_PROGRESSION,
				restSeconds: 150,
				setCount: 4,
				set: range(8, 10),
				startWeight: 28,
				increment: 2,
			},
			{
				name: 'Pull-ups',
				scheme: ProgressionScheme.NONE,
				restSeconds: 150,
				note: 'Bodyweight plus belt.',
				setCount: 4,
				set: fixed(8, 1),
				startWeight: 5,
				increment: 2.5,
			},
			{
				name: 'Dumbbell Shoulder Press',
				scheme: ProgressionScheme.DOUBLE_PROGRESSION,
				restSeconds: 120,
				setCount: 3,
				set: range(8, 10),
				startWeight: 22,
				increment: 2,
			},
			{
				name: 'Cable Row',
				scheme: ProgressionScheme.NONE,
				restSeconds: 90,
				setCount: 3,
				set: fixed(12),
				startWeight: 70,
				increment: 5,
			},
			{
				name: 'Barbell Curl',
				scheme: ProgressionScheme.DYNAMIC_DOUBLE_PROGRESSION,
				restSeconds: 75,
				setCount: 3,
				set: range(8, 12, 1),
				startWeight: 30,
				increment: 2.5,
			},
		],
	},
	{
		label: 'Lower B - Hinge focus',
		exercises: [
			{
				name: 'Deadlift',
				scheme: ProgressionScheme.DOUBLE_PROGRESSION,
				restSeconds: 240,
				note: 'Double overhand until it slips, then mixed.',
				setCount: 3,
				set: range(3, 5, 1),
				startWeight: 120,
				increment: 5,
				deloads: true,
			},
			{
				name: 'Front Squat',
				scheme: ProgressionScheme.DOUBLE_PROGRESSION,
				restSeconds: 180,
				setCount: 3,
				set: range(5, 7),
				startWeight: 70,
				increment: 2.5,
				deloads: true,
			},
			{
				name: 'Bulgarian Split Squat',
				scheme: ProgressionScheme.NONE,
				restSeconds: 90,
				setCount: 3,
				set: fixed(10),
				startWeight: 20,
				increment: 2,
			},
			{
				name: 'Leg Extension',
				scheme: ProgressionScheme.NONE,
				restSeconds: 75,
				setCount: 3,
				set: fixed(15, 1),
				startWeight: 45,
				increment: 5,
			},
			{
				name: 'Hanging Leg Raise',
				scheme: ProgressionScheme.NONE,
				restSeconds: 60,
				setCount: 3,
				set: fixed(12, 1),
				startWeight: 0,
				increment: 0,
			},
		],
	},
]

/** 3-day full body -- the earlier block, archived as completed. */
export const LEGACY_DAYS: DaySpec[] = [
	{
		label: 'Full Body A',
		exercises: [
			{
				name: 'Squat',
				scheme: ProgressionScheme.DOUBLE_PROGRESSION,
				restSeconds: 180,
				setCount: 3,
				set: range(5, 8, 2),
				startWeight: 82.5,
				increment: 2.5,
			},
			{
				name: 'Bench Press',
				scheme: ProgressionScheme.DOUBLE_PROGRESSION,
				restSeconds: 180,
				setCount: 3,
				set: range(5, 8, 2),
				startWeight: 65,
				increment: 2.5,
			},
			{
				name: 'Bent-over Row',
				scheme: ProgressionScheme.NONE,
				restSeconds: 120,
				setCount: 3,
				set: fixed(10),
				startWeight: 55,
				increment: 2.5,
			},
			{
				name: 'Plank',
				scheme: ProgressionScheme.NONE,
				restSeconds: 60,
				setCount: 3,
				set: fixed(1, 1),
				startWeight: 0,
				increment: 0,
			},
		],
	},
	{
		label: 'Full Body B',
		exercises: [
			{
				name: 'Deadlift',
				scheme: ProgressionScheme.DOUBLE_PROGRESSION,
				restSeconds: 210,
				setCount: 3,
				set: range(4, 6, 2),
				startWeight: 110,
				increment: 5,
			},
			{
				name: 'Overhead Press',
				scheme: ProgressionScheme.DOUBLE_PROGRESSION,
				restSeconds: 150,
				setCount: 3,
				set: range(6, 8),
				startWeight: 40,
				increment: 2.5,
			},
			{
				name: 'Lat Pulldown',
				scheme: ProgressionScheme.NONE,
				restSeconds: 90,
				setCount: 3,
				set: fixed(10),
				startWeight: 55,
				increment: 5,
			},
			{
				name: 'Dumbbell Curl',
				scheme: ProgressionScheme.NONE,
				restSeconds: 60,
				setCount: 3,
				set: fixed(12, 1),
				startWeight: 12,
				increment: 2,
			},
		],
	},
	{
		label: 'Full Body C',
		exercises: [
			{
				name: 'Front Squat',
				scheme: ProgressionScheme.NONE,
				restSeconds: 150,
				setCount: 3,
				set: fixed(8),
				startWeight: 60,
				increment: 2.5,
			},
			{
				name: 'Incline Bench Press',
				scheme: ProgressionScheme.DOUBLE_PROGRESSION,
				restSeconds: 150,
				setCount: 3,
				set: range(6, 8),
				startWeight: 55,
				increment: 2.5,
			},
			{
				name: 'Cable Row',
				scheme: ProgressionScheme.NONE,
				restSeconds: 90,
				setCount: 3,
				set: fixed(12),
				startWeight: 60,
				increment: 5,
			},
			{
				name: 'Calf Raise',
				scheme: ProgressionScheme.NONE,
				restSeconds: 60,
				setCount: 3,
				set: fixed(15, 1),
				startWeight: 60,
				increment: 5,
			},
		],
	},
]

/** Peer accounts so search and the public profiles are not empty. */
export const PEERS = [
	{ handle: 'marta-ibanez', name: 'Marta', lastName: 'Ibanez' },
	{ handle: 'tomas-ferreira', name: 'Tomas', lastName: 'Ferreira' },
	{ handle: 'nadia-haddad', name: 'Nadia', lastName: 'Haddad' },
	{ handle: 'ken-watanabe', name: 'Ken', lastName: 'Watanabe' },
	{ handle: 'lucia-moreno', name: 'Lucia', lastName: 'Moreno' },
	{ handle: 'darius-okonkwo', name: 'Darius', lastName: 'Okonkwo' },
] as const

/** Session notes -- deliberately sparse, only a handful across 12 weeks. */
export const SESSION_NOTES = [
	'Felt strong today, bar speed was good on the top set.',
	'Slept badly, kept the weight and just moved it.',
	'Right shoulder a bit cranky on pressing, shortened the range.',
	'Back after a week off sick. Took 10% off and rebuilt.',
	'Gym was packed, had to superset the accessories.',
	'Best top set in months. Grip finally holding.',
	'Deload week. Everything felt light, which is the point.',
]
