@echo off
rem Cai tac vu giu may thuc + man hinh sang 24/24 (cho PAD attended, vd. SAP). Bo -Screen neu chi can may khong ngu.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0GiuMay_Thuc.ps1" -Install -Screen
pause
