import { PrismaClient, WorkoutSessionStatus } from '@prisma/client'
import { computeStreaks } from '../src/workouts/workout-progress.service'

const prisma = new PrismaClient()
const EMAIL = 'eze.olivero96@gmail.com'
const TZ = 'Europe/Madrid'

async function main() {
	const user = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } })

	const sessions = await prisma.workoutSession.findMany({
		where: { userId: user.id, status: WorkoutSessionStatus.COMPLETED },
		orderBy: { startedAt: 'asc' },
		select: {
			id: true, startedAt: true, endedAt: true, durationSec: true, notes: true,
			routine: { select: { name: true } },
			setLogs: { select: { weight: true, reps: true, rpe: true } },
		},
	})

	console.log(`sessions: ${sessions.length}`)
	console.log(`first   : ${sessions[0].startedAt.toISOString()}`)
	console.log(`last    : ${sessions.at(-1)!.startedAt.toISOString()}`)

	const dur = sessions.map(s => s.durationSec! / 60)
	console.log(`duration min/max/avg: ${Math.min(...dur)} / ${Math.max(...dur)} / ${(dur.reduce((a,b)=>a+b,0)/dur.length).toFixed(1)}`)

	const hours = sessions.map(s => s.startedAt.getHours())
	console.log(`start hours: ${[...new Set(hours)].sort((a,b)=>a-b).join(',')}`)

	console.log(`notes on ${sessions.filter(s=>s.notes).length} sessions`)

	const rpes = sessions.flatMap(s => s.setLogs.map(l => l.rpe!))
	console.log(`rpe min/max: ${Math.min(...rpes)} / ${Math.max(...rpes)}`)

	// sessions per week
	const byWeek = new Map<string, number>()
	for (const s of sessions) {
		const d = new Date(s.startedAt); d.setDate(d.getDate() - ((d.getDay()+6)%7))
		const k = d.toISOString().slice(0,10)
		byWeek.set(k, (byWeek.get(k) ?? 0) + 1)
	}
	console.log('\nsessions per week:')
	for (const [k,v] of [...byWeek].sort()) console.log(`  ${k}  ${'#'.repeat(v)} ${v}`)

	// progression of top sets
	for (const name of ['Squat','Bench Press','Deadlift','Overhead Press','Incline Dumbbell Press']) {
		const ex = await prisma.exercise.findUnique({ where: { name } })
		if (!ex) continue
		const logs = await prisma.setLog.findMany({
			where: { exerciseId: ex.id, session: { userId: user.id } },
			orderBy: [{ session: { startedAt: 'asc' } }, { setNumber: 'asc' }],
			select: { weight: true, reps: true, setNumber: true, session: { select: { startedAt: true, routineId: true } } },
		})
		const perSession = new Map<string, {w:number,r:number}[]>()
		for (const l of logs) {
			const k = l.session.startedAt.toISOString().slice(0,10)
			if (!perSession.has(k)) perSession.set(k, [])
			perSession.get(k)!.push({ w: l.weight!, r: l.reps! })
		}
		console.log(`\n${name}:`)
		for (const [k, sets] of perSession) {
			console.log(`  ${k}  ${sets.map(s=>`${s.w}x${s.r}`).join('  ')}`)
		}
	}

	// streaks
	const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year:'numeric', month:'2-digit', day:'2-digit' })
	const dates = sessions.map(s => fmt.format(s.endedAt!))
	console.log('\nstreaks:', computeStreaks(dates, fmt.format(new Date())))

	// totals
	const vol = sessions.flatMap(s=>s.setLogs).reduce((a,l)=>a+(l.weight??0)*(l.reps??0),0)
	console.log('total volume kg:', Math.round(vol))

	const total = await prisma.workoutSession.count({ where: { userId: user.id } })
	console.log(`total sessions (all statuses): ${total}, completion rate: ${Math.round(sessions.length/total*100)}%`)

	// this week
	const start = new Date(); start.setDate(start.getDate() - ((start.getDay()+6)%7)); start.setHours(0,0,0,0)
	const end = new Date(start); end.setDate(end.getDate()+7)
	const week = sessions.filter(s => s.endedAt! >= start && s.endedAt! < end)
	console.log(`this week: ${week.length} workouts, active days: ${new Set(week.map(s=>fmt.format(s.endedAt!))).size}`)
}

main().finally(() => prisma.$disconnect())
