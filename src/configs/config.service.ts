import { Injectable } from '@nestjs/common'

/**
 * ConfigService - Centralized configuration management
 * 
 * Handles environment variables and feature flags for the application.
 * Provides type-safe access to configuration values with defaults.
 */
@Injectable()
export class ConfigService {
	/**
	 * Check if TM events feature is enabled
	 */
	get isTmEventsEnabled(): boolean {
		return process.env.ENABLE_TM_EVENTS === 'true'
	}

	/**
	 * Get maximum allowed TM delta threshold for warnings
	 */
	get maxTmEventDeltaKg(): number {
		return Number(process.env.MAX_TM_EVENT_DELTA_KG) || 15
	}

	/**
	 * Database URL
	 */
	get databaseUrl(): string {
		return process.env.DATABASE_URL || ''
	}

	/**
	 * JWT Secret
	 */
	get jwtSecret(): string {
		return process.env.JWT_SECRET || ''
	}

	/**
	 * Server port
	 */
	get port(): number {
		return Number(process.env.PORT) || 4000
	}

	/**
	 * Frontend URL for CORS
	 */
	get frontendUrl(): string {
		return process.env.FRONTEND_URL || 'http://localhost:3000'
	}

	/**
	 * Supabase configuration
	 */
	get supabaseUrl(): string {
		return process.env.SUPABASE_URL || ''
	}

	get supabaseServiceRoleKey(): string {
		return process.env.SUPABASE_SERVICE_ROLE_KEY || ''
	}
}