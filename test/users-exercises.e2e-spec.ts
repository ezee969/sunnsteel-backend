import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { SupabaseService } from '../src/auth/supabase.service';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';

describe('Users & Exercises (e2e)', () => {
  let app: INestApplication;
  let databaseService: DatabaseService;
  let accessToken: string;
  let userId: string;
  // Shared token map for guard across tests
  const tokenToUser: Record<string, { id: string; email: string }> = {};
  let supabaseServiceMock: Partial<SupabaseService>;

  let testUser: { email: string; password: string; name: string };

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
  });

  beforeEach(async () => {
    // Generate a unique user per test to avoid collisions
    testUser = {
      email: `users-exercises-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}@example.com`,
      password: 'password123',
      name: 'Test User',
    };

    // Register and authenticate a user for protected routes
    const registerResponse = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send(testUser)
      .expect(201);

    accessToken = registerResponse.body.accessToken;
    userId = registerResponse.body.user.id;
    tokenToUser[accessToken] = { id: userId, email: testUser.email };

    if (!accessToken || !userId) {
      throw new Error(
        `Invalid register response: ${JSON.stringify(registerResponse.body)}`,
      );
    }
  });

  afterEach(async () => {
    // Clean up only the user created by this test (cascades handle dependents)
    if (userId) {
      await databaseService.user.deleteMany({ where: { id: userId } });
    }
  });

  afterAll(async () => {
    await databaseService.$disconnect();
    await app.close();
  });

  describe('/users/profile (GET)', () => {
    it('should return user profile', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/users/profile')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body).toMatchObject({
        id: userId,
        email: testUser.email,
        name: testUser.name,
        weightUnit: expect.any(String),
      });
      expect(response.body.password).toBeUndefined();
    });

    it('should return 401 without authorization', async () => {
      await request(app.getHttpServer()).get('/api/users/profile').expect(401);
    });

    it('should return 401 with invalid token', async () => {
      await request(app.getHttpServer())
        .get('/api/users/profile')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);
    });
  });

  describe('/exercises (GET)', () => {
    it('should return list of exercises', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/exercises')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);

      if (response.body.length > 0) {
        expect(response.body[0]).toMatchObject({
          id: expect.any(String),
          name: expect.any(String),
          primaryMuscles: expect.any(Array),
          equipment: expect.any(String),
        });
      }
    });

    it('should return exercises ordered by name', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/exercises')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      if (response.body.length > 1) {
        const names = response.body.map((exercise) => exercise.name);
        // Deterministic comparator to match service sorting across environments
        const collator = new Intl.Collator('en', {
          sensitivity: 'base',
          ignorePunctuation: true,
        });
        for (let i = 1; i < names.length; i++) {
          expect(collator.compare(names[i - 1], names[i])).toBeLessThanOrEqual(
            0,
          );
        }
      }
    });

    it('should return 401 without authorization', async () => {
      await request(app.getHttpServer()).get('/api/exercises').expect(401);
    });

    it('should return 401 with invalid token', async () => {
      await request(app.getHttpServer())
        .get('/api/exercises')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);
    });
  });

  describe('Authentication token validation', () => {
    it('should reject expired token', async () => {
      // This test would require generating an expired token
      // For now, we'll test with malformed token
      await request(app.getHttpServer())
        .get('/api/users/profile')
        .set('Authorization', 'Bearer malformed.jwt.token')
        .expect(401);
    });

    it('should reject token without Bearer prefix', async () => {
      await request(app.getHttpServer())
        .get('/api/users/profile')
        .set('Authorization', accessToken)
        .expect(401);
    });
  });
});
