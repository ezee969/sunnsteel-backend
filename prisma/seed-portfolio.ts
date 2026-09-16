import 'reflect-metadata'

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

import { ProgressionScheme, RepType } from '@prisma/client'

import { DatabaseService } from '../src/database/database.service'
import { UserRelationshipsService } from '../src/users/user-relationships.service'
import { FeaturedProfileItemsService } from '../src/users/featured-profile-items.service'
import { UsersService } from '../src/users/users.service'
import {
	SeedSession,
	rebuildAnalytics,
	recordCompletedSession,
	writePrescription,
} from './portfolio-seed.analytics'
import {
	MANIFEST_PATH,
	OWNER_EMAIL,
	ROUTINE_IDS,
	SEED_EMAIL_DOMAIN,
	SEED_VERSION,
	SeedManifest,
	projectionIdFor,
	seedId,
} from './portfolio-seed.constants'
import {
	ACTIVE_DAYS,
	DaySpec,
	ExerciseSpec,
	LEGACY_DAYS,
	PEERS,
	PeerProfileSpec,
	SESSION_NOTES,
} from './portfolio-seed.program'
import { resetPortfolioSeed } from './portfolio-seed.reset'

// DatabaseService is the app's PrismaClient, so the verification step can run
// the real search, suggestion and profile services against the seeded rows.
const prisma = new DatabaseService()

/** 12 weeks of history, ending yesterday. */
const HISTORY_DAYS = 84
/** Days older than this belong to the earlier full-body block. */
const LEGACY_CUTOFF_DAYS = 57
/** Week off sick, roughly five weeks back. */
const MISSED_WEEK = { from: 45, to: 51 }
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
	if (setIndex <= 3) return 1
	return 2
}

/**
 * Reps the lifter opens a weight on: top sets at the ceiling minus the natural
 * fall-off, so the drop across sets survives every reset.
 */
