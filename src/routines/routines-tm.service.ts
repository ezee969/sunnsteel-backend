import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common'
import { DatabaseService } from '../database/database.service'
import { CreateTmEventDto } from './dto/create-tm-event.dto'
import { GetTmAdjustmentsDto } from './dto/get-tm-adjustments.dto'
import { ProgramStyle } from '@prisma/client'

/**
 * Service responsible for Training Max (TM) adjustments in programmed RTF routines
 * 
 * Provides functionality for:
 * - Creating TM adjustment events with validation
 * - Retrieving adjustment history with filtering
 * - Generating adjustment summaries and analytics
 * - Ensuring user authorization for routine access
 */
@Injectable()
export class RoutinesTmService {
	constructor(private readonly databaseService: DatabaseService) {}

	/**
	 * Creates a new Training Max adjustment event
	 * 
	 * @param userId - ID of the user making the adjustment
	 * @param routineId - ID of the routine to adjust
	 * @param createTmEventDto - TM adjustment details
	 * @returns Promise<TmAdjustmentResponse> - Created adjustment record
	 * @throws NotFoundException - When routine doesn't exist or user lacks access
	 * @throws ForbiddenException - When exercise not in routine or delta out of range
	 */
	async createTmAdjustment(userId: string, routineId: string, createTmEventDto: CreateTmEventDto) {
		// Verify routine exists and user has access
		const routine = await this.databaseService.routine.findFirst({
			where: { id: routineId, userId },
			include: {
				days: {
					include: {
						exercises: {
							include: {
								exercise: { select: { id: true, name: true } }
							}
						}
					}
				}
			}
		})

		if (!routine) {
			throw new NotFoundException('Routine not found or access denied')
		}

		// Verify exercise exists in routine
		const exerciseInRoutine = routine.days
			.flatMap(day => day.exercises)
			.some(ex => ex.exerciseId === createTmEventDto.exerciseId)

		if (!exerciseInRoutine) {
			throw new ForbiddenException('Exercise not found in this routine')
		}

		// Create TM adjustment record
		const adjustment = await (this.databaseService as any).tmAdjustment.create({
			data: {
				routineId,
				exerciseId: createTmEventDto.exerciseId,
				weekNumber: createTmEventDto.weekNumber,
				deltaKg: createTmEventDto.deltaKg,
				preTmKg: createTmEventDto.preTmKg,
				postTmKg: createTmEventDto.postTmKg,
				reason: createTmEventDto.reason || null,
				style: routine.programStyle as ProgramStyle || null
			}
		})

		return adjustment
	}

	/**
	 * Retrieves TM adjustments for a routine with optional filtering
	 * 
	 * @param userId - ID of the requesting user
	 * @param routineId - ID of the routine
	 * @param exerciseId - Optional exercise filter
	 * @returns Promise<TmAdjustment[]> - List of adjustment records
	 * @throws NotFoundException - When routine doesn't exist or user lacks access
	 */
	async getTmAdjustments(userId: string, routineId: string, exerciseId?: string) {
		// Verify routine access
		const routine = await this.databaseService.routine.findFirst({
			where: { id: routineId, userId }
		})

		if (!routine) {
			throw new NotFoundException('Routine not found or access denied')
		}

		// Build filter conditions
		const whereClause: any = { routineId }
		if (exerciseId) {
			whereClause.exerciseId = exerciseId
		}

		// Retrieve adjustments with sorting
		const adjustments = await (this.databaseService as any).tmAdjustment.findMany({
			where: whereClause,
			orderBy: { createdAt: 'desc' }
		})

		return adjustments
	}

	/**
	 * Generates TM adjustment summary statistics for a routine
	 * 
	 * @param userId - ID of the requesting user
	 * @param routineId - ID of the routine
	 * @returns Promise<TmAdjustmentSummary[]> - Summary stats per exercise
	 * @throws NotFoundException - When routine doesn't exist or user lacks access
	 */
	async getTmAdjustmentSummary(userId: string, routineId: string) {
		// Verify routine access
		const routine = await this.databaseService.routine.findFirst({
			where: { id: routineId, userId }
		})

		if (!routine) {
			throw new NotFoundException('Routine not found or access denied')
		}

		// Aggregate adjustment statistics by exercise
		const summary = await (this.databaseService as any).tmAdjustment.groupBy({
			by: ['exerciseId'],
			where: { routineId },
			_count: { id: true },
			_sum: { deltaKg: true },
			_avg: { deltaKg: true },
			_max: { createdAt: true }
		})

		// Get exercise names for summary
		const exerciseIds = summary.map(s => s.exerciseId)
		const exercises = await this.databaseService.exercise.findMany({
			where: { id: { in: exerciseIds } },
			select: { id: true, name: true }
		})

		// Combine summary data with exercise names
		const enrichedSummary = summary.map(stat => {
			const exercise = exercises.find(ex => ex.id === stat.exerciseId)
			return {
				exerciseId: stat.exerciseId,
				exerciseName: exercise?.name || 'Unknown Exercise',
				totalAdjustments: stat._count.id,
				totalDeltaKg: stat._sum.deltaKg || 0,
				averageDeltaKg: stat._avg.deltaKg || 0,
				lastAdjustment: stat._max.createdAt
			}
		})

		return enrichedSummary
	}
}