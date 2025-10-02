import { Test, TestingModule } from '@nestjs/testing'
import { AuthController } from './auth.controller'

/**
 * @deprecated This test suite is for the deprecated AuthController.
 * 
 * The AuthController has been deprecated in favor of Supabase authentication.
 * All legacy Passport.js-based endpoints have been removed.
 * 
 * For testing active authentication functionality, see:
 * - `supabase-auth.controller.spec.ts` - Tests for Supabase auth endpoints
 * - `auth.service.spec.ts` - Tests for auth service (token validation)
 * - `test/auth.e2e-spec.ts` - E2E tests for authentication flows
 */
describe('AuthController (Deprecated)', () => {
	let controller: AuthController

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			controllers: [AuthController],
		}).compile()

		controller = module.get<AuthController>(AuthController)
	})

	it('should be defined', () => {
		expect(controller).toBeDefined()
	})

	it('should be an empty deprecated controller', () => {
		// AuthController is now empty - all methods removed during Supabase migration
		const methodNames = Object.getOwnPropertyNames(Object.getPrototypeOf(controller))
			.filter(name => name !== 'constructor')
		
		expect(methodNames.length).toBe(0)
	})
})
