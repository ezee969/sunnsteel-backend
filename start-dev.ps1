# Sunnsteel Development Server Launcher
# This script starts both frontend and backend development servers in parallel

Write-Host "Starting Sunnsteel Development Servers..." -ForegroundColor Green
Write-Host "================================================" -ForegroundColor Cyan

# Define paths
$BackendPath = "c:\Users\Ezequiel\Desktop\Code\sunsteel\sunnsteel-backend"
$FrontendPath = "c:\Users\Ezequiel\Desktop\Code\sunsteel\sunnsteel-frontend"

# Function to run a command in a new PowerShell window with colored output
function Start-DevServer {
    param(
        [string]$Path,
        [string]$Command,
        [string]$Title,
        [string]$Color
    )
    
    $scriptBlock = {
        param($path, $command, $title, $color)
        
        # Set window title
        $host.UI.RawUI.WindowTitle = $title
        
        # Change to the project directory
        Set-Location $path
        
        # Display startup message
        Write-Host "Starting $title..." -ForegroundColor $color
        Write-Host "Working Directory: $path" -ForegroundColor Gray
        Write-Host "Command: $command" -ForegroundColor Gray
        Write-Host "----------------------------------------" -ForegroundColor $color
        
        # Execute the command
        Invoke-Expression $command
    }
    
    # Start the process in a new PowerShell window
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "& {$($scriptBlock.ToString())} '$Path' '$Command' '$Title' '$Color'"
}

# Check if directories exist
if (-not (Test-Path $BackendPath)) {
    Write-Host "Backend directory not found: $BackendPath" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path $FrontendPath)) {
    Write-Host "Frontend directory not found: $FrontendPath" -ForegroundColor Red
    exit 1
}

# Start backend server
Write-Host "Launching Backend Server (NestJS)..." -ForegroundColor Blue
Start-DevServer -Path $BackendPath -Command "npm run start:dev" -Title "Sunnsteel Backend (Port 4000)" -Color "Blue"

# Wait a moment before starting frontend
Start-Sleep -Seconds 2

# Start frontend server
Write-Host "Launching Frontend Server (Next.js)..." -ForegroundColor Magenta
Start-DevServer -Path $FrontendPath -Command "npm run dev" -Title "Sunnsteel Frontend (Port 3000)" -Color "Magenta"

Write-Host ""
Write-Host "Both development servers are starting up!" -ForegroundColor Green
Write-Host "Frontend: http://localhost:3000" -ForegroundColor Cyan
Write-Host "Backend:  http://localhost:4000" -ForegroundColor Cyan
Write-Host ""
Write-Host "Each server runs in its own window for easy debugging." -ForegroundColor Yellow
Write-Host "Close the respective PowerShell windows to stop the servers." -ForegroundColor Yellow
Write-Host ""
Write-Host "Press any key to exit this launcher..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")