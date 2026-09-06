import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

import {
	PrismaClient,
	ProgressionScheme,
	RepType,
	WorkoutSessionStatus,
} from '@prisma/client'

import {
	MANIFEST_PATH,
	ROUTINE_IDS,
	SEED_EMAIL_DOMAIN,
	SEED_VERSION,
	SeedManifest,
	seedId,
} from './portfolio-seed.constants'
import {
	ACTIVE_DAYS,
	DaySpec,
	ExerciseSpec,
	LEGACY_DAYS,
	PEERS,
	SESSION_NOTES,
} from './portfolio-seed.program'
import { resetPortfolioSeed } from './portfolio-seed.reset'

const prisma = new PrismaClient()

const OWNER_EMAIL = process.env.SEED_OWNER_EMAIL ?? 'eze.olivero96@gmail.com'

/** 12 weeks of history, ending yesterday. */
const HISTORY_DAYS = 84
/** Days older than this belong to the earlier full-body block. */
const LEGACY_CUTOFF_DAYS = 57
/** Week off sick, roughly five weeks back. */
const MISSED_WEEK = { from: 30, to: 36 }
/** No skipped sessions inside this window, so recent activity stays dense. */
const NO_SKIP_RECENT_DAYS = 12

const MS_PER_DAY = 86_400_000

// ---------------------------------------------------------------------------
// Deterministic randomness
// ---------------------------------------------------------------------------

/**
 * mulberry32 -- small, fast, and seeded, so two runs of this script produce
 * byte-identical data. That is what makes the seed idempotent in practice
 * rather than just in principle.
 */
