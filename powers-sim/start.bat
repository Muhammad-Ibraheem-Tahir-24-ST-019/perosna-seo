@echo off
REM Serves this folder and opens the app. The camera only works over
REM http://localhost, which is why this cannot just double-click index.html.
cd /d "%~dp0"
where python >nul 2>nul && goto :py
where node   >nul 2>nul && goto :node
echo Neither python nor node was found on PATH. Install either one, or use any
echo other static web server pointed at this folder.
pause & exit /b 1

:py
start "" http://localhost:8777/index.html
python serve.py 8777
exit /b

:node
start "" http://localhost:8777/index.html
npx --yes serve -l 8777 .
exit /b
