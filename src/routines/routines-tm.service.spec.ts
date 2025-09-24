import { Test, TestingModule } from '@nestjs/testing'
import { HttpStatus } from '@nestjs/common'
import { DatabaseService } from '../database/database.service'
import { RoutinesService } from './routines.service'
import { WorkoutsService } from '../workouts/workouts.service'
import { CreateTmEventDto } from './dto/tm-adjustment.dto'
import { RoutineOwnershipException, TmEventNotAllowedException } from './exceptions/routine-exceptions'
import { RTF_WEEK_GOALS_CACHE } from '../cache/rtf-week-goals-cache.async'

describe('RoutinesService - TM Adjustments', () => {
	let service: RoutinesService
	let databaseService: DatabaseService
	let mockRoutine: any
	let mockUser: any

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			providers: [
				RoutinesService,
				{
					provide: DatabaseService,
					useValue: {
						routine: {
							findFirst: jest.fn()
						},
						tmAdjustment: {
							create: jest.fn(),
							findMany: jest.fn(),
							groupBy: jest.fn()
						},
						exercise: {
							findMany: jest.fn()
						}
					}
					},
					{ provide: WorkoutsService, useValue: { getRtFWeekGoals: jest.fn() } },
					{
						provide: RTF_WEEK_GOALS_CACHE,
						useValue: {
							get: jest.fn().mockResolvedValue(null),
							set: jest.fn().mockResolvedValue(undefined),
							delete: jest.fn().mockResolvedValue(undefined),
							invalidateRoutine: jest.fn().mockResolvedValue(undefined)
						}
					}
			]
		}).compile()

		service = module.get<RoutinesService>(RoutinesService)
		databaseService = module.get<DatabaseService>(DatabaseService)

		// Mock data
		mockUser = { id: 'user-123', email: 'test@example.com' }
		mockRoutine = {
			id: 'routine-123',
			userId: 'user-123',
			programStyle: 'STANDARD',
			days: [
				{
					exercises: [
						{ 
							id: 'routine-exercise-123',
							exerciseId: 'exercise-123',
							progressionScheme: 'PROGRAMMED_RTF'
						}
					]
				}
			]
		}
	})

	describe('createTmAdjustment', () => {
		const createTmEventDto: CreateTmEventDto = {
			exerciseId: 'exercise-123',
			weekNumber: 3,
			deltaKg: 2.5,
			preTmKg: 100,
			postTmKg: 102.5,
			reason: 'Completed all reps easily'
		}

		it('should create TM adjustment successfully', async () => {
			const mockAdjustment = {
				id: 'adjustment-123',
				...createTmEventDto,
				routineId: 'routine-123',
				style: 'STANDARD' as const,
				reason: createTmEventDto.reason || null,
				createdAt: new Date()
			}

			jest.spyOn(databaseService.routine, 'findFirst').mockResolvedValue(mockRoutine)
			jest.spyOn((databaseService as any).tmAdjustment, 'create').mockResolvedValue(mockAdjustment as any)

			const result = await service.createTmAdjustment(
				mockUser.id,
				mockRoutine.id,
				createTmEventDto
			)

			expect(result).toEqual({
				id: mockAdjustment.id,
				exerciseId: mockAdjustment.exerciseId,
				weekNumber: mockAdjustment.weekNumber,
				deltaKg: mockAdjustment.deltaKg,
				preTmKg: mockAdjustment.preTmKg,
				postTmKg: mockAdjustment.postTmKg,
				reason: mockAdjustment.reason,
				style: mockAdjustment.style,
				createdAt: mockAdjustment.createdAt
			})
		})

		it('should throw RoutineOwnershipException for non-existent routine', async () => {
			jest.spyOn(databaseService.routine, 'findFirst').mockResolvedValue(null)

			await expect(
				service.createTmAdjustment(mockUser.id, 'non-existent-routine', createTmEventDto)
			).rejects.toThrow('Routine not found, not accessible, or does not use RTF progression schemes')
		})

		it('should validate delta calculation', async () => {
			const invalidDto = {
				...createTmEventDto,
				deltaKg: 5,
				postTmKg: 102.5 // Should be 105
			}

			jest.spyOn(databaseService.routine, 'findFirst').mockResolvedValue(mockRoutine)

			await expect(
				service.createTmAdjustment(mockUser.id, mockRoutine.id, invalidDto)
			).rejects.toThrow('preTmKg + deltaKg must equal postTmKg')
		})

		it('should reject exercise not in routine', async () => {
			const routineWithoutExercise = {
				...mockRoutine,
				days: [{ exercises: [] }]
			}

			jest.spyOn(databaseService.routine, 'findFirst').mockResolvedValue(routineWithoutExercise)

			await expect(
				service.createTmAdjustment(mockUser.id, mockRoutine.id, createTmEventDto)
			).rejects.toThrow('Exercise not found in routine or does not use RTF progression schemes')
		})
	})

	describe('getTmAdjustments', () => {
		it('should return adjustments for authorized user', async () => {
			const mockAdjustments = [
				{
					id: 'adj-1',
					routineId: 'routine-123',
					exerciseId: 'exercise-123',
					weekNumber: 3,
					deltaKg: 2.5,
					preTmKg: 100,
					postTmKg: 102.5,
					reason: 'test',
					style: 'STANDARD' as const,
					createdAt: new Date()
				}
			]

			jest.spyOn(databaseService.routine, 'findFirst').mockResolvedValue(mockRoutine)
			jest.spyOn((databaseService as any).tmAdjustment, 'findMany').mockResolvedValue(mockAdjustments as any)

			const result = await service.getTmAdjustments(mockUser.id, mockRoutine.id)

			// The service should return adjustments without exposing routineId (since it's already in the context)
			const expectedResult = mockAdjustments.map(adj => {
				const { routineId, ...rest } = adj
				return rest
			})
			expect(result).toEqual(expectedResult)
			expect((databaseService as any).tmAdjustment.findMany).toHaveBeenCalledWith({
				where: { routineId: mockRoutine.id },
				orderBy: [
					{ weekNumber: 'desc' },
					{ createdAt: 'desc' }
				]
			})
		})

		it('should apply exercise filter', async () => {
			jest.spyOn(databaseService.routine, 'findFirst').mockResolvedValue(mockRoutine)
			jest.spyOn((databaseService as any).tmAdjustment, 'findMany').mockResolvedValue([] as any)

			await service.getTmAdjustments(mockUser.id, mockRoutine.id, 'exercise-123')

			expect((databaseService as any).tmAdjustment.findMany).toHaveBeenCalledWith({
				where: {
					routineId: mockRoutine.id,
					exerciseId: 'exercise-123'
				},
				orderBy: [
					{ weekNumber: 'desc' },
					{ createdAt: 'desc' }
				]
			})
		})
	})

	describe('getTmAdjustmentSummary', () => {
		it('should return summary statistics', async () => {
			const mockSummary = [
				{
					exerciseId: 'exercise-123',
					_count: { id: 3 },
					_sum: { deltaKg: 7.5 },
					_avg: { deltaKg: 2.5 },
					_max: { createdAt: new Date() }
				}
			]

			const mockExercises = [
				{ 
					id: 'exercise-123', 
					name: 'Bench Press',
					createdAt: new Date(),
					updatedAt: new Date(),
					primaryMuscles: [],
					secondaryMuscles: [],
					equipment: 'barbell'
				}
			]

			jest.spyOn(databaseService.routine, 'findFirst').mockResolvedValue(mockRoutine)
			jest.spyOn((databaseService as any).tmAdjustment, 'groupBy').mockResolvedValue(mockSummary as any)
			jest.spyOn(databaseService.exercise, 'findMany').mockResolvedValue(mockExercises as any)

			const result = await service.getTmAdjustmentSummary(mockUser.id, mockRoutine.id)

			expect(result).toEqual([
				{
					exerciseId: 'exercise-123',
					exerciseName: 'Bench Press',
					events: 3,
					netDelta: 7.5,
					avgChange: 2.5,
					lastEventAt: mockSummary[0]._max.createdAt
				}
			])
		})
	})
})