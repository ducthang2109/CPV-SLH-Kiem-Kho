@echo off
rem Go tac vu dong bo tu dong
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0DongBo_KiemKe.ps1" -Uninstall
pause
