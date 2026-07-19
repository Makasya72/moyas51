@echo off
setlocal EnableExtensions
chcp 65001 >nul

set "PROJECT_DIR=%~dp0"
set "QUIET=0"
if /I "%~1"=="/quiet" set "QUIET=1"

pushd "%PROJECT_DIR%" >nul 2>&1
if errorlevel 1 (
  if "%QUIET%"=="0" (
    echo [Ошибка] Не удалось открыть папку проекта:
    echo %PROJECT_DIR%
    pause
  )
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference = 'Stop';" ^
  "$root = (Get-Location).Path;" ^
  "$pidFile = Join-Path $root '.moya-smena.pid';" ^
  "$viteScript = Join-Path $root 'node_modules\vite\bin\vite.js';" ^
  "if (-not (Test-Path -LiteralPath $pidFile)) {" ^
  "  Write-Host '[Моя смена] PID-файл отсутствует: сервер, запущенный start.bat, не найден.';" ^
  "  exit 0;" ^
  "}" ^
  "$raw = (Get-Content -LiteralPath $pidFile -Raw).Trim();" ^
  "$serverPid = 0;" ^
  "if (-not [int]::TryParse($raw, [ref]$serverPid)) {" ^
  "  Remove-Item -LiteralPath $pidFile -Force;" ^
  "  Write-Error 'PID-файл повреждён и удалён. Ни один процесс не был остановлен.';" ^
  "  exit 2;" ^
  "}" ^
  "$process = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $serverPid) -ErrorAction SilentlyContinue;" ^
  "if (-not $process) {" ^
  "  Remove-Item -LiteralPath $pidFile -Force;" ^
  "  Write-Host ('[Моя смена] Процесс PID ' + $serverPid + ' уже завершён. Устаревший PID-файл удалён.');" ^
  "  exit 0;" ^
  "}" ^
  "$commandLine = [string]$process.CommandLine;" ^
  "if (-not $commandLine -or $commandLine.IndexOf($viteScript, [StringComparison]::OrdinalIgnoreCase) -lt 0) {" ^
  "  Write-Error ('PID ' + $serverPid + ' принадлежит другому процессу. Он не был остановлен. Удалите устаревший .moya-smena.pid вручную после проверки.');" ^
  "  exit 3;" ^
  "}" ^
  "Stop-Process -Id $serverPid -ErrorAction Stop;" ^
  "Wait-Process -Id $serverPid -Timeout 10 -ErrorAction SilentlyContinue;" ^
  "Remove-Item -LiteralPath $pidFile -Force;" ^
  "Write-Host ('[Моя смена] Локальный сервер остановлен, PID ' + $serverPid + '.');"

set "STOP_CODE=%ERRORLEVEL%"
popd

if not "%STOP_CODE%"=="0" (
  if "%QUIET%"=="0" pause
  exit /b %STOP_CODE%
)

if "%QUIET%"=="0" timeout /t 2 /nobreak >nul
exit /b 0
