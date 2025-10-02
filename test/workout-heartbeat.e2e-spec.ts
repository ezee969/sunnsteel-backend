import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from './../src/app.module';
import { DatabaseService } from '../src/database/database.service';
import { WorkoutSessionStatus } from '@prisma/client';
import { JwtAuthGuard } from '../src/auth/guards/passport-jwt.guard';
import { SupabaseJwtGuard } from '../src/auth/guards/supabase-jwt.guard';

const mockUser = { id: 'test-user-heartbeat', email: 'heartbeat@test.com' };
const allowAuthGuards = {
  canActivate: (ctx: any) => {
    const req = ctx.switchToHttp().getRequest();
    req.user = mockUser;
    return true;
  },
};

describe('Workout Session Heartbeat (e2e)', () => {
  let app: INestApplication;
  let db: DatabaseService;
  let testUserId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideGuard(JwtAuthGuard as any)
      .useValue(allowAuthGuards)
      .overrideGuard(SupabaseJwtGuard as any)
      .useValue(allowAuthGuards)
      .compile();

    app = moduleFixture.createNestApplication();
    db = moduleFixture.get<DatabaseService>(DatabaseService);
    await app.init();

    // Use mock user ID for consistency
    testUserId = mockUser.id;

    // Create test user in database
    await db.user.upsert({
      where: { id: testUserId },
      update: {},
      create: {
        id: testUserId,
        email: mockUser.email,
        name: 'Heartbeat Test User',
        password: 'hashedpassword',
      },
    });
  }, 30000);

  afterAll(async () => {
    // Clean up in proper order to handle foreign key constraints
    if (testUserId) {
      await db.workoutSession.deleteMany({ where: { userId: testUserId } });
      await db.routine.deleteMany({ where: { userId: testUserId } });
      await db.user.delete({ where: { id: testUserId } });
    }
    await app.close();
  }, 30000);

  describe('Activity heartbeat tracking', () => {
    it('should update lastActivityAt when starting a session', async () => {
      // Create a simple routine for testing
      const routine = await db.routine.create({
        data: {
          userId: testUserId,
          name: 'Heartbeat Test Routine',
          description: 'For testing lastActivityAt updates',
        },
      });

      const routineDay = await db.routineDay.create({
        data: {
          routineId: routine.id,
          dayOfWeek: new Date().getDay(),
        },
      });

      const beforeStart = new Date();

      // Start workout session
      const response = await request(app.getHttpServer())
        .post('/workouts/sessions/start')
        .send({
          routineId: routine.id,
          routineDayId: routineDay.id,
        });

      expect(response.status).toBe(201);
      expect(response.body.id).toBeDefined();

      const sessionId = response.body.id;

      // Check that lastActivityAt was updated during session start
      const session = await db.workoutSession.findUnique({
        where: { id: sessionId },
        select: { lastActivityAt: true },
      });

      expect(session?.lastActivityAt).toBeTruthy();
      expect(session!.lastActivityAt!.getTime()).toBeGreaterThanOrEqual(
        beforeStart.getTime(),
      );
    });

    it('should update lastActivityAt when upserting set logs', async () => {
      // Get an existing session to work with
      const session = await db.workoutSession.findFirst({
        where: { userId: testUserId, status: WorkoutSessionStatus.IN_PROGRESS },
        select: { id: true, routineDayId: true },
      });

      expect(session).toBeTruthy();

      // Create a routine exercise for this session
      let exercise = await db.exercise.findFirst({
        select: { id: true },
      });

      if (!exercise) {
        // Create a simple exercise if none exists
        exercise = await db.exercise.create({
          data: {
            name: 'Heartbeat Test Exercise',
            equipment: 'bodyweight',
            primaryMuscles: [],
            secondaryMuscles: [],
          },
          select: { id: true },
        });
      }

      const routineExercise = await db.routineExercise.create({
        data: {
          routineDayId: session!.routineDayId,
          exerciseId: exercise.id,
          order: 1,
        },
      });

      // Get initial lastActivityAt
      const beforeUpsert = await db.workoutSession.findUnique({
        where: { id: session!.id },
        select: { lastActivityAt: true },
      });

      // Small delay to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Upsert a set log (should trigger heartbeat)
      const upsertResponse = await request(app.getHttpServer())
        .put(`/workouts/sessions/${session!.id}/set-logs`)
        .send({
          routineExerciseId: routineExercise.id,
          exerciseId: exercise.id,
          setNumber: 1,
          reps: 10,
          weight: 100,
          isCompleted: true,
        });

      expect(upsertResponse.status).toBe(200);

      // Check that lastActivityAt was updated
      const afterUpsert = await db.workoutSession.findUnique({
        where: { id: session!.id },
        select: { lastActivityAt: true },
      });

      expect(afterUpsert?.lastActivityAt).toBeTruthy();
      expect(afterUpsert!.lastActivityAt!.getTime()).toBeGreaterThan(
        beforeUpsert!.lastActivityAt!.getTime(),
      );
    });

    it('should update lastActivityAt when deleting set logs', async () => {
      // Get existing session with set logs
      const session = await db.workoutSession.findFirst({
        where: { userId: testUserId, status: WorkoutSessionStatus.IN_PROGRESS },
        include: { setLogs: { take: 1 } },
      });

      expect(session?.setLogs.length).toBeGreaterThan(0);

      const setLog = session!.setLogs[0];

      // Get initial lastActivityAt
      const beforeDelete = await db.workoutSession.findUnique({
        where: { id: session!.id },
        select: { lastActivityAt: true },
      });

      // Small delay to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Delete the set log (should trigger heartbeat)
      const deleteResponse = await request(app.getHttpServer()).delete(
        `/workouts/sessions/${session!.id}/set-logs/${setLog.routineExerciseId}/${setLog.setNumber}`,
      );

      expect(deleteResponse.status).toBe(200);

      // Check that lastActivityAt was updated
      const afterDelete = await db.workoutSession.findUnique({
        where: { id: session!.id },
        select: { lastActivityAt: true },
      });

      expect(afterDelete?.lastActivityAt).toBeTruthy();
      expect(afterDelete!.lastActivityAt!.getTime()).toBeGreaterThan(
        beforeDelete!.lastActivityAt!.getTime(),
      );
    });
  });
});
