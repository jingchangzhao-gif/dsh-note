@echo off
REM dsh-note cross-platform launcher (Windows).
REM Usage: run.bat [notes-directory]
node "%~dp0cli.mjs" %1
