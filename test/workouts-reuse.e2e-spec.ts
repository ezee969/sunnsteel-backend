import { INestApplication } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import * as request from 'supertest'
import { AppModule } from '../src/app.module'
import { WorkoutsService } from '../src/workouts/workouts.service'
import { SupabaseJwtGuard } from '../src/auth/guards/supabase-jwt.guard'

// Mock that simulates idempotent start behavior: first call creates, second returns same with reused:true
let callCount = 0
const workoutsServiceMock = {
	startSession: jest.fn().mockImplementation((_userId: string, _dto: any) => {
		callCount++
		if (callCount === 1) return Promise.resolve({ id: 'sess-reuse', status: 'IN_PROGRESS', reused: false })
		return Promise.resolve({ id: 'sess-reuse', status: 'IN_PROGRESS', reused: true })
	}),
	getActiveSession: jest.fn().mockResolvedValue({ id: 'sess-reuse', status: 'IN_PROGRESS' }),
}

const allowGuard: Partial<SupabaseJwtGuard> = {
	canActivate: (ctx: any) => { const req = ctx.switchToHttp().getRequest(); req.user = { id: 'user-2', email: 'u2@example.com' }; return true as any }
}

describe('Workouts start reuse e2e (mocked service)', () => {
	let app: INestApplication

	beforeAll(async () => {
		const moduleRef: TestingModule = await Test.createTestingModule({
			imports: [AppModule],
		})
			.overrideProvider(WorkoutsService)
			.useValue(workoutsServiceMock)
			.overrideGuard(SupabaseJwtGuard as any)
			.useValue(allowGuard)
			.compile()

		app = moduleRef.createNestApplication()
		app.setGlobalPrefix('api')
		await app.init()
	})

	afterAll(async () => { await app.close() })

	it('second start returns reused flag', async () => {
		const first = await request(app.getHttpServer())
			.post('/api/workouts/sessions/start')
			.send({ routineId: 'rA', routineDayId: 'dA' })
			.expect(201)
		expect(first.body).toEqual(expect.objectContaining({ id: 'sess-reuse', reused: false }))

		const second = await request(app.getHttpServer())
			.post('/api/workouts/sessions/start')
			.send({ routineId: 'rA', routineDayId: 'dA' })
			.expect(201)
		expect(second.body).toEqual(expect.objectContaining({ id: 'sess-reuse', reused: true }))
		expect(workoutsServiceMock.startSession).toHaveBeenCalledTimes(2)
	})
})
