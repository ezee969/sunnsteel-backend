import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { SupabaseJwtGuard } from '../src/auth/guards/supabase-jwt.guard';
import { RoutinesService } from '../src/routines/routines.service';

// We mock only the routines service for focused tests
const mockUser = { id: 'user-mix', email: 'mix@mail.com' };
const allowSupabaseGuard: Partial<SupabaseJwtGuard> = {
  canActivate: (ctx) => {
    const req = ctx.switchToHttp().getRequest();
    req.user = mockUser as any;
    return true as any;
  },
};

describe('RtF Variant Routine Creation (e2e)', () => {
  let app: INestApplication;
  const routinesServiceMock = {
    create: jest.fn(),
  } as unknown as jest.Mocked<RoutinesService>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideGuard(SupabaseJwtGuard as any)
      .useValue(allowSupabaseGuard)
      .overrideProvider(RoutinesService)
      .useValue(routinesServiceMock)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('POST /api/routines creates routine mixing PROGRAMMED_RTF STANDARD and HYPERTROPHY', async () => {
    // Mock service return (simplified echo shape)
    (routinesServiceMock.create as any).mockImplementation((_userId, dto) => ({
      id: 'r-mix',
      name: dto.name,
      days: dto.days.map((d: any) => ({
        dayOfWeek: d.dayOfWeek,
        exercises: d.exercises.map((e: any) => ({
          exercise: { id: e.exerciseId, name: 'Mock Exercise' },
          progressionScheme: e.progressionScheme,
          programTMKg: e.programTMKg,
          programRoundingKg: e.programRoundingKg,
          sets: e.sets,
        })),
      })),
    }));

    const payload = {
      name: 'Mixed RtF Routine',
      isPeriodized: false,
      programWithDeloads: true,
      programStartDate: '2025-10-01',
      programTimezone: 'UTC',
      days: [
        {
          dayOfWeek: 1,
          order: 0,
          exercises: [
            {
              exerciseId: 'e-standard',
              progressionScheme: 'PROGRAMMED_RTF',
              programStyle: 'STANDARD',
              programTMKg: 100,
              programRoundingKg: 2.5,
              sets: [
                { setNumber: 1, repType: 'FIXED', reps: 5 },
                { setNumber: 2, repType: 'FIXED', reps: 5 },
                { setNumber: 3, repType: 'FIXED', reps: 5 },
                { setNumber: 4, repType: 'FIXED', reps: 5 },
                { setNumber: 5, repType: 'FIXED', reps: 1 },
              ],
              restSeconds: 120,
            },
            {
              exerciseId: 'e-hyp',
              progressionScheme: 'PROGRAMMED_RTF',
              programStyle: 'HYPERTROPHY',
              programTMKg: 80,
              programRoundingKg: 2.5,
              sets: [
                { setNumber: 1, repType: 'FIXED', reps: 8 },
                { setNumber: 2, repType: 'FIXED', reps: 8 },
                { setNumber: 3, repType: 'FIXED', reps: 8 },
                { setNumber: 4, repType: 'FIXED', reps: 1 },
              ],
              restSeconds: 90,
            },
          ],
        },
      ],
    };

    const res = await request(app.getHttpServer())
      .post('/api/routines')
      .send(payload)
      .expect(201);

    expect(routinesServiceMock.create).toHaveBeenCalled();
    const returned = res.body.days[0].exercises.map(
      (e: any) => e.progressionScheme,
    );
    expect(returned).toEqual(['PROGRAMMED_RTF', 'PROGRAMMED_RTF']);
  });
});
