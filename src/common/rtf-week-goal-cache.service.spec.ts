import { RtfWeekGoalCacheService } from './rtf-week-goal-cache.service'

// Unit tests for simple in-memory RtF week goal cache (L1 helper)
describe('RtfWeekGoalCacheService', () => {
  const make = (ttlSec?: number) => {
    const cfg: any = { get: (k: string) => (k === 'RTF_WEEK_GOAL_TTL_SEC' ? ttlSec : undefined) }
    return new RtfWeekGoalCacheService(cfg)
  }

  it('stores and retrieves value before TTL expiry', () => {
    const cache = make(1) // 1 second TTL
    const key = cache.makeKey('r1', 3)
    cache.set(key, { a: 1 })
    expect(cache.get(key)).toEqual({ a: 1 })
  })

  it('returns null after TTL expiry and purges entry', () => {
    jest.useFakeTimers()
    const cache = make(1)
    const key = cache.makeKey('r1', 1)
    cache.set(key, 42)
    jest.advanceTimersByTime(1100)
    expect(cache.get(key)).toBeNull()
    jest.useRealTimers()
  })

  it('invalidateRoutine removes matching keys only', () => {
    const cache = make(60)
    const k1 = cache.makeKey('r1', 1)
    const k2 = cache.makeKey('r1', 2)
    const k3 = cache.makeKey('r2', 1)
    cache.set(k1, 1)
    cache.set(k2, 2)
    cache.set(k3, 3)
    cache.invalidateRoutine('r1')
    expect(cache.get(k1)).toBeNull()
    expect(cache.get(k2)).toBeNull()
    expect(cache.get(k3)).toBe(3)
  })

  it('makeKey formats correctly', () => {
    const cache = make(60)
    expect(cache.makeKey('abc', 5)).toBe('weekGoals:abc:5')
  })

  it('_stats exposes size and ttl', () => {
    const cache = make(60)
    const key = cache.makeKey('r1', 1)
    cache.set(key, 'x')
    const stats = (cache as any)._stats()
    expect(stats.size).toBe(1)
    expect(typeof stats.ttlMs).toBe('number')
  })
})
