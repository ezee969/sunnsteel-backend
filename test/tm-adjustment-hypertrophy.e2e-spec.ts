import { INestApplication, ValidationPipe } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import * as request from 'supertest'
import { AppModule } from '../src/app.module'
import { SupabaseJwtGuard } from '../src/auth/guards/supabase-jwt.guard'
import { RoutinesService } from '../src/routines/routines.service'

const mockUser = { id: 'user-tm', email: 'tm@mail.com' }
const allowSupabaseGuard: Partial<SupabaseJwtGuard> = {
	canActivate: (ctx) => {
		const req = ctx.switchToHttp().getRequest()
		req.user = mockUser as any
		return true as any
	},
}

describe('TM Adjustment (Hypertrophy RtF) (e2e)', () => {
	let app: INestApplication
	const routinesServiceMock = {
		createTmAdjustment: jest.fn(),
	} as unknown as jest.Mocked<RoutinesService>

	beforeAll(async () => {
		const moduleFixture: TestingModule = await Test.createTestingModule({
			imports: [AppModule],
		})
			.overrideGuard(SupabaseJwtGuard as any)
			.useValue(allowSupabaseGuard)
			.overrideProvider(RoutinesService)
			.useValue(routinesServiceMock)
			.compile()

		app = moduleFixture.createNestApplication()
		app.useGlobalPipes(new ValidationPipe({ transform: true }))
		app.setGlobalPrefix('api')
		await app.init()
	})

	afterAll(async () => {
		await app.close()
	})

	beforeEach(() => jest.clearAllMocks())

	it('POST /api/routines/:id/tm-events creates hypertrophy TM adjustment', async () => {
		;(routinesServiceMock.createTmAdjustment as any).mockResolvedValue({
			id: 'tm1',
			routineId: 'r-hyp',
			exerciseId: 'e-hyp',
			weekNumber: 4,
			preTmKg: 80,
			deltaKg: 2.5,
			postTmKg: 82.5,
			style: 'HYPERTROPHY',
		})

		const payload = {
			exerciseId: 'e-hyp',
			weekNumber: 4,
			preTmKg: 80,
			deltaKg: 2.5,
			postTmKg: 82.5,
		}

		const res = await request(app.getHttpServer())
			.post('/api/routines/r-hyp/tm-events')
			.send(payload)
			.expect(201)

		expect(routinesServiceMock.createTmAdjustment).toHaveBeenCalledWith(
			'user-tm',
			'r-hyp',
			payload,
		)
		expect(res.body).toEqual(expect.objectContaining({ style: 'HYPERTROPHY' }))
	})
})
