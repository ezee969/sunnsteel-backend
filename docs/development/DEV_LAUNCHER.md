# Sunnsteel Development Server Launcher

This directory contains unified development server launchers that start both the frontend and backend servers simultaneously.

## Available Commands

### Option 1: NPM Scripts (Recommended)

From the backend directory (`sunnsteel-backend`):

```bash
# Using PowerShell (recommended for Windows)
npm run dev:all

# Using Command Prompt (alternative)
npm run dev:all:cmd
```

### Option 2: Direct Script Execution

```bash
# PowerShell
.\start-dev.ps1

# Command Prompt
start-dev.bat
```

## What It Does

The launcher will:

1. **Start Backend Server** (NestJS)
   - Command: `npm run start:dev`
   - Port: 4000
   - URL: http://localhost:4000

2. **Start Frontend Server** (Next.js with Turbopack)
   - Command: `npm run dev`
   - Port: 3000
   - URL: http://localhost:3000

## Features

- ✅ **Parallel Execution**: Both servers start simultaneously
- ✅ **Separate Windows**: Each server runs in its own terminal window for easy debugging
- ✅ **Colored Output**: Different colors for backend (blue) and frontend (magenta)
- ✅ **Error Handling**: Checks if project directories exist before starting
- ✅ **Cross-Platform**: PowerShell and Batch file options
- ✅ **Individual Process Control**: Stop servers independently by closing their windows

## Requirements

- Node.js 18+ installed
- Both projects (`sunnsteel-backend` and `sunnsteel-frontend`) must exist in the expected locations
- Dependencies installed in both projects (`npm install`)

## Troubleshooting

### PowerShell Execution Policy Error

If you get an execution policy error, run this command in PowerShell as Administrator:

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### Directory Not Found

Ensure both project directories exist at:
- `c:\Users\Ezequiel\Desktop\Code\sunsteel\sunnsteel-backend`
- `c:\Users\Ezequiel\Desktop\Code\sunsteel\sunnsteel-frontend`

### Port Already in Use

If ports 3000 or 4000 are already in use:
1. Stop any existing development servers
2. Check for other applications using these ports
3. Restart the launcher

## Stopping the Servers

To stop the development servers:
1. Close the respective terminal windows, or
2. Press `Ctrl+C` in each terminal window

## Development Workflow

1. Run `npm run dev:all` from the backend directory
2. Wait for both servers to start (usually 10-30 seconds)
3. Open your browser to http://localhost:3000 for the frontend
4. Backend API is available at http://localhost:4000
5. Make changes to either project - both have hot reload enabled
6. Close terminal windows when done developing

## Script Details

### PowerShell Script (`start-dev.ps1`)
- Uses colored output for better visibility
- Runs each server in a separate PowerShell window
- Includes comprehensive error checking
- Shows helpful information about ports and URLs

### Batch Script (`start-dev.bat`)
- Compatible with older Windows systems
- Uses Command Prompt windows
- Simpler output but same functionality
- Good fallback option

Both scripts are functionally equivalent and will produce the same result.