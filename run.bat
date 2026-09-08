@echo off
REM dsh-note launcher (Windows).
REM Double-click: opens an interactive window where you type commands, e.g.
REM     list C:\Users\me\notes
REM     remember C:\notes --name session.md --content "decided: pnpm"
REM     memory-recall D:\memory --query pnpm
REM     exit
REM From a terminal you can also pass a one-shot command:
REM     run.bat <command> [dir] [--flags...]
chcp 65001 >nul
title dsh-note
where node >nul 2>nul
if errorlevel 1 (
    echo [dsh-note] Node.js not found - install it from https://nodejs.org first
    pause
    exit /b 1
)
cd /d "%~dp0"
node cli.mjs %*
if errorlevel 1 pause