function makeRng(seed: number): () => number {
	let state = seed >>> 0
	return () => {
		state = (state + 0x6d2b79f5) >>> 0
		let t = state
		t = Math.imul(t ^ (t >>> 15), t | 1)
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

const rng = makeRng(0x51e6d17f)

const randInt = (min: number, max: number) =>
	min + Math.floor(rng() * (max - min + 1))
const chance = (probability: number) => rng() < probability

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const clamp = (value: number, min: number, max: number) =>
	Math.min(max, Math.max(min, value))

const round2 = (value: number) => Math.round(value * 100) / 100

function roundToIncrement(weight: number, increment: number): number {
	if (increment <= 0) return round2(weight)
	return round2(Math.round(weight / increment) * increment)
}

function startOfDay(date: Date): Date {
	const copy = new Date(date)
	copy.setHours(0, 0, 0, 0)
	return copy
}

function addDays(date: Date, days: number): Date {
	return new Date(date.getTime() + days * MS_PER_DAY)
}

/**
 * Reps fall off across the sets of an exercise, the way they actually do when
 * the weight stays put and fatigue accumulates.
 */
function setDropOff(setIndex: number): number {
	if (setIndex <= 1) return 0
	if (setIndex === 2) return 1
	return 2
}

function targetReps(spec: ExerciseSpec): number {
	return spec.set.repType === RepType.RANGE
		? (spec.set.maxReps ?? 0)
		: (spec.set.reps ?? 0)
}

function floorReps(spec: ExerciseSpec): number {
	return spec.set.repType === RepType.RANGE
		? (spec.set.minReps ?? 1)
		: Math.max(1, (spec.set.reps ?? 1) - 2)
}

/** RPE climbs across the sets and again when a set is at the rep ceiling. */
function rpeFor(setIndex: number, atCeiling: boolean): number {
	const raw =
		6.5 + setIndex * 0.5 + (atCeiling ? 0.5 : 0) + (chance(0.35) ? 0.5 : 0)
	return clamp(Math.round(raw * 2) / 2, 6, 9.5)
}

// ---------------------------------------------------------------------------
// Progression simulation
// ---------------------------------------------------------------------------

interface ExerciseState {
	routineExerciseId: string
	exerciseId: string
	spec: ExerciseSpec
	/** Current prescription weight per set. */
	weights: number[]
	/** Reps the lifter is currently good for on each set. */
	reps: number[]
}

interface PlannedSetLog {
	routineExerciseId: string
	exerciseId: string
	setNumber: number
	reps: number
	weight: number
	rpe: number
}

/**
 * Performs one session for one exercise, then advances state using **exactly**
 * the rules `WorkoutSessionFinishService` applies on finish:
 *
 * - `DOUBLE_PROGRESSION` -- every set must hit target before any weight moves.
 * - `DYNAMIC_DOUBLE_PROGRESSION` -- each set progresses on its own.
 * - `NONE` -- weight is whatever was logged; nothing moves automatically.
 *
 * Keeping these in lockstep is what makes the stored prescriptions agree with
 * the history that produced them.
 */
function performExercise(state: ExerciseState): PlannedSetLog[] {
	const { spec } = state
	const ceiling = targetReps(spec)
	const floor = floorReps(spec)
	const logs: PlannedSetLog[] = []

	for (let i = 0; i < spec.setCount; i += 1) {
		const reps = clamp(state.reps[i], 1, ceiling)
		logs.push({
			routineExerciseId: state.routineExerciseId,
			exerciseId: state.exerciseId,
			setNumber: i + 1,
			reps,
			weight: state.weights[i],
			rpe: rpeFor(i, reps >= ceiling),
		})
	}

	const hits = logs.map((log) => log.reps >= ceiling)

	if (spec.scheme === ProgressionScheme.DOUBLE_PROGRESSION) {
		if (hits.every(Boolean)) {
			for (let i = 0; i < spec.setCount; i += 1) {
				state.weights[i] = roundToIncrement(
					state.weights[i] + spec.increment,
					spec.increment,
				)
				state.reps[i] = floor
			}
			return logs
		}
	} else if (spec.scheme === ProgressionScheme.DYNAMIC_DOUBLE_PROGRESSION) {
		for (let i = 0; i < spec.setCount; i += 1) {
			if (hits[i]) {
				state.weights[i] = roundToIncrement(
					state.weights[i] + spec.increment,
					spec.increment,
				)
				state.reps[i] = floor
			}
		}
	}

	// Sets that did not progress creep up a rep, except on an off day -- which
	// is what produces the two-to-three session stalls at the same weight.
	const offDay = chance(0.16)
	for (let i = 0; i < spec.setCount; i += 1) {
		if (hits[i] && spec.scheme !== ProgressionScheme.NONE) continue
		if (spec.scheme === ProgressionScheme.NONE) {
			state.reps[i] = clamp(
				ceiling - setDropOff(i) - (chance(0.25) ? 1 : 0),
				1,
				ceiling,
			)
			continue
		}
		if (!offDay) state.reps[i] = clamp(state.reps[i] + 1, 1, ceiling)
	}

	return logs
}

function initialState(
	routineExerciseId: string,
	exerciseId: string,
	spec: ExerciseSpec,
): ExerciseState {
	const ceiling = targetReps(spec)
	const floor = floorReps(spec)
	return {
		routineExerciseId,
		exerciseId,
		spec,
		weights: Array.from({ length: spec.setCount }, () => spec.startWeight),
		reps: Array.from({ length: spec.setCount }, (_unused, i) =>
			clamp(floor + 1 - setDropOff(i), 1, ceiling),
		),
	}
}

// ---------------------------------------------------------------------------
// Schedule
// ---------------------------------------------------------------------------

/**
 * Training days for the 4-day split, guaranteeing today is one of them so the
 * dashboard's "Today's Workouts" has real scheduled work to show.
 */
function activeTrainingDows(todayDow: number): number[] {
	const canonical = [1, 2, 4, 5] // Mon, Tue, Thu, Fri
	if (canonical.includes(todayDow)) return canonical
	return [0, 1, 3, 4].map((offset) => (todayDow + offset) % 7).sort((a, b) => a - b)
}

/** Three days for the archived block that deliberately avoid today. */
function legacyTrainingDows(todayDow: number): number[] {
	const preferred = [1, 3, 5].filter((dow) => dow !== todayDow)
	const spare = [0, 2, 4, 6].filter(
		(dow) => dow !== todayDow && !preferred.includes(dow),
	)
	while (preferred.length < 3) preferred.push(spare.shift()!)
	return preferred.sort((a, b) => a - b)
}

function sessionStart(date: Date): Date {
	const weekend = date.getDay() === 0 || date.getDay() === 6
	const start = new Date(date)
	start.setHours(
		weekend ? randInt(9, 11) : randInt(17, 19),
		randInt(0, 59),
		0,
		0,
	)
	return start
}

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

function reportDatabaseHost(): void {
	const url = process.env.DATABASE_URL ?? ''
	let host = 'unknown'
	try {
		host = new URL(url).host
	} catch {
		/* leave as unknown */
	}
	console.log(`Database host : ${host}`)
	console.log(`Seed version  : ${SEED_VERSION}`)
}

async function ensureExerciseCatalogue(): Promise<number> {
	const count = await prisma.exercise.count()
	if (count >= 40) return count

	console.log(
		`Exercise catalogue is thin (${count}). Running the canonical loader...`,
	)
	execFileSync('npx', ['tsx', 'prisma/add-exercises.ts'], {
		stdio: 'inherit',
		shell: process.platform === 'win32',
	})
	return prisma.exercise.count()
}

async function requireOwner() {
	const owner = await prisma.user.findUnique({
		where: { email: OWNER_EMAIL },
		select: { id: true, email: true, name: true },
	})

	if (!owner) {
		throw new Error(
			[
				`No user row found for ${OWNER_EMAIL}.`,
				'',
				'Auth is Supabase-backed and the local users row is only created on',
				'the first authenticated request. Log in through the app once, then',
				're-run this seed. This script will never create an auth identity.',
			].join('\n'),
		)
	}

	return owner
}

interface BuiltRoutine {
	id: string
	days: {
		routineDayId: string
		dayOfWeek: number
		states: ExerciseState[]
	}[]
}

async function buildRoutine(
	ownerId: string,
	routineId: string,
	name: string,
	description: string,
	daySpecs: DaySpec[],
	dows: number[],
	options: { isCompleted: boolean; isFavorite: boolean; createdAt: Date },
	exerciseIdByName: Map<string, string>,
): Promise<BuiltRoutine> {
	await prisma.routine.create({
		data: {
			id: routineId,
			userId: ownerId,
			name,
			description,
			isCompleted: options.isCompleted,
			isFavorite: options.isFavorite,
			createdAt: options.createdAt,
			days: {
				create: daySpecs.map((day, dayIndex) => ({
					id: seedId(routineId, 'day', dayIndex),
					dayOfWeek: dows[dayIndex],
					order: dayIndex,
					exercises: {
						create: day.exercises.map((spec, exerciseIndex) => ({
							id: seedId(routineId, 'day', dayIndex, 'ex', exerciseIndex),
							exerciseId: exerciseIdByName.get(spec.name)!,
							order: exerciseIndex,
							restSeconds: spec.restSeconds,
							note: spec.note,
							progressionScheme: spec.scheme,
							minWeightIncrement: spec.increment || 2.5,
							sets: {
								create: Array.from(
									{ length: spec.setCount },
									(_unused, setIndex) => ({
										id: seedId(
											routineId,
											'day',
											dayIndex,
											'ex',
											exerciseIndex,
											'set',
											setIndex,
										),
										setNumber: setIndex + 1,
										repType: spec.set.repType,
										reps: spec.set.reps ?? null,
										minReps: spec.set.minReps ?? null,
										maxReps: spec.set.maxReps ?? null,
										weight: spec.startWeight,
										rir: spec.set.rir ?? null,
									}),
								),
							},
						})),
					},
				})),
			},
		},
	})

	return {
		id: routineId,
		days: daySpecs.map((day, dayIndex) => ({
			routineDayId: seedId(routineId, 'day', dayIndex),
			dayOfWeek: dows[dayIndex],
			states: day.exercises.map((spec, exerciseIndex) =>
				initialState(
					seedId(routineId, 'day', dayIndex, 'ex', exerciseIndex),
					exerciseIdByName.get(spec.name)!,
					spec,
				),
			),
		})),
	}
}

async function main() {
	reportDatabaseHost()

	const owner = await requireOwner()
	console.log(`Owner         : ${owner.email} (${owner.id})`)

	const catalogueSize = await ensureExerciseCatalogue()
	console.log(`Exercises     : ${catalogueSize} in catalogue`)

	const removed = await resetPortfolioSeed(prisma)
	const removedTotal = Object.values(removed).reduce((a, b) => a + b, 0)
	if (removedTotal > 0) {
		console.log(`Reset         : cleared ${removedTotal} rows from a prior run`)
	}

	const today = startOfDay(new Date())
	const todayDow = today.getDay()
	const activeDows = activeTrainingDows(todayDow)
	const legacyDows = legacyTrainingDows(todayDow)

	const names = [...ACTIVE_DAYS, ...LEGACY_DAYS].flatMap((day) =>
		day.exercises.map((exercise) => exercise.name),
	)
	const catalogue = await prisma.exercise.findMany({
		where: { name: { in: [...new Set(names)] } },
		select: { id: true, name: true },
	})
	const exerciseIdByName = new Map(catalogue.map((e) => [e.name, e.id]))
	const missing = [...new Set(names)].filter((n) => !exerciseIdByName.has(n))
	if (missing.length) {
		throw new Error(
			`Exercise catalogue is missing: ${missing.join(', ')}.\n` +
				'Run `npm run db:seed` first.',
		)
	}

	const legacyRoutine = await buildRoutine(
		owner.id,
		ROUTINE_IDS.legacy,
		'Full Body Foundations',
		'Three-day full body block. Ran it for a month before moving to the upper/lower split.',
		LEGACY_DAYS,
		legacyDows,
		{
			isCompleted: true,
			isFavorite: false,
			createdAt: addDays(today, -(HISTORY_DAYS + 6)),
		},
		exerciseIdByName,
	)

	const activeRoutine = await buildRoutine(
		owner.id,
		ROUTINE_IDS.active,
		'Upper / Lower - Autumn Block',
		'Four-day upper/lower split. Double progression on the main lifts, straight sets on accessories.',
		ACTIVE_DAYS,
		activeDows,
		{
			isCompleted: false,
			isFavorite: true,
			createdAt: addDays(today, -(LEGACY_CUTOFF_DAYS + 2)),
		},
		exerciseIdByName,
	)

	const sessions: {
		id: string
		routineId: string
		routineDayId: string
		startedAt: Date
		endedAt: Date
		durationSec: number
		notes: string | null
	}[] = []
	const setLogRows: {
		id: string
		sessionId: string
		routineExerciseId: string
		exerciseId: string
		setNumber: number
		reps: number
		weight: number
		rpe: number
		isCompleted: boolean
		completedAt: Date
	}[] = []

	let legacyCursor = 0
	let activeCursor = 0
	let deloadApplied = false
	let noteCursor = 0
	const noteDays = new Set([79, 62, 44, 21, 9])

	// Walk forwards through history so progression accumulates in order. Day 0
	// (today) is deliberately left empty: a completed session today would make
	// the dashboard hide today's scheduled work.
	for (let daysAgo = HISTORY_DAYS; daysAgo >= 1; daysAgo -= 1) {
		const date = addDays(today, -daysAgo)
		const dow = date.getDay()

		if (daysAgo <= MISSED_WEEK.to && daysAgo >= MISSED_WEEK.from) continue

		const isLegacy = daysAgo > LEGACY_CUTOFF_DAYS
		const routine = isLegacy ? legacyRoutine : activeRoutine
		const dows = isLegacy ? legacyDows : activeDows
		if (!dows.includes(dow)) continue

		// A believable amount of life getting in the way, but never in the last
		// stretch -- recent activity and the streak both read off that window.
		if (daysAgo > NO_SKIP_RECENT_DAYS && chance(0.1)) continue

		const dayIndex = isLegacy ? legacyCursor % 3 : activeCursor % 4
		if (isLegacy) legacyCursor += 1
		else activeCursor += 1

		const day = routine.days[dayIndex]

		// Coming back from the week off: pull the barbell lifts back ~10% and
		// rebuild. One small deload, exactly where a real one would land.
		let note: string | null = null
		if (!isLegacy && !deloadApplied && daysAgo < MISSED_WEEK.from) {
			deloadApplied = true
			note = SESSION_NOTES[3]
			for (const routineDay of routine.days) {
				for (const state of routineDay.states) {
					if (!state.spec.deloads) continue
					for (let i = 0; i < state.weights.length; i += 1) {
						state.weights[i] = roundToIncrement(
							state.weights[i] * 0.9,
							state.spec.increment,
						)
						state.reps[i] = floorReps(state.spec)
					}
				}
			}
		} else if (noteDays.has(daysAgo)) {
			note = SESSION_NOTES[noteCursor % SESSION_NOTES.length]
			noteCursor += 1
			if (note === SESSION_NOTES[3]) note = SESSION_NOTES[0]
		}

		const sessionId = seedId('session', routine.id, daysAgo)
		const startedAt = sessionStart(date)

		const logs = day.states.flatMap((state) => performExercise(state))

		const totalSets = logs.length
		const durationSec =
			clamp(Math.round(12 + totalSets * 3.2 + randInt(-4, 6)), 45, 75) * 60
		const endedAt = new Date(startedAt.getTime() + durationSec * 1000)

		sessions.push({
			id: sessionId,
			routineId: routine.id,
			routineDayId: day.routineDayId,
			startedAt,
			endedAt,
			durationSec,
			notes: note,
		})

		logs.forEach((log, index) => {
			setLogRows.push({
				id: seedId('setlog', sessionId, log.routineExerciseId, log.setNumber),
				sessionId,
				routineExerciseId: log.routineExerciseId,
				exerciseId: log.exerciseId,
				setNumber: log.setNumber,
				reps: log.reps,
				weight: log.weight,
				rpe: log.rpe,
				isCompleted: true,
				completedAt: new Date(
					startedAt.getTime() +
						Math.round(((index + 1) / (totalSets + 1)) * durationSec * 1000),
				),
			})
		})
	}

	await prisma.workoutSession.createMany({
		data: sessions.map((session) => ({
			...session,
			userId: owner.id,
			status: WorkoutSessionStatus.COMPLETED,
			lastActivityAt: session.endedAt,
			createdAt: session.startedAt,
		})),
		skipDuplicates: true,
	})

	// Chunked: a single createMany with a few thousand rows blows past the
	// pooled connection's parameter limit.
	for (let i = 0; i < setLogRows.length; i += 500) {
		await prisma.setLog.createMany({
			data: setLogRows.slice(i, i + 500),
			skipDuplicates: true,
		})
	}

	// Persist the prescriptions the simulated progression arrived at, so the
	// routine screens show the weights this history actually earned.
	for (const routine of [legacyRoutine, activeRoutine]) {
		for (const day of routine.days) {
			for (const state of day.states) {
				for (let i = 0; i < state.weights.length; i += 1) {
					await prisma.routineExerciseSet.update({
						where: {
							routineExerciseId_setNumber: {
								routineExerciseId: state.routineExerciseId,
								setNumber: i + 1,
							},
						},
						data: { weight: state.weights[i] },
					})
				}
			}
		}
	}

	// --- peers and follow graph ------------------------------------------------
	const peerIds = PEERS.map((peer) => seedId('user', peer.handle))
	await prisma.user.createMany({
		data: PEERS.map((peer, index) => ({
			id: peerIds[index],
			email: `${peer.handle}@${SEED_EMAIL_DOMAIN}`,
			name: peer.name,
			lastName: peer.lastName,
			avatarUrl: `https://api.dicebear.com/9.x/avataaars/svg?seed=${peer.handle}`,
			createdAt: addDays(today, -randInt(30, 200)),
		})),
		skipDuplicates: true,
	})

	// Asymmetric on purpose: some mutual, some one-way in each direction.
	const iFollow = [0, 1, 2, 4]
	const followMe = [1, 2, 3, 5]
	const follows = [
		...iFollow.map((i) => ({ followerId: owner.id, followingId: peerIds[i] })),
		...followMe.map((i) => ({ followerId: peerIds[i], followingId: owner.id })),
		// A little peer-to-peer texture so follower counts are not all 1.
		{ followerId: peerIds[0], followingId: peerIds[1] },
		{ followerId: peerIds[3], followingId: peerIds[1] },
		{ followerId: peerIds[4], followingId: peerIds[0] },
		{ followerId: peerIds[5], followingId: peerIds[2] },
	]
	await prisma.userFollow.createMany({ data: follows, skipDuplicates: true })

	// --- manifest and summary --------------------------------------------------
	const counts = {
		routines: 2,
		routineDays: ACTIVE_DAYS.length + LEGACY_DAYS.length,
		routineExercises:
			ACTIVE_DAYS.reduce((n, d) => n + d.exercises.length, 0) +
			LEGACY_DAYS.reduce((n, d) => n + d.exercises.length, 0),
		workoutSessions: sessions.length,
		setLogs: setLogRows.length,
		peerUsers: PEERS.length,
		follows: follows.length,
	}

	const manifest: SeedManifest = {
		seedVersion: SEED_VERSION,
		generatedAt: new Date().toISOString(),
		ownerUserId: owner.id,
		ownerEmail: owner.email,
		routineIds: [ROUTINE_IDS.active, ROUTINE_IDS.legacy],
		peerUserIds: peerIds,
		counts,
	}
	writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`)

	const totalVolume = setLogRows.reduce(
		(sum, log) => sum + log.weight * log.reps,
		0,
	)

	console.log('\nCreated')
	for (const [table, value] of Object.entries(counts)) {
		console.log(`  ${table.padEnd(18)} ${value}`)
	}
	console.log(`\n  total volume       ${Math.round(totalVolume).toLocaleString()} kg`)
	console.log(`  history window     ${HISTORY_DAYS} days`)
	console.log(
		`  active routine     days ${activeDows.join(', ')} (today = ${todayDow})`,
	)
	console.log(`  manifest           ${MANIFEST_PATH}`)
}

main()
	.catch((error: unknown) => {
		console.error(
			`\nSeed failed: ${error instanceof Error ? error.message : String(error)}`,
		)
		process.exitCode = 1
	})
	.finally(() => {
		void prisma.$disconnect()
	})
