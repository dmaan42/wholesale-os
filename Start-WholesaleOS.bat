@echo off
title WholesaleOS 
color 0A

echo.
echo Starting WholesaleOS...
echo.

cd /d "c:\Users\lisabug\Downloads\wholesaleOS\wholesale-os"

echo Current folder
cd
echo.

echo Installing packages (this can take a couple minutes)...
call npm install

echo.
echo Starting the software...
echo Open your browser to: http://localhost:3000
echo.
echo Keep this window open.
echo.

call npm run dev
pause