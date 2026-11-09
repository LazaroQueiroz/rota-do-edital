@echo off
chcp 65001 >nul
cd /d "%~dp0"
where py >nul 2>nul && (py -3 backend\server.py %* & goto fim)
where python >nul 2>nul && (python backend\server.py %* & goto fim)
echo.
echo   Python nao encontrado. Instale em https://www.python.org/downloads/
echo   (marque a opcao "Add python.exe to PATH" durante a instalacao)
echo.
:fim
pause
