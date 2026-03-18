@echo off
setlocal enabledelayedexpansion

echo === WoA Bot Upgrade Script ===

set "foundInstallation="

set "clawdbotDir=%USERPROFILE%\.clawdbot"
if exist "%clawdbotDir%\" (
    call :CleanupInstallation clawdbot
    set "foundInstallation=clawdbot"
)

set "openclawDir=%USERPROFILE%\.openclaw"
if exist "%openclawDir%\" (
    call :CleanupInstallation openclaw
    set "foundInstallation=openclaw"
)

set "moltbotDir=%USERPROFILE%\.moltbot"
if exist "%moltbotDir%\" (
    call :CleanupInstallation moltbot
    set "foundInstallation=moltbot"
)

if "%foundInstallation%"=="" (
    echo clawdbot, openclaw or moltbot not found
    exit /b 1
)

set "cmd=%foundInstallation%"

echo.
echo === Cleanup Complete ===
echo.
echo Run these commands to reinstall:
for %%I in ("%~dp0..") do set "woabotDir=%%~fI"
echo   cd %woabotDir%
echo   %cmd% plugins install .
echo   %cmd% gateway restart
exit /b 0

:CleanupInstallation
set "AppName=%~1"
set "appDir=%USERPROFILE%\.%AppName%"
set "configFile=%appDir%\%AppName%.json"

echo.
echo ^>^>^> Processing %AppName% installation...

rem Clean up both woabot and legacy qqbot extension dirs
for %%E in (woabot qqbot) do (
    set "extensionDir=%appDir%\extensions\%%E"
    if exist "!extensionDir!\" (
        echo Deleting old plugin: !extensionDir!
        rd /s /q "!extensionDir!" 2>nul || (
            echo Warning: Could not delete !extensionDir! ^(permission denied^)
            echo   Please delete it manually if needed
        )
    )
)

if exist "%configFile%" (
    echo Cleaning woabot/qqbot fields from config...
    set "configPath=%configFile:\=/%"
    node -e "const fs=require('fs');const c=JSON.parse(fs.readFileSync('!configPath!','utf8'));['woabot','qqbot'].forEach(n=>{if(c.channels&&c.channels[n]){delete c.channels[n];console.log('  - deleted channels.'+n);}if(c.plugins&&c.plugins.entries&&c.plugins.entries[n]){delete c.plugins.entries[n];console.log('  - deleted plugins.entries.'+n);}if(c.plugins&&c.plugins.installs&&c.plugins.installs[n]){delete c.plugins.installs[n];console.log('  - deleted plugins.installs.'+n);}if(c.plugins&&c.plugins.allow&&Array.isArray(c.plugins.allow)){const i=c.plugins.allow.indexOf(n);if(i!==-1){c.plugins.allow.splice(i,1);console.log('  - deleted '+n+' from plugins.allow array');}}});fs.writeFileSync('!configPath!',JSON.stringify(c,null,2));console.log('Config file updated');" || (
        echo Warning: Node.js error
    )
) else (
    echo Config file not found: %configFile%
)
exit /b 0
