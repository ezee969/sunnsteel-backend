import { Test, TestingModule } from '@nestjs/testing';
import {
  INestApplication,
  ValidationPipe,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';
import { SupabaseService } from '../src/auth/supabase.service';

/**
 * E2E tests for Supabase authentication flow
 * Tests the complete signup and verification flow with mocked SupabaseService
 */
describe('Supabase Auth (e2e)', () => {
  let app: INestApplication;
  let databaseService: DatabaseService;
  let supabaseServiceMock: Partial<SupabaseService>;

  // Token-to-user mapping for mock verification
  const tokenToUser: Record<
    string,
    { id: string; email: string; name?: string }
  > = {};

  beforeAll(async () => {
    // Create SupabaseService mock with token-based verification
    supabaseServiceMock = {
      verifyToken: jest.fn().mockImplementation((token: string) => {
        if (!token) throw new BadRequestException('Token required');
        const mapped = tokenToUser[token];
        if (!mapped) throw new UnauthorizedException('Invalid token');
        return {
          id: mapped.id,
          email: mapped.email,
          user_metadata: { name: mapped.name || 'Test User' },
          email_confirmed_at: new Date().toISOString(),
        } as any;
      }),
      getUserBySupabaseId: jest
        .fn()
        .mockImplementation(async (supabaseId: string) => {
          // Look up user by supabaseUserId
          return databaseService?.user.findFirst({
            where: { supabaseUserId: supabaseId },
          });
        }),
      getOrCreateUser: jest
        .fn()
        .mockImplementation(async (supabaseUser: any) => {
          return databaseService.user.upsert({
            where: { email: supabaseUser.email },
            update: { supabaseUserId: supabaseUser.id },
            create: {
              email: supabaseUser.email,
              name: supabaseUser.user_metadata?.name || 'Test User',
              supabaseUserId: supabaseUser.id,
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

    // Apply global validation pipe (same as main.ts)
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    // Set global API prefix to match production
    app.setGlobalPrefix('api');

    databaseService = app.get<DatabaseService>(DatabaseService);

    await app.init();
  });

  afterAll(async () => {
    // Cleanup test users
    await databaseService.user.deleteMany({
      where: {
        email: {
          contains: '@supabasetest.com',
        },
      },
    });

    await app.close();
  });

  describe('/auth/supabase/verify (POST)', () => {
    it('should verify a valid Supabase token and create new user', async () => {
      const mockToken = `valid-token-${Date.now()}`;
      const mockEmail = `newuser-${Date.now()}@supabasetest.com`;
      const mockSupabaseId = `supabase-${Date.now()}`;

      // Register token in mock mapping
      tokenToUser[mockToken] = {
        id: mockSupabaseId,
        email: mockEmail,
        name: 'New Test User',
      };

      const response = await request(app.getHttpServer())
        .post('/api/auth/supabase/verify')
        .send({ token: mockToken })
        .expect(200);

      expect(response.body).toHaveProperty('user');
      expect(response.body.user).toHaveProperty('id');
      expect(response.body.user.email).toBe(mockEmail);
      expect(response.body.user).toHaveProperty('name');
      expect(response.body.user).toHaveProperty(
        'supabaseUserId',
        mockSupabaseId,
      );
      expect(response.body.user).toHaveProperty('weightUnit');
      expect(response.body).toHaveProperty('message');

      // Verify user was created in database
      const dbUser = await databaseService.user.findUnique({
        where: { email: mockEmail },
      });
      expect(dbUser).toBeDefined();
      expect(dbUser?.supabaseUserId).toBe(mockSupabaseId);
    });

    it('should reject invalid token', async () => {
      const invalidToken = 'invalid-token-12345';
      // Don't register this token in mapping

      await request(app.getHttpServer())
        .post('/api/auth/supabase/verify')
        .send({ token: invalidToken })
        .expect(401);
    });

    it('should reject missing token', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/supabase/verify')
        .send({})
        .expect(400);
    });

    it('should handle existing user on subsequent verification', async () => {
      const mockToken = `existing-user-token-${Date.now()}`;
      const mockEmail = `existinguser-${Date.now()}@supabasetest.com`;
      const mockSupabaseId = `supabase-existing-${Date.now()}`;

      // Register token
      tokenToUser[mockToken] = {
        id: mockSupabaseId,
        email: mockEmail,
        name: 'Existing User',
      };

      // First verification creates user
      const firstResponse = await request(app.getHttpServer())
        .post('/api/auth/supabase/verify')
        .send({ token: mockToken })
        .expect(200);

      const userId = firstResponse.body.user.id;

      // Second verification returns same user
      const secondResponse = await request(app.getHttpServer())
        .post('/api/auth/supabase/verify')
        .send({ token: mockToken })
        .expect(200);

      expect(secondResponse.body.user.id).toBe(userId);
      expect(secondResponse.body.user.email).toBe(mockEmail);
    });

    it('should set session cookie on successful verification', async () => {
      const mockToken = `cookie-test-${Date.now()}`;
      const mockEmail = `cookieuser-${Date.now()}@supabasetest.com`;

      tokenToUser[mockToken] = {
        id: `supabase-cookie-${Date.now()}`,
        email: mockEmail,
      };

      const response = await request(app.getHttpServer())
        .post('/api/auth/supabase/verify')
        .send({ token: mockToken })
        .expect(200);

      const cookies = response.headers['set-cookie'];
      expect(cookies).toBeDefined();

      if (Array.isArray(cookies)) {
        const sessionCookie = cookies.find((c: string) =>
          c.includes('ss_session'),
        );
        expect(sessionCookie).toBeDefined();
        expect(sessionCookie).toContain('HttpOnly');
        expect(sessionCookie).toContain('Path=/');
      }
    });
  });

  describe('/auth/supabase/profile (GET)', () => {
    it('should return user profile with valid Bearer token', async () => {
      const mockToken = `profile-token-${Date.now()}`;
      const mockEmail = `profileuser-${Date.now()}@supabasetest.com`;
      const mockSupabaseId = `supabase-profile-${Date.now()}`;

      // Register token and create user
      tokenToUser[mockToken] = {
        id: mockSupabaseId,
        email: mockEmail,
        name: 'Profile Test User',
      };

      // First verify to create user
      await request(app.getHttpServer())
        .post('/api/auth/supabase/verify')
        .send({ token: mockToken })
        .expect(200);

      // Now get profile
      const response = await request(app.getHttpServer())
        .get('/api/auth/supabase/profile')
        .set('Authorization', `Bearer ${mockToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('user');
      expect(response.body.user).toHaveProperty('id');
      expect(response.body.user.email).toBe(mockEmail);
      expect(response.body.user).toHaveProperty('name');
      expect(response.body.user).toHaveProperty(
        'supabaseUserId',
        mockSupabaseId,
      );
    });

    it('should reject request without Bearer token', async () => {
      await request(app.getHttpServer())
        .get('/api/auth/supabase/profile')
        .expect(401);
    });

    it('should reject request with invalid Bearer token', async () => {
      await request(app.getHttpServer())
        .get('/api/auth/supabase/profile')
        .set('Authorization', 'Bearer invalid-token-xyz')
        .expect(401);
    });
  });

  describe('User Creation and Upsert Flow', () => {
    it('should upsert user on verification (update supabaseUserId for existing user)', async () => {
      const testEmail = `migration-${Date.now()}@supabasetest.com`;
      const mockToken = `migration-token-${Date.now()}`;
      const mockSupabaseId = `supabase-migration-${Date.now()}`;

      // Create a legacy user without supabaseUserId
      const legacyUser = await databaseService.user.create({
        data: {
          email: testEmail,
          name: 'Legacy User',
          password: 'hashed-password',
        },
      });

      expect(legacyUser.supabaseUserId).toBeNull();

      // Register token for this email
      tokenToUser[mockToken] = {
        id: mockSupabaseId,
        email: testEmail,
        name: 'Migrated User',
      };

      // Verify - should update existing user with supabaseUserId
      const response = await request(app.getHttpServer())
        .post('/api/auth/supabase/verify')
        .send({ token: mockToken })
        .expect(200);

      // Should return the same user, now with supabaseUserId
      expect(response.body.user.id).toBe(legacyUser.id);
      expect(response.body.user.supabaseUserId).toBe(mockSupabaseId);

      // Verify in database
      const updatedUser = await databaseService.user.findUnique({
        where: { id: legacyUser.id },
      });
      expect(updatedUser?.supabaseUserId).toBe(mockSupabaseId);
    });
  });

  describe('Performance', () => {
    it('should verify token within acceptable time', async () => {
      const mockToken = `perf-token-${Date.now()}`;
      const mockEmail = `perfuser-${Date.now()}@supabasetest.com`;

      tokenToUser[mockToken] = {
        id: `supabase-perf-${Date.now()}`,
        email: mockEmail,
      };

      const startTime = Date.now();

      await request(app.getHttpServer())
        .post('/api/auth/supabase/verify')
        .send({ token: mockToken })
        .expect(200);

      const duration = Date.now() - startTime;

      // Should complete within 5 seconds
      expect(duration).toBeLessThan(5000);
    });
  });
});
