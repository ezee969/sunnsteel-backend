import { Test, TestingModule } from '@nestjs/testing';
import { ExercisesController } from './exercises.controller';
import { ExercisesService } from './exercises.service';
import { SupabaseJwtGuard } from '../auth/guards/supabase-jwt.guard';
import { MuscleGroup } from '@prisma/client';

describe('ExercisesController', () => {
  let controller: ExercisesController;
  let exercisesService: ExercisesService;

  const mockExercises = [
    {
      id: '1',
      name: 'Bench Press',
      primaryMuscles: [MuscleGroup.PECTORAL],
      secondaryMuscles: [MuscleGroup.ANTERIOR_DELTOIDS, MuscleGroup.TRICEPS],
      equipment: 'barbell',
      progressionScheme: 'DYNAMIC' as const,
      minWeightIncrement: 2.5,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: '2',
      name: 'Squat',
      primaryMuscles: [MuscleGroup.QUADRICEPS],
      secondaryMuscles: [MuscleGroup.GLUTES, MuscleGroup.HAMSTRINGS],
      equipment: 'barbell',
      progressionScheme: 'DYNAMIC' as const,
      minWeightIncrement: 2.5,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];

  beforeEach(async () => {
    const mockExercisesService = {
      findAll: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ExercisesController],
      providers: [
        {
          provide: ExercisesService,
          useValue: mockExercisesService,
        },
      ],
    })
      .overrideGuard(SupabaseJwtGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .compile();

    controller = module.get<ExercisesController>(ExercisesController);
    exercisesService = module.get<ExercisesService>(ExercisesService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('findAll', () => {
    it('should return an array of exercises', async () => {
      jest.spyOn(exercisesService, 'findAll').mockResolvedValue(mockExercises);

      const result = await controller.findAll();

      expect(exercisesService.findAll).toHaveBeenCalled();
      expect(result).toEqual(mockExercises);
    });

    it('should return empty array when no exercises found', async () => {
      jest.spyOn(exercisesService, 'findAll').mockResolvedValue([]);

      const result = await controller.findAll();

      expect(exercisesService.findAll).toHaveBeenCalled();
      expect(result).toEqual([]);
    });
  });
});
