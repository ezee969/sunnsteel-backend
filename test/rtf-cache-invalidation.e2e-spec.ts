import { INestApplication, ValidationPipe } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import * as request from 'supertest'
import { AppModule } from '../src/app.module'
import { SupabaseJwtGuard } from '../src/auth/guards/supabase-jwt.guard'
import { DatabaseService } from '../src/database/database.service'
import { ProgressionScheme } from '@prisma/client'

// Verifies:
// 1. version field present on week goals payload
// 2. cache HIT after second call same week
// 3. TM adjustment invalidates cache (returns MISS again)

const mockUser = { id: 'user-cache', email: 'cache@test.local' }

const allowGuard: Partial<SupabaseJwtGuard> = {
  canActivate: (ctx) => {
    const req = ctx.switchToHttp().getRequest()
    req.user = mockUser as any
    return true as any
  }
}

describe('RtF Cache Invalidation & Version (e2e mocked)', () => {
  let app: INestApplication
  const dbMock: Partial<DatabaseService> = {}
  const routineId = 'r-cache'
  const exerciseId = 'ex-rtf'

  beforeAll(async () => {
    ;(dbMock as any).routine = {
      findFirst: jest.fn().mockImplementation(({ where, select }) => {
        if (where.id !== routineId) return null
        return {
          id: routineId,
          programWithDeloads: true,
          programDurationWeeks: 10,
          programStartDate: new Date('2025-09-01T00:00:00.000Z'),
          programTimezone: 'UTC',
          days: [
            {
              exercises: [
                {
                  id: exerciseId,
                  progressionScheme: ProgressionScheme.PROGRAMMED_RTF,
                  programTMKg: 100,
                  programRoundingKg: 2.5,
                  exercise: { id: 'lift', name: 'Lift' },
                }
              ]
            }
          ]
        }
      })
    }
    ;(dbMock as any).tmAdjustment = {
      create: jest.fn().mockImplementation(({ data }) => ({
        id: 'tm1',
        routineId,
        exerciseId: data.exerciseId,
        weekNumber: data.weekNumber,
        deltaKg: data.deltaKg,
        preTmKg: data.preTmKg,
        postTmKg: data.postTmKg,
        reason: data.reason,
        style: 'STANDARD',
        createdAt: new Date()
      })),
      findMany: jest.fn().mockResolvedValue([])
    }

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule]
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

  it('returns version and reflects cache invalidation after TM adjustment', async () => {
    // First call -> MISS
    const first = await request(app.getHttpServer())
      .get(`/api/workouts/routines/${routineId}/rtf-week-goals?week=2`)
      .expect(200)
    expect(first.body._cache).toBe('MISS')
    expect(first.body.version).toBe(1)

    // Second call -> HIT
    const second = await request(app.getHttpServer())
      .get(`/api/workouts/routines/${routineId}/rtf-week-goals?week=2`)
      .expect(200)
    expect(second.body._cache).toBe('HIT')
    expect(second.body.version).toBe(1)

    // Create TM adjustment -> triggers invalidation
    const adj = await request(app.getHttpServer())
      .post(`/api/routines/${routineId}/tm-events`)
      .send({
        exerciseId,
        weekNumber: 2,
        deltaKg: 2.5,
        preTmKg: 100,
        postTmKg: 102.5,
        reason: 'Progress',
        style: 'STANDARD'
      })
      .expect(201)
    expect(adj.body.exerciseId).toBe(exerciseId)

    // Third call after adjustment -> should be MISS again
    const third = await request(app.getHttpServer())
      .get(`/api/workouts/routines/${routineId}/rtf-week-goals?week=2`)
      .expect(200)
    expect(third.body._cache).toBe('MISS')
    expect(third.body.version).toBe(1)
  })
})