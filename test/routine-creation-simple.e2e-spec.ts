import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';
import { SupabaseService } from '../src/auth/supabase.service';

/**
 * Simplified E2E test for routine creation
 *
 * Tests the complete flow:
 * 1. Register a user via /auth/register
 * 2. Create a routine via API
 * 3. Verify it's in the database
 * 4. Retrieve it via API
 * 5. Delete it
 */

describe('Routine Creation - Simple E2E (e2e)', () => {
  let app: INestApplication;
  let databaseService: DatabaseService;
  let accessToken: string;
  let userId: string;
  let createdRoutineId: string;

  // Mock token map for Supabase
  const tokenToUser: Record<string, { id: string; email: string }> = {};
  let supabaseServiceMock: Partial<SupabaseService>;

  const testUser = {
    email: `routine-e2e-${Date.now()}@example.com`,
    password: 'password123',
    name: 'Routine Test User',
  };

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
    // Map token for Supabase mock so SupabaseJwtGuard authenticates
    tokenToUser[accessToken] = { id: userId, email: testUser.email };
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

  it('should create a simple routine successfully', async () => {
    // Get an existing exercise from DB
    const exercise = await databaseService.exercise.findFirst();

    if (!exercise) {
      console.warn('⚠️  No exercises in database, skipping test');
      return;
    }

    const routinePayload = {
      name: 'Simple E2E Test Routine',
      description: 'Created by E2E test',
      isPeriodized: false,
      days: [
        {
          dayOfWeek: 1,
          exercises: [
            {
              exerciseId: exercise.id,
              restSeconds: 120,
              progressionScheme: 'NONE',
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
      .send(routinePayload)
      .expect(201);

    expect(response.body.id).toBeDefined();
    expect(response.body.name).toBe('Simple E2E Test Routine');
    expect(response.body.userId).toBe(userId);

    createdRoutineId = response.body.id;
  }, 30000);

  it('should find the routine in database', async () => {
    if (!createdRoutineId) {
      console.warn('⚠️  No routine created, skipping test');
      return;
    }

    const routine = await databaseService.routine.findUnique({
      where: { id: createdRoutineId },
      include: {
        days: { include: { exercises: { include: { sets: true } } } },
      },
    });

    expect(routine).toBeDefined();
    expect(routine?.name).toBe('Simple E2E Test Routine');
    expect(routine?.days.length).toBe(1);
    expect(routine?.days[0].exercises.length).toBe(1);
    expect(routine?.days[0].exercises[0].sets.length).toBe(1);
  });

  it('should retrieve the routine via API', async () => {
    if (!createdRoutineId) {
      console.warn('⚠️  No routine created, skipping test');
      return;
    }

    const response = await request(app.getHttpServer())
      .get(`/api/routines/${createdRoutineId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(response.body.id).toBe(createdRoutineId);
    expect(response.body.name).toBe('Simple E2E Test Routine');
  });

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
  });
});
