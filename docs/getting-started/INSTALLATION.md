# Installation Guide

Complete setup instructions for the Sunnsteel Backend API development environment.

## 📋 Prerequisites

### **Required Software**
- **Node.js** v18.0.0 or higher ([Download](https://nodejs.org/))
- **npm** v8.0.0 or higher (comes with Node.js)
- **PostgreSQL** v14.0 or higher ([Download](https://www.postgresql.org/download/))
- **Git** for version control ([Download](https://git-scm.com/))

### **Optional but Recommended**
- **Redis** v6.0+ for caching ([Download](https://redis.io/download))
- **VSCode** with NestJS extensions ([Download](https://code.visualstudio.com/))
- **Postman** for API testing ([Download](https://www.postman.com/))

## 🚀 Quick Installation

### **1. Clone the Repository**
```bash
git clone <repository-url>
cd sunnsteel-backend
```

### **2. Install Dependencies**
```bash
npm install
```

### **3. Environment Setup**
```bash
# Copy environment template
cp .env.example .env

# Edit environment variables
# See Environment Setup guide for details
```

### **4. Database Setup**
```bash
# Run database migrations
npx prisma migrate dev

# Seed the database with initial data
npm run db:seed
```

### **5. Start Development Server**
```bash
npm run start:dev
```

The API will be available at `http://localhost:4000`

## 🔧 Detailed Setup

### **Node.js Installation**

#### Windows
1. Download Node.js LTS from [nodejs.org](https://nodejs.org/)
2. Run the installer and follow the setup wizard
3. Verify installation:
```bash
node --version  # Should show v18.0.0+
npm --version   # Should show v8.0.0+
```

#### macOS
```bash
# Using Homebrew (recommended)
brew install node@18

# Or download from nodejs.org
```

#### Linux (Ubuntu/Debian)
```bash
# Using NodeSource repository
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs
```

### **PostgreSQL Installation**

#### Windows
1. Download PostgreSQL from [postgresql.org](https://www.postgresql.org/download/windows/)
2. Run installer and remember your password
3. Add PostgreSQL to your PATH

#### macOS
```bash
# Using Homebrew
brew install postgresql@14
brew services start postgresql@14
```

#### Linux (Ubuntu/Debian)
```bash
sudo apt update
sudo apt install postgresql postgresql-contrib
sudo systemctl start postgresql
sudo systemctl enable postgresql
```

### **Database Configuration**
```bash
# Connect to PostgreSQL
psql -U postgres

# Create database and user
CREATE DATABASE sunnsteel_dev;
CREATE USER sunnsteel_user WITH PASSWORD 'your_password';
GRANT ALL PRIVILEGES ON DATABASE sunnsteel_dev TO sunnsteel_user;
\\q
```

## 📝 Environment Variables

Create a `.env` file in the project root:

```env
# Database
DATABASE_URL="postgresql://sunnsteel_user:your_password@localhost:5432/sunnsteel_dev"

# JWT Secrets
JWT_ACCESS_SECRET="your-jwt-access-secret-here"
JWT_REFRESH_SECRET="your-jwt-refresh-secret-here"

# Supabase (for authentication)
SUPABASE_URL="your-supabase-url"
SUPABASE_SERVICE_ROLE_KEY="your-supabase-service-key"

# Google OAuth (optional)
GOOGLE_CLIENT_ID="your-google-client-id"

# Application
PORT=4000
NODE_ENV=development
FRONTEND_URL="http://localhost:3000"

# Redis (optional for development)
RTF_CACHE_DRIVER=memory
# RTF_REDIS_URL="redis://localhost:6379"

# Monitoring
METRICS_IP_ALLOWLIST="127.0.0.1,::1"
```

## 🧪 Verify Installation

### **1. Check Dependencies**
```bash
npm list --depth=0
```

### **2. Run Database Migrations**
```bash
npx prisma migrate dev
```

### **3. Start the Server**
```bash
npm run start:dev
```

### **4. Test API Health**
```bash
curl http://localhost:4000/api/health
```

Expected response:
```json
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

## 🛠️ Development Tools Setup

### **VSCode Extensions**
Install these recommended extensions:
- **NestJS Files** - File templates
- **Prisma** - Database schema support
- **ESLint** - Code linting
- **Prettier** - Code formatting
- **Thunder Client** - API testing

### **Git Configuration**
```bash
git config --global user.name "Your Name"
git config --global user.email "your.email@example.com"
```

## 📊 Available Scripts

```bash
# Development
npm run start:dev      # Start with hot reload
npm run start:debug    # Start with debugger

# Building
npm run build          # Build for production
npm run start:prod     # Start production build

# Testing
npm run test           # Run unit tests
npm run test:e2e       # Run end-to-end tests
npm run test:cov       # Run tests with coverage

# Code Quality
npm run lint           # Run ESLint
npm run format         # Format code with Prettier

# Database
npm run db:seed        # Seed database with test data
npx prisma studio      # Open Prisma Studio (database GUI)
npx prisma generate    # Generate Prisma client
```

## 🚨 Troubleshooting

### **Common Issues**

#### Port Already in Use
```bash
# Kill process on port 4000
npx kill-port 4000

# Or use different port
PORT=4001 npm run start:dev
```

#### Database Connection Issues
```bash
# Check PostgreSQL is running
sudo systemctl status postgresql  # Linux
brew services list | grep postgres  # macOS

# Test connection
psql -U sunnsteel_user -d sunnsteel_dev -h localhost
```

#### Prisma Issues
```bash
# Reset database (WARNING: deletes all data)
npx prisma migrate reset

# Generate Prisma client
npx prisma generate
```

#### Node Modules Issues
```bash
# Clear npm cache and reinstall
rm -rf node_modules package-lock.json
npm cache clean --force
npm install
```

## 🔗 Next Steps

1. **[Quick Start Guide](QUICK_START.md)** - Get running in 5 minutes
2. **[Environment Setup](ENVIRONMENT_SETUP.md)** - Detailed environment configuration
3. **[First API Call](FIRST_API_CALL.md)** - Make your first authenticated request
4. **[Development Workflow](DEVELOPMENT_WORKFLOW.md)** - Learn the development process

## 📞 Support

If you encounter issues:
1. Check the [Troubleshooting](#-troubleshooting) section
2. Review the [Development Documentation](../development/README.md)
3. Check existing GitHub issues
4. Create a new issue with detailed error information

---

*This guide is part of the [Getting Started](README.md) documentation.*