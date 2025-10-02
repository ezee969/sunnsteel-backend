import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { WorkoutsService } from '../src/workouts/workouts.service';
import { SupabaseJwtGuard } from '../src/auth/guards/supabase-jwt.guard';

// Minimal mocked forecast payload (shape matters, values illustrative)
const forecastMock = {
  routineId: 'r1',
  weeks: 3,
  version: 1,
  withDeloads: true,
  forecast: [
    {
      week: 1,
      isDeload: false,
      standard: {
        intensity: 0.7,
        fixedReps: 5,
        amrapTarget: 10,
        sets: 5,
        amrapSet: 5,
      },
      hypertrophy: {
        intensity: 0.7,
        fixedReps: 10,
        amrapTarget: 12,
        sets: 4,
        amrapSet: 4,
      },
    },
    {
      week: 2,
      isDeload: false,
      standard: {
        intensity: 0.75,
        fixedReps: 4,
        amrapTarget: 8,
        sets: 5,
        amrapSet: 5,
      },
      hypertrophy: {
        intensity: 0.725,
        fixedReps: 9,
        amrapTarget: 11,
        sets: 4,
        amrapSet: 4,
      },
    },
    {
      week: 3,
      isDeload: true,
      standard: { isDeload: true },
      hypertrophy: { isDeload: true },
    },
  ],
};

const workoutsServiceMock = {
  getRtFForecast: jest.fn().mockResolvedValue(forecastMock),
};

// Allow guard & attach fake user id
const allowSupabaseGuard: Partial<SupabaseJwtGuard> = {
  canActivate: (ctx: any) => {
    const req = ctx.switchToHttp().getRequest();
    req.user = { id: 'user-1', email: 'user@example.com' };
    return true as any;
  },
};

describe('RtF Forecast e2e (mocked) (RTF-B06/B09 integration)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(WorkoutsService)
      .useValue(workoutsServiceMock)
      .overrideGuard(SupabaseJwtGuard as any)
      .useValue(allowSupabaseGuard)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/workouts/routines/:id/rtf-forecast returns structured forecast', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/workouts/routines/r1/rtf-forecast')
      .expect(200);

    expect(res.body).toEqual(
      expect.objectContaining({
        routineId: 'r1',
        weeks: 3,
        forecast: expect.any(Array),
      }),
    );
    expect(workoutsServiceMock.getRtFForecast).toHaveBeenCalledWith(
      'user-1',
      'r1',
    );
    // Spot check first week structure
    expect(res.body.forecast[0]).toEqual(
      expect.objectContaining({
        week: 1,
        standard: expect.any(Object),
        hypertrophy: expect.any(Object),
      }),
    );
  });
});
