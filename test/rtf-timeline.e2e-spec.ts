import { INestApplication, ValidationPipe } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import * as request from 'supertest'
import { AppModule } from '../src/app.module'
import { SupabaseJwtGuard } from '../src/auth/guards/supabase-jwt.guard'
import { DatabaseService } from '../src/database/database.service'
import { ProgressionScheme } from '@prisma/client'

// This test focuses on the timeline endpoint (RTF-B03) ensuring:
// 1. Aggregates all weeks up to programDurationWeeks.
// 2. Each week contains both variants' goals when exercises exist.
// 3. Cache hit/miss accounting works on second fetch.
// We mock DB to isolate logic and make week goal generation deterministic.

const mockUser = { id: 'user-timeline', email: 'tl@mail.com' }

const allowGuard: Partial<SupabaseJwtGuard> = {
  canActivate: (ctx) => {
    const req = ctx.switchToHttp().getRequest()
    req.user = mockUser as any
    return true as any
  },
}

describe('RtF Timeline Endpoint (e2e mocked)', () => {
  let app: INestApplication
  const dbMock: Partial<DatabaseService> = {}

  beforeAll(async () => {
    // Minimal routine meta for initial timeline call; subsequent per-week calls reuse same query shape
    ;(dbMock as any).routine = {
      findFirst: jest.fn().mockImplementation(({ where, select }) => {
        if (where.id !== 'r-timeline') return null
        // Distinguish select shape: timeline meta vs week goals (presence of days?)
        if (select && select.days) {
          return {
            id: 'r-timeline',
            programWithDeloads: true,
            programDurationWeeks: 5, // small subset to keep test quick
            programStartDate: new Date('2025-09-01T00:00:00.000Z'),
            programTimezone: 'UTC',
            days: [
              {
                exercises: [
                  {
                    id: 'ex-std',
                    progressionScheme: ProgressionScheme.PROGRAMMED_RTF,
                    programTMKg: 120,
                    programRoundingKg: 2.5,
                    exercise: { id: 'lift-std', name: 'Standard Lift' },
                  },
                  {
                    id: 'ex-hyp',
                    progressionScheme: ProgressionScheme.PROGRAMMED_RTF_HYPERTROPHY,
                    programTMKg: 90,
                    programRoundingKg: 2.5,
                    exercise: { id: 'lift-hyp', name: 'Hypertrophy Lift' },
                  },
                ],
              },
            ],
          }
        }
        return {
          id: 'r-timeline',
          programDurationWeeks: 5,
          programWithDeloads: true,
          programStartDate: new Date('2025-09-01T00:00:00.000Z'),
          programTimezone: 'UTC',
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

  it('returns timeline with expected weeks and both variants present in each week', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/workouts/routines/r-timeline/rtf-timeline')
      .expect(200)

    expect(res.body.weeks).toBe(5)
    expect(res.body.timeline).toHaveLength(5)
    // Each week entry should have two goals (STANDARD + HYPERTROPHY)
    for (const w of res.body.timeline) {
      const std = w.goals.find((g: any) => g.variant === 'STANDARD')
      const hyp = w.goals.find((g: any) => g.variant === 'HYPERTROPHY')
      expect(std).toBeDefined()
      expect(hyp).toBeDefined()
      // Week mapping spot check: week 1 intensities differ (0.7 both variants but fixedReps differ)
      if (w.week === 1) {
        expect(std.fixedReps).toBe(5) // standard week1 fixed reps
        expect(hyp.fixedReps).toBe(10) // hypertrophy week1 fixed reps
      }
    }
    // Initial call should have 0 cache hits (all MISS) for 5 weeks
    expect(res.body.cacheStats).toEqual({ hits: 0, misses: 5 })

    // Second call should leverage cache (all 5 weeks HIT now)
    const res2 = await request(app.getHttpServer())
      .get('/api/workouts/routines/r-timeline/rtf-timeline')
      .expect(200)
    expect(res2.body.cacheStats).toEqual({ hits: 5, misses: 0 })
  })
})
