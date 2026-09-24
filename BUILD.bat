@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title SSK's Garden Buddy builder

echo.
echo   SSK's Garden Buddy builder
echo   ===========================
echo.

where node >nul 2>nul
if errorlevel 1 goto :nonode

echo   Step 1 of 4: installing packages...
call npm install --no-audit --no-fund --loglevel=error
if errorlevel 1 goto :fail

for /f "usebackq delims=" %%v in (`node -p "require('./node_modules/electron/package.json').version"`) do set "EV=%%v"
for /f "usebackq delims=" %%v in (`node -p "require('./package.json').version"`) do set "AV=%%v"

if exist "node_modules\electron\dist\electron.exe" goto :haveelectron

echo   Step 2 of 4: downloading Electron %EV%, about 100 MB. This can take a few minutes...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; Invoke-WebRequest -Uri 'https://github.com/electron/electron/releases/download/v%EV%/electron-v%EV%-win32-x64.zip' -OutFile 'electron.zip'; Expand-Archive -Path 'electron.zip' -DestinationPath 'node_modules\electron\dist' -Force; Remove-Item 'electron.zip'"
if errorlevel 1 goto :fail
goto :pathtxt

:haveelectron
echo   Step 2 of 4: Electron is already in place.

:pathtxt
<nul set /p "=electron.exe" > "node_modules\electron\path.txt"

echo   Step 3 of 4: building the app...
if exist release rmdir /s /q release
call npm run dist:win
if errorlevel 1 goto :fail

set "SETUP=release\SSKs-Garden-Buddy-Windows.exe"
if not exist "%SETUP%" goto :fail

echo.
echo   Step 4 of 4: installing version %AV%...
echo   If the app is already open, the installer will ask you to close it.
start "" "%SETUP%"
echo.
echo   Done. Your settings and pity counts carry over.
echo   The installer is also saved in the release folder, for the other laptop.
echo.
pause
exit /b 0

:nonode
echo   Node.js isn't installed on this computer.
echo   Install the LTS version from https://nodejs.org and then run this again.
echo.
pause
exit /b 1

:fail
echo.
echo   Something went wrong. Scroll up to find the error, and paste it to Claude.
echo.
pause
exit /b 1
