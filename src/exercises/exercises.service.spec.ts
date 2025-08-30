import { Test, TestingModule } from '@nestjs/testing';
import { ExercisesService } from './exercises.service';
import { DatabaseService } from '../database/database.service';

describe('ExercisesService', () => {
  let service: ExercisesService;
  let databaseService: DatabaseService;

  const mockExercises = [
    {
      id: '1',
      name: 'Bench Press',
      primaryMuscle: 'chest',
      equipment: 'barbell',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: '2',
      name: 'Squat',
      primaryMuscle: 'legs',
      equipment: 'barbell',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: '3',
      name: 'Deadlift',
      primaryMuscle: 'back',
      equipment: 'barbell',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];

  beforeEach(async () => {
    const mockDatabaseService = {
      exercise: {
        findMany: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExercisesService,
        {
          provide: DatabaseService,
          useValue: mockDatabaseService,
        },
      ],
    }).compile();

    service = module.get<ExercisesService>(ExercisesService);
    databaseService = module.get<DatabaseService>(DatabaseService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('should return all exercises ordered by name', async () => {
      jest.spyOn(databaseService.exercise, 'findMany').mockResolvedValue(mockExercises);

      const result = await service.findAll();

      expect(databaseService.exercise.findMany).toHaveBeenCalledWith({
        orderBy: { name: 'asc' },
      });
      expect(result).toEqual(mockExercises);
    });

    it('should return empty array when no exercises found', async () => {
      jest.spyOn(databaseService.exercise, 'findMany').mockResolvedValue([]);

      const result = await service.findAll();

      expect(databaseService.exercise.findMany).toHaveBeenCalledWith({
        orderBy: { name: 'asc' },
      });
      expect(result).toEqual([]);
    });

    it('should handle database errors', async () => {
      const dbError = new Error('Database connection failed');
      jest.spyOn(databaseService.exercise, 'findMany').mockRejectedValue(dbError);

      await expect(service.findAll()).rejects.toThrow('Database connection failed');
    });
  });
});
