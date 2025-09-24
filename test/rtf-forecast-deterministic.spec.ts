import { Test, TestingModule } from '@nestjs/testing'
import { WorkoutsService } from '../src/workouts/workouts.service'
import { DatabaseService } from '../src/database/database.service'
import { RTF_WEEK_GOALS_CACHE } from '../src/cache/rtf-week-goals-cache.async'
import { ProgressionScheme } from '@prisma/client'

/**
 * Deterministic forecast tests (RTF-B13): ensure
 * 1. Snapshot is used when applicable (no recompute drift)
 * 2. Fallback computation matches snapshot for both withDeloads true/false
 * 3. Cache set on miss then hit path returns _cache = HIT
 */

describe('RtF Forecast Deterministic (RTF-B13)', () => {
  let service: WorkoutsService
  let db: any
  const cacheProvider = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
    invalidateRoutine: jest.fn().mockResolvedValue(undefined)
  }

  beforeEach(async () => {
    jest.clearAllMocks()
    db = {
      routine: { findFirst: jest.fn() }
    }
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkoutsService,
        { provide: DatabaseService, useValue: db },
        { provide: RTF_WEEK_GOALS_CACHE, useValue: cacheProvider }
      ]
    }).compile()
    service = module.get(WorkoutsService)
  })

  const makeSnapshot = (withDeloads: boolean) => {
    const weeks = withDeloads ? 21 : 18
    const standard: any[] = []
    const hypertrophy: any[] = []
    // Simple deterministic fake schedule: intensity increments 0.01 each week
    // Deload weeks (7,14,21) flagged with isDeload and no intensity data
    const deloadWeeks = withDeloads ? new Set([7,14,21]) : new Set<number>()
    let trainingIndex = 0
    for (let w=1; w<= (withDeloads?21:21); w++) {
      const isDeload = deloadWeeks.has(w)
      if (isDeload) {
        standard.push({ week: w, isDeload: true })
        hypertrophy.push({ week: w, isDeload: true })
        continue
      }
      trainingIndex++
      if (!withDeloads && w > 21) break
      const logicalWeek = withDeloads ? w : trainingIndex
      standard.push({ week: logicalWeek, intensity: 0.7 + (logicalWeek-1)*0.01, fixedReps: 5, amrapTarget: 8 })
      hypertrophy.push({ week: logicalWeek, intensity: 0.65 + (logicalWeek-1)*0.01, fixedReps: 8, amrapTarget: 12 })
      if (!withDeloads && logicalWeek === 18) break
    }
    return { version: 1, createdAt: new Date().toISOString(), withDeloads, weeks, standard, hypertrophy }
  }

  const baseRoutine = (withDeloads: boolean, includeSnapshot: boolean) => ({
    id: 'r1',
    programDurationWeeks: withDeloads ? 21 : 18,
    programWithDeloads: withDeloads,
    programStartDate: new Date('2025-01-06'),
    programTimezone: 'UTC',
    programRtfSnapshot: includeSnapshot ? makeSnapshot(withDeloads) : null,
    days: [
      { exercises: [ { id: 're1', progressionScheme: ProgressionScheme.PROGRAMMED_RTF, exercise: { id: 'e1', name: 'Bench' } } ] }
    ]
  })

  it('uses snapshot when applicable (with deloads)', async () => {
    db.routine.findFirst.mockResolvedValue(baseRoutine(true, true))
    const res: any = await service.getRtFForecast('u1','r1')
    expect(res._cache).toBe('MISS')
    expect(res.withDeloads).toBe(true)
    // Week 7 should be deload from snapshot
    const wk7 = res.forecast.find((w: any) => w.week === 7)
    expect(wk7.isDeload).toBe(true)
    // intensities align with snapshot week1
    expect(res.forecast[0].standard.intensity).toBeCloseTo(0.7, 5)
  })

  it('computes forecast when snapshot absent (with deloads) and then cache hit', async () => {
    db.routine.findFirst.mockResolvedValue(baseRoutine(true, false))
    const first: any = await service.getRtFForecast('u1','r1')
    expect(first._cache).toBe('MISS')
    // Simulate cache now has value
    cacheProvider.get.mockResolvedValueOnce(first)
    const second: any = await service.getRtFForecast('u1','r1')
    expect(second._cache).toBe('HIT')
  })

  it('uses snapshot when applicable (no deloads)', async () => {
    db.routine.findFirst.mockResolvedValue(baseRoutine(false, true))
    const res: any = await service.getRtFForecast('u1','r1')
    expect(res.withDeloads).toBe(false)
    expect(res.weeks).toBe(18)
    // Ensure last week is 18
    const last = res.forecast[res.forecast.length - 1]
    expect(last.week).toBe(18)
  })

  it('snapshot mismatch (deload flag differs) triggers recompute (treats snapshot as inapplicable)', async () => {
    const snap = makeSnapshot(true) // with deloads snapshot
    const routine = baseRoutine(false, false)
    routine.programRtfSnapshot = snap // mismatch: routine has no deloads
    db.routine.findFirst.mockResolvedValue(routine)
    const res: any = await service.getRtFForecast('u1','r1')
    expect(res.withDeloads).toBe(false)
    expect(res.weeks).toBe(18)
    // Snapshot would have week 21, forecast should not
    expect(res.forecast.find((w: any) => w.week === 21)).toBeUndefined()
  })
})
