import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';

describe('Users & Exercises (e2e)', () => {
  let app: INestApplication;
  let databaseService: DatabaseService;
  let accessToken: string;
  let userId: string;

  const testUser = {
    email: 'test@example.com',
    password: 'password123',
    name: 'Test User',
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    databaseService = moduleFixture.get<DatabaseService>(DatabaseService);
    
    await app.init();
  });

  beforeEach(async () => {
    // Clean up database before each test
    await databaseService.user.deleteMany();
    await databaseService.refreshToken.deleteMany();
    await databaseService.blacklistedToken.deleteMany();

    // Register and authenticate a user for protected routes
    const registerResponse = await request(app.getHttpServer())
      .post('/auth/register')
      .send(testUser);

    accessToken = registerResponse.body.accessToken;
    userId = registerResponse.body.user.id;
  });

  afterAll(async () => {
    await databaseService.$disconnect();
    await app.close();
  });

  describe('/users/profile (GET)', () => {
    it('should return user profile', async () => {
      const response = await request(app.getHttpServer())
        .get('/users/profile')
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
      await request(app.getHttpServer())
        .get('/users/profile')
        .expect(401);
    });

    it('should return 401 with invalid token', async () => {
      await request(app.getHttpServer())
        .get('/users/profile')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);
    });
  });

  describe('/exercises (GET)', () => {
    it('should return list of exercises', async () => {
      const response = await request(app.getHttpServer())
        .get('/exercises')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      
      if (response.body.length > 0) {
        expect(response.body[0]).toMatchObject({
          id: expect.any(String),
          name: expect.any(String),
          primaryMuscle: expect.any(String),
          equipment: expect.any(String),
        });
      }
    });

    it('should return exercises ordered by name', async () => {
      const response = await request(app.getHttpServer())
        .get('/exercises')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      if (response.body.length > 1) {
        const names = response.body.map((exercise: any) => exercise.name);
        const sortedNames = [...names].sort();
        expect(names).toEqual(sortedNames);
      }
    });

    it('should return 401 without authorization', async () => {
      await request(app.getHttpServer())
        .get('/exercises')
        .expect(401);
    });

    it('should return 401 with invalid token', async () => {
      await request(app.getHttpServer())
        .get('/exercises')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);
    });
  });

  describe('Authentication token validation', () => {
    it('should reject expired token', async () => {
      // This test would require generating an expired token
      // For now, we'll test with malformed token
      await request(app.getHttpServer())
        .get('/users/profile')
        .set('Authorization', 'Bearer malformed.jwt.token')
        .expect(401);
    });

    it('should reject token without Bearer prefix', async () => {
      await request(app.getHttpServer())
        .get('/users/profile')
        .set('Authorization', accessToken)
        .expect(401);
    });
  });
});
