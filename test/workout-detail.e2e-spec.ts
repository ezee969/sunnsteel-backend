import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { SupabaseService } from '../src/auth/supabase.service';
import * as request from 'supertest';
import { AppModule } from './../src/app.module';
import { DatabaseService } from '../src/database/database.service';

// Shared token registry for SupabaseService mock
const tokenToUser: Record<string, { id: string; email: string }> = {};
let supabaseServiceMock: Partial<SupabaseService>;

describe('Workout Detail (e2e)', () => {
  let app: INestApplication;
  let prisma: DatabaseService;
  let accessToken: string;
  let otherAccessToken: string;
  let userId: string;
  let routineId: string;
  let routineDayId: string;
  let sessionId: string;
  let exerciseId: string;
  let routineExerciseId: string;
  let exerciseName: string;

  beforeAll(async () => {
    supabaseServiceMock = {
      verifyToken: jest.fn().mockImplementation((token: string) => {
        const mapped = tokenToUser[token];
        if (!mapped) throw new Error('invalid');
        return {
          id: mapped.id,
          email: mapped.email,
          user_metadata: { name: mapped.email.split('@')[0] },
        } as any;
      }),
      getOrCreateUser: jest.fn().mockImplementation((supabaseUser: any) => {
        return prisma.user.upsert({
          where: { email: supabaseUser.email },
          update: {},
          create: {
            email: supabaseUser.email,
            name: supabaseUser.user_metadata?.name || 'wd',
          },
        });
      }),
    };
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(SupabaseService)
      .useValue(supabaseServiceMock)
      .compile();

    app = moduleFixture.createNestApplication();
    prisma = moduleFixture.get<DatabaseService>(DatabaseService);

    // Add validation pipe to enable DTO validation
    const { ValidationPipe } = await import('@nestjs/common');
    app.useGlobalPipes(new ValidationPipe());

    // Add cookie parser middleware
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const cookieParser = require('cookie-parser');
    app.use(cookieParser());

    // Set global API prefix
    app.setGlobalPrefix('api');

    await app.init();

    // Create primary test user directly in DB and assign mocked token
    const primaryEmail = `workout-detail-${Date.now()}@example.com`;
    const createdUser = await prisma.user.create({
      data: {
        email: primaryEmail,
        name: 'Workout Detail Test User',
      },
    });
    userId = createdUser.id;
    accessToken = `token-${Date.now()}`;
    tokenToUser[accessToken] = { id: userId, email: primaryEmail };

    // Pre-create secondary user and assign mocked token
    const otherEmail = `other-${Date.now()}@example.com`;
    const otherUser = await prisma.user.create({
      data: {
        email: otherEmail,
        name: 'Other User',
      },
    });
    otherAccessToken = `token2-${Date.now()}`;
    tokenToUser[otherAccessToken] = {
      id: otherUser.id,
      email: otherEmail,
    };

    if (!accessToken || !userId) throw new Error('User/token creation failed');

    // Verify user still exists before creating dependent entities
    const userCheck = await prisma.user.findUnique({ where: { id: userId } });
    if (!userCheck) {
      throw new Error(
        `User ${userId} was deleted by another test before routine creation`,
      );
    }

    // Create test exercise with unique name
    exerciseName = `Bench Press ${Date.now()}`;
    const exercise = await prisma.exercise.create({
      data: {
        name: exerciseName,
        primaryMuscles: ['PECTORAL'],
        secondaryMuscles: ['TRICEPS'],
        equipment: 'BARBELL',
      },
    });
    exerciseId = exercise.id;

    // Create test routine with day and exercises
    const routine = await prisma.routine.create({
      data: {
        name: 'Push Day',
        description: 'Upper body push workout',
        userId,
        days: {
          create: {
            dayOfWeek: 1,
            exercises: {
              create: {
                exerciseId,
                order: 1,
                restSeconds: 180,
                sets: {
                  create: [
                    {
                      setNumber: 1,
                      repType: 'FIXED',
                      reps: 8,
                      weight: 80,
                    },
                    {
                      setNumber: 2,
                      repType: 'RANGE',
                      minReps: 6,
                      maxReps: 10,
                      weight: 85,
                    },
                  ],
                },
              },
            },
          },
        },
      },
      include: {
        days: {
          include: {
            exercises: true,
          },
        },
      },
    });

    routineId = routine.id;
    routineDayId = routine.days[0].id;
    routineExerciseId = routine.days[0].exercises[0].id;

    // Create test workout session
    const session = await prisma.workoutSession.create({
      data: {
        userId,
        routineId,
        routineDayId,
        status: 'COMPLETED',
        startedAt: new Date('2024-01-15T10:00:00Z'),
        endedAt: new Date('2024-01-15T11:30:00Z'),
        durationSec: 5400, // 90 minutes
        notes: 'Great workout today!',
      },
    });
    sessionId = session.id;

    // Create test set logs
    await prisma.setLog.createMany({
      data: [
        {
          sessionId,
          routineExerciseId,
          exerciseId,
          setNumber: 1,
          reps: 8,
          weight: 80,
          rpe: 8,
          isCompleted: true,
          completedAt: new Date('2024-01-15T10:15:00Z'),
        },
        {
          sessionId,
          routineExerciseId,
          exerciseId,
          setNumber: 2,
          reps: 9,
          weight: 85,
          rpe: 9,
          isCompleted: true,
          completedAt: new Date('2024-01-15T10:20:00Z'),
        },
      ],
    });
  }, 30000); // Increase timeout to 30 seconds

  afterAll(async () => {
    // Clean up test data
    await prisma.setLog.deleteMany({ where: { sessionId } });
    await prisma.workoutSession.deleteMany({ where: { userId } });
    await prisma.routineExerciseSet.deleteMany({});
    await prisma.routineExercise.deleteMany({});
    await prisma.routineDay.deleteMany({});
    await prisma.routine.deleteMany({ where: { userId } });
    await prisma.exercise.deleteMany({ where: { id: exerciseId } });
    await prisma.user.deleteMany({
      where: { id: userId },
    });

    await app.close();
  });

  describe('GET /api/workouts/sessions/:id', () => {
    it('should return detailed workout session with exercises and set logs', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/workouts/sessions/${sessionId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      const session = response.body;

      // Basic session properties
      expect(session.id).toBe(sessionId);
      expect(session.userId).toBe(userId);
      expect(session.routineId).toBe(routineId);
      expect(session.routineDayId).toBe(routineDayId);
      expect(session.status).toBe('COMPLETED');
      expect(session.startedAt).toBe('2024-01-15T10:00:00.000Z');
      expect(session.endedAt).toBe('2024-01-15T11:30:00.000Z');
      expect(session.durationSec).toBe(5400);
      expect(session.notes).toBe('Great workout today!');

      // Routine details
      expect(session.routine).toBeDefined();
      expect(session.routine.id).toBe(routineId);
      expect(session.routine.name).toBe('Push Day');
      expect(session.routine.description).toBe('Upper body push workout');

      // Routine day details
      expect(session.routineDay).toBeDefined();
      expect(session.routineDay.id).toBe(routineDayId);
      expect(session.routineDay.dayOfWeek).toBe(1);

      // Exercises
      expect(session.routineDay.exercises).toHaveLength(1);
      const exercise = session.routineDay.exercises[0];
      expect(exercise.id).toBe(routineExerciseId);
      expect(exercise.order).toBe(1);
      expect(exercise.restSeconds).toBe(180);

      // Exercise details
      expect(exercise.exercise.id).toBe(exerciseId);
      expect(exercise.exercise.name).toBe(exerciseName);
      expect(exercise.exercise.primaryMuscles).toEqual(['PECTORAL']);
      expect(exercise.exercise.equipment).toBe('BARBELL');

      // Planned sets
      expect(exercise.sets).toHaveLength(2);
      const fixedSet = exercise.sets.find((s) => s.setNumber === 1);
      const rangeSet = exercise.sets.find((s) => s.setNumber === 2);

      expect(fixedSet.repType).toBe('FIXED');
      expect(fixedSet.reps).toBe(8);
      expect(fixedSet.weight).toBe(80);
      expect(fixedSet.minReps).toBeNull();
      expect(fixedSet.maxReps).toBeNull();

      expect(rangeSet.repType).toBe('RANGE');
      expect(rangeSet.reps).toBeNull();
      expect(rangeSet.minReps).toBe(6);
      expect(rangeSet.maxReps).toBe(10);
      expect(rangeSet.weight).toBe(85);

      // Set logs
      expect(session.setLogs).toHaveLength(2);
      const setLog1 = session.setLogs.find((log) => log.setNumber === 1);
      const setLog2 = session.setLogs.find((log) => log.setNumber === 2);

      expect(setLog1.routineExerciseId).toBe(routineExerciseId);
      expect(setLog1.exerciseId).toBe(exerciseId);
      expect(setLog1.reps).toBe(8);
      expect(setLog1.weight).toBe(80);
      expect(setLog1.rpe).toBe(8);
      expect(setLog1.isCompleted).toBe(true);
      expect(setLog1.completedAt).toBe('2024-01-15T10:15:00.000Z');

      expect(setLog2.setNumber).toBe(2);
      expect(setLog2.reps).toBe(9);
      expect(setLog2.weight).toBe(85);
      expect(setLog2.rpe).toBe(9);
      expect(setLog2.isCompleted).toBe(true);
      expect(setLog2.completedAt).toBe('2024-01-15T10:20:00.000Z');

      // Set logs should include exercise details
      expect(setLog1.exercise.id).toBe(exerciseId);
      expect(setLog1.exercise.name).toBe(exerciseName);
      expect(setLog1.exercise.primaryMuscles).toEqual(['PECTORAL']);
      expect(setLog1.exercise.equipment).toBe('BARBELL');
    });

    it('should return 404 for non-existent session', async () => {
      const nonExistentId = '00000000-0000-0000-0000-000000000000';

      await request(app.getHttpServer())
        .get(`/api/workouts/sessions/${nonExistentId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(404);
    });

    it('should return 401 without authentication', async () => {
      await request(app.getHttpServer())
        .get(`/api/workouts/sessions/${sessionId}`)
        .expect(401);
    });

    it('should return 404 when accessing a session owned by another user', async () => {
      await request(app.getHttpServer())
        .get(`/api/workouts/sessions/${sessionId}`)
        .set('Authorization', `Bearer ${otherAccessToken}`)
        .expect(404);
    });

    it('should handle session without set logs', async () => {
      // Create session without set logs
      const emptySession = await prisma.workoutSession.create({
        data: {
          userId,
          routineId,
          routineDayId,
          status: 'IN_PROGRESS',
          startedAt: new Date(),
        },
      });

      const response = await request(app.getHttpServer())
        .get(`/api/workouts/sessions/${emptySession.id}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body.setLogs).toEqual([]);
      expect(response.body.status).toBe('IN_PROGRESS');
      expect(response.body.endedAt).toBeNull();
      expect(response.body.durationSec).toBeNull();

      // Clean up
      await prisma.workoutSession.delete({
        where: { id: emptySession.id },
      });
    });
  });
});
