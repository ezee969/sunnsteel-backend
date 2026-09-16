import {
	PreferredTrainingStyle,
	ProfileVisibility,
	ProgressionScheme,
	RepType,
	Sex,
	TrainingDiscipline,
	TrainingExperienceLevel,
	TrainingGoal,
} from '@prisma/client'

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

/**
 * A peer whose profile has something to show: identity sections, a short
 * training history of their own (so records and the training summary are
 * real), and privacy settings that open some sections to everyone and keep
 * others for followers.
 */
export interface PeerProfileSpec {
	bio: string
	location: string
	goals: TrainingGoal[]
	experience: TrainingExperienceLevel
	disciplines: TrainingDiscipline[]
	style: PreferredTrainingStyle
	/** Catalogue exercise names, in display order. */
	favorites: string[]
	body: { age: number; sex: Sex; weight: number; height: number }
	visibility: {
		bio: ProfileVisibility
		location: ProfileVisibility
		trainingIdentity: ProfileVisibility
		history: ProfileVisibility
		records: ProfileVisibility
		achievements: ProfileVisibility
		bodyMetrics: ProfileVisibility
	}
	routineName: string
	/** Indexes into ACTIVE_DAYS; each becomes one day of the peer's routine. */
	days: number[]
	/** Weekdays the peer trains on, one per day above. */
	dows: number[]
	/** Scales the owner's starting weights. */
	strength: number
	/** Exercise names whose records the peer features on their profile. */
	featuredRecords: string[]
}

export interface PeerSpec {
	handle: string
	name: string
	lastName: string
	profile?: PeerProfileSpec
}

const { PUBLIC, FOLLOWERS, PRIVATE } = ProfileVisibility

/** Peer accounts so search and the public profiles are not empty. */
export const PEERS: PeerSpec[] = [
	{
		handle: 'marta-ibanez',
		name: 'Marta',
		lastName: 'Ibanez',
		profile: {
			bio: 'Powerlifter chasing a 140 kg deadlift. Coffee first, then pulls.',
			location: 'Valencia, Spain',
			goals: [TrainingGoal.STRENGTH],
			experience: TrainingExperienceLevel.ADVANCED,
			disciplines: [TrainingDiscipline.POWERLIFTING],
			style: PreferredTrainingStyle.UPPER_LOWER,
			favorites: ['Deadlift', 'Squat', 'Bench Press'],
			body: { age: 29, sex: Sex.FEMALE, weight: 63, height: 166 },
			visibility: {
				bio: PUBLIC,
				location: PUBLIC,
				trainingIdentity: PUBLIC,
				history: PUBLIC,
				records: PUBLIC,
				achievements: PUBLIC,
				bodyMetrics: FOLLOWERS,
			},
			routineName: 'Meet Prep - Block 2',
			days: [1, 3],
			dows: [2, 5],
			strength: 0.8,
			featuredRecords: ['Deadlift', 'Squat'],
		},
	},
	{
		handle: 'tomas-ferreira',
		name: 'Tomas',
		lastName: 'Ferreira',
		profile: {
			bio: 'Hypertrophy nerd. Upper/lower four days a week, long rests, no ego.',
			location: 'Porto, Portugal',
			goals: [TrainingGoal.MUSCLE_GROWTH, TrainingGoal.STRENGTH],
			experience: TrainingExperienceLevel.INTERMEDIATE,
			disciplines: [TrainingDiscipline.BODYBUILDING],
			style: PreferredTrainingStyle.UPPER_LOWER,
			favorites: ['Incline Dumbbell Press', 'Pull-ups'],
			body: { age: 33, sex: Sex.MALE, weight: 84, height: 181 },
			visibility: {
				bio: PUBLIC,
				location: PUBLIC,
				trainingIdentity: PUBLIC,
				history: FOLLOWERS,
				records: FOLLOWERS,
				achievements: FOLLOWERS,
				bodyMetrics: PRIVATE,
			},
			routineName: 'Upper / Lower Hypertrophy',
			days: [0, 2],
			dows: [1, 4],
			strength: 1.05,
			featuredRecords: ['Bench Press'],
		},
	},
	{
		handle: 'nadia-haddad',
		name: 'Nadia',
		lastName: 'Haddad',
		profile: {
			bio: 'Hybrid athlete: lifting three days, running the rest.',
			location: 'Montreal, Canada',
			goals: [TrainingGoal.GENERAL_FITNESS, TrainingGoal.ENDURANCE],
			experience: TrainingExperienceLevel.INTERMEDIATE,
			disciplines: [TrainingDiscipline.HYBRID_TRAINING],
			style: PreferredTrainingStyle.FULL_BODY,
			favorites: ['Front Squat', 'Overhead Press'],
			body: { age: 27, sex: Sex.FEMALE, weight: 58, height: 170 },
			visibility: {
				bio: PUBLIC,
				location: PRIVATE,
				trainingIdentity: PUBLIC,
				history: FOLLOWERS,
				records: PUBLIC,
				achievements: PUBLIC,
				bodyMetrics: PRIVATE,
			},
			routineName: 'Strength for Runners',
			days: [0, 3],
			dows: [3, 6],
			strength: 0.65,
			featuredRecords: ['Front Squat'],
		},
	},
	{ handle: 'ken-watanabe', name: 'Ken', lastName: 'Watanabe' },
	{ handle: 'lucia-moreno', name: 'Lucia', lastName: 'Moreno' },
	{ handle: 'darius-okonkwo', name: 'Darius', lastName: 'Okonkwo' },
]

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
