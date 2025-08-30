import { Test, TestingModule } from '@nestjs/testing';
import { ExercisesService } from './exercises.service';
import { DatabaseService } from '../database/database.service';
import { MuscleGroup } from '@prisma/client';

describe('ExercisesService', () => {
  let service: ExercisesService;
  let databaseService: DatabaseService;

  const mockExercises = [
    {
      id: '1',
      name: 'Bench Press',
      primaryMuscles: [MuscleGroup.PECTORAL],
      secondaryMuscles: [MuscleGroup.ANTERIOR_DELTOIDS, MuscleGroup.TRICEPS],
      equipment: 'barbell',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: '2',
      name: 'Squat',
      primaryMuscles: [MuscleGroup.QUADRICEPS, MuscleGroup.GLUTES],
      secondaryMuscles: [MuscleGroup.HAMSTRINGS, MuscleGroup.CORE],
      equipment: 'barbell',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: '3',
      name: 'Deadlift',
      primaryMuscles: [MuscleGroup.ERECTOR_SPINAE, MuscleGroup.GLUTES],
      secondaryMuscles: [MuscleGroup.HAMSTRINGS, MuscleGroup.LATISSIMUS_DORSI],
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
      // Mock unsorted exercises to verify sorting behavior
      const unsortedExercises = [
        mockExercises[1],
        mockExercises[2],
        mockExercises[0],
      ]; // Squat, Deadlift, Bench Press
      jest
        .spyOn(databaseService.exercise, 'findMany')
        .mockResolvedValue(unsortedExercises);

      const result = await service.findAll();

      expect(databaseService.exercise.findMany).toHaveBeenCalledWith();
      // Should be sorted: Bench Press, Deadlift, Squat
      expect(result).toEqual([
        mockExercises[0],
        mockExercises[2],
        mockExercises[1],
      ]);
    });

    it('should return empty array when no exercises found', async () => {
      jest.spyOn(databaseService.exercise, 'findMany').mockResolvedValue([]);

      const result = await service.findAll();

      expect(databaseService.exercise.findMany).toHaveBeenCalledWith();
      expect(result).toEqual([]);
    });

    it('should handle database errors', async () => {
      const dbError = new Error('Database connection failed');
      jest
        .spyOn(databaseService.exercise, 'findMany')
        .mockRejectedValue(dbError);

      await expect(service.findAll()).rejects.toThrow(
        'Database connection failed',
      );
    });
  });
});
