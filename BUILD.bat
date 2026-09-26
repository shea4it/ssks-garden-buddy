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

rem An installer left running from an earlier build keeps its file open.
taskkill /f /im "SSKs-Garden-Buddy-Windows.exe" >nul 2>nul

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

rem The installer is built outside this folder, in a new folder of its own
rem under AppData\Local every time. This folder may be synced by OneDrive
rem (Documents usually is), and OneDrive or a virus scan grabbing the new
rem installer while it's being written stalls the build with "output file
rem is locked for writing". AppData\Local is never synced, and a new name
rem each time means nothing can already have the file open.
set "STAMP="
for /f "usebackq delims=" %%s in (`powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"`) do set "STAMP=%%s"
if not defined STAMP set "STAMP=%RANDOM%%RANDOM%"
set "BUILDROOT=%LOCALAPPDATA%\SSKs-Garden-Buddy-builds"
set "OUT=%BUILDROOT%\%AV%-%STAMP%"
if not exist "%BUILDROOT%" mkdir "%BUILDROOT%"

echo   Step 3 of 4: building the app...
call "node_modules\.bin\electron-builder.cmd" --win --publish never "--config.directories.output=%OUT%"
if errorlevel 1 goto :fail

set "SETUP=%OUT%\SSKs-Garden-Buddy-Windows.exe"
if not exist "%SETUP%" goto :fail

rem Earlier builds: keep the newest three.
powershell -NoProfile -Command "Get-ChildItem -LiteralPath $env:BUILDROOT -Directory | Sort-Object LastWriteTime -Descending | Select-Object -Skip 3 | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue" >nul 2>nul

rem A copy in the release folder here, for the other laptop. If it can't be
rem written right now, nothing is lost: the installer is in the folder above.
if not exist "release" mkdir "release"
copy /y "%SETUP%" "release\SSKs-Garden-Buddy-Windows.exe" >nul 2>nul

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
