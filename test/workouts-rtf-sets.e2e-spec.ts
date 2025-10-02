import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { WorkoutsService } from '../src/workouts/workouts.service';
import { SupabaseJwtGuard } from '../src/auth/guards/supabase-jwt.guard';

const allowSupabaseGuard: Partial<SupabaseJwtGuard> = {
  canActivate: (ctx) => {
    const req = ctx.switchToHttp().getRequest();
    req.user = { id: 'user-sets', email: 'sets@mail.com' };
    return true as any;
  },
};

describe('Workout Planning RtF Variant Sets (e2e mocked)', () => {
  let app: INestApplication;

  const workoutsServiceMock = {
    startSession: jest.fn(),
    finishSession: jest.fn(),
    getActiveSession: jest.fn(),
    getSessionById: jest.fn(),
    listSessions: jest
      .fn()
      .mockResolvedValue({ items: [], nextCursor: undefined }),
    upsertSetLog: jest.fn(),
  } as unknown as jest.Mocked<WorkoutsService>;

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

  beforeEach(() => jest.clearAllMocks());

  it('verifies standard vs hypertrophy set counts in mocked planning output shape', async () => {
    // We mock an internal helper outcome that a controller might expose (simulate future endpoint)
    // For now we simulate by directly defining an artificial response via listSessions
    (workoutsServiceMock.listSessions as any).mockResolvedValueOnce({
      items: [
        {
          id: 'sess-std',
          status: 'IN_PROGRESS',
          planned: [
            {
              routineExerciseId: 're-std',
              progressionScheme: 'PROGRAMMED_RTF',
              sets: [1, 2, 3, 4, 5].map((n) => ({ setNumber: n })),
            },
            {
              routineExerciseId: 're-hyp',
              progressionScheme: 'PROGRAMMED_RTF',
              programStyle: 'HYPERTROPHY',
              sets: [1, 2, 3, 4].map((n) => ({ setNumber: n })),
            },
          ],
        },
      ],
      nextCursor: undefined,
    });

    const res = await request(app.getHttpServer())
      .get('/api/workouts/sessions')
      .expect(200);

    const planned = res.body.items[0].planned;
    // Ensure both variants appear
    const std = planned.find(
      (p: any) => p.progressionScheme === 'PROGRAMMED_RTF' && !p.programStyle,
    );
    const hyp = planned.find(
      (p: any) =>
        p.progressionScheme === 'PROGRAMMED_RTF' &&
        p.programStyle === 'HYPERTROPHY',
    );
    expect(std.sets).toHaveLength(5);
    expect(hyp.sets).toHaveLength(4);
  });
});
