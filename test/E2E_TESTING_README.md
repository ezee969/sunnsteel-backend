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

### 2. Manual Testing with Thunder Client

**Files:** 
- `thunder-tests/routine-creation-e2e.json` - Request collection
- `thunder-tests/thunderEnvironment.json` - Environment variables

**Setup:**
1. Install [Thunder Client](https://marketplace.visualstudio.com/items?itemName=rangav.vscode-thunder-client) in VS Code
2. Open Thunder Client from sidebar
3. Import the collection from `thunder-tests/routine-creation-e2e.json`
4. Select "Sunsteel Development" environment

**Flow:**
1. **Register User** → Creates new test user, saves `accessToken` and `userId`
2. **Create ULPPL Routine** → Posts routine using bearer token, saves `routineId`
3. **Get All Routines** → Verifies routine appears in list
4. **Get Routine by ID** → Retrieves full routine details
5. **Delete Routine** → Cleanup test data

**Environment Variables (auto-populated):**
- `baseUrl`: API base URL (default: `http://localhost:3000/api`)
- `accessToken`: JWT bearer token (set after login/register)
- `userId`: Current user ID
- `routineId`: Created routine ID

---

### 3. Alternative: Postman Collection

If you prefer Postman, you can convert the Thunder Client collection or create similar requests:

**Postman Setup:**
1. Create new collection "Routine Creation E2E"
2. Add environment with variables: `baseUrl`, `accessToken`, `routineId`
3. Add requests following the Thunder Client structure
4. Use Tests tab to auto-save response values:
   ```javascript
   pm.environment.set("accessToken", pm.response.json().accessToken);
   pm.environment.set("routineId", pm.response.json().id);
   ```

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
