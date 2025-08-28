import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { WorkoutsService } from './workouts.service';
import { DatabaseService } from '../database/database.service';
import { FinishStatusDto } from './dto/finish-workout.dto';
import { WorkoutSessionStatus } from '@prisma/client';

const dbMock = {
  workoutSession: {
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  routineDay: {
    findFirst: jest.fn(),
  },
  routineExercise: {
    findFirst: jest.fn(),
  },
  setLog: {
    upsert: jest.fn(),
  },
} as unknown as jest.Mocked<DatabaseService>;

describe('WorkoutsService', () => {
  let service: WorkoutsService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkoutsService,
        {
          provide: DatabaseService,
          useValue: dbMock,
        },
      ],
    }).compile();

    service = module.get<WorkoutsService>(WorkoutsService);
  });

  describe('getActiveSession', () => {
    it('returns active session if exists', async () => {
      const active = { id: 's1', status: WorkoutSessionStatus.IN_PROGRESS };
      (dbMock.workoutSession.findFirst as any).mockResolvedValue(active);

      const result = await service.getActiveSession('u1');

      expect(result).toBe(active);
      expect(dbMock.workoutSession.findFirst).toHaveBeenCalled();
    });

    it('queries with orderBy startedAt desc to fetch most recent', async () => {
      (dbMock.workoutSession.findFirst as any).mockResolvedValue(null);

      await service.getActiveSession('u1');

      expect(dbMock.workoutSession.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: 'u1' }),
          orderBy: { startedAt: 'desc' },
        }),
      );
    });
  });

  describe('startSession', () => {
    it('throws if an active session exists', async () => {
      // Spy getActiveSession to simplify
      jest
        .spyOn(service, 'getActiveSession')
        .mockResolvedValue({ id: 's1' } as any);

      await expect(
        service.startSession('u1', { routineId: 'r1', routineDayId: 'd1' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws NotFound if routine day not found/belongs to user', async () => {
      jest.spyOn(service, 'getActiveSession').mockResolvedValue(null);
      (dbMock.routineDay.findFirst as any).mockResolvedValue(null);

      await expect(
        service.startSession('u1', { routineId: 'r1', routineDayId: 'd1' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('creates a new session when valid', async () => {
      jest.spyOn(service, 'getActiveSession').mockResolvedValue(null);
      (dbMock.routineDay.findFirst as any).mockResolvedValue({
        id: 'd1',
        routineId: 'r1',
      });
      const created = { id: 's1', status: WorkoutSessionStatus.IN_PROGRESS };
      (dbMock.workoutSession.create as any).mockResolvedValue(created);

      const res = await service.startSession('u1', {
        routineId: 'r1',
        routineDayId: 'd1',
        notes: 'go!',
      });

      expect(res).toBe(created);
      expect(dbMock.workoutSession.create).toHaveBeenCalled();
    });
  });

  describe('finishSession', () => {
    it('throws NotFound when session not found', async () => {
      (dbMock.workoutSession.findFirst as any).mockResolvedValue(null);

      await expect(
        service.finishSession('u1', 's1', {
          status: FinishStatusDto.COMPLETED,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws BadRequest when session not IN_PROGRESS', async () => {
      (dbMock.workoutSession.findFirst as any).mockResolvedValue({
        id: 's1',
        startedAt: new Date(),
        status: WorkoutSessionStatus.COMPLETED,
      });

      await expect(
        service.finishSession('u1', 's1', {
          status: FinishStatusDto.COMPLETED,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('updates session as COMPLETED', async () => {
      const startedAt = new Date(Date.now() - 1000);
      (dbMock.workoutSession.findFirst as any).mockResolvedValue({
        id: 's1',
        startedAt,
        status: WorkoutSessionStatus.IN_PROGRESS,
      });
      const updated = { id: 's1', status: WorkoutSessionStatus.COMPLETED };
      (dbMock.workoutSession.update as any).mockResolvedValue(updated);

      const res = await service.finishSession('u1', 's1', {
        status: FinishStatusDto.COMPLETED,
        notes: 'done',
      });

      expect(res).toBe(updated);
      expect(dbMock.workoutSession.update).toHaveBeenCalled();
    });

    it('updates session as ABORTED and sets duration', async () => {
      const startedAt = new Date(Date.now() - 5000);
      (dbMock.workoutSession.findFirst as any).mockResolvedValue({
        id: 's2',
        startedAt,
        status: WorkoutSessionStatus.IN_PROGRESS,
      });
      (dbMock.workoutSession.update as any).mockImplementation(
        (args: any) => args,
      );

      const res: any = await service.finishSession('u1', 's2', {
        status: FinishStatusDto.ABORTED,
        notes: 'stopped',
      });

      expect(res.data.status).toBe(WorkoutSessionStatus.ABORTED);
      expect(typeof res.data.durationSec).toBe('number');
      expect(res.data.endedAt).toBeInstanceOf(Date);
      expect(res.data.notes).toBe('stopped');
    });
  });

  describe('upsertSetLog', () => {
    it('throws NotFound when session missing', async () => {
      (dbMock.workoutSession.findFirst as any).mockResolvedValue(null);

      await expect(
        service.upsertSetLog('u1', 's1', {
          routineExerciseId: 're1',
          exerciseId: 'e1',
          setNumber: 1,
        } as any),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws BadRequest when session is not IN_PROGRESS', async () => {
      (dbMock.workoutSession.findFirst as any).mockResolvedValue({
        id: 's1',
        status: WorkoutSessionStatus.COMPLETED,
        routineDayId: 'd1',
      });

      await expect(
        service.upsertSetLog('u1', 's1', {
          routineExerciseId: 're1',
          exerciseId: 'e1',
          setNumber: 1,
        } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws BadRequest when routineExercise not in routineDay', async () => {
      (dbMock.workoutSession.findFirst as any).mockResolvedValue({
        id: 's1',
        status: WorkoutSessionStatus.IN_PROGRESS,
        routineDayId: 'd1',
      });
      (dbMock.routineExercise.findFirst as any).mockResolvedValue(null);

      await expect(
        service.upsertSetLog('u1', 's1', {
          routineExerciseId: 're1',
          exerciseId: 'e1',
          setNumber: 1,
        } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws BadRequest when exerciseId mismatch', async () => {
      (dbMock.workoutSession.findFirst as any).mockResolvedValue({
        id: 's1',
        status: WorkoutSessionStatus.IN_PROGRESS,
        routineDayId: 'd1',
      });
      (dbMock.routineExercise.findFirst as any).mockResolvedValue({
        id: 're1',
        exerciseId: 'e1',
      });

      await expect(
        service.upsertSetLog('u1', 's1', {
          routineExerciseId: 're1',
          exerciseId: 'e2',
          setNumber: 1,
        } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('upserts and returns set log on success', async () => {
      (dbMock.workoutSession.findFirst as any).mockResolvedValue({
        id: 's1',
        status: WorkoutSessionStatus.IN_PROGRESS,
        routineDayId: 'd1',
      });
      (dbMock.routineExercise.findFirst as any).mockResolvedValue({
        id: 're1',
        exerciseId: 'e1',
      });
      const upserted = { id: 'log1', setNumber: 1 };
      (dbMock.setLog.upsert as any).mockResolvedValue(upserted);

      const res = await service.upsertSetLog('u1', 's1', {
        routineExerciseId: 're1',
        exerciseId: 'e1',
        setNumber: 1,
        reps: 8,
        weight: 100,
        rpe: 8,
        isCompleted: true,
      } as any);

      expect(res).toBe(upserted);
      expect(dbMock.setLog.upsert).toHaveBeenCalled();
    });

    it('sets completedAt on update when isCompleted = true', async () => {
      (dbMock.workoutSession.findFirst as any).mockResolvedValue({
        id: 's3',
        status: WorkoutSessionStatus.IN_PROGRESS,
        routineDayId: 'd1',
      });
      (dbMock.routineExercise.findFirst as any).mockResolvedValue({
        id: 're2',
        exerciseId: 'e2',
      });
      (dbMock.setLog.upsert as any).mockResolvedValue({ id: 'log2' });

      await service.upsertSetLog('u1', 's3', {
        routineExerciseId: 're2',
        exerciseId: 'e2',
        setNumber: 2,
        isCompleted: true,
      } as any);

      const args = (dbMock.setLog.upsert as any).mock.calls[0][0];
      expect(args.update.isCompleted).toBe(true);
      expect(args.update.completedAt).toBeInstanceOf(Date);
    });

    it('unsets completedAt on update when isCompleted = false', async () => {
      (dbMock.workoutSession.findFirst as any).mockResolvedValue({
        id: 's3',
        status: WorkoutSessionStatus.IN_PROGRESS,
        routineDayId: 'd1',
      });
      (dbMock.routineExercise.findFirst as any).mockResolvedValue({
        id: 're2',
        exerciseId: 'e2',
      });
      (dbMock.setLog.upsert as any).mockResolvedValue({ id: 'log2' });

      await service.upsertSetLog('u1', 's3', {
        routineExerciseId: 're2',
        exerciseId: 'e2',
        setNumber: 2,
        isCompleted: false,
      } as any);

      const args = (dbMock.setLog.upsert as any).mock.calls[0][0];
      expect(args.update.isCompleted).toBe(false);
      expect(args.update.completedAt).toBeUndefined();
    });

    it('does not touch completedAt on update when isCompleted = undefined', async () => {
      (dbMock.workoutSession.findFirst as any).mockResolvedValue({
        id: 's4',
        status: WorkoutSessionStatus.IN_PROGRESS,
        routineDayId: 'd1',
      });
      (dbMock.routineExercise.findFirst as any).mockResolvedValue({
        id: 're3',
        exerciseId: 'e3',
      });
      (dbMock.setLog.upsert as any).mockResolvedValue({ id: 'log3' });

      await service.upsertSetLog('u1', 's4', {
        routineExerciseId: 're3',
        exerciseId: 'e3',
        setNumber: 3,
      } as any);

      const args = (dbMock.setLog.upsert as any).mock.calls[0][0];
      expect(args.update.isCompleted).toBeUndefined();
      expect(args.update.completedAt).toBeUndefined();
    });
  });

  describe('getSessionById', () => {
    it('throws NotFound when session does not exist', async () => {
      (dbMock.workoutSession.findFirst as any).mockResolvedValue(null);

      await expect(
        service.getSessionById('u1', 'missing'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('select includes setLogs ordered by routineExerciseId asc then setNumber asc', async () => {
      (dbMock.workoutSession.findFirst as any).mockResolvedValue({
        id: 's1',
        setLogs: [],
      });

      await service.getSessionById('u1', 's1');

      const args = (dbMock.workoutSession.findFirst as any).mock.calls[0][0];
      expect(args.select.setLogs.orderBy).toEqual([
        { routineExerciseId: 'asc' },
        { setNumber: 'asc' },
      ]);
    });
  });

  describe('upsertSetLog (create path completedAt)', () => {
    beforeEach(() => {
      (dbMock.workoutSession.findFirst as any).mockResolvedValue({
        id: 's1',
        status: WorkoutSessionStatus.IN_PROGRESS,
        routineDayId: 'd1',
      });
      (dbMock.routineExercise.findFirst as any).mockResolvedValue({
        id: 're1',
        exerciseId: 'e1',
      });
      (dbMock.setLog.upsert as any).mockResolvedValue({ id: 'logc' });
    });

    it('sets create.completedAt when isCompleted = true', async () => {
      await service.upsertSetLog('u1', 's1', {
        routineExerciseId: 're1',
        exerciseId: 'e1',
        setNumber: 1,
        isCompleted: true,
      } as any);

      const args = (dbMock.setLog.upsert as any).mock.calls[0][0];
      expect(args.create.isCompleted).toBe(true);
      expect(args.create.completedAt).toBeInstanceOf(Date);
    });

    it('does not set create.completedAt when isCompleted = false', async () => {
      await service.upsertSetLog('u1', 's1', {
        routineExerciseId: 're1',
        exerciseId: 'e1',
        setNumber: 1,
        isCompleted: false,
      } as any);

      const args = (dbMock.setLog.upsert as any).mock.calls[0][0];
      expect(args.create.isCompleted).toBe(false);
      expect(args.create.completedAt).toBeUndefined();
    });
  });
});
