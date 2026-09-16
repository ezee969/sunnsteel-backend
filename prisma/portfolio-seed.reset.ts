import { PrismaClient } from '@prisma/client'

import { removeSeededAnalytics } from './portfolio-seed.analytics'
import {
	ROUTINE_IDS,
	SEED_EMAIL_DOMAIN,
	projectionIdFor,
} from './portfolio-seed.constants'

export interface ResetCounts {
	setLogs: number
	workoutSessions: number
	routines: number
	trainingEvents: number
	personalRecords: number
	notifications: number
	projections: number
	follows: number
	users: number
}

/**
 * Removes everything a previous seed run created, and nothing else.
 *
 * Two independent signals identify seeded rows, and a row only has to match one
 * of them: the deterministic routine and projection ids, and the unroutable
 * peer email domain. The real user account is never deleted -- only the
 * routines hanging off it and the analytics rows its seeded sessions derived.
 *
 * Deletion order is load-bearing. `SetLog.routineExercise` is a required
 * relation with no `onDelete` rule, so Postgres restricts it: dropping a
 * routine while its set logs still exist raises a foreign-key error. Logs go
 * first, then sessions, then the routine cascades the rest of its tree. Peer
 * accounts cascade their own events, records, projections and profile rows.
 *
 * This leaves the owner without an active analytics generation when the seed
 * had provided it; callers decide whether to rebuild one.
 */
export async function resetPortfolioSeed(
	prisma: PrismaClient,
	ownerId: string | null,
): Promise<ResetCounts> {
	const peers = await prisma.user.findMany({
		where: { email: { endsWith: `@${SEED_EMAIL_DOMAIN}` } },
		select: { id: true },
	})
	const peerIds = peers.map((peer) => peer.id)

	const peerRoutines = peerIds.length
		? await prisma.routine.findMany({
				where: { userId: { in: peerIds } },
				select: { id: true },
			})
		: []

	const routineIds = [
		...new Set([
			ROUTINE_IDS.active,
			ROUTINE_IDS.legacy,
			...peerRoutines.map((routine) => routine.id),
		]),
	]

	const analytics = ownerId
		? await removeSeededAnalytics(
				prisma,
				ownerId,
				(
					await prisma.workoutSession.findMany({
						where: {
							userId: ownerId,
							routineId: { in: [ROUTINE_IDS.active, ROUTINE_IDS.legacy] },
						},
						select: { id: true },
					})
				).map((session) => session.id),
				projectionIdFor(ownerId),
			)
		: {
				trainingEvents: 0,
				personalRecords: 0,
				notifications: 0,
				projections: 0,
			}

	const setLogs = await prisma.setLog.deleteMany({
		where: { session: { routineId: { in: routineIds } } },
	})
	const workoutSessions = await prisma.workoutSession.deleteMany({
		where: { routineId: { in: routineIds } },
	})
	const routines = await prisma.routine.deleteMany({
		where: { id: { in: routineIds } },
	})

	const follows = peerIds.length
		? await prisma.userFollow.deleteMany({
				where: {
					OR: [
						{ followerId: { in: peerIds } },
						{ followingId: { in: peerIds } },
					],
				},
			})
		: { count: 0 }

	const users = peerIds.length
		? await prisma.user.deleteMany({ where: { id: { in: peerIds } } })
		: { count: 0 }

	return {
		setLogs: setLogs.count,
		workoutSessions: workoutSessions.count,
		routines: routines.count,
		...analytics,
		follows: follows.count,
		users: users.count,
	}
}
