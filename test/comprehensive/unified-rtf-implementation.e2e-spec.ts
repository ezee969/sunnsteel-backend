import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../../src/app.module';
import { DatabaseService } from '../../src/database/database.service';
import { SupabaseJwtGuard } from '../../src/auth/guards/supabase-jwt.guard';

describe('Unified PROGRAMMED_RTF Implementation (e2e)', () => {
  let app: INestApplication;
  let prisma: DatabaseService;
  let userId: string;
  let benchId: string;
  let lateralId: string;
  let squatId: string;

  const mockUser = {
    id: 'unified-rtf-test-user',
    email: 'unified-rtf-test@example.com',
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

    // Create test user directly in database
    const testUser = await prisma.user.create({
      data: {
        email: mockUser.email,
        name: 'Unified RtF Test User',
      },
    });
    userId = testUser.id;
    mockUser.id = userId; // Update mock user with actual ID
    // Prepare exercises (use existing or create minimal ones)
    const existing = await prisma.exercise.findMany({ take: 3 });
    if (existing.length >= 3) {
      benchId = existing[0].id;
      lateralId = existing[1].id;
      squatId = existing[2].id;
    } else {
      const ts = Date.now();
      const bench = await prisma.exercise.create({
        data: {
          name: `Bench Unified ${ts}`,
          primaryMuscles: ['PECTORAL'],
          secondaryMuscles: ['TRICEPS'],
          equipment: 'barbell',
        },
      });
      const lateral = await prisma.exercise.create({
        data: {
          name: `Lateral Raises Unified ${ts}`,
          primaryMuscles: ['MEDIAL_DELTOIDS'],
          equipment: 'dumbbell',
        },
      });
      const squat = await prisma.exercise.create({
        data: {
          name: `Squat Unified ${ts}`,
          primaryMuscles: ['QUADRICEPS'],
          secondaryMuscles: ['GLUTES'],
          equipment: 'barbell',
        },
      });
      benchId = bench.id;
      lateralId = lateral.id;
      squatId = squat.id;
    }
  }, 30000);

  afterAll(async () => {
    // Clean up test data
    if (userId) {
      await prisma.user.delete({
        where: { id: userId },
      });
    }
    await app.close();
  });

  describe('Mixed-Style Routine Creation', () => {
    it('should create routine with mixed STANDARD and HYPERTROPHY exercises', async () => {
      const routineData = {
        name: 'Mixed Style RtF Routine',
        description: 'Testing unified PROGRAMMED_RTF with mixed styles',
        isPeriodized: false,
        programWithDeloads: true,
        programDurationWeeks: 12,
        programStartWeek: 1,
        programStartDate: '2024-12-30', // Monday (first training day)
        programTimezone: 'America/New_York',
        programTrainingDaysOfWeek: [1, 3, 5],
        days: [
          {
            dayOfWeek: 1,
            order: 0,
            exercises: [
              {
                exerciseId: benchId,
                order: 0,
                restSeconds: 180,
                progressionScheme: 'PROGRAMMED_RTF',
                programStyle: 'STANDARD',
                programTMKg: 100.0,
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
                exerciseId: lateralId,
                order: 1,
                restSeconds: 120,
                progressionScheme: 'PROGRAMMED_RTF',
                programStyle: 'HYPERTROPHY',
                programTMKg: 20.0,
                programRoundingKg: 1.0,
                minWeightIncrement: 1.0,
                sets: [
                  { setNumber: 1, repType: 'FIXED', reps: 12, weight: 15 },
                  { setNumber: 2, repType: 'FIXED', reps: 12, weight: 15 },
                  { setNumber: 3, repType: 'FIXED', reps: 12, weight: 15 },
                ],
              },
              {
                exerciseId: squatId,
                order: 2,
                restSeconds: 180,
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

      let response: any;
      try {
        response = await request(app.getHttpServer())
          .post('/api/routines')
          .send(routineData);
      } catch (error) {
        console.log('Request error:', error);
        throw error;
      }

      if (response.status !== 201) {
        console.log('Response status:', response.status);
        console.log('Response body:', JSON.stringify(response.body, null, 2));
        console.log('Request data:', JSON.stringify(routineData, null, 2));
      }

      expect(response.status).toBe(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body.name).toBe('Mixed Style RtF Routine');
      expect(response.body.days).toHaveLength(1);
      expect(response.body.days[0].exercises).toHaveLength(3);

      // Verify STANDARD exercise
      const standardExercise = response.body.days[0].exercises.find(
        (ex) => ex.programStyle === 'STANDARD',
      );
      expect(standardExercise).toBeDefined();
      expect(standardExercise.progressionScheme).toBe('PROGRAMMED_RTF');
      expect(standardExercise.programStyle).toBe('STANDARD');
      expect(standardExercise.sets).toHaveLength(5); // 4 + 1 AMRAP

      // Verify HYPERTROPHY exercise
      const hypertrophyExercise = response.body.days[0].exercises.find(
        (ex) => ex.programStyle === 'HYPERTROPHY',
      );
      expect(hypertrophyExercise).toBeDefined();
      expect(hypertrophyExercise.progressionScheme).toBe('PROGRAMMED_RTF');
      expect(hypertrophyExercise.programStyle).toBe('HYPERTROPHY');
      expect(hypertrophyExercise.sets).toHaveLength(3); // 3 sets as provided in test data

      // Verify DYNAMIC_DOUBLE_PROGRESSION exercise (no programStyle)
      const doubleProgressionExercise = response.body.days[0].exercises.find(
        (ex) => ex.progressionScheme === 'DYNAMIC_DOUBLE_PROGRESSION',
      );
      expect(doubleProgressionExercise).toBeDefined();
      expect(doubleProgressionExercise.progressionScheme).toBe(
        'DYNAMIC_DOUBLE_PROGRESSION',
      );
      expect(doubleProgressionExercise.programStyle).toBeNull();
    }, 30000);
  });
});
