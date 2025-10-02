import { Test, TestingModule } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import * as request from 'supertest'
import { AppModule } from '../src/app.module'
import { DatabaseService } from '../src/database/database.service'
import * as fs from 'fs'
import * as path from 'path'

/**
 * Full E2E test for routine creation flow
 * 
 * This test simulates the complete user journey:
 * 1. Register a new user
 * 2. Authenticate and get bearer token
 * 3. Create a routine using the frontend JSON payload
 * 4. Verify routine exists in database with correct structure
 * 5. Clean up test data
 * 
 * Tests authentication, authorization, data validation, and persistence
 */
describe('Routine Creation - Full E2E (e2e)', () => {
	let app: INestApplication
	let databaseService: DatabaseService
	let accessToken: string
	let userId: string
	let createdRoutineId: string

	const testUser = {
		email: `routine-e2e-${Date.now()}@example.com`,
		password: 'SecurePassword123!',
		name: 'Routine Test User',
	}

	beforeAll(async () => {
		const moduleFixture: TestingModule = await Test.createTestingModule({
			imports: [AppModule],
		}).compile()

		app = moduleFixture.createNestApplication()
		databaseService = moduleFixture.get<DatabaseService>(DatabaseService)

		// Configure validation pipeline
		const { ValidationPipe } = await import('@nestjs/common')
		app.useGlobalPipes(new ValidationPipe({ transform: true }))

		// Add cookie parser
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const cookieParser = require('cookie-parser')
		app.use(cookieParser())

		app.setGlobalPrefix('api')
		await app.init()
	})

	afterAll(async () => {
		// Cleanup: Delete test user and all related data
		if (userId) {
			await databaseService.routine.deleteMany({ where: { userId } })
			await databaseService.user.delete({ where: { id: userId } })
		}

		await databaseService.$disconnect()
		await app.close()
	})

	describe('Step 1: User Registration', () => {
		it('should register a new test user', async () => {
			const response = await request(app.getHttpServer())
				.post('/api/auth/register')
				.send(testUser)
				.expect(201)

			expect(response.body).toMatchObject({
				user: {
					email: testUser.email,
					name: testUser.name,
				},
				accessToken: expect.any(String),
			})

			accessToken = response.body.accessToken
			userId = response.body.user.id

			expect(userId).toBeDefined()
			expect(accessToken).toBeDefined()
		})
	})

	describe('Step 2: Load and Validate Routine JSON', () => {
		it('should load the routine JSON from frontend', () => {
			// Load the my-routine.json file from frontend workspace
			const jsonPath = path.join(
				__dirname,
				'../../sunnsteel-frontend/my-routine.json',
			)

			expect(fs.existsSync(jsonPath)).toBe(true)

			const routineData = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'))

			// Validate required fields exist
			expect(routineData.name).toBeDefined()
			expect(routineData.isPeriodized).toBe(false)
			expect(routineData.days).toBeInstanceOf(Array)
			expect(routineData.days.length).toBeGreaterThan(0)

			// Validate PROGRAMMED_RTF exercises have programStyle
			routineData.days.forEach((day: any) => {
				day.exercises.forEach((exercise: any) => {
					if (exercise.progressionScheme === 'PROGRAMMED_RTF') {
						expect(exercise.programStyle).toBeDefined()
						expect(['STANDARD', 'HYPERTROPHY']).toContain(
							exercise.programStyle,
						)
					}
				})
			})
		})
	})

	describe('Step 3: Create Routine via API', () => {
		it('should create routine with authentication', async () => {
			// Load routine data
			const jsonPath = path.join(
				__dirname,
				'../../sunnsteel-frontend/my-routine.json',
			)
			const routinePayload = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'))

			const response = await request(app.getHttpServer())
				.post('/api/routines')
				.set('Authorization', `Bearer ${accessToken}`)
				.send(routinePayload)
				.expect(201)

			// Validate response structure
			expect(response.body).toMatchObject({
				id: expect.any(String),
				name: routinePayload.name,
				description: routinePayload.description,
				isPeriodized: false,
				userId: userId,
			})

			createdRoutineId = response.body.id

			// Validate days structure
			expect(response.body.days).toBeInstanceOf(Array)
			expect(response.body.days.length).toBe(routinePayload.days.length)

			// Validate first day structure
			const firstDay = response.body.days[0]
			expect(firstDay).toMatchObject({
				dayOfWeek: expect.any(Number),
				exercises: expect.any(Array),
			})

			// Validate exercises have proper structure
			const firstExercise = firstDay.exercises[0]
			expect(firstExercise).toMatchObject({
				exerciseId: expect.any(String),
				restSeconds: expect.any(Number),
				progressionScheme: expect.any(String),
				sets: expect.any(Array),
			})

			// Validate sets have repType
			const firstSet = firstExercise.sets[0]
			expect(firstSet).toMatchObject({
				setNumber: expect.any(Number),
				repType: expect.any(String),
			})
		})

		it('should reject routine creation without authentication', async () => {
			const jsonPath = path.join(
				__dirname,
				'../../sunnsteel-frontend/my-routine.json',
			)
			const routinePayload = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'))

			await request(app.getHttpServer())
				.post('/api/routines')
				.send(routinePayload)
				.expect(401)
		})
	})

	describe('Step 4: Verify Database Persistence', () => {
		it('should find the routine in database', async () => {
			const routine = await databaseService.routine.findUnique({
				where: { id: createdRoutineId },
				include: {
					days: {
						include: {
							exercises: {
								include: {
									sets: true,
									exercise: true,
								},
							},
						},
					},
				},
			})

			expect(routine).toBeDefined()
			expect(routine?.userId).toBe(userId)
			expect(routine?.name).toBe('ULPPL')
		})

		it('should have correct number of days', async () => {
			const routine = await databaseService.routine.findUnique({
				where: { id: createdRoutineId },
				include: { days: true },
			})

			// ULPPL routine has 5 days (Mon, Tue, Thu, Fri, Sat)
			expect(routine?.days.length).toBe(5)
		})

		it('should have PROGRAMMED_RTF exercises with programStyle', async () => {
			const routine = await databaseService.routine.findUnique({
				where: { id: createdRoutineId },
				include: {
					days: {
						include: {
							exercises: true,
						},
					},
				},
			})

			const rtfExercises = routine?.days
				.flatMap((day) => day.exercises)
				.filter((ex) => ex.progressionScheme === 'PROGRAMMED_RTF')

			expect(rtfExercises?.length).toBeGreaterThan(0)

			rtfExercises?.forEach((exercise) => {
				expect(exercise.programStyle).toBeDefined()
				expect(['STANDARD', 'HYPERTROPHY']).toContain(exercise.programStyle)
			})
		})

		it('should have correct set structure with repType', async () => {
			const routine = await databaseService.routine.findUnique({
				where: { id: createdRoutineId },
				include: {
					days: {
						include: {
							exercises: {
								include: { sets: true },
							},
						},
					},
				},
			})

			const firstExercise = routine?.days[0]?.exercises[0]
			expect(firstExercise?.sets.length).toBeGreaterThan(0)

			const firstSet = firstExercise?.sets[0]
			expect(firstSet?.repType).toBeDefined()
			expect(['FIXED', 'RANGE']).toContain(firstSet?.repType)

			// Validate rep fields based on repType
			if (firstSet?.repType === 'RANGE') {
				expect(firstSet.minReps).toBeDefined()
				expect(firstSet.maxReps).toBeDefined()
			} else if (firstSet?.repType === 'FIXED') {
				expect(firstSet.reps).toBeDefined()
			}
		})
	})

	describe('Step 5: Retrieve Routine via API', () => {
		it('should retrieve the created routine', async () => {
			const response = await request(app.getHttpServer())
				.get(`/api/routines/${createdRoutineId}`)
				.set('Authorization', `Bearer ${accessToken}`)
				.expect(200)

			expect(response.body).toMatchObject({
				id: createdRoutineId,
				name: 'ULPPL',
				userId: userId,
			})
		})

		it('should list routine in user routines', async () => {
			const response = await request(app.getHttpServer())
				.get('/api/routines')
				.set('Authorization', `Bearer ${accessToken}`)
				.expect(200)

			expect(response.body).toBeInstanceOf(Array)
			expect(response.body.length).toBeGreaterThan(0)

			const foundRoutine = response.body.find(
				(r: any) => r.id === createdRoutineId,
			)
			expect(foundRoutine).toBeDefined()
		})
	})

	describe('Step 6: Data Integrity Checks', () => {
		it('should have correct program configuration', async () => {
			const routine = await databaseService.routine.findUnique({
				where: { id: createdRoutineId },
			})

			expect(routine?.programWithDeloads).toBe(true)
			expect(routine?.programStartDate).toBeDefined()
			expect(routine?.programTimezone).toBe('America/Cordoba')
		})

		it('should preserve exercise order', async () => {
			const routine = await databaseService.routine.findUnique({
				where: { id: createdRoutineId },
				include: {
					days: {
						orderBy: { order: 'asc' },
						include: {
							exercises: {
								orderBy: { order: 'asc' },
							},
						},
					},
				},
			})

			// Validate days are ordered
			const dayOrders = routine?.days.map((d) => d.order) || []
			expect(dayOrders).toEqual([...dayOrders].sort((a, b) => a - b))

			// Validate exercises within each day are ordered
			routine?.days.forEach((day) => {
				const exerciseOrders = day.exercises.map((e) => e.order)
				expect(exerciseOrders).toEqual(
					[...exerciseOrders].sort((a, b) => a - b),
				)
			})
		})

		it('should have correct rest periods', async () => {
			const routine = await databaseService.routine.findUnique({
				where: { id: createdRoutineId },
				include: {
					days: {
						include: { exercises: true },
					},
				},
			})

			routine?.days.forEach((day) => {
				day.exercises.forEach((exercise) => {
					expect(exercise.restSeconds).toBeGreaterThanOrEqual(0)
					expect(exercise.restSeconds).toBeLessThanOrEqual(600)
				})
			})
		})
	})

	describe('Step 7: Cleanup and Deletion', () => {
		it('should delete the routine', async () => {
			await request(app.getHttpServer())
				.delete(`/api/routines/${createdRoutineId}`)
				.set('Authorization', `Bearer ${accessToken}`)
				.expect(200)

			// Verify deletion
			const deletedRoutine = await databaseService.routine.findUnique({
				where: { id: createdRoutineId },
			})

			expect(deletedRoutine).toBeNull()
		})
	})
})
