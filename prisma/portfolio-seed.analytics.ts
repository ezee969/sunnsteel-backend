import { Prisma, PrismaClient } from '@prisma/client'

import { lockTrainingAccount } from '../src/workouts/analytics/analytics-lock'
import {
	applyContribution,
	summarizeSession,
} from '../src/workouts/analytics/analytics-writer'
import { writeProgressionEvents } from '../src/workouts/analytics/progression-events'
import { ensureSessionSnapshot } from '../src/workouts/analytics/session-snapshot'
import { buildProgressionOutcome } from '../src/workouts/progression-changes'

/**
 * The portfolio seed writes history through the same writers a real finish
 * and the analytics backfill use, so every derived surface (snapshots,
 * progression and record events, personal records, rollups, achievements) is
 * produced by production code rather than approximated here.
 */

export interface SeedSetLog {
	id: string
	routineExerciseId: string
	exerciseId: string
	setNumber: number
	reps: number
	weight: number
	rpe: number
	completedAt: Date
}

export interface SeedSession {
	id: string
	routineId: string
	routineDayId: string
	startedAt: Date
	endedAt: Date
	durationSec: number
	notes: string | null
	/** The prescription this session was performed against, by set id. */
	prescription: { setId: string; weight: number }[]
	logs: SeedSetLog[]
}

/**
 * Batch size and transaction budget for the analytics replay.
 *
 * Remote databases pay a round trip per statement, and how much that costs
 * depends entirely on which database DATABASE_URL points at. Four sessions per
 * transaction finishes in seconds against a local Postgres; against the hosted
 * one it overran the 60s interactive-transaction limit part-way through a run
 * on 2026-09-16, after the reset had already cleared 993 rows — so the account
 * was left with no portfolio data at all and the failure was only visible in
 * the seed's own output.
 *
 * Halving the batch and doubling the budget gives roughly four times the
 * headroom. Both are overridable so a slower link does not need a code change:
 * SEED_REPLAY_BATCH, SEED_TX_TIMEOUT_MS, SEED_TX_MAX_WAIT_MS.
 */
const REPLAY_BATCH = Number(process.env.SEED_REPLAY_BATCH ?? 2)
const TX_OPTIONS = {
	timeout: Number(process.env.SEED_TX_TIMEOUT_MS ?? 120_000),
	maxWait: Number(process.env.SEED_TX_MAX_WAIT_MS ?? 15_000),
}

/** Writes a routine day's prescription in one statement. */
export async function writePrescription(
	prisma: PrismaClient,
	sets: { setId: string; weight: number }[],
): Promise<void> {
	if (!sets.length) return
	const values = Prisma.join(
		sets.map((set) => Prisma.sql`(${set.setId}, ${set.weight}::float8)`),
	)
	await prisma.$executeRaw`
		UPDATE "RoutineExerciseSet" AS s SET "weight" = v.weight
		FROM (VALUES ${values}) AS v(id, weight)
		WHERE s."id" = v.id`
}

/**
 * Records one completed session as a finish would have: the routine carries
 * the prescription the session was performed against, the snapshot is
 * captured from it, and the progression the finish rules derive is written as
 * `PROGRESSION_CHANGED` events at the session's real end time. Routine weights
 * themselves are left to the caller's simulation, which also models deloads.
 */
export async function recordCompletedSession(
	prisma: PrismaClient,
	userId: string,
	session: SeedSession,
): Promise<void> {
	await writePrescription(prisma, session.prescription)
	await prisma.workoutSession.create({
		data: {
			id: session.id,
			userId,
			routineId: session.routineId,
			routineDayId: session.routineDayId,
			status: 'COMPLETED',
			startedAt: session.startedAt,
			endedAt: session.endedAt,
			durationSec: session.durationSec,
			notes: session.notes,
			lastActivityAt: session.endedAt,
			createdAt: session.startedAt,
			setLogs: {
				createMany: {
					data: session.logs.map((log) => ({
						id: log.id,
						routineExerciseId: log.routineExerciseId,
						exerciseId: log.exerciseId,
						setNumber: log.setNumber,
						reps: log.reps,
						weight: log.weight,
						rpe: log.rpe,
						isCompleted: true,
						completedAt: log.completedAt,
					})),
				},
			},
		},
	})

	await prisma.$transaction(async (tx) => {
		await lockTrainingAccount(tx, userId)
		const snapshot = await ensureSessionSnapshot(tx, session.id, 'CAPTURED')
		const outcome = buildProgressionOutcome(
			snapshot.routineDay.exercises ?? [],
			session.logs.map((log) => ({
				routineExerciseId: log.routineExerciseId,
				setNumber: log.setNumber,
				reps: log.reps,
				weight: log.weight,
				isCompleted: true,
			})),
		)
		await writeProgressionEvents(
			tx,
			userId,
			session.id,
			session.endedAt,
			outcome.changes,
		)
	}, TX_OPTIONS)
}

