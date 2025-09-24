import { INestApplication } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import * as request from 'supertest'
import { AppModule } from '../src/app.module'

/** E2E test for metrics endpoint (RTF-B07) */

describe('Metrics endpoint e2e', () => {
  let app: INestApplication

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule]
    }).compile()

    app = moduleRef.createNestApplication()
    app.setGlobalPrefix('api')
    await app.init()
  })

  afterAll(async () => { await app.close() })

  it('GET /api/metrics returns Prometheus text format', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/metrics')
      .expect(200)

    expect(typeof res.text).toBe('string')
    expect(res.text).toContain('# HELP')
  expect(res.text).toContain('rtf_week_goals_hit_rate')
  expect(res.text).toContain('rtf_forecast_hit_rate')
  expect(res.text).toContain('rtf_tm_adjustments_total')
  })
})
