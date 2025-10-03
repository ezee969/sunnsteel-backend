@echo off
title Sunnsteel Development Server Launcher

echo.
echo 🚀 Starting Sunnsteel Development Servers...
echo ================================================

REM Define paths
set "BACKEND_PATH=c:\Users\Ezequiel\Desktop\Code\sunsteel\sunnsteel-backend"
set "FRONTEND_PATH=c:\Users\Ezequiel\Desktop\Code\sunsteel\sunnsteel-frontend"

REM Check if directories exist
if not exist "%BACKEND_PATH%" (
    echo ❌ Backend directory not found: %BACKEND_PATH%
    pause
    exit /b 1
)

if not exist "%FRONTEND_PATH%" (
    echo ❌ Frontend directory not found: %FRONTEND_PATH%
    pause
    exit /b 1
)

echo 🔧 Launching Backend Server (NestJS)...
start "Sunnsteel Backend (Port 4000)" cmd /k "cd /d "%BACKEND_PATH%" && npm run start:dev"

REM Wait a moment before starting frontend
timeout /t 2 /nobreak >nul

echo 🔧 Launching Frontend Server (Next.js)...
start "Sunnsteel Frontend (Port 3000)" cmd /k "cd /d "%FRONTEND_PATH%" && npm run dev"

echo.
echo ✅ Both development servers are starting up!
echo 📱 Frontend: http://localhost:3000
echo 🔧 Backend:  http://localhost:4000
echo.
echo 💡 Each server runs in its own window for easy debugging.
echo 💡 Close the respective command prompt windows to stop the servers.
echo.
echo Press any key to exit this launcher...
pause >nul