/**
 * Builds a fresh analytics generation over **every** completed session of the
 * account, in end-time order, and activates it -- the backfill job's work,
 * scoped to one account and run in-process. The account's own sessions are
 * included so the projection stays true to the whole history; only derived
 * rows are written for them.
 */
export async function rebuildAnalytics(
	prisma: PrismaClient,
	userId: string,
	timeZone: string,
	projectionId: string,
): Promise<{ sessions: number; skipped: number }> {
	await prisma.$transaction(async (tx) => {
		await lockTrainingAccount(tx, userId)
		await tx.analyticsBackfillJob.updateMany({
			where: { projection: { userId, state: 'BUILDING' } },
			data: { state: 'CANCELLED' },
		})
		await tx.workoutAnalyticsProjection.updateMany({
			where: { userId, state: 'BUILDING' },
			data: { state: 'SUPERSEDED' },
		})
		await tx.workoutAnalyticsProjection.create({
			data: { id: projectionId, userId, timeZone },
		})
	}, TX_OPTIONS)

	let cursor: { endedAt: Date; id: string } | null = null
	let sessions = 0
	let skipped = 0

	for (;;) {
		const done: boolean = await prisma.$transaction(async (tx) => {
			await lockTrainingAccount(tx, userId)
			const batch = await tx.workoutSession.findMany({
				where: {
					userId,
					status: 'COMPLETED',
					endedAt: { not: null },
					...(cursor
						? {
								OR: [
									{ endedAt: { gt: cursor.endedAt } },
									{ endedAt: cursor.endedAt, id: { gt: cursor.id } },
								],
							}
						: {}),
				},
				orderBy: [{ endedAt: 'asc' }, { id: 'asc' }],
				take: REPLAY_BATCH,
				select: { id: true, endedAt: true },
			})

			let projection = await tx.workoutAnalyticsProjection.findUniqueOrThrow({
				where: { id: projectionId },
			})
			for (const session of batch) {
				try {
					projection = await applyContribution(
						tx,
						projection,
						await summarizeSession(tx, session.id),
					)
					sessions += 1
				} catch (error) {
					// The backfill cannot recover a session whose routine is gone and
					// was never snapshotted either; it throws before writing anything.
					if (
						error instanceof Error &&
						error.message.startsWith('Irrecoverable')
					) {
						skipped += 1
						continue
					}
					throw error
				}
			}

			const last = batch.at(-1)
			if (last) {
				cursor = { endedAt: last.endedAt!, id: last.id }
				return false
			}

			await tx.workoutAnalyticsProjection.updateMany({
				where: { userId, active: true },
				data: { active: false },
			})
			await tx.workoutAnalyticsProjection.update({
				where: { id: projectionId },
				data: { active: true, state: 'READY' },
			})
			await tx.user.update({
				where: { id: userId },
				data: { timeZone, analyticsProjectionId: projectionId },
			})
			return true
		}, TX_OPTIONS)

		if (done) return { sessions, skipped }
	}
}

export interface AnalyticsRemovalCounts {
	trainingEvents: number
	personalRecords: number
	notifications: number
	projections: number
}

/**
 * Removes the derived rows seeded sessions produced on an account the seed
 * does not own. Deleting the sessions cascades their snapshots, shares and
 * session notifications; events, records and achievement notifications carry
 * no foreign key to the session and have to go explicitly.
 */
export async function removeSeededAnalytics(
	prisma: PrismaClient,
	userId: string,
	sessionIds: string[],
	projectionId: string,
): Promise<AnalyticsRemovalCounts> {
	const events = sessionIds.length
		? await prisma.trainingEvent.findMany({
				where: { userId, sessionId: { in: sessionIds } },
				select: { id: true, type: true },
			})
		: []
	const achievementKeys = events
		.filter((event) => event.type === 'ACHIEVEMENT_UNLOCKED')
		.map((event) => `achievement:${event.id}`)

	const notifications = achievementKeys.length
		? await prisma.notification.deleteMany({
				where: { userId, sourceKey: { in: achievementKeys } },
			})
		: { count: 0 }
	const trainingEvents = events.length
		? await prisma.trainingEvent.deleteMany({
				where: { id: { in: events.map((event) => event.id) } },
			})
		: { count: 0 }
	const personalRecords = sessionIds.length
		? await prisma.personalRecord.deleteMany({
				where: { userId, sessionId: { in: sessionIds } },
			})
		: { count: 0 }

	await prisma.user.updateMany({
		where: { id: userId, analyticsProjectionId: projectionId },
		data: { analyticsProjectionId: null },
	})
	const projections = await prisma.workoutAnalyticsProjection.deleteMany({
		where: { id: projectionId, userId },
	})

	return {
		trainingEvents: trainingEvents.count,
		personalRecords: personalRecords.count,
		notifications: notifications.count,
		projections: projections.count,
	}
}
