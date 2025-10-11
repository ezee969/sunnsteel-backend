import { Test, TestingModule } from '@nestjs/testing'
import { INestApplication, ValidationPipe } from '@nestjs/common'
import * as request from 'supertest'
import { AppModule } from '../src/app.module'
import { DatabaseService } from '../src/database/database.service'
import { SupabaseJwtGuard } from '../src/auth/guards/supabase-jwt.guard'

jest.setTimeout(60000)

describe('RtF Timeline/Forecast remaining=1 semantics (e2e)', () => {
	let app: INestApplication
	let prisma: DatabaseService
	let userId: string
	let benchId: string

	const mockUser = { id: 'rtf-rem-user', email: `rtf-rem-${Date.now()}@example.com` }

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

		const u = await prisma.user.create({ data: { email: mockUser.email, name: 'RtF Remaining User' } })
		userId = u.id
		mockUser.id = userId

		const ex = await prisma.exercise.create({
			data: {
				name: `Bench Press Remaining ${Date.now()}`,
				primaryMuscles: ['PECTORAL'],
				secondaryMuscles: ['TRICEPS'],
				equipment: 'barbell',
			},
		})
		benchId = ex.id
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

	it('should start timeline/forecast at programStartWeek when remaining=1', async () => {
		const today = new Date()
		const dow = today.getUTCDay() // 0..6 (Sun..Sat)
		const startDate = yyyyMmDdUtc(today)

		const createRes = await request(app.getHttpServer())
			.post('/api/routines')
			.send({
				name: 'Remaining Switch Routine',
				description: 'Test remaining param',
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
								exerciseId: benchId,
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

		// Timeline without remaining: expect fromWeek=1 and first week=1
		const tlAll = await request(app.getHttpServer())
			.get(`/api/workouts/routines/${routine.id}/rtf-timeline`)
			.expect(200)
		expect(tlAll.body.fromWeek ?? 1).toBe(1)
		expect(tlAll.body.timeline[0].week).toBe(1)

		// Timeline with remaining=1: expect fromWeek=8 and first week=8
		const tlRem = await request(app.getHttpServer())
			.get(`/api/workouts/routines/${routine.id}/rtf-timeline`)
			.query({ remaining: '1' })
			.expect(200)
		expect(tlRem.body.fromWeek).toBe(8)
		expect(tlRem.body.timeline[0].week).toBe(8)

		// Forecast without remaining: expect fromWeek=1 and first week=1
		const fcAll = await request(app.getHttpServer())
			.get(`/api/workouts/routines/${routine.id}/rtf-forecast`)
			.expect(200)
		expect(fcAll.body.fromWeek ?? 1).toBe(1)
		expect(fcAll.body.forecast[0].week).toBe(1)

		// Forecast with remaining=1: expect fromWeek=8 and first week=8
		const fcRem = await request(app.getHttpServer())
			.get(`/api/workouts/routines/${routine.id}/rtf-forecast`)
			.query({ remaining: '1' })
			.expect(200)
		expect(fcRem.body.fromWeek).toBe(8)
		expect(fcRem.body.forecast[0].week).toBe(8)
	})
})
