import { PrismaClient } from '@prisma/client'

import { ROUTINE_IDS, SEED_EMAIL_DOMAIN } from './portfolio-seed.constants'

export interface ResetCounts {
	setLogs: number
	workoutSessions: number
	routines: number
	follows: number
	users: number
}

/**
 * Removes everything a previous seed run created, and nothing else.
 *
 * Two independent signals identify seeded rows, and a row only has to match one
 * of them: the deterministic routine ids, and the unroutable peer email domain.
 * The real user account is never touched -- only the routines hanging off it.
 *
 * Deletion order is load-bearing. `SetLog.routineExercise` is a required
 * relation with no `onDelete` rule, so Postgres restricts it: dropping a
 * routine while its set logs still exist raises a foreign-key error. Logs go
 * first, then sessions, then the routine cascades the rest of its tree.
 */
export async function resetPortfolioSeed(
	prisma: PrismaClient,
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
		follows: follows.count,
		users: users.count,
	}
}
