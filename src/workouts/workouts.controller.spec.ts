import { Test, TestingModule } from '@nestjs/testing';
import { WorkoutsController } from './workouts.controller';
import { WorkoutsService } from './workouts.service';
import { FinishStatusDto } from './dto/finish-workout.dto';

const serviceMock = {
  startSession: jest.fn(),
  finishSession: jest.fn(),
  getActiveSession: jest.fn(),
  getSessionById: jest.fn(),
  upsertSetLog: jest.fn(),
};

describe('WorkoutsController', () => {
  let controller: WorkoutsController;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [WorkoutsController],
      providers: [{ provide: WorkoutsService, useValue: serviceMock }],
    }).compile();

    controller = module.get<WorkoutsController>(WorkoutsController);
  });

  const req = { user: { id: 'u1', email: 'u@example.com' } } as any;

  it('start calls service with userId and dto', async () => {
    const dto = { routineId: 'r1', routineDayId: 'd1', notes: 'go' } as any;
    serviceMock.startSession.mockResolvedValue({ id: 's1' });

    const res = await controller.start(req, dto);

    expect(serviceMock.startSession).toHaveBeenCalledWith('u1', dto);
    expect(res).toEqual({ id: 's1' });
  });

  it('finish calls service with userId, id and dto', async () => {
    const dto = { status: FinishStatusDto.COMPLETED, notes: 'ok' } as any;
    serviceMock.finishSession.mockResolvedValue({ id: 's1' });

    const res = await controller.finish(req, 's1', dto);

    expect(serviceMock.finishSession).toHaveBeenCalledWith('u1', 's1', dto);
    expect(res).toEqual({ id: 's1' });
  });

  it('getActive calls service with userId', async () => {
    serviceMock.getActiveSession.mockResolvedValue(null);

    const res = await controller.getActive(req);

    expect(serviceMock.getActiveSession).toHaveBeenCalledWith('u1');
    expect(res).toBeNull();
  });

  it('getById calls service with userId and id', async () => {
    serviceMock.getSessionById.mockResolvedValue({ id: 's2' });

    const res = await controller.getById(req, 's2');

    expect(serviceMock.getSessionById).toHaveBeenCalledWith('u1', 's2');
    expect(res).toEqual({ id: 's2' });
  });

  it('upsertSetLog calls service with userId, sessionId and dto', async () => {
    const dto = {
      routineExerciseId: 're1',
      exerciseId: 'e1',
      setNumber: 1,
    } as any;
    serviceMock.upsertSetLog.mockResolvedValue({ id: 'log1' });

    const res = await controller.upsertSetLog(req, 's3', dto);

    expect(serviceMock.upsertSetLog).toHaveBeenCalledWith('u1', 's3', dto);
    expect(res).toEqual({ id: 'log1' });
  });
});