function repShape(spec: ExerciseSpec, setIndex: number): number {
	const ceiling = targetReps(spec)
	const floor = floorReps(spec)
	return clamp(floor + 2 - setDropOff(setIndex), floor, ceiling)
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
	/** Deterministic `RoutineExerciseSet` ids, one per set. */
	setIds: string[]
	exerciseId: string
	spec: ExerciseSpec
	/** Current prescription weight per set. */
	weights: number[]
	/** Reps the lifter is currently good for on each set. */
	reps: number[]
	/**
	 * Weight to climb back to after a deload. While set, the weight goes back on
	 * every session regardless of reps -- post-deload work is submaximal, so a
	 * real lifter walks it back up rather than re-earning every plate.
	 */
	rebuildTo: (number | null)[]
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

	// Walking back up after a deload takes priority over the normal rules.
	if (state.rebuildTo.some((target) => target !== null)) {
		for (let i = 0; i < spec.setCount; i += 1) {
			const target = state.rebuildTo[i]
			if (target === null) continue
			state.weights[i] = roundToIncrement(
				Math.min(state.weights[i] + spec.increment, target),
				spec.increment,
			)
			state.reps[i] = repShape(spec, i)
			if (state.weights[i] >= target) state.rebuildTo[i] = null
		}
		return logs
	}

	if (spec.scheme === ProgressionScheme.DOUBLE_PROGRESSION) {
		if (hits.every(Boolean)) {
			for (let i = 0; i < spec.setCount; i += 1) {
				state.weights[i] = roundToIncrement(
					state.weights[i] + spec.increment,
					spec.increment,
				)
				state.reps[i] = repShape(spec, i)
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
				state.reps[i] = repShape(spec, i)
			}
		}
	}

	// Sets that did not progress creep up a rep, except on an off day -- which
	// is what produces the two-to-three session stalls at the same weight.
	const offDay = chance(0.12)
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
	return {
		routineExerciseId,
		setIds: Array.from({ length: spec.setCount }, (_unused, i) =>
			seedId(routineExerciseId, 'set', i),
		),
		exerciseId,
		spec,
		weights: Array.from({ length: spec.setCount }, () => spec.startWeight),
		reps: Array.from({ length: spec.setCount }, (_unused, i) =>
			repShape(spec, i),
		),
		rebuildTo: Array.from({ length: spec.setCount }, () => null),
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
	return [0, 1, 3, 4]
		.map((offset) => (todayDow + offset) % 7)
		.sort((a, b) => a - b)
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
		select: { id: true, email: true, name: true, timeZone: true },
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

function readManifest(): SeedManifest | null {
	if (!existsSync(MANIFEST_PATH)) return null
	try {
		return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as SeedManifest
	} catch {
		return null
	}
}

/** The weekdays a weekly routine does not train on are its planned rest days. */
const restDaysFor = (dows: number[]) =>
	[0, 1, 2, 3, 4, 5, 6].filter((dow) => !dows.includes(dow))

interface BuiltRoutine {
	id: string
	days: {
		routineDayId: string
		dayOfWeek: number
		states: ExerciseState[]
	}[]
}

async function buildRoutine(
	userId: string,
	routineId: string,
	name: string,
	description: string,
	daySpecs: DaySpec[],
	dows: number[],
	options: { isCompleted: boolean; isFavorite: boolean; createdAt: Date },
	exerciseIdByName: Map<string, string>,
): Promise<BuiltRoutine> {
	const built: BuiltRoutine = {
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

	await prisma.routine.create({
		data: {
			id: routineId,
			userId,
			name,
			description,
			isCompleted: options.isCompleted,
			isFavorite: options.isFavorite,
			scheduleMode: 'WEEKLY',
			restDays: restDaysFor(dows),
			createdAt: options.createdAt,
			days: {
				create: daySpecs.map((day, dayIndex) => ({
					id: built.days[dayIndex].routineDayId,
					dayOfWeek: dows[dayIndex],
					name: day.label.slice(0, 40),
					order: dayIndex,
					exercises: {
						create: built.days[dayIndex].states.map((state, exerciseIndex) => ({
							id: state.routineExerciseId,
							exerciseId: state.exerciseId,
							order: exerciseIndex,
							restSeconds: state.spec.restSeconds,
							note: state.spec.note,
							progressionScheme: state.spec.scheme,
							minWeightIncrement: state.spec.increment || 2.5,
							sets: {
								create: state.setIds.map((setId, setIndex) => ({
									id: setId,
									setNumber: setIndex + 1,
									repType: state.spec.set.repType,
									reps: state.spec.set.reps ?? null,
									minReps: state.spec.set.minReps ?? null,
									maxReps: state.spec.set.maxReps ?? null,
									weight: state.spec.startWeight,
									rir: state.spec.set.rir ?? null,
								})),
							},
						})),
					},
				})),
			},
		},
	})

	return built
}

/**
 * Performs one routine day and returns the session as the analytics writers
 * need it: the prescription it was performed against (captured before the
 * simulation advances) and the completed set logs.
 */
function planSession(
	routine: BuiltRoutine,
	day: BuiltRoutine['days'][number],
	sessionId: string,
	startedAt: Date,
	notes: string | null,
): SeedSession {
	const prescription = day.states.flatMap((state) =>
		state.setIds.map((setId, i) => ({ setId, weight: state.weights[i] })),
	)
	const planned = day.states.flatMap((state) => performExercise(state))

	const totalSets = planned.length
	const durationSec =
		clamp(Math.round(12 + totalSets * 3.2 + randInt(-4, 6)), 45, 75) * 60
	const endedAt = new Date(startedAt.getTime() + durationSec * 1000)

	return {
		id: sessionId,
		routineId: routine.id,
		routineDayId: day.routineDayId,
		startedAt,
		endedAt,
		durationSec,
		notes,
		prescription,
		logs: planned.map((log, index) => ({
			id: seedId('setlog', sessionId, log.routineExerciseId, log.setNumber),
			routineExerciseId: log.routineExerciseId,
			exerciseId: log.exerciseId,
			setNumber: log.setNumber,
			reps: log.reps,
			weight: log.weight,
			rpe: log.rpe,
			completedAt: new Date(
				startedAt.getTime() +
					Math.round(((index + 1) / (totalSets + 1)) * durationSec * 1000),
			),
		})),
	}
}

/** Persists the prescriptions the simulated progression arrived at. */
async function persistFinalPrescriptions(routine: BuiltRoutine): Promise<void> {
	await writePrescription(
		prisma,
		routine.days.flatMap((day) =>
			day.states.flatMap((state) =>
				state.setIds.map((setId, i) => ({ setId, weight: state.weights[i] })),
			),
		),
	)
}

/** A peer's program: the owner's days, scaled to their strength. */
function scaleDay(day: DaySpec, strength: number): DaySpec {
	return {
		label: day.label,
		exercises: day.exercises.map((exercise) => ({
			...exercise,
			startWeight: roundToIncrement(
				exercise.startWeight * strength,
				exercise.increment,
			),
			deloads: false,
		})),
	}
}

const PEER_HISTORY_DAYS = 42

async function seedPeerProfile(
	peerId: string,
	handle: string,
	profile: PeerProfileSpec,
	today: Date,
	timeZone: string,
	exerciseIdByName: Map<string, string>,
): Promise<{ sessions: number; setLogs: number }> {
	await prisma.user.update({
		where: { id: peerId },
		data: {
			bio: profile.bio,
			location: profile.location,
			trainingGoals: profile.goals,
			trainingExperienceLevel: profile.experience,
			trainingDisciplines: profile.disciplines,
			preferredTrainingStyle: profile.style,
			age: profile.body.age,
			sex: profile.body.sex,
			weight: profile.body.weight,
			height: profile.body.height,
			bioVisibility: profile.visibility.bio,
			locationVisibility: profile.visibility.location,
			trainingIdentityVisibility: profile.visibility.trainingIdentity,
			historyVisibility: profile.visibility.history,
			recordsVisibility: profile.visibility.records,
			achievementsVisibility: profile.visibility.achievements,
			bodyMetricsVisibility: profile.visibility.bodyMetrics,
			favoriteExercises: {
				create: profile.favorites.map((name, position) => ({
					exerciseId: exerciseIdByName.get(name)!,
					position,
				})),
			},
		},
	})

	const routine = await buildRoutine(
		peerId,
		seedId('routine', 'peer', handle),
		profile.routineName,
		'',
		profile.days.map((index) => scaleDay(ACTIVE_DAYS[index], profile.strength)),
		profile.dows,
		{
			isCompleted: false,
			isFavorite: true,
			createdAt: addDays(today, -(PEER_HISTORY_DAYS + 3)),
		},
		exerciseIdByName,
	)

	let sessions = 0
	let setLogs = 0
	for (let daysAgo = PEER_HISTORY_DAYS; daysAgo >= 1; daysAgo -= 1) {
		const date = addDays(today, -daysAgo)
		const day = routine.days.find(
			(candidate) => candidate.dayOfWeek === date.getDay(),
		)
		if (!day || chance(0.15)) continue
		const session = planSession(
			routine,
			day,
			seedId('session', routine.id, daysAgo),
			sessionStart(date),
			null,
		)
		await recordCompletedSession(prisma, peerId, session)
		sessions += 1
		setLogs += session.logs.length
	}
	await persistFinalPrescriptions(routine)
	await rebuildAnalytics(prisma, peerId, timeZone, projectionIdFor(peerId))

	// Featured through the real service, which refuses records that do not exist.
	await new FeaturedProfileItemsService(prisma).replace(
		peerId,
		profile.featuredRecords.map((name) => ({
			kind: 'RECORD' as const,
			referenceId: exerciseIdByName.get(name)!,
		})),
	)

	return { sessions, setLogs }
}

/**
 * Reads the seeded data back through the real services the capture targets
 * call, and fails the run when a surface would render empty.
 */
async function verify(ownerId: string): Promise<void> {
	const problems: string[] = []
	const ownerRoutineIds = [ROUTINE_IDS.active, ROUTINE_IDS.legacy]
	const expectedDays = ACTIVE_DAYS.length + LEGACY_DAYS.length

	const days = await prisma.routineDay.findMany({
		where: { routineId: { in: ownerRoutineIds } },
		select: { name: true, _count: { select: { exercises: true } } },
	})
	if (days.length !== expectedDays)
		problems.push(`expected ${expectedDays} routine days, found ${days.length}`)
	const emptyDays = days.filter((day) => day._count.exercises === 0)
	if (emptyDays.length)
		problems.push(
			`routine days without exercises: ${emptyDays.map((day) => day.name).join(', ')}`,
		)

	const unsummarized = await prisma.workoutSession.count({
		where: {
			userId: ownerId,
			routineId: { in: ownerRoutineIds },
			OR: [
				{ totalVolumeKg: null },
				{ completedSets: null },
				{ snapshot: null },
			],
		},
	})
	if (unsummarized)
		problems.push(
			`${unsummarized} seeded sessions lack volume, sets or a snapshot`,
		)

	const projection = await prisma.workoutAnalyticsProjection.findFirst({
		where: { userId: ownerId, active: true, state: 'READY' },
	})
	if (!projection)
		problems.push('owner has no active READY analytics projection')

	const [records, achievements, progression] = await Promise.all([
		prisma.personalRecord.count({ where: { userId: ownerId } }),
		prisma.trainingEvent.count({
			where: { userId: ownerId, type: 'ACHIEVEMENT_UNLOCKED' },
		}),
		prisma.trainingEvent.count({
			where: { userId: ownerId, type: 'PROGRESSION_CHANGED' },
		}),
	])
	if (!records) problems.push('owner has no personal records')
	if (!achievements) problems.push('owner has no achievements')

	console.log('\nOwner analytics')
	console.log(`  sessions           ${projection?.completedSessions ?? 0}`)
	console.log(`  sets               ${projection?.completedSets ?? 0}`)
	console.log(
		`  volume             ${Math.round(projection?.totalVolumeKg ?? 0).toLocaleString()} kg`,
	)
	console.log(`  best streak        ${projection?.bestRun ?? 0} days`)
	console.log(`  personal records   ${records}`)
	console.log(`  achievements       ${achievements}`)
	console.log(`  progression events ${progression}`)

	const users = new UsersService(
		prisma,
		new FeaturedProfileItemsService(prisma),
	)
	const relationships = new UserRelationshipsService(prisma)

	console.log('\nSearch (as the owner)')
	for (const query of ['Marta', '@tomas', 'Haddad', 'ken']) {
		const results = await users.searchUsers(query, ownerId, 10)
		console.log(
			`  ${query.padEnd(18)} ${results.map((user) => user.username).join(', ') || '(none)'}`,
		)
		if (!results.length) problems.push(`search "${query}" returned no members`)
	}
	const suggestions = await relationships.suggestions(ownerId)
	console.log(
		`  /search suggestions ${suggestions.items.map((item) => item.username).join(', ') || '(none)'}`,
	)
	if (!suggestions.items.length) problems.push('follow suggestions are empty')

	console.log('\nPeer profiles (owner view | signed-out view)')
	const sections = [
		'bio',
		'location',
		'trainingIdentity',
		'trainingSummary',
		'personalRecords',
		'bodyMetrics',
		'featuredItems',
	]
	const describe = (profile: object) =>
		sections.filter((key) => key in profile).join(', ') || '(nothing)'
	for (const peer of PEERS.filter((candidate) => candidate.profile)) {
		const member = await users.getPublicProfile(ownerId, peer.handle)
		const anonymous = await users.getPublicProfile(null, peer.handle)
		console.log(`  ${peer.handle.padEnd(18)} ${describe(member)}`)
		console.log(`  ${''.padEnd(18)} ${describe(anonymous)}`)
		if (!member.personalRecords?.length)
			problems.push(`${peer.handle} shows no personal records to the owner`)
	}

	if (problems.length) {
		throw new Error(`Verification failed:\n  - ${problems.join('\n  - ')}`)
	}
}

async function main() {
	reportDatabaseHost()

	const owner = await requireOwner()
	console.log(`Owner         : ${owner.email} (${owner.id})`)

	const catalogueSize = await ensureExerciseCatalogue()
	console.log(`Exercises     : ${catalogueSize} in catalogue`)

	// Remember the account's analytics state before the first run only; later
	// runs would otherwise record what the seed itself set.
	const ownerBefore = readManifest()?.ownerBefore ?? {
		timeZone: owner.timeZone,
		hadProjection:
			(await prisma.workoutAnalyticsProjection.count({
				where: { userId: owner.id, id: { not: projectionIdFor(owner.id) } },
			})) > 0,
	}
	const timeZone =
		process.env.SEED_TIME_ZONE ??
		owner.timeZone ??
		Intl.DateTimeFormat().resolvedOptions().timeZone

	const removed = await resetPortfolioSeed(prisma, owner.id)
	const removedTotal = Object.values(removed).reduce((a, b) => a + b, 0)
	if (removedTotal > 0) {
		console.log(`Reset         : cleared ${removedTotal} rows from a prior run`)
	}

	const today = startOfDay(new Date())
	const todayDow = today.getDay()
	const activeDows = activeTrainingDows(todayDow)
	const legacyDows = legacyTrainingDows(todayDow)

	const names = [
		...[...ACTIVE_DAYS, ...LEGACY_DAYS].flatMap((day) =>
			day.exercises.map((exercise) => exercise.name),
		),
		...PEERS.flatMap((peer) => [
			...(peer.profile?.favorites ?? []),
			...(peer.profile?.featuredRecords ?? []),
		]),
	]
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

	let deloadApplied = false
	let noteCursor = 0
	let sessionIndex = 0
	let setLogCount = 0
	let totalVolume = 0
	const noteSessions = new Set([2, 9, 17, 24, 31])

	// Walk forwards through history so progression accumulates in order, and
	// record each session as it happens so its snapshot captures that day's
	// prescription. Day 0 (today) is deliberately left empty: a completed
	// session today would make the dashboard hide today's scheduled work.
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

		// Match the routine day to the real weekday. Rotating through days with a
		// cursor would file a Thursday session under the Sunday day, and the UI
		// labels sessions from `routineDay.dayOfWeek`.
		const day = routine.days.find((candidate) => candidate.dayOfWeek === dow)
		if (!day) continue

		// Coming back from the week off: pull the barbell lifts back ~5% and
		// rebuild. One small deload, exactly where a real one would land.
		let note: string | null = null
		if (!isLegacy && !deloadApplied && daysAgo < MISSED_WEEK.from) {
			deloadApplied = true
			note = SESSION_NOTES[3]
			for (const routineDay of routine.days) {
				for (const state of routineDay.states) {
					if (!state.spec.deloads) continue
					for (let i = 0; i < state.weights.length; i += 1) {
						state.rebuildTo[i] = state.weights[i]
						state.weights[i] = roundToIncrement(
							state.weights[i] * 0.95,
							state.spec.increment,
						)
						state.reps[i] = repShape(state.spec, i)
					}
				}
			}
		} else if (noteSessions.has(sessionIndex)) {
			note = SESSION_NOTES[noteCursor % SESSION_NOTES.length]
			noteCursor += 1
			if (note === SESSION_NOTES[3]) note = SESSION_NOTES[0]
		}

		sessionIndex += 1
		const session = planSession(
			routine,
			day,
			seedId('session', routine.id, daysAgo),
			sessionStart(date),
			note,
		)
		await recordCompletedSession(prisma, owner.id, session)
		setLogCount += session.logs.length
		totalVolume += session.logs.reduce(
			(sum, log) => sum + log.weight * log.reps,
			0,
		)
	}

	// The routine screens show the weights this history actually earned.
	await persistFinalPrescriptions(legacyRoutine)
	await persistFinalPrescriptions(activeRoutine)

	// --- peers and follow graph ------------------------------------------------
	const peerIds = PEERS.map((peer) => seedId('user', peer.handle))
	await prisma.user.createMany({
		data: PEERS.map((peer, index) => ({
			id: peerIds[index],
			email: `${peer.handle}@${SEED_EMAIL_DOMAIN}`,
			username: peer.handle,
			name: peer.name,
			lastName: peer.lastName,
			avatarUrl: `https://api.dicebear.com/9.x/avataaars/svg?seed=${peer.handle}`,
			createdAt: addDays(today, -randInt(60, 200)),
		})),
		skipDuplicates: true,
	})

	let peerSessions = 0
	let peerSetLogs = 0
	for (const [index, peer] of PEERS.entries()) {
		if (!peer.profile) continue
		const seeded = await seedPeerProfile(
			peerIds[index],
			peer.handle,
			peer.profile,
			today,
			timeZone,
			exerciseIdByName,
		)
		peerSessions += seeded.sessions
		peerSetLogs += seeded.setLogs
	}

	// Asymmetric on purpose: some mutual, some one-way in each direction. The
	// owner follows every profiled peer, so followers-only sections open up.
	const iFollow = [0, 1, 2, 4]
	const followMe = [1, 2, 3, 5]
	const follows = [
		...iFollow.map((i) => ({ followerId: owner.id, followingId: peerIds[i] })),
		...followMe.map((i) => ({ followerId: peerIds[i], followingId: owner.id })),
		// Peer-to-peer texture so follower counts are not all 1, and so the
		// suggestions have accounts followed by the people the owner follows.
		{ followerId: peerIds[0], followingId: peerIds[1] },
		{ followerId: peerIds[3], followingId: peerIds[1] },
		{ followerId: peerIds[4], followingId: peerIds[0] },
		{ followerId: peerIds[5], followingId: peerIds[2] },
		{ followerId: peerIds[0], followingId: peerIds[5] },
		{ followerId: peerIds[2], followingId: peerIds[3] },
	]
	await prisma.userFollow.createMany({ data: follows, skipDuplicates: true })

	// --- owner analytics -------------------------------------------------------
	// Replays every completed session of the account, real ones included, into
	// a fresh generation, exactly as the backfill job would.
	const analytics = await rebuildAnalytics(
		prisma,
		owner.id,
		timeZone,
		projectionIdFor(owner.id),
	)

	// --- manifest and summary --------------------------------------------------
	const profiledPeers = PEERS.filter((peer) => peer.profile).length
	const counts = {
		routines: 2 + profiledPeers,
		routineDays: ACTIVE_DAYS.length + LEGACY_DAYS.length,
		routineExercises:
			ACTIVE_DAYS.reduce((n, d) => n + d.exercises.length, 0) +
			LEGACY_DAYS.reduce((n, d) => n + d.exercises.length, 0),
		workoutSessions: sessionIndex,
		setLogs: setLogCount,
		peerUsers: PEERS.length,
		peerSessions,
		peerSetLogs,
		follows: follows.length,
	}

	const manifest: SeedManifest = {
		seedVersion: SEED_VERSION,
		generatedAt: new Date().toISOString(),
		ownerUserId: owner.id,
		ownerEmail: owner.email,
		routineIds: [ROUTINE_IDS.active, ROUTINE_IDS.legacy],
		peerUserIds: peerIds,
		ownerBefore,
		counts,
	}
	writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`)

	console.log('\nCreated')
	for (const [table, value] of Object.entries(counts)) {
		console.log(`  ${table.padEnd(18)} ${value}`)
	}
	console.log(
		`\n  total volume       ${Math.round(totalVolume).toLocaleString()} kg`,
	)
	console.log(`  history window     ${HISTORY_DAYS} days`)
	console.log(
		`  analytics replay   ${analytics.sessions} sessions in ${timeZone} (${analytics.skipped} unrecoverable skipped)`,
	)
	console.log(
		`  active routine     days ${activeDows.join(', ')} (today = ${todayDow})`,
	)
	console.log(`  manifest           ${MANIFEST_PATH}`)

	await verify(owner.id)
	console.log('\nVerification passed.')
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
