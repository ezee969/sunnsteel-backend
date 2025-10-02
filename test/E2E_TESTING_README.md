# End-to-End Testing: Routine Creation

This directory contains comprehensive E2E tests for the routine creation flow, covering authentication, API requests, and database persistence.

## 🎯 Testing Approaches

### 1. Automated E2E Test (Recommended)

**File:** `routine-creation-full.e2e-spec.ts`

Complete automated test that simulates the entire user journey:
- ✅ User registration
- ✅ Authentication (bearer token)
- ✅ Routine creation using `my-routine.json`
- ✅ Database verification
- ✅ Data integrity checks
- ✅ Cleanup

**Run the test:**
```bash
# From backend directory
npm run test:e2e -- routine-creation-full.e2e-spec.ts

# Or run all E2E tests
npm run test:e2e
```

**What it tests:**
- User authentication flow
- Routine payload validation
- PROGRAMMED_RTF exercises with `programStyle`
- Set structure with `repType` (FIXED/RANGE)
- Database persistence
- Exercise and day ordering
- Program configuration (deloads, timezone, start date)

---

### 2. Manual Testing with HTTP File

**File:** `test/api-manual-tests.http`

This file contains all the manual testing requests in standard HTTP format, compatible with multiple free tools.

**Option A: REST Client Extension (Recommended - Free)**
1. Install [REST Client](https://marketplace.visualstudio.com/items?itemName=humao.rest-client) in VS Code
2. Open `test/api-manual-tests.http`
3. Click "Send Request" above any request
4. Variables like `{{accessToken}}` are auto-populated from previous responses

**Option B: Thunder Client Individual Requests (Free)**
1. Install [Thunder Client](https://marketplace.visualstudio.com/items?itemName=rangav.vscode-thunder-client)
2. Create individual requests (collections require paid version)
3. Copy-paste requests from `api-manual-tests.http`
4. Manually copy `accessToken` from register response to subsequent requests

**Flow:**
1. **STEP 1: Register User** → Creates test user, returns `accessToken`
2. **STEP 2: Create Simple Routine** → Basic routine with NONE progression
3. **STEP 3: Create Complex Routine** → PROGRAMMED_RTF + DYNAMIC_DOUBLE_PROGRESSION
4. **STEP 4: Get All Routines** → List user's routines
5. **STEP 5: Get Specific Routine** → Retrieve by ID
6. **STEP 6: Delete Routine** → Cleanup

**Helper Endpoints:**
- Get all exercises
- Filter exercises by muscle group
- Login endpoint (if user already exists)

**Variables:**
```http
@baseUrl = http://localhost:3000/api
@email = test-user@example.com
@password = testPassword123
@accessToken = {{register.response.body.accessToken}}
```

---

### 3. Alternative Tools

The `.http` file format is compatible with:
- **Postman** - Import as collection
- **Insomnia** - Open HTTP file directly
- **curl** - Copy commands from file
- **HTTPie** - Convert to HTTPie syntax
- **Any HTTP client** - Standard format

---

## 📋 Test Data

**Source:** `sunnsteel-frontend/my-routine.json`

This is the actual routine payload used by the frontend. The E2E test validates:
- Correct DTO structure
- Required fields for each progression scheme
- PROGRAMMED_RTF exercises have `programStyle: "STANDARD" | "HYPERTROPHY"`
- Sets have `repType: "FIXED" | "RANGE"` with appropriate rep fields

**Example Exercise Structure:**
```json
{
  "exerciseId": "uuid",
  "restSeconds": 180,
  "progressionScheme": "PROGRAMMED_RTF",
  "minWeightIncrement": 2.5,
  "programTMKg": 113,
  "programRoundingKg": 2.5,
  "programStyle": "STANDARD",
  "sets": [
    {
      "setNumber": 1,
      "repType": "RANGE",
      "minReps": 10,
      "maxReps": 10
    }
  ]
}
```

---

## 🔐 Authentication

All tests use **JWT Bearer Token** authentication via Supabase:

**Headers:**
```
Authorization: Bearer <accessToken>
```

**Token obtained from:**
- `POST /api/auth/register` - Returns `accessToken` in response body
- `POST /api/auth/login` - Returns `accessToken` in response body

The E2E test automatically handles authentication and passes the token to all subsequent requests.

---

## 🗄️ Database Verification

The automated test verifies database state using Prisma:

```typescript
const routine = await databaseService.routine.findUnique({
  where: { id: routineId },
  include: {
    days: {
      include: {
        exercises: {
          include: { sets: true, exercise: true }
        }
      }
    }
  }
})
```

**Checks:**
- Routine ownership (userId matches)
- Correct day count and ordering
- Exercise configuration (progressionScheme, TM values, programStyle)
- Set structure (repType, reps/minReps/maxReps)
- Program metadata (deloads, timezone, start date)

---

## 🧹 Cleanup

**Automated Test:**
- Automatically deletes test user and all routines in `afterAll()` hook
- No manual cleanup needed

**Manual Testing:**
- Use "Delete Routine" request in Thunder Client
- Or manually delete from database:
  ```sql
  DELETE FROM routines WHERE id = '<routineId>';
  DELETE FROM users WHERE email LIKE 'test-%@example.com';
  ```

---

## 📊 Running Tests

**Watch mode (development):**
```bash
npm run test:e2e:watch
```

**With coverage:**
```bash
npm run test:e2e:cov
```

**Specific test file:**
```bash
npm run test:e2e -- routine-creation-full
```

**Debug mode:**
```bash
node --inspect-brk -r tsconfig-paths/register -r ts-node/register node_modules/.bin/jest --runInBand routine-creation-full.e2e-spec.ts
```

---

## 🐛 Troubleshooting

**Test fails: "Routine not found"**
- Ensure backend is running (`npm run start:dev`)
- Check database connection in `.env`
- Verify Prisma migrations are up to date: `npx prisma migrate dev`

**Test fails: "401 Unauthorized"**
- Token may be expired (tokens typically expire after 1 hour)
- Re-run registration step to get fresh token
- Check Supabase JWT configuration

**Test fails: "Exercise not found"**
- Ensure exercise IDs in `my-routine.json` exist in your database
- Run seed script: `npx prisma db seed`

**Thunder Client requests fail:**
- Verify `baseUrl` points to correct backend URL
- Check backend is running: `npm run start:dev`
- Ensure environment is selected in Thunder Client

---

## 🎓 Learning Resources

**NestJS Testing:**
- [NestJS Testing Docs](https://docs.nestjs.com/fundamentals/testing)
- [Jest Documentation](https://jestjs.io/docs/getting-started)

**E2E Testing Best Practices:**
- Test complete user flows, not isolated units
- Use realistic test data (like `my-routine.json`)
- Clean up test data in `afterAll()` hooks
- Mock external services (e.g., Supabase Auth)
- Use meaningful test descriptions

**API Testing:**
- Use `supertest` for HTTP assertions
- Validate both response status and body structure
- Test authorization (with/without token)
- Verify database state after mutations

---

## 📝 Next Steps

Want to add more tests? Consider:

1. **Frontend Integration Tests:** Use Playwright/Cypress to test UI + API together
2. **Load Testing:** Use k6 or Artillery to test routine creation under load
3. **Contract Testing:** Use Pact to verify frontend/backend API contracts
4. **Snapshot Testing:** Compare routine JSON structure over time

---

## 🤝 Contributing

When adding new features to routine creation:

1. Update `CreateRoutineDto` in backend
2. Update `my-routine.json` with new fields
3. Add test cases to `routine-creation-full.e2e-spec.ts`
4. Update Thunder Client collection
5. Document changes in this README
