import { Test, TestingModule } from '@nestjs/testing'
import { INestApplication, ValidationPipe } from '@nestjs/common'
import * as request from 'supertest'
import { AppModule } from '../src/app.module'
import { DatabaseService } from '../src/database/database.service'
import { SupabaseJwtGuard } from '../src/auth/guards/supabase-jwt.guard'
import { FinishStatusDto } from '../src/workouts/dto/finish-workout.dto'

jest.setTimeout(30000)

describe('TM Adjustments on Forwarded Weeks (e2e)', () => {
	let app: INestApplication
	let prisma: DatabaseService
	let userId: string
	let benchPressId: string

	const mockUser = { id: 'ffwd-tm-user', email: `ffwd-tm-${Date.now()}@example.com` }

	const allowSupabaseGuard = {
		canActivate: (ctx: any) => {
			const req = ctx.switchToHttp().getRequest()
			req.user = mockUser
			return true as any
		},
	}

	beforeAll(async () => {
		const moduleFixture: TestingModule = await Test.createTestingModule({
			imports: [AppModule],
		})
			.overrideGuard(SupabaseJwtGuard as any)
			.useValue(allowSupabaseGuard)
			.compile()

		app = moduleFixture.createNestApplication()
		app.useGlobalPipes(new ValidationPipe({ transform: true }))
		app.setGlobalPrefix('api')
		prisma = moduleFixture.get<DatabaseService>(DatabaseService)
		await app.init()

		// Create user
		const u = await prisma.user.create({ data: { email: mockUser.email, name: 'FFWD TM User' } })
		userId = u.id
		mockUser.id = userId

		// Create bench press exercise
		const ex = await prisma.exercise.create({
			data: {
				name: `Bench Press TM ${Date.now()}`,
				primaryMuscles: ['PECTORAL'],
				secondaryMuscles: ['TRICEPS'],
				equipment: 'barbell',
			},
		})
		benchPressId = ex.id
	}, 30000)

	afterAll(async () => {
		if (userId) {
			await prisma.user.delete({ where: { id: userId } })
		}
		await app.close()
	})

	function yyyyMmDdUtc(d: Date): string {
		const y = d.getUTCFullYear()
		const m = `${d.getUTCMonth() + 1}`.padStart(2, '0')
		const day = `${d.getUTCDate()}`.padStart(2, '0')
		return `${y}-${m}-${day}`
	}

	it('Deload week: no TM adjustment even if AMRAP reps are high', async () => {
		const today = new Date()
		const dow = today.getUTCDay()
		const startDate = yyyyMmDdUtc(today)

		// Create routine forwarded to week 7 (deload)
		const createRes = await request(app.getHttpServer())
			.post('/api/routines')
			.send({
				name: 'TM No Adjust Deload',
				description: 'Deload week test',
				isPeriodized: false,
				programWithDeloads: true,
				programStartWeek: 7,
				programStartDate: startDate,
				programTimezone: 'UTC',
				days: [
					{
						dayOfWeek: dow,
						order: 0,
						exercises: [
							{
								exerciseId: benchPressId,
								order: 0,
								restSeconds: 180,
								progressionScheme: 'PROGRAMMED_RTF',
								programStyle: 'STANDARD',
								programTMKg: 100,
								programRoundingKg: 2.5,
								minWeightIncrement: 2.5,
								sets: [
									{ setNumber: 1, repType: 'FIXED', reps: 5 },
									{ setNumber: 2, repType: 'FIXED', reps: 5 },
									{ setNumber: 3, repType: 'FIXED', reps: 5 },
									{ setNumber: 4, repType: 'FIXED', reps: 5 },
									{ setNumber: 5, repType: 'FIXED', reps: 5 },
								],
							},
						],
					},
				],
			})
			.expect(201)

		const routine = createRes.body
		const dayId = routine.days[0].id

		// Start session
		const startRes = await request(app.getHttpServer())
			.post('/api/workouts/sessions/start')
			.send({ routineId: routine.id, routineDayId: dayId })
			.expect(201)
		const sess = startRes.body
		const rtfPlan = (sess.rtfPlans || [])[0]
		const beforeEx = await prisma.routineExercise.findUnique({ where: { id: rtfPlan.routineExerciseId } })
		expect(beforeEx?.programTMKg).toBe(100)
		expect(beforeEx?.programLastAdjustedWeek ?? null).toBeNull()

		// Upsert AMRAP set (#5 for standard) with high reps
		await request(app.getHttpServer())
			.put(`/api/workouts/sessions/${sess.id}/set-logs`)
			.send({
				routineExerciseId: rtfPlan.routineExerciseId,
				exerciseId: rtfPlan.exerciseId,
				setNumber: 5,
				reps: 20,
				isCompleted: true,
			})
			.expect(200)

		// Finish session
		await request(app.getHttpServer())
			.patch(`/api/workouts/sessions/${sess.id}/finish`)
			.send({ status: FinishStatusDto.COMPLETED })
			.expect(200)

		const afterEx = await prisma.routineExercise.findUnique({ where: { id: rtfPlan.routineExerciseId } })
		expect(afterEx?.programTMKg).toBe(100)
		expect(afterEx?.programLastAdjustedWeek ?? null).toBeNull()
	})

	it('Non-deload week: AMRAP ≥ target triggers TM adjustment', async () => {
		const today = new Date()
		const dow = today.getUTCDay()
		const startDate = yyyyMmDdUtc(today)

		// Create routine forwarded to week 8 (non-deload)
		const createRes = await request(app.getHttpServer())
			.post('/api/routines')
			.send({
				name: 'TM Adjust Non-Deload',
				description: 'Non-deload week test',
				isPeriodized: false,
				programWithDeloads: true,
				programStartWeek: 8,
				programStartDate: startDate,
				programTimezone: 'UTC',
				days: [
					{
						dayOfWeek: dow,
						order: 0,
						exercises: [
							{
								exerciseId: benchPressId,
								order: 0,
								restSeconds: 180,
								progressionScheme: 'PROGRAMMED_RTF',
								programStyle: 'STANDARD',
								programTMKg: 100,
								programRoundingKg: 2.5,
								minWeightIncrement: 2.5,
								sets: [
									{ setNumber: 1, repType: 'FIXED', reps: 5 },
									{ setNumber: 2, repType: 'FIXED', reps: 5 },
									{ setNumber: 3, repType: 'FIXED', reps: 5 },
									{ setNumber: 4, repType: 'FIXED', reps: 5 },
									{ setNumber: 5, repType: 'FIXED', reps: 5 },
								],
							},
						],
					},
				],
			})
			.expect(201)

		const routine = createRes.body
		const dayId = routine.days[0].id

		const startRes = await request(app.getHttpServer())
			.post('/api/workouts/sessions/start')
			.send({ routineId: routine.id, routineDayId: dayId })
			.expect(201)
		const sess = startRes.body
		const rtfPlan = (sess.rtfPlans || [])[0]
		const beforeEx = await prisma.routineExercise.findUnique({ where: { id: rtfPlan.routineExerciseId } })
		expect(beforeEx?.programTMKg).toBe(100)
		expect(beforeEx?.programLastAdjustedWeek ?? null).toBeNull()

		// Upsert AMRAP set #5 with reps well above target (week 8 target=8)
		await request(app.getHttpServer())
			.put(`/api/workouts/sessions/${sess.id}/set-logs`)
			.send({
				routineExerciseId: rtfPlan.routineExerciseId,
				exerciseId: rtfPlan.exerciseId,
				setNumber: 5,
				reps: 14,
				isCompleted: true,
			})
			.expect(200)

		await request(app.getHttpServer())
			.patch(`/api/workouts/sessions/${sess.id}/finish`)
			.send({ status: FinishStatusDto.COMPLETED })
			.expect(200)

		const afterEx = await prisma.routineExercise.findUnique({ where: { id: rtfPlan.routineExerciseId } })
		expect(afterEx?.programTMKg).toBeGreaterThan(100)
		expect(afterEx?.programLastAdjustedWeek).toBe(8)
	})
})
