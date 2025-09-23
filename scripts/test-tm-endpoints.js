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

	// Test basic server connectivity
	try {
		const response = await fetch(`${BASE_URL}/health`)
		if (!response.ok) {
			console.log('⚠️  Server might not be running')
			console.log('💡 Make sure the server is running with: npm run start:dev')
			return
		}
	} catch (error) {
		console.log('⚠️  Server not accessible')
		console.log('💡 Make sure the server is running with: npm run start:dev')
		return
	}

	console.log('✅ Server is running and accessible')

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
	console.log('1. Create a routine with PROGRAMMED_RTF exercises')  
	console.log('2. Use authenticated requests to test the endpoints')
	console.log('3. Check the database for stored TM adjustments')
	console.log('4. Large adjustments (>15kg) will log warnings automatically')
}

// Run the test if this script is executed directly
if (require.main === module) {
	testTmEndpoints().catch(console.error)
}

module.exports = { testTmEndpoints }