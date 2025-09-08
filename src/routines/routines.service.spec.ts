import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { RoutinesService } from './routines.service';
import { DatabaseService } from '../database/database.service';

const makeDbMock = () => {
  const routine = {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
  const routineDay = {
    deleteMany: jest.fn(),
  };
  const setLog = {
    deleteMany: jest.fn(),
  };
  const db = {
    routine,
    routineDay,
    setLog,
    $transaction: jest.fn(async (cb: any) =>
      cb({ routine, routineDay, setLog }),
    ),
  } as unknown as jest.Mocked<DatabaseService>;

  return db;
};

describe('RoutinesService', () => {
  let service: RoutinesService;
  let dbMock: jest.Mocked<DatabaseService>;

  beforeEach(async () => {
    jest.clearAllMocks();
    dbMock = makeDbMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RoutinesService,
        { provide: DatabaseService, useValue: dbMock },
      ],
    }).compile();

    service = module.get<RoutinesService>(RoutinesService);
  });

  describe('RtF program start week & end date computation', () => {
    const monday = '2025-01-06'; // Monday in UTC
    const tz = 'UTC';

    const ymd = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;

    it('create: clamps startWeek to 18 when deloads=false and startWeek=21; endDate = start + 6 days', async () => {
      (dbMock.routine.create as any).mockResolvedValue({ id: 'r1' });
      const dto: any = {
        name: 'r',
        description: 'd',
        isPeriodized: false,
        programWithDeloads: false, // 18 weeks
        programStartDate: monday,
        programTimezone: tz,
        programStartWeek: 21, // should clamp to 18
        days: [
          {
            dayOfWeek: 1, // Monday
            order: 0,
            exercises: [
              {
                exerciseId: 'e1',
                order: 0,
                restSeconds: 60,
                sets: [{ setNumber: 1, repType: 'FIXED', reps: 8 }],
                progressionScheme: 'PROGRAMMED_RTF',
                programTMKg: 100,
                programRoundingKg: 2.5,
              },
            ],
          },
        ],
      };

      await service.create('u1', dto);

      const args = (dbMock.routine.create as any).mock.calls[0][0];
      expect(args.data.programDurationWeeks).toBe(18);
      expect(args.data.programStartWeek).toBe(18);
      const expectedEnd = new Date(Date.UTC(2025, 0, 6));
      expectedEnd.setUTCDate(expectedEnd.getUTCDate() + 6); // remainingWeeks=1 → 6 days
      expect(ymd(args.data.programEndDate)).toBe(ymd(expectedEnd));
    });

    it('create: clamps startWeek upper bound to 21 when deloads=true and startWeek=25; endDate = start + 6 days', async () => {
      (dbMock.routine.create as any).mockResolvedValue({ id: 'r1' });
      const dto: any = {
        name: 'r',
        description: 'd',
        isPeriodized: false,
        programWithDeloads: true, // 21 weeks
        programStartDate: monday,
        programTimezone: tz,
        programStartWeek: 25, // should clamp to 21
        days: [
          {
            dayOfWeek: 1,
            order: 0,
            exercises: [
              {
                exerciseId: 'e1',
                order: 0,
                restSeconds: 60,
                sets: [{ setNumber: 1, repType: 'FIXED', reps: 8 }],
                progressionScheme: 'PROGRAMMED_RTF',
                programTMKg: 100,
                programRoundingKg: 2.5,
              },
            ],
          },
        ],
      };

      await service.create('u1', dto);

      const args = (dbMock.routine.create as any).mock.calls[0][0];
      expect(args.data.programDurationWeeks).toBe(21);
      expect(args.data.programStartWeek).toBe(21);
      const expectedEnd = new Date(Date.UTC(2025, 0, 6));
      expectedEnd.setUTCDate(expectedEnd.getUTCDate() + 6);
      expect(ymd(args.data.programEndDate)).toBe(ymd(expectedEnd));
    });

    it('create: defaults startWeek to 1 when omitted; endDate = start + (weeks*7 - 1) days', async () => {
      (dbMock.routine.create as any).mockResolvedValue({ id: 'r1' });
      const dto: any = {
        name: 'r',
        description: 'd',
        isPeriodized: false,
        programWithDeloads: true, // 21
        programStartDate: monday,
        programTimezone: tz,
        days: [
          {
            dayOfWeek: 1,
            order: 0,
            exercises: [
              {
                exerciseId: 'e1',
                order: 0,
                restSeconds: 60,
                sets: [{ setNumber: 1, repType: 'FIXED', reps: 8 }],
                progressionScheme: 'PROGRAMMED_RTF',
                programTMKg: 100,
                programRoundingKg: 2.5,
              },
            ],
          },
        ],
      };

      await service.create('u1', dto);

      const args = (dbMock.routine.create as any).mock.calls[0][0];
      expect(args.data.programStartWeek).toBe(1);
      const expectedEnd = new Date(Date.UTC(2025, 0, 6));
      expectedEnd.setUTCDate(expectedEnd.getUTCDate() + (21 * 7 - 1));
      expect(ymd(args.data.programEndDate)).toBe(ymd(expectedEnd));
    });

    it('update: recomputes endDate when programStartWeek provided', async () => {
      (dbMock.routine.findFirst as any).mockResolvedValue({
        id: 'r1',
        programWithDeloads: true,
        programStartDate: new Date('2025-01-06T00:00:00.000Z'),
        programEndDate: new Date('2025-06-01T00:00:00.000Z'),
      });
      (dbMock.routineDay.deleteMany as any).mockResolvedValue({ count: 1 });
      (dbMock.routine.update as any).mockResolvedValue({ id: 'r1' });
      const dto: any = {
        name: 'r',
        description: 'd',
        isPeriodized: false,
        programWithDeloads: true, // 21
        programStartDate: monday,
        programTimezone: tz,
        programStartWeek: 9, // remaining = 13 → totalDays = 90
        days: [
          {
            dayOfWeek: 1,
            order: 0,
            exercises: [
              {
                exerciseId: 'e1',
                order: 0,
                restSeconds: 60,
                sets: [{ setNumber: 1, repType: 'FIXED', reps: 8 }],
                progressionScheme: 'PROGRAMMED_RTF',
                programTMKg: 100,
                programRoundingKg: 2.5,
              },
            ],
          },
        ],
      };

      await service.update('u1', 'r1', dto);

      const args = (dbMock.routine.update as any).mock.calls[0][0];
      const expectedEnd = new Date(Date.UTC(2025, 0, 6));
      expectedEnd.setUTCDate(expectedEnd.getUTCDate() + (13 * 7 - 1));
      expect(ymd(args.data.programEndDate)).toBe(ymd(expectedEnd));
    });

    it('update: preserves existing endDate when base fields unchanged and no startWeek provided', async () => {
      const existingEnd = new Date('2025-06-01T00:00:00.000Z');
      (dbMock.routine.findFirst as any).mockResolvedValue({
        id: 'r1',
        programWithDeloads: true,
        programStartDate: new Date('2025-01-06T00:00:00.000Z'),
        programEndDate: existingEnd,
      });
      (dbMock.routineDay.deleteMany as any).mockResolvedValue({ count: 1 });
      (dbMock.routine.update as any).mockResolvedValue({ id: 'r1' });

      const dto: any = {
        name: 'r',
        description: 'd',
        isPeriodized: false,
        programWithDeloads: true,
        programStartDate: monday,
        programTimezone: tz,
        days: [
          {
            dayOfWeek: 1,
            order: 0,
            exercises: [
              {
                exerciseId: 'e1',
                order: 0,
                restSeconds: 60,
                sets: [{ setNumber: 1, repType: 'FIXED', reps: 8 }],
                progressionScheme: 'PROGRAMMED_RTF',
                programTMKg: 100,
                programRoundingKg: 2.5,
              },
            ],
          },
        ],
      };

      await service.update('u1', 'r1', dto);

      const args = (dbMock.routine.update as any).mock.calls[0][0];
      expect(ymd(args.data.programEndDate)).toBe(ymd(existingEnd));
    });
  });

  describe('create validations and selects', () => {
    it('throws BadRequest when FIXED set is missing reps', async () => {
      const dto: any = {
        name: 'r',
        description: 'd',
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

      await expect(service.create('u1', dto)).rejects.toThrow(
        'For FIXED repType, reps is required',
      );
      expect(dbMock.routine.create).not.toHaveBeenCalled();
    });

    it('throws BadRequest when RANGE set is missing min/max', async () => {
      const dto: any = {
        name: 'r',
        description: 'd',
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

      await expect(service.create('u1', dto)).rejects.toThrow(
        'For RANGE repType, minReps and maxReps are required',
      );
      expect(dbMock.routine.create).not.toHaveBeenCalled();
    });

    it('calls create with select including rep fields', async () => {
      (dbMock.routine.create as any).mockResolvedValue({ id: 'r1' });
      const dto: any = {
        name: 'r',
        description: 'd',
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

      await service.create('u1', dto);

      expect(dbMock.routine.create).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.objectContaining({
            days: expect.objectContaining({
              select: expect.objectContaining({
                exercises: expect.objectContaining({
                  select: expect.objectContaining({
                    sets: expect.objectContaining({
                      select: {
                        setNumber: true,
                        repType: true,
                        reps: true,
                        minReps: true,
                        maxReps: true,
                        weight: true,
                      },
                    }),
                  }),
                }),
              }),
            }),
          }),
        }),
      );
    });

    it('maps FIXED set into data with repType and reps', async () => {
      (dbMock.routine.create as any).mockResolvedValue({ id: 'r1' });
      const dto: any = {
        name: 'r',
        description: 'd',
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

      await service.create('u1', dto);

      expect(dbMock.routine.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            days: expect.objectContaining({
              create: expect.arrayContaining([
                expect.objectContaining({
                  exercises: expect.objectContaining({
                    create: expect.arrayContaining([
                      expect.objectContaining({
                        sets: expect.objectContaining({
                          create: expect.arrayContaining([
                            expect.objectContaining({
                              repType: 'FIXED',
                              reps: 8,
                              weight: 80,
                            }),
                          ]),
                        }),
                      }),
                    ]),
                  }),
                }),
              ]),
            }),
          }),
        }),
      );
    });
  });

  describe('update validations and selects', () => {
    it('throws BadRequest when RANGE set has minReps > maxReps', async () => {
      (dbMock.routine.findFirst as any).mockResolvedValue({ id: 'r1' });
      (dbMock.routineDay.deleteMany as any).mockResolvedValue({ count: 1 });

      const dto: any = {
        name: 'r',
        description: 'd',
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

      await expect(service.update('u1', 'r1', dto)).rejects.toThrow(
        'minReps must be less than or equal to maxReps',
      );
      expect(dbMock.routine.update).not.toHaveBeenCalled();
    });

    it('calls update with select including rep fields', async () => {
      (dbMock.routine.findFirst as any).mockResolvedValue({ id: 'r1' });
      (dbMock.routineDay.deleteMany as any).mockResolvedValue({ count: 1 });
      (dbMock.routine.update as any).mockResolvedValue({ id: 'r1' });

      const dto: any = {
        name: 'r',
        description: 'd',
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

      await service.update('u1', 'r1', dto);

      expect(dbMock.routine.update).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.objectContaining({
            days: expect.objectContaining({
              select: expect.objectContaining({
                exercises: expect.objectContaining({
                  select: expect.objectContaining({
                    sets: expect.objectContaining({
                      select: {
                        setNumber: true,
                        repType: true,
                        reps: true,
                        minReps: true,
                        maxReps: true,
                        weight: true,
                      },
                    }),
                  }),
                }),
              }),
            }),
          }),
        }),
      );
    });
  });

  describe('findAll', () => {
    it('applies isFavorite filter when provided', async () => {
      (dbMock.routine.findMany as any).mockResolvedValue([]);

      await service.findAll('u1', { isFavorite: true });

      expect(dbMock.routine.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'u1', isFavorite: true },
          orderBy: { createdAt: 'desc' },
        }),
      );
    });

    it('applies both isFavorite and isCompleted filters', async () => {
      (dbMock.routine.findMany as any).mockResolvedValue([]);

      await service.findAll('u1', { isFavorite: false, isCompleted: true });

      expect(dbMock.routine.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'u1', isFavorite: false, isCompleted: true },
        }),
      );
    });
  });

  describe('findOne', () => {
    it('throws NotFound when routine is missing', async () => {
      (dbMock.routine.findFirst as any).mockResolvedValue(null);

      await expect(service.findOne('u1', 'r-missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('setFavorite', () => {
    it('throws NotFound when user does not own routine', async () => {
      (dbMock.routine.findFirst as any).mockResolvedValue(null);

      await expect(
        service.setFavorite('u1', 'r1', true),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('updates isFavorite when owned', async () => {
      (dbMock.routine.findFirst as any).mockResolvedValue({ id: 'r1' });
      const updated = { id: 'r1', isFavorite: true };
      (dbMock.routine.update as any).mockResolvedValue(updated);

      const res = await service.setFavorite('u1', 'r1', true);

      expect(res).toBe(updated);
      expect(dbMock.routine.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { isFavorite: true } }),
      );
    });
  });

  describe('setCompleted', () => {
    it('throws NotFound when user does not own routine', async () => {
      (dbMock.routine.findFirst as any).mockResolvedValue(null);

      await expect(
        service.setCompleted('u1', 'r1', true),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('updates isCompleted when owned', async () => {
      (dbMock.routine.findFirst as any).mockResolvedValue({ id: 'r1' });
      const updated = { id: 'r1', isCompleted: true };
      (dbMock.routine.update as any).mockResolvedValue(updated);

      const res = await service.setCompleted('u1', 'r1', true);

      expect(res).toBe(updated);
      expect(dbMock.routine.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { isCompleted: true } }),
      );
    });
  });

  describe('findFavorites', () => {
    it('returns only favorites ordered by createdAt desc', async () => {
      (dbMock.routine.findMany as any).mockResolvedValue([]);

      await service.findFavorites('u1');

      expect(dbMock.routine.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'u1', isFavorite: true },
          orderBy: { createdAt: 'desc' },
        }),
      );
    });

    it('selects repType-related fields on sets', async () => {
      (dbMock.routine.findMany as any).mockResolvedValue([]);

      await service.findFavorites('u1');

      expect(dbMock.routine.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.objectContaining({
            days: expect.objectContaining({
              select: expect.objectContaining({
                exercises: expect.objectContaining({
                  select: expect.objectContaining({
                    sets: expect.objectContaining({
                      select: {
                        setNumber: true,
                        repType: true,
                        reps: true,
                        minReps: true,
                        maxReps: true,
                        weight: true,
                      },
                    }),
                  }),
                }),
              }),
            }),
          }),
        }),
      );
    });
  });

  describe('findCompleted', () => {
    it('returns only completed ordered by createdAt desc', async () => {
      (dbMock.routine.findMany as any).mockResolvedValue([]);

      await service.findCompleted('u1');

      expect(dbMock.routine.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'u1', isCompleted: true },
          orderBy: { createdAt: 'desc' },
        }),
      );
    });

    it('selects repType-related fields on sets', async () => {
      (dbMock.routine.findMany as any).mockResolvedValue([]);

      await service.findCompleted('u1');

      expect(dbMock.routine.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.objectContaining({
            days: expect.objectContaining({
              select: expect.objectContaining({
                exercises: expect.objectContaining({
                  select: expect.objectContaining({
                    sets: expect.objectContaining({
                      select: {
                        setNumber: true,
                        repType: true,
                        reps: true,
                        minReps: true,
                        maxReps: true,
                        weight: true,
                      },
                    }),
                  }),
                }),
              }),
            }),
          }),
        }),
      );
    });
  });

  describe('update', () => {
    it('throws NotFound when routine not owned', async () => {
      (dbMock.routine.findFirst as any).mockResolvedValue(null);

      await expect(
        service.update('u1', 'r1', {
          name: 'n',
          description: 'd',
          days: [],
        } as any),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('deletes days and updates routine structure when owned', async () => {
      (dbMock.routine.findFirst as any).mockResolvedValue({ id: 'r1' });
      (dbMock.routineDay.deleteMany as any).mockResolvedValue({ count: 1 });
      const updated = { id: 'r1', name: 'n' };
      (dbMock.routine.update as any).mockResolvedValue(updated);

      const res = await service.update('u1', 'r1', {
        name: 'n',
        description: 'd',
        days: [],
      } as any);

      expect(res).toBe(updated);
      expect(dbMock.routineDay.deleteMany).toHaveBeenCalledWith({
        where: { routineId: 'r1' },
      });
      expect(dbMock.routine.update).toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('throws NotFound when routine not owned', async () => {
      (dbMock.routine.findFirst as any).mockResolvedValue(null);

      await expect(service.remove('u1', 'r1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('deletes routine when owned', async () => {
      (dbMock.routine.findFirst as any).mockResolvedValue({ id: 'r1' });
      const deleted = { id: 'r1' };
      (dbMock.routine.delete as any).mockResolvedValue(deleted);

      const res = await service.remove('u1', 'r1');

      expect(res).toBe(deleted);
      expect(dbMock.routine.delete).toHaveBeenCalledWith({
        where: { id: 'r1' },
      });
    });
  });
});
