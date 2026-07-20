@echo off
setlocal EnableExtensions
chcp 65001 >nul

set "APP_URL=http://127.0.0.1:4173/"
set "PROJECT_DIR=%~dp0"
set "OPEN_BROWSER=1"
if /I "%~1"=="/noopen" set "OPEN_BROWSER=0"

pushd "%PROJECT_DIR%" >nul 2>&1
if errorlevel 1 goto :directory_error

where node.exe >nul 2>&1
if errorlevel 1 goto :node_error
where npm.cmd >nul 2>&1
if errorlevel 1 goto :npm_error

if not exist "node_modules\vite\bin\vite.js" goto :install
goto :build

:install
echo Installing dependencies...
if exist "package-lock.json" call npm.cmd ci
if not exist "package-lock.json" call npm.cmd install
if errorlevel 1 goto :install_error

:build
echo Building application...
call npm.cmd run build
if errorlevel 1 goto :build_error

netstat -ano | findstr /r /c:":4173 .*LISTENING" >nul
if not errorlevel 1 goto :server_ready

echo Starting local server...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$p = Start-Process -FilePath 'node.exe' -ArgumentList 'node_modules\vite\bin\vite.js preview --host 127.0.0.1 --port 4173 --strictPort' -WorkingDirectory '%CD%' -WindowStyle Hidden -RedirectStandardOutput '.moya-smena.stdout.log' -RedirectStandardError '.moya-smena.stderr.log' -PassThru; Set-Content -LiteralPath '.moya-smena.pid' -Value $p.Id -Encoding ascii"
if errorlevel 1 goto :server_error
timeout /t 2 /nobreak >nul

:server_ready
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest -UseBasicParsing -Uri '%APP_URL%' -TimeoutSec 10 | Out-Null; exit 0 } catch { exit 1 }"
if errorlevel 1 goto :server_error

echo Ready: %APP_URL%
if "%OPEN_BROWSER%"=="0" goto :done
start "" "%APP_URL%"

:done
popd
exit /b 0

:directory_error
echo Cannot open the project folder.
goto :failed

:node_error
echo Node.js was not found. Install the current LTS version from https://nodejs.org/
goto :failed

:npm_error
echo npm was not found. Reinstall Node.js from https://nodejs.org/
goto :failed

:install_error
echo Failed to install dependencies.
goto :failed

:build_error
echo Failed to build the application.
goto :failed

:server_error
echo The local server did not start. Check .moya-smena.stderr.log.

:failed
popd
pause
exit /b 1
