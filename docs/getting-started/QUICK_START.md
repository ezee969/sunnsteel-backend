# Quick Start Guide

Get the Sunnsteel Backend API running in 5 minutes! This guide assumes you have Node.js and PostgreSQL already installed.

## ⚡ 5-Minute Setup

### **1. Clone & Install** (1 minute)
```bash
git clone <repository-url>
cd sunnsteel-backend
npm install
```

### **2. Environment Setup** (1 minute)
```bash
# Copy environment template
cp .env.example .env
```

Edit `.env` with your database credentials:
```env
DATABASE_URL="postgresql://username:password@localhost:5432/sunnsteel_dev"
JWT_ACCESS_SECRET="your-secret-key-here"
JWT_REFRESH_SECRET="your-refresh-secret-here"
```

### **3. Database Setup** (2 minutes)
```bash
# Create database (if needed)
createdb sunnsteel_dev

# Run migrations and seed data
npx prisma migrate dev
npm run db:seed
```

### **4. Start Server** (30 seconds)
```bash
npm run start:dev
```

### **5. Test API** (30 seconds)
```bash
curl http://localhost:4000/api/health
```

✅ **Success!** Your API is running at `http://localhost:4000`

## 🚀 First API Calls

### **1. Health Check**
```bash
curl http://localhost:4000/api/health
```

Response:
```json
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### **2. Get Exercises** (requires auth)
```bash
# First, you'll need to authenticate
# See Authentication section below
```

## 🔐 Quick Authentication Setup

### **Option 1: Use Seeded Test User**
The database seed creates a test user:
```
Email: test@example.com
Password: password123
```

### **Option 2: Register New User**
```bash
curl -X POST http://localhost:4000/api/auth/register \\
  -H "Content-Type: application/json" \\
  -d '{
    "email": "your@email.com",
    "password": "yourpassword",
    "name": "Your Name"
  }'
```

### **Login and Get Token**
```bash
curl -X POST http://localhost:4000/api/auth/login \\
  -H "Content-Type: application/json" \\
  -d '{
    "email": "test@example.com",
    "password": "password123"
  }'
```

Response:
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "user-id",
    "email": "test@example.com",
    "name": "Test User"
  }
}
```

### **Make Authenticated Request**
```bash
curl -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \\
     http://localhost:4000/api/exercises
```

## 📊 Quick Development Commands

```bash
# Development server with hot reload
npm run start:dev

# Static verification
npm run typecheck
npm run lint

# Code formatting
npm run format

# Database GUI
npx prisma studio
```

## 🛠️ Development Tools

### **Prisma Studio** (Database GUI)
```bash
npx prisma studio
```
Opens at `http://localhost:5555`

### **API Testing with curl**
```bash
# Health check
curl http://localhost:4000/api/health

# Get user profile (with auth)
curl -H "Authorization: Bearer TOKEN" \\
     http://localhost:4000/api/users/profile

# List exercises (with auth)
curl -H "Authorization: Bearer TOKEN" \\
     http://localhost:4000/api/exercises
```

### **Postman Collection**
Import the Postman collection for ready-to-use API requests:
- [Download Collection](../api/POSTMAN_COLLECTION.md)

## 🔧 Common Development Tasks

### **Reset Database**
```bash
npx prisma migrate reset
npm run db:seed
```

### **Generate New Migration**
```bash
npx prisma migrate dev --name your_migration_name
```

### **Update Prisma Client**
```bash
npx prisma generate
```

### **Check Code Quality**
```bash
npm run lint
npm run format
```

## 📁 Project Structure Overview

```
sunnsteel-backend/
├── src/
│   ├── auth/           # Authentication module
│   ├── users/          # User management
│   ├── exercises/      # Exercise catalog
│   ├── routines/       # Routine management
│   ├── workouts/       # Workout sessions
│   └── main.ts         # Application entry point
├── prisma/
│   ├── schema.prisma   # Database schema
│   └── migrations/     # Database migrations
├── test/               # E2E tests
└── docs/               # Documentation
```

## 🚨 Quick Troubleshooting

### **Port 4000 in use**
```bash
npx kill-port 4000
# Or change port: PORT=4001 npm run start:dev
```

### **Database connection error**
```bash
# Check PostgreSQL is running
pg_ctl status
# Or: brew services list | grep postgres
```

### **Prisma errors**
```bash
npx prisma generate
npx prisma migrate dev
```

### **Module not found errors**
```bash
rm -rf node_modules package-lock.json
npm install
```

## 🎯 What's Next?

Now that you're running, explore these areas:

1. **[API Documentation](../api/README.md)** - Learn all available endpoints
2. **[Authentication Flow](FIRST_API_CALL.md)** - Understand auth patterns
3. **[Development Workflow](DEVELOPMENT_WORKFLOW.md)** - Learn the dev process
4. **[Architecture Overview](../architecture/README.md)** - Understand the system design

## 📚 Key Endpoints to Try

```bash
# Core endpoints (all require authentication)
GET  /api/users/profile          # Your user profile
GET  /api/exercises              # Available exercises
GET  /api/routines               # Your routines
POST /api/routines               # Create new routine
GET  /api/workouts/sessions      # Your workout sessions
```

## 🔗 Useful Links

- **API Health**: http://localhost:4000/api/health
- **Prisma Studio**: http://localhost:5555 (after running `npx prisma studio`)
- **Metrics**: http://localhost:4000/api/metrics
- **Full Documentation**: [docs/README.md](../README.md)

---

*Ready to dive deeper? Check out the [complete installation guide](INSTALLATION.md) or [development workflow](DEVELOPMENT_WORKFLOW.md).*
