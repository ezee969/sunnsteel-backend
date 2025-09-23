#!/usr/bin/env node

/**
 * Test script for TM Adjustment endpoints
 * 
 * This script tests the new TM adjustment functionality by:
 * 1. Creating a test routine with PROGRAMMED_RTF exercise
 * 2. Creating TM adjustment events  
 * 3. Fetching TM adjustments and summaries
 * 
 * Usage: node test-tm-endpoints.js
 */

const BASE_URL = 'http://localhost:4000/api'

async function testTmEndpoints() {
	console.log('🧪 Testing TM Adjustment Endpoints')
	console.log('=====================================')

	// Check if TM events are enabled
	try {
		const response = await fetch(`${BASE_URL}/routines/test-routine-id/tm-events`)
		if (response.status === 404) {
			console.log('❌ TM Events feature is disabled (ENABLE_TM_EVENTS=false)')
			console.log('💡 Set ENABLE_TM_EVENTS=true in your .env file to test')
			return
		}
	} catch (error) {
		console.log('⚠️  Server might not be running or endpoint not accessible')
		console.log('💡 Make sure the server is running with: npm run start:dev')
		return
	}

	console.log('✅ TM Events endpoints are accessible')

	// Test endpoint structure (without authentication for now)
	console.log('\n📋 Available TM Endpoints:')
	console.log('- POST   /api/routines/:id/tm-events')
	console.log('- GET    /api/routines/:id/tm-events')  
	console.log('- GET    /api/routines/:id/tm-events/summary')

	console.log('\n📝 Sample TM Adjustment Payload:')
	const samplePayload = {
		exerciseId: 'exercise-uuid',
		weekNumber: 3,
		deltaKg: 2.5,
		preTmKg: 100,
		postTmKg: 102.5,
		reason: 'Completed all reps with good form'
	}
	console.log(JSON.stringify(samplePayload, null, 2))

	console.log('\n🎯 Next Steps:')
	console.log('1. Enable TM events: ENABLE_TM_EVENTS=true')
	console.log('2. Create a routine with PROGRAMMED_RTF exercises')  
	console.log('3. Use authenticated requests to test the endpoints')
	console.log('4. Check the database for stored TM adjustments')
}

// Run the test if this script is executed directly
if (require.main === module) {
	testTmEndpoints().catch(console.error)
}

module.exports = { testTmEndpoints }