import { INestApplication, ValidationPipe } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import * as request from 'supertest'
import { AppModule } from '../src/app.module'
import { SupabaseJwtGuard } from '../src/auth/guards/supabase-jwt.guard'
import { WorkoutsService } from '../src/workouts/workouts.service'
import { DatabaseService } from '../src/database/database.service'
import { ProgressionScheme } from '@prisma/client'

// We mock DB layer minimally to simulate one routine containing two exercises (one per variant)

const mockUser = { id: 'user-goals', email: 'goals@mail.com' }

const allowGuard: Partial<SupabaseJwtGuard> = {
	canActivate: (ctx) => {
		const req = ctx.switchToHttp().getRequest()
		req.user = mockUser as any
		return true as any
	},
}

describe('RtF Variant Weekly Goals Endpoint (e2e mocked)', () => {
	let app: INestApplication
	const dbMock: Partial<DatabaseService> = {}

	beforeAll(async () => {
		// Build a controlled mock for getRtFWeekGoals query path
		;(dbMock as any).routine = {
			findFirst: jest.fn().mockImplementation(({ where }) => {
				if (where.id !== 'r1') return null
				return {
					id: 'r1',
					programWithDeloads: true,
					programDurationWeeks: 21,
					programStartDate: new Date('2025-09-15T12:00:00.000Z'), // Monday aligning with day ordering not needed here
					programTimezone: 'UTC',
					days: [
						{
							exercises: [
								{
									id: 'ex-std',
									progressionScheme: ProgressionScheme.PROGRAMMED_RTF,
									programTMKg: 100,
									programRoundingKg: 2.5,
									exercise: { id: 'lift-std', name: 'Standard Lift' },
								},
								{
									id: 'ex-hyp',
									progressionScheme: ProgressionScheme.PROGRAMMED_RTF_HYPERTROPHY,
									programTMKg: 80,
									programRoundingKg: 2.5,
									exercise: { id: 'lift-hyp', name: 'Hypertrophy Lift' },
								},
							],
						},
					],
				}
			}),
		}

		const moduleRef: TestingModule = await Test.createTestingModule({
			imports: [AppModule],
		})
			.overrideProvider(DatabaseService)
			.useValue(dbMock)
			.overrideGuard(SupabaseJwtGuard as any)
			.useValue(allowGuard)
			.compile()

		app = moduleRef.createNestApplication()
		app.useGlobalPipes(new ValidationPipe({ transform: true }))
		app.setGlobalPrefix('api')
		await app.init()
	})

	afterAll(async () => {
		await app.close()
	})

	it('returns distinct intensity & fixedReps for STANDARD vs HYPERTROPHY same week', async () => {
		const res = await request(app.getHttpServer())
			.get('/api/workouts/routines/r1/rtf-week-goals?week=3')
			.expect(200)

		// Expect two goals (one per variant)
		expect(res.body.goals).toHaveLength(2)
		const std = res.body.goals.find((g: any) => g.variant === 'STANDARD')
		const hyp = res.body.goals.find((g: any) => g.variant === 'HYPERTROPHY')
		expect(std).toBeDefined()
		expect(hyp).toBeDefined()
		// Week 3 STANDARD: intensity 0.8 fixedReps 3
		expect(std.intensity).toBeCloseTo(0.8)
		expect(std.fixedReps).toBe(3)
		// Week 3 HYPERTROPHY: intensity 0.75 fixedReps 8
		expect(hyp.intensity).toBeCloseTo(0.75)
		expect(hyp.fixedReps).toBe(8)
		// AMRAP set number differs
		expect(std.amrapSetNumber).toBe(5)
		expect(hyp.amrapSetNumber).toBe(4)
	})
})
