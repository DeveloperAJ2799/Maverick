@echo off
title Mavrick Desktop Build
echo ================================
echo   Mavrick Desktop Build Script
echo ================================
echo.

:: Step 1: Build Python backend with PyInstaller
echo [1/3] Building Python backend with PyInstaller...
if not exist "venv\Scripts\python.exe" (
    echo ERROR: venv not found. Run: python -m venv venv ^&^& venv\Scripts\pip install -r requirements.txt
    pause
    exit /b 1
)
venv\Scripts\python.exe -m PyInstaller Mavrick.spec --noconfirm
if %ERRORLEVEL% neq 0 (
    echo ERROR: PyInstaller build failed.
    pause
    exit /b 1
)
echo [OK] Python backend built.
echo.

:: Step 2: Install npm dependencies
echo [2/3] Installing npm dependencies...
call npm install
if %ERRORLEVEL% neq 0 (
    echo ERROR: npm install failed.
    pause
    exit /b 1
)
echo [OK] Dependencies installed.
echo.

:: Step 3: Build Electron app with electron-builder
echo [3/3] Building Electron installer...
call npm run build:win
if %ERRORLEVEL% neq 0 (
    echo ERROR: electron-builder failed.
    pause
    exit /b 1
)
echo.
echo ================================
echo   BUILD COMPLETE
echo ================================
echo Output: dist\Mavrick-Setup-1.0.0.exe
echo         dist\Mavrick-1.0.0.exe (portable)
echo.
pause
