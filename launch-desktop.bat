@echo off
title MAVRICK Desktop Launcher

:: Kill any leftover process on port 7000 from a previous run
echo Checking for stale processes on port 7000...
for /f "tokens=5" %%p in ('netstat -ano 2^>nul ^| findstr ":7000 " ^| findstr "LISTENING"') do (
    echo Killing stale process PID %%p on port 7000...
    taskkill /PID %%p /F >nul 2>&1
)

:: Short pause to let the port free up
timeout /t 1 /nobreak >nul

echo Starting MAVRICK Desktop App...
npm start
