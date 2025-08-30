import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let databaseService: DatabaseService;

  const makeUser = () => ({
    email: `auth-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`,
    password: 'password123',
    name: 'Test User',
  });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

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

  // No global DB wipes. Tests will clean up only what they create.

  afterAll(async () => {
    await databaseService.$disconnect();
    await app.close();
  });

  describe('/auth/register (POST)', () => {
    it('should register a new user', async () => {
      const testUser = makeUser();
      const response = await request(app.getHttpServer())
        .post('/api/auth/register')
        .send(testUser)
        .expect(201);

      expect(response.body).toMatchObject({
        user: {
          email: testUser.email,
          name: testUser.name,
        },
        accessToken: expect.any(String),
      });
      expect(response.body.user.id).toBeDefined();
      expect(response.headers['set-cookie']).toBeDefined();
      // Cleanup
      await databaseService.user.deleteMany({
        where: { email: testUser.email },
      });
    });

    it('should return 409 if email already exists', async () => {
      // First registration
      const testUser = makeUser();
      await request(app.getHttpServer())
        .post('/api/auth/register')
        .send(testUser)
        .expect(201);

      // Second registration with same email
      await request(app.getHttpServer())
        .post('/api/auth/register')
        .send(testUser)
        .expect(409);

      // Cleanup
      await databaseService.user.deleteMany({
        where: { email: testUser.email },
      });
    });

    it('should return 400 for invalid email', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({
          name: 'Test User',
          password: 'password123',
          email: 'invalid-email',
        })
        .expect(400);

      expect(response.body.message).toContain('Invalid email format');
    });

    it('should return 400 for weak password', async () => {
      const testUser = makeUser();
      await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({
          ...testUser,
          password: '123',
        })
        .expect(400);
    });
  });

  describe('/auth/login (POST)', () => {
    const testUser = makeUser();
    beforeAll(async () => {
      // Register a user for login tests
      await request(app.getHttpServer())
        .post('/api/auth/register')
        .send(testUser)
        .expect(201);
    });
    afterAll(async () => {
      await databaseService.user.deleteMany({
        where: { email: testUser.email },
      });
    });

    it('should login with valid credentials', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          email: testUser.email,
          password: testUser.password,
        })
        .expect(200);

      expect(response.body).toMatchObject({
        user: {
          email: testUser.email,
          name: testUser.name,
        },
        accessToken: expect.any(String),
      });
      expect(response.headers['set-cookie']).toBeDefined();
    });

    it('should return 401 for invalid email', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          email: 'wrong@example.com',
          password: testUser.password,
        })
        .expect(401);
    });

    it('should return 401 for invalid password', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          email: testUser.email,
          password: 'wrongpassword',
        })
        .expect(401);
    });
  });

  describe('/auth/logout (POST)', () => {
    let accessToken: string;
    let refreshTokenCookie: string;
    const testUser = makeUser();

    beforeAll(async () => {
      // Register and login
      await request(app.getHttpServer())
        .post('/api/auth/register')
        .send(testUser)
        .expect(201);

      const loginResponse = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          email: testUser.email,
          password: testUser.password,
        })
        .expect(200);

      accessToken = loginResponse.body.accessToken;
      const cookies = loginResponse.headers['set-cookie'];
      if (!cookies || !cookies[0]) {
        throw new Error(
          `No refresh token cookie in response: ${JSON.stringify({
            loginBody: loginResponse.body,
            loginHeaders: loginResponse.headers,
          })}`,
        );
      }
      refreshTokenCookie = cookies[0];

      if (!accessToken) {
        throw new Error(
          `Invalid login response: ${JSON.stringify(loginResponse.body)}`,
        );
      }
    });
    afterAll(async () => {
      await databaseService.user.deleteMany({
        where: { email: testUser.email },
      });
    });

    it('should logout successfully', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('Cookie', refreshTokenCookie)
        .expect(200);

      expect(response.body.message).toBe('Logged out successfully');
    });

    it('should return 401 without access token', async () => {
      await request(app.getHttpServer()).post('/api/auth/logout').expect(401);
    });
  });

  describe('/auth/refresh (POST)', () => {
    let refreshTokenCookie: string;
    const testUser = makeUser();

    beforeAll(async () => {
      // Register and login
      await request(app.getHttpServer())
        .post('/api/auth/register')
        .send(testUser)
        .expect(201);

      const loginResponse = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          email: testUser.email,
          password: testUser.password,
        })
        .expect(200);

      const cookies = loginResponse.headers['set-cookie'];
      if (!cookies || !cookies[0]) {
        throw new Error(
          `No refresh token cookie in refresh test: ${JSON.stringify(
            loginResponse.headers,
          )}`,
        );
      }
      refreshTokenCookie = cookies[0];
    });
    afterAll(async () => {
      await databaseService.user.deleteMany({
        where: { email: testUser.email },
      });
    });

    it('should refresh tokens successfully', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .set('Cookie', refreshTokenCookie)
        .expect(200);

      expect(response.body).toMatchObject({
        accessToken: expect.any(String),
      });
      expect(response.headers['set-cookie']).toBeDefined();
    });

    it('should return 401 without refresh token', async () => {
      await request(app.getHttpServer()).post('/api/auth/refresh').expect(401);
    });
  });
});
