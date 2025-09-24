import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { WorkoutsService } from '../src/workouts/workouts.service';
import { JwtAuthGuard } from '../src/auth/guards/passport-jwt.guard';
import { SupabaseJwtGuard } from '../src/auth/guards/supabase-jwt.guard';
import { FinishStatusDto } from '../src/workouts/dto/finish-workout.dto';

// Mock WorkoutsService behavior for e2e to avoid DB dependency
const workoutsServiceMock = {
  startSession: jest
    .fn()
    .mockResolvedValue({ id: 'sess1', status: 'IN_PROGRESS' }),
  finishSession: jest
    .fn()
    .mockResolvedValue({ id: 'sess1', status: 'COMPLETED', durationSec: 60 }),
  getActiveSession: jest
    .fn()
    .mockResolvedValue({ id: 'sess1', status: 'IN_PROGRESS' }),
  getSessionById: jest
    .fn()
    .mockResolvedValue({ id: 'sess1', status: 'IN_PROGRESS' }),
  listSessions: jest.fn().mockResolvedValue({
    items: [
      {
        id: 'sess1',
        status: 'COMPLETED',
        startedAt: new Date('2024-03-01T10:00:00Z').toISOString(),
        endedAt: new Date('2024-03-01T10:30:00Z').toISOString(),
        durationSec: 1800,
        totalVolume: 1000,
        totalSets: 12,
        notes: 'good',
        routine: { id: 'r1', name: 'Push', dayName: 'Day 1' },
      },
    ],
    nextCursor: undefined,
  }),
  upsertSetLog: jest.fn().mockResolvedValue({ id: 'log1', setNumber: 1 }),
};

// Allow all requests and attach a fake user
const allowJwtGuard: Partial<JwtAuthGuard> = {
  canActivate: (ctx) => {
    const req = ctx.switchToHttp().getRequest();
    req.user = { userId: 'user-1', email: 'user@example.com' };
    return true as any;
  },
};

describe('Workouts e2e (mocked service)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(WorkoutsService)
      .useValue(workoutsServiceMock)
      .overrideGuard(JwtAuthGuard as any)
      .useValue(allowJwtGuard)
      .overrideGuard(SupabaseJwtGuard as any)
      .useValue({ canActivate: (ctx: any) => { const req = ctx.switchToHttp().getRequest(); req.user = { id: 'user-1', email: 'user@example.com' }; return true as any } })
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  it('GET /api/workouts/sessions -> 200 (filters + pagination)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/workouts/sessions')
      .query({ status: 'COMPLETED', limit: 1, sort: 'finishedAt:desc' })
      .expect(200);

    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.items[0]).toEqual(
      expect.objectContaining({ id: 'sess1', status: 'COMPLETED' }),
    );
    expect(workoutsServiceMock.listSessions).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        status: 'COMPLETED',
        // Note: query params are strings; DTO may coerce in real app, but mock receives raw query
        limit: '1',
        sort: 'finishedAt:desc',
      }),
    );
  });
  afterAll(async () => {
    await app.close();
  });

  it('POST /api/workouts/sessions/start -> 201', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/workouts/sessions/start')
      .send({ routineId: 'r1', routineDayId: 'd1', notes: 'go' })
      .expect(201);

    expect(res.body).toEqual(expect.objectContaining({ id: 'sess1' }));
    expect(workoutsServiceMock.startSession).toHaveBeenCalledWith('user-1', {
      routineId: 'r1',
      routineDayId: 'd1',
      notes: 'go',
    });
  });

  it('PUT /api/workouts/sessions/:id/set-logs -> 200', async () => {
    const res = await request(app.getHttpServer())
      .put('/api/workouts/sessions/sess1/set-logs')
      .send({ routineExerciseId: 're1', exerciseId: 'e1', setNumber: 1 })
      .expect(200);

    expect(res.body).toEqual(expect.objectContaining({ id: 'log1' }));
    expect(workoutsServiceMock.upsertSetLog).toHaveBeenCalled();
  });

  it('GET /api/workouts/sessions/active -> 200', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/workouts/sessions/active')
      .expect(200);

    expect(res.body).toEqual(expect.objectContaining({ id: 'sess1' }));
    expect(workoutsServiceMock.getActiveSession).toHaveBeenCalledWith('user-1');
  });

  it('GET /api/workouts/sessions/:id -> 200', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/workouts/sessions/sess1')
      .expect(200);

    expect(res.body).toEqual(expect.objectContaining({ id: 'sess1' }));
    expect(workoutsServiceMock.getSessionById).toHaveBeenCalledWith(
      'user-1',
      'sess1',
    );
  });

  it('PATCH /api/workouts/sessions/:id/finish -> 200', async () => {
    const res = await request(app.getHttpServer())
      .patch('/api/workouts/sessions/sess1/finish')
      .send({ status: FinishStatusDto.COMPLETED, notes: 'ok' })
      .expect(200);

    expect(res.body).toEqual(
      expect.objectContaining({ id: 'sess1', status: 'COMPLETED' }),
    );
    expect(workoutsServiceMock.finishSession).toHaveBeenCalled();
  });
});
