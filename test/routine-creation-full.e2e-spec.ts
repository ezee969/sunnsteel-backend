import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';
import { SupabaseService } from '../src/auth/supabase.service';

/**
 * Comprehensive E2E test for routine creation with complex validation
 *
 * Tests the complete flow with:
 * 1. Multiple progression schemes (PROGRAMMED_RTF, DYNAMIC_DOUBLE_PROGRESSION)
 * 2. Different rep types (FIXED, RANGE)
 * 3. Program configuration validation
 * 4. Exercise ordering validation
 * 5. Rest periods validation
 * 6. Database integrity checks
 */

describe('Routine Creation - Full E2E (e2e)', () => {
  let app: INestApplication;
  let databaseService: DatabaseService;
  let accessToken: string;
  let userId: string;
  let createdRoutineId: string;

  // Mock token map for Supabase
  const tokenToUser: Record<string, { id: string; email: string }> = {};
  let supabaseServiceMock: Partial<SupabaseService>;

  const testUser = {
    email: `routine-full-e2e-${Date.now()}@example.com`,
    password: 'password123',
    name: 'Routine Full Test User',
  };

  let testExerciseIds: string[] = [];

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
        return databaseService.user.upsert({
          where: { email: supabaseUser.email },
          update: {},
          create: {
            email: supabaseUser.email,
            name: supabaseUser.user_metadata?.name || 'user',
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
    databaseService = moduleFixture.get<DatabaseService>(DatabaseService);

    const { ValidationPipe } = await import('@nestjs/common');
    app.useGlobalPipes(new ValidationPipe({ transform: true }));

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const cookieParser = require('cookie-parser');
    app.use(cookieParser());

    app.setGlobalPrefix('api');
    await app.init();

    // Create user directly in DB and issue a mocked Supabase token
    const created = await databaseService.user.create({
      data: { email: testUser.email, name: testUser.name },
    });
    userId = created.id;
    accessToken = `token-${Date.now()}`;
    // Map token for Supabase mock
    tokenToUser[accessToken] = { id: userId, email: testUser.email };

    // Get existing exercises from database
    const existingExercises = await databaseService.exercise.findMany({
      take: 2,
    });

    if (existingExercises.length < 2) {
      throw new Error('Database must have at least 2 exercises for this test');
    }

    testExerciseIds = existingExercises.map((ex) => ex.id);
  }, 30000); // 30 second timeout

  afterAll(async () => {
    // Cleanup
    if (userId) {
      await databaseService.routine.deleteMany({ where: { userId } });
      await databaseService.user.deleteMany({ where: { id: userId } });
    }
    await databaseService.$disconnect();
    await app.close();
  });

  describe('Step 1: Create Complex Routine', () => {
    it('should create routine with PROGRAMMED_RTF and DYNAMIC_DOUBLE_PROGRESSION', async () => {
      const routinePayload = {
        name: 'Complex E2E Test Routine',
        description: 'Full E2E test with multiple progression schemes',
        isPeriodized: false,
        programStartDate: '2025-10-06', // Monday
        programTimezone: 'America/Cordoba',
        programWithDeloads: true,
        days: [
          {
            dayOfWeek: 1,
            exercises: [
              {
                exerciseId: testExerciseIds[0],
                restSeconds: 180,
                progressionScheme: 'PROGRAMMED_RTF',
                minWeightIncrement: 2.5,
                programTMKg: 100,
                programRoundingKg: 2.5,
                programStyle: 'STANDARD',
                sets: [
                  {
                    setNumber: 1,
                    repType: 'RANGE',
                    minReps: 8,
                    maxReps: 10,
                  },
                ],
              },
              {
                exerciseId: testExerciseIds[1],
                restSeconds: 120,
                progressionScheme: 'DYNAMIC_DOUBLE_PROGRESSION',
                minWeightIncrement: 2.5,
                sets: [
                  {
                    setNumber: 1,
                    repType: 'FIXED',
                    reps: 10,
                    weight: 50,
                  },
                ],
              },
            ],
          },
        ],
      };

      const response = await request(app.getHttpServer())
        .post('/api/routines')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(routinePayload);

      if (response.status !== 201) {
        console.error('❌ Routine creation failed:', response.body);
      }

      expect(response.status).toBe(201);

      expect(response.body.id).toBeDefined();
      expect(response.body.name).toBe('Complex E2E Test Routine');
      expect(response.body.userId).toBe(userId);
      expect(response.body.days).toBeInstanceOf(Array);
      expect(response.body.days.length).toBe(1);

      const firstDay = response.body.days[0];
      expect(firstDay.exercises.length).toBe(2);

      // Find exercises by progression scheme (order may vary)
      const rtfExercise = firstDay.exercises.find(
        (ex: any) => ex.progressionScheme === 'PROGRAMMED_RTF',
      );
      const ddpExercise = firstDay.exercises.find(
        (ex: any) => ex.progressionScheme === 'DYNAMIC_DOUBLE_PROGRESSION',
      );

      // Validate RTF exercise
      expect(rtfExercise).toBeDefined();
      expect(rtfExercise.progressionScheme).toBe('PROGRAMMED_RTF');
      expect(rtfExercise.programStyle).toBe('STANDARD');
      expect(rtfExercise.sets[0].repType).toBe('RANGE');
      expect(rtfExercise.sets[0].minReps).toBe(8);
      expect(rtfExercise.sets[0].maxReps).toBe(10);

      // Validate DDP exercise
      expect(ddpExercise).toBeDefined();
      expect(ddpExercise.progressionScheme).toBe('DYNAMIC_DOUBLE_PROGRESSION');
      expect(ddpExercise.sets[0].repType).toBe('FIXED');
      expect(ddpExercise.sets[0].reps).toBe(10);

      createdRoutineId = response.body.id;
    }, 30000);
  });

  describe('Step 2: Database Validation', () => {
    it('should have PROGRAMMED_RTF exercises with programStyle in DB', async () => {
      if (!createdRoutineId) {
        console.warn('⚠️  No routine created, skipping test');
        return;
      }

      const routine = await databaseService.routine.findUnique({
        where: { id: createdRoutineId },
        include: {
          days: {
            include: {
              exercises: { include: { sets: true } },
            },
          },
        },
      });

      const rtfExercises = routine?.days
        .flatMap((day) => day.exercises)
        .filter((ex) => ex.progressionScheme === 'PROGRAMMED_RTF');

      expect(rtfExercises?.length).toBeGreaterThan(0);
      rtfExercises?.forEach((exercise) => {
        expect(exercise.programStyle).toBeDefined();
        expect(['STANDARD', 'HYPERTROPHY']).toContain(exercise.programStyle);
      });
    }, 30000);

    it('should have correct repType on sets', async () => {
      if (!createdRoutineId) {
        console.warn('⚠️  No routine created, skipping test');
        return;
      }

      const routine = await databaseService.routine.findUnique({
        where: { id: createdRoutineId },
        include: {
          days: {
            include: {
              exercises: { include: { sets: true } },
            },
          },
        },
      });

      const allSets = routine?.days.flatMap((day) =>
        day.exercises.flatMap((ex) => ex.sets),
      );

      allSets?.forEach((set) => {
        expect(set.repType).toBeDefined();
        expect(['FIXED', 'RANGE']).toContain(set.repType);

        if (set.repType === 'RANGE') {
          expect(set.minReps).toBeDefined();
          expect(set.maxReps).toBeDefined();
        } else if (set.repType === 'FIXED') {
          expect(set.reps).toBeDefined();
        }
      });
    }, 30000);

    it('should preserve exercise order', async () => {
      if (!createdRoutineId) {
        console.warn('⚠️  No routine created, skipping test');
        return;
      }

      const routine = await databaseService.routine.findUnique({
        where: { id: createdRoutineId },
        include: {
          days: {
            orderBy: { order: 'asc' },
            include: {
              exercises: { orderBy: { order: 'asc' } },
            },
          },
        },
      });

      // Validate days are ordered
      const dayOrders = routine?.days.map((d) => d.order) || [];
      expect(dayOrders).toEqual([...dayOrders].sort((a, b) => a - b));

      // Validate exercises within each day are ordered
      routine?.days.forEach((day) => {
        const exerciseOrders = day.exercises.map((e) => e.order);
        expect(exerciseOrders).toEqual(
          [...exerciseOrders].sort((a, b) => a - b),
        );
      });
    }, 30000);

    it('should have correct rest periods', async () => {
      if (!createdRoutineId) {
        console.warn('⚠️  No routine created, skipping test');
        return;
      }

      const routine = await databaseService.routine.findUnique({
        where: { id: createdRoutineId },
        include: {
          days: {
            include: { exercises: true },
          },
        },
      });

      routine?.days.forEach((day) => {
        day.exercises.forEach((exercise) => {
          expect(exercise.restSeconds).toBeGreaterThanOrEqual(0);
          expect(exercise.restSeconds).toBeLessThanOrEqual(600);
        });
      });
    }, 30000);
  });

  describe('Step 3: API Retrieval', () => {
    it('should retrieve the created routine', async () => {
      if (!createdRoutineId) {
        console.warn('⚠️  No routine created, skipping test');
        return;
      }

      const response = await request(app.getHttpServer())
        .get(`/api/routines/${createdRoutineId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body.id).toBe(createdRoutineId);
      expect(response.body.name).toBe('Complex E2E Test Routine');
    }, 30000);

    it('should list routine in user routines', async () => {
      if (!createdRoutineId) {
        console.warn('⚠️  No routine created, skipping test');
        return;
      }

      const response = await request(app.getHttpServer())
        .get('/api/routines')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body).toBeInstanceOf(Array);
      expect(response.body.length).toBeGreaterThan(0);

      const foundRoutine = response.body.find(
        (r: any) => r.id === createdRoutineId,
      );
      expect(foundRoutine).toBeDefined();
    }, 30000);
  });

  describe('Step 4: Program Configuration', () => {
    it('should have correct program settings', async () => {
      if (!createdRoutineId) {
        console.warn('⚠️  No routine created, skipping test');
        return;
      }

      const routine = await databaseService.routine.findUnique({
        where: { id: createdRoutineId },
      });

      expect(routine?.programWithDeloads).toBe(true);
      expect(routine?.programStartDate).toBeDefined();
      expect(routine?.programTimezone).toBe('America/Cordoba');
    }, 30000);
  });

  describe('Step 5: Cleanup', () => {
    it('should delete the routine', async () => {
      if (!createdRoutineId) {
        console.warn('⚠️  No routine created, skipping test');
        return;
      }

      await request(app.getHttpServer())
        .delete(`/api/routines/${createdRoutineId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      const deleted = await databaseService.routine.findUnique({
        where: { id: createdRoutineId },
      });

      expect(deleted).toBeNull();
    }, 30000);
  });
});
