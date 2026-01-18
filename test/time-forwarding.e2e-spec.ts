import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';
import { SupabaseJwtGuard } from '../src/auth/guards/supabase-jwt.guard';

jest.setTimeout(30000);

/**
 * E2E tests for time-based routine forwarding using programStartWeek.
 * - Verifies create with forward week sets programStartWeek and shortens window
 * - Verifies week-goals at a forwarded deload week
 * - Verifies start-session resolves currentWeek with offset and deload mapping
 */
describe('Time-based Routine Forwarding (e2e)', () => {
  let app: INestApplication;
  let prisma: DatabaseService;
  let userId: string;
  let benchPressId: string;
  let squatId: string;

  const mockUser = {
    id: 'ffwd-test-user',
    email: 'ffwd-test@example.com',
  };

  const allowSupabaseGuard = {
    canActivate: (ctx: any) => {
      const req = ctx.switchToHttp().getRequest();
      req.user = mockUser;
      return true as any;
    },
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideGuard(SupabaseJwtGuard as any)
      .useValue(allowSupabaseGuard)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    app.setGlobalPrefix('api');
    prisma = moduleFixture.get<DatabaseService>(DatabaseService);
    await app.init();

    // Create test user
    const testUser = await prisma.user.create({
      data: { email: mockUser.email, name: 'FFWD Test User' },
    });
    userId = testUser.id;
    mockUser.id = userId;

    // Create minimal exercises (unique names to avoid conflicts)
    const ts = Date.now();
    const bench = await prisma.exercise.create({
      data: {
        name: `Bench Press FFWD ${ts}`,
        primaryMuscles: ['PECTORAL'],
        secondaryMuscles: ['TRICEPS'],
        equipment: 'barbell',
      },
    });
    benchPressId = bench.id;
    const squat = await prisma.exercise.create({
      data: {
        name: `Squat FFWD ${ts}`,
        primaryMuscles: ['QUADRICEPS'],
        secondaryMuscles: ['GLUTES'],
        equipment: 'barbell',
      },
    });
    squatId = squat.id;
  }, 30000);

  afterAll(async () => {
    if (userId) {
      await prisma.user.delete({ where: { id: userId } });
    }
    await app.close();
  });

  function yyyyMmDdUtc(date: Date): string {
    const y = date.getUTCFullYear();
    const m = `${date.getUTCMonth() + 1}`.padStart(2, '0');
    const d = `${date.getUTCDate()}`.padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  it('should create an RtF routine forwarded to week 7 and expose deload goals at week 7', async () => {
    // Use today (UTC) as programStartDate so startSession sees currentWeek = offset+1
    const todayUtc = new Date();
    const todayDow = todayUtc.getUTCDay(); // 0..6
    const startDateStr = yyyyMmDdUtc(todayUtc);

    const routineData = {
      name: 'FFWD RtF Routine',
      description: 'Forwarded to week 7',
      isPeriodized: false,
      programWithDeloads: true,
      programStartWeek: 7,
      programStartDate: startDateStr,
      programTimezone: 'UTC',
      days: [
        {
          dayOfWeek: todayDow,
          order: 0,
          exercises: [
            {
              exerciseId: benchPressId,
              order: 0,
              restSeconds: 180,
              progressionScheme: 'PROGRAMMED_RTF',
              programStyle: 'STANDARD',
              programTMKg: 100,
              programRoundingKg: 2.5,
              minWeightIncrement: 2.5,
              sets: [
                { setNumber: 1, repType: 'FIXED', reps: 5, weight: 85 },
                { setNumber: 2, repType: 'FIXED', reps: 5, weight: 85 },
                { setNumber: 3, repType: 'FIXED', reps: 5, weight: 85 },
                { setNumber: 4, repType: 'FIXED', reps: 5, weight: 85 },
                { setNumber: 5, repType: 'FIXED', reps: 5, weight: 85 },
              ],
            },
            {
              exerciseId: squatId,
              order: 1,
              restSeconds: 150,
              progressionScheme: 'DYNAMIC_DOUBLE_PROGRESSION',
              sets: [
                { setNumber: 1, repType: 'FIXED', reps: 8, weight: 120 },
                { setNumber: 2, repType: 'FIXED', reps: 8, weight: 120 },
                { setNumber: 3, repType: 'FIXED', reps: 8, weight: 120 },
              ],
            },
          ],
        },
      ],
    };

    const createRes = await request(app.getHttpServer())
      .post('/api/routines')
      .send(routineData)
      .expect(201);

    const routine = createRes.body;
    expect(routine).toHaveProperty('id');
    expect(routine.programStartWeek).toBe(7);
    expect(routine.programWithDeloads).toBe(true);
    expect(Array.isArray(routine.days)).toBe(true);
    expect(routine.days[0].dayOfWeek).toBe(todayDow);

    // Verify week 7 (global) goals are deload
    const goalsRes = await request(app.getHttpServer())
      .get(`/api/workouts/routines/${routine.id}/rtf-week-goals`)
      .query({ week: '7' })
      .expect(200);
    const goalsBody = goalsRes.body;
    expect(goalsBody.week).toBe(7);
    // Find our PROGRAMMED_RTF exercise in goals (by exerciseId)
    const anyDeload = (goalsBody.goals || []).some(
      (g: any) => g.isDeload === true,
    );
    expect(anyDeload).toBe(true);

    // Start a session on the correct weekday; should map currentWeek to 7 (offset + 1)
    const dayId: string = routine.days[0].id;
    const startRes = await request(app.getHttpServer())
      .post('/api/workouts/sessions/start')
      .send({ routineId: routine.id, routineDayId: dayId })
      .expect(201);
    const sess = startRes.body;
    expect(sess.reused).toBe(false);
    expect(sess.program.currentWeek).toBe(7);
    expect(sess.program.isDeloadWeek).toBe(true);
  });

  it('should update programStartWeek and recalculate end date window', async () => {
    const todayUtc = new Date();
    const todayDow = todayUtc.getUTCDay();
    const startDateStr = yyyyMmDdUtc(todayUtc);

    // Create routine forwarded to week 8
    const routineData = {
      name: 'FFWD RtF Routine 2',
      description: 'Forwarded to week 8',
      isPeriodized: false,
      programWithDeloads: true,
      programStartWeek: 8,
      programStartDate: startDateStr,
      programTimezone: 'UTC',
      days: [
        {
          dayOfWeek: todayDow,
          order: 0,
          exercises: [
            {
              exerciseId: benchPressId,
              order: 0,
              restSeconds: 180,
              progressionScheme: 'PROGRAMMED_RTF',
              programStyle: 'STANDARD',
              programTMKg: 100,
              programRoundingKg: 2.5,
              minWeightIncrement: 2.5,
              sets: [{ setNumber: 1, repType: 'FIXED', reps: 5, weight: 85 }],
            },
          ],
        },
      ],
    };

    const createRes = await request(app.getHttpServer())
      .post('/api/routines')
      .send(routineData)
      .expect(201);
    const routine = createRes.body;
    expect(routine.programStartWeek).toBe(8);

    // Update: move forward to week 10, keep base inputs unchanged
    const updateRes = await request(app.getHttpServer())
      .patch(`/api/routines/${routine.id}`)
      .send({
        programWithDeloads: true,
        programStartDate: startDateStr,
        programTimezone: 'UTC',
        programStartWeek: 10,
        days: routine.days.map((d: any) => ({
          dayOfWeek: d.dayOfWeek,
          order: d.order,
          exercises: d.exercises.map((e: any) => ({
            exerciseId: e.exercise.id,
            order: e.order,
            restSeconds: e.restSeconds,
            progressionScheme: e.progressionScheme,
            programStyle: e.programStyle ?? 'STANDARD',
            programTMKg: e.programTMKg ?? 100,
            programRoundingKg: e.programRoundingKg ?? 2.5,
            minWeightIncrement: e.minWeightIncrement ?? 2.5,
            sets: e.sets,
          })),
        })),
      })
      .expect(200);
    const updated = updateRes.body;
    expect(updated.programStartWeek).toBe(10);
  });
});
