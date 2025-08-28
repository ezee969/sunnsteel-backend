import {
  INestApplication,
  ValidationPipe,
  BadRequestException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { JwtAuthGuard } from '../src/auth/guards/passport-jwt.guard';
import { RoutinesService } from '../src/routines/routines.service';

const mockUser = { userId: 'u1', email: 'u1@mail.com' };
const allowJwtGuard: Partial<JwtAuthGuard> = {
  canActivate: (ctx) => {
    const req = ctx.switchToHttp().getRequest();
    req.user = mockUser as any;
    return true as any;
  },
};

describe('RoutinesController (e2e)', () => {
  let app: INestApplication;
  const routinesServiceMock = {
    create: jest.fn(),
    update: jest.fn(),
    findAll: jest.fn(),
    findFavorites: jest.fn(),
    findCompleted: jest.fn(),
    setFavorite: jest.fn(),
    setCompleted: jest.fn(),
  } as unknown as jest.Mocked<RoutinesService>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideGuard(JwtAuthGuard as any)
      .useValue(allowJwtGuard)
      .overrideProvider(RoutinesService)
      .useValue(routinesServiceMock)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    app.setGlobalPrefix('api');
    await app.init();
  });

  it('POST /api/routines creates routine and includes repType fields in sets', async () => {
    (routinesServiceMock.create as any).mockResolvedValue({
      id: 'r10',
      days: [
        {
          id: 'd10',
          dayOfWeek: 1,
          order: 0,
          exercises: [
            {
              id: 're10',
              order: 0,
              restSeconds: 60,
              exercise: { id: 'e1', name: 'Bench Press' },
              sets: [
                {
                  setNumber: 1,
                  repType: 'FIXED',
                  reps: 8,
                  minReps: null,
                  maxReps: null,
                  weight: 80,
                },
              ],
            },
          ],
        },
      ],
    });

    const payload: any = {
      name: 'r',
      isPeriodized: false,
      days: [
        {
          dayOfWeek: 1,
          order: 0,
          exercises: [
            {
              exerciseId: 'e1',
              order: 0,
              restSeconds: 60,
              sets: [{ setNumber: 1, repType: 'FIXED', reps: 8, weight: 80 }],
            },
          ],
        },
      ],
    };

    const res = await request(app.getHttpServer())
      .post('/api/routines')
      .send(payload)
      .expect(201);

    const set = res.body.days[0].exercises[0].sets[0];
    expect(set).toEqual(
      expect.objectContaining({
        setNumber: 1,
        repType: 'FIXED',
        reps: 8,
        minReps: null,
        maxReps: null,
        weight: 80,
      }),
    );
  });

  it('PATCH /api/routines/:id updates routine and includes repType fields in sets', async () => {
    (routinesServiceMock.update as any).mockResolvedValue({
      id: 'r11',
      days: [
        {
          id: 'd11',
          dayOfWeek: 2,
          order: 0,
          exercises: [
            {
              id: 're11',
              order: 0,
              restSeconds: 90,
              exercise: { id: 'e2', name: 'Squat' },
              sets: [
                {
                  setNumber: 1,
                  repType: 'RANGE',
                  reps: null,
                  minReps: 5,
                  maxReps: 7,
                  weight: 100,
                },
              ],
            },
          ],
        },
      ],
    });

    const payload: any = {
      name: 'r',
      isPeriodized: false,
      days: [
        {
          dayOfWeek: 2,
          order: 0,
          exercises: [
            {
              exerciseId: 'e2',
              order: 0,
              restSeconds: 90,
              sets: [
                {
                  setNumber: 1,
                  repType: 'RANGE',
                  minReps: 5,
                  maxReps: 7,
                  weight: 100,
                },
              ],
            },
          ],
        },
      ],
    };

    const res = await request(app.getHttpServer())
      .patch('/api/routines/r11')
      .send(payload)
      .expect(200);

    const set = res.body.days[0].exercises[0].sets[0];
    expect(set).toEqual(
      expect.objectContaining({
        setNumber: 1,
        repType: 'RANGE',
        reps: null,
        minReps: 5,
        maxReps: 7,
        weight: 100,
      }),
    );
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/routines parses boolean query filters and calls service with them', async () => {
    (routinesServiceMock.findAll as any).mockResolvedValue([]);

    await request(app.getHttpServer())
      .get('/api/routines')
      .query({ isFavorite: 'true', isCompleted: 'false' })
      .expect(200)
      .expect([]);

    expect(routinesServiceMock.findAll).toHaveBeenCalledWith('u1', {
      isFavorite: true,
      isCompleted: false,
    });
  });

  it('GET /api/routines without filters calls service with undefined filter', async () => {
    (routinesServiceMock.findAll as any).mockResolvedValue([]);

    await request(app.getHttpServer())
      .get('/api/routines')
      .expect(200)
      .expect([]);

    expect(routinesServiceMock.findAll).toHaveBeenCalledWith('u1', {} as any);
  });

  it('POST /api/routines returns 400 when FIXED set is missing reps', async () => {
    const payload: any = {
      name: 'r',
      isPeriodized: false,
      days: [
        {
          dayOfWeek: 1,
          order: 0,
          exercises: [
            {
              exerciseId: 'e1',
              order: 0,
              restSeconds: 60,
              sets: [{ setNumber: 1, repType: 'FIXED' }],
            },
          ],
        },
      ],
    };

    await request(app.getHttpServer())
      .post('/api/routines')
      .send(payload)
      .expect(400);

    expect(routinesServiceMock.create).not.toHaveBeenCalled();
  });

  it('PATCH /api/routines/:id returns 400 when RANGE set is missing min/max', async () => {
    const payload: any = {
      name: 'r',
      isPeriodized: false,
      days: [
        {
          dayOfWeek: 1,
          order: 0,
          exercises: [
            {
              exerciseId: 'e1',
              order: 0,
              restSeconds: 60,
              sets: [{ setNumber: 1, repType: 'RANGE' }],
            },
          ],
        },
      ],
    };

    await request(app.getHttpServer())
      .patch('/api/routines/r1')
      .send(payload)
      .expect(400);

    expect(routinesServiceMock.update).not.toHaveBeenCalled();
  });

  it('POST /api/routines returns 400 when RANGE set has minReps > maxReps', async () => {
    (routinesServiceMock.create as any).mockImplementation(() => {
      throw new BadRequestException(
        'minReps must be less than or equal to maxReps',
      );
    });

    const payload: any = {
      name: 'r',
      isPeriodized: false,
      days: [
        {
          dayOfWeek: 1,
          order: 0,
          exercises: [
            {
              exerciseId: 'e1',
              order: 0,
              restSeconds: 60,
              sets: [
                { setNumber: 1, repType: 'RANGE', minReps: 10, maxReps: 8 },
              ],
            },
          ],
        },
      ],
    };

    await request(app.getHttpServer())
      .post('/api/routines')
      .send(payload)
      .expect(400);

    expect(routinesServiceMock.create).toHaveBeenCalled();
  });

  it('PATCH /api/routines/:id returns 400 when RANGE set has minReps > maxReps', async () => {
    (routinesServiceMock.update as any).mockImplementation(() => {
      throw new BadRequestException(
        'minReps must be less than or equal to maxReps',
      );
    });

    const payload: any = {
      name: 'r',
      isPeriodized: false,
      days: [
        {
          dayOfWeek: 1,
          order: 0,
          exercises: [
            {
              exerciseId: 'e1',
              order: 0,
              restSeconds: 60,
              sets: [
                { setNumber: 1, repType: 'RANGE', minReps: 10, maxReps: 8 },
              ],
            },
          ],
        },
      ],
    };

    await request(app.getHttpServer())
      .patch('/api/routines/r1')
      .send(payload)
      .expect(400);

    expect(routinesServiceMock.update).toHaveBeenCalled();
  });

  it('GET /api/routines/favorites calls findFavorites', async () => {
    (routinesServiceMock.findFavorites as any).mockResolvedValue([
      { id: 'r1' },
    ]);

    await request(app.getHttpServer())
      .get('/api/routines/favorites')
      .expect(200)
      .expect([{ id: 'r1' }]);

    expect(routinesServiceMock.findFavorites).toHaveBeenCalledWith('u1');
  });

  it('GET /api/routines/favorites includes repType fields in sets', async () => {
    (routinesServiceMock.findFavorites as any).mockResolvedValue([
      {
        id: 'r1',
        days: [
          {
            id: 'd1',
            dayOfWeek: 1,
            order: 0,
            exercises: [
              {
                id: 're1',
                order: 0,
                restSeconds: 60,
                exercise: { id: 'e1', name: 'Bench Press' },
                sets: [
                  {
                    setNumber: 1,
                    repType: 'FIXED',
                    reps: 8,
                    minReps: null,
                    maxReps: null,
                    weight: 80,
                  },
                  {
                    setNumber: 2,
                    repType: 'RANGE',
                    reps: null,
                    minReps: 8,
                    maxReps: 10,
                    weight: 80,
                  },
                ],
              },
            ],
          },
        ],
      },
    ]);

    const res = await request(app.getHttpServer())
      .get('/api/routines/favorites')
      .expect(200);

    const set = res.body[0].days[0].exercises[0].sets[0];
    expect(set).toEqual(
      expect.objectContaining({
        setNumber: 1,
        repType: 'FIXED',
        reps: 8,
        minReps: null,
        maxReps: null,
        weight: 80,
      }),
    );
  });

  it('GET /api/routines/completed calls findCompleted', async () => {
    (routinesServiceMock.findCompleted as any).mockResolvedValue([
      { id: 'r2' },
    ]);

    await request(app.getHttpServer())
      .get('/api/routines/completed')
      .expect(200)
      .expect([{ id: 'r2' }]);

    expect(routinesServiceMock.findCompleted).toHaveBeenCalledWith('u1');
  });

  it('GET /api/routines/completed includes repType fields in sets', async () => {
    (routinesServiceMock.findCompleted as any).mockResolvedValue([
      {
        id: 'r2',
        days: [
          {
            id: 'd2',
            dayOfWeek: 2,
            order: 0,
            exercises: [
              {
                id: 're2',
                order: 0,
                restSeconds: 90,
                exercise: { id: 'e2', name: 'Squat' },
                sets: [
                  {
                    setNumber: 1,
                    repType: 'RANGE',
                    reps: null,
                    minReps: 5,
                    maxReps: 7,
                    weight: 100,
                  },
                ],
              },
            ],
          },
        ],
      },
    ]);

    const res = await request(app.getHttpServer())
      .get('/api/routines/completed')
      .expect(200);

    const set = res.body[0].days[0].exercises[0].sets[0];
    expect(set).toEqual(
      expect.objectContaining({
        setNumber: 1,
        repType: 'RANGE',
        reps: null,
        minReps: 5,
        maxReps: 7,
        weight: 100,
      }),
    );
  });

  it('PATCH /api/routines/:id/favorite toggles favorite', async () => {
    (routinesServiceMock.setFavorite as any).mockResolvedValue({
      id: 'r3',
      isFavorite: true,
    });

    await request(app.getHttpServer())
      .patch('/api/routines/r3/favorite')
      .send({ isFavorite: true })
      .expect(200)
      .expect({ id: 'r3', isFavorite: true });

    expect(routinesServiceMock.setFavorite).toHaveBeenCalledWith(
      'u1',
      'r3',
      true,
    );
  });

  it('PATCH /api/routines/:id/completed toggles completed', async () => {
    (routinesServiceMock.setCompleted as any).mockResolvedValue({
      id: 'r4',
      isCompleted: false,
    });

    await request(app.getHttpServer())
      .patch('/api/routines/r4/completed')
      .send({ isCompleted: false })
      .expect(200)
      .expect({ id: 'r4', isCompleted: false });

    expect(routinesServiceMock.setCompleted).toHaveBeenCalledWith(
      'u1',
      'r4',
      false,
    );
  });
});
