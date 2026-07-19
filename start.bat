@echo off
setlocal EnableExtensions
chcp 65001 >nul

set "APP_URL=http://127.0.0.1:4173/"
set "PROJECT_DIR=%~dp0"
set "OPEN_BROWSER=1"
if /I "%~1"=="/noopen" set "OPEN_BROWSER=0"

pushd "%PROJECT_DIR%" >nul 2>&1
if errorlevel 1 (
  echo [Ошибка] Не удалось открыть папку проекта:
  echo %PROJECT_DIR%
  pause
  exit /b 1
)

where node.exe >nul 2>&1
if errorlevel 1 (
  echo [Ошибка] Node.js не найден.
  echo Установите актуальную LTS-версию Node.js с https://nodejs.org/
  echo Затем закройте это окно, откройте его снова и повторите запуск.
  popd
  pause
  exit /b 1
)

where npm.cmd >nul 2>&1
if errorlevel 1 (
  echo [Ошибка] npm не найден. Обычно npm устанавливается вместе с Node.js.
  echo Переустановите Node.js и повторите запуск.
  popd
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo [Моя смена] Установка зависимостей...
  if exist "package-lock.json" (
    call npm.cmd ci
  ) else (
    call npm.cmd install
  )
  if errorlevel 1 goto :install_error
) else if not exist "node_modules\vite\bin\vite.js" (
  echo [Моя смена] Зависимости установлены не полностью. Восстановление...
  call npm.cmd install
  if errorlevel 1 goto :install_error
)

echo [Моя смена] Подготовка production-сборки с офлайн-режимом...
call npm.cmd run build
if errorlevel 1 goto :build_error

echo [Моя смена] Запуск локального сервера...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference = 'Stop';" ^
  "$root = (Get-Location).Path;" ^
  "$pidFile = Join-Path $root '.moya-smena.pid';" ^
  "$viteScript = Join-Path $root 'node_modules\vite\bin\vite.js';" ^
  "if (Test-Path -LiteralPath $pidFile) {" ^
  "  $raw = (Get-Content -LiteralPath $pidFile -Raw).Trim();" ^
  "  $serverPid = 0;" ^
  "  if ([int]::TryParse($raw, [ref]$serverPid)) {" ^
  "    $existing = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $serverPid) -ErrorAction SilentlyContinue;" ^
  "    if ($existing -and ([string]$existing.CommandLine).IndexOf($viteScript, [StringComparison]::OrdinalIgnoreCase) -ge 0) {" ^
  "      Write-Host ('[Моя смена] Сервер уже запущен, PID ' + $serverPid + '.');" ^
  "      exit 10;" ^
  "    }" ^
  "  }" ^
  "  Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue;" ^
  "}" ^
  "$pathVars = @([Environment]::GetEnvironmentVariables([EnvironmentVariableTarget]::Process).GetEnumerator() | Where-Object { [string]$_.Key -ieq 'PATH' });" ^
  "if ($pathVars.Count -gt 1) {" ^
  "  $seen = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase);" ^
  "  $mergedPath = (((@($pathVars | ForEach-Object { [string]$_.Value }) -join ';') -split ';') | Where-Object { $_ -and $seen.Add($_) }) -join ';';" ^
  "  foreach ($pathVar in $pathVars) { [Environment]::SetEnvironmentVariable([string]$pathVar.Key, $null, [EnvironmentVariableTarget]::Process) };" ^
  "  [Environment]::SetEnvironmentVariable('Path', $mergedPath, [EnvironmentVariableTarget]::Process);" ^
  "}" ^
  "$node = (Get-Command node.exe -ErrorAction Stop).Source;" ^
  "$stdout = Join-Path $root '.moya-smena.stdout.log';" ^
  "$stderr = Join-Path $root '.moya-smena.stderr.log';" ^
  "$arguments = @($viteScript, 'preview', '--host', '127.0.0.1', '--port', '4173', '--strictPort');" ^
  "$process = Start-Process -FilePath $node -ArgumentList $arguments -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru;" ^
  "Set-Content -LiteralPath $pidFile -Value $process.Id -Encoding Ascii -NoNewline;" ^
  "Write-Host ('[Моя смена] Сервер запущен, PID ' + $process.Id + '.');"

set "START_CODE=%ERRORLEVEL%"
if "%START_CODE%"=="10" goto :wait_server
if not "%START_CODE%"=="0" (
  echo [Ошибка] Не удалось запустить Vite.
  popd
  pause
  exit /b %START_CODE%
)

:wait_server
echo [Моя смена] Ожидание ответа %APP_URL%
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
  "$deadline = [DateTime]::UtcNow.AddSeconds(45);" ^
  "$ready = $false;" ^
  "while ([DateTime]::UtcNow -lt $deadline) {" ^
  "  try {" ^
  "    $response = Invoke-WebRequest -Uri '%APP_URL%' -UseBasicParsing -TimeoutSec 2;" ^
  "    if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) { $ready = $true; break }" ^
  "  } catch {}" ^
  "  Start-Sleep -Milliseconds 500;" ^
  "}" ^
  "if (-not $ready) { exit 1 }"

if errorlevel 1 (
  echo [Ошибка] Сервер не ответил за 45 секунд.
  echo Проверьте .moya-smena.stderr.log и убедитесь, что порт 4173 свободен.
  call "%PROJECT_DIR%stop.bat" /quiet >nul 2>&1
  popd
  pause
  exit /b 1
)

if "%OPEN_BROWSER%"=="1" (
  echo [Моя смена] Готово. Открываю браузер...
  start "" "%APP_URL%"
) else (
  echo [Моя смена] Готово. Сервер отвечает по адресу %APP_URL%
)
popd
exit /b 0

:build_error
echo [Ошибка] Не удалось собрать production-версию приложения.
echo Проверьте сообщения npm выше и повторите запуск.
popd
pause
exit /b 1
:install_error
echo [Ошибка] Не удалось установить зависимости.
echo Проверьте подключение к интернету и сообщения npm выше.
popd
pause
exit /b 1
