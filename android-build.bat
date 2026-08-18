@echo off
chcp 936 >nul
setlocal EnableDelayedExpansion
title JiaMusic - Android APK Builder
cd /d "%~dp0"

echo ============================================
echo  JiaMusic Android APK Builder
echo ============================================
echo.

:: Check JDK
set "JAVA_OK=0"
java -version >nul 2>&1
if %errorlevel%==0 (
    set "JAVA_OK=1"
    echo [OK] JDK found
) else (
    echo [MISS] JDK not found in PATH
)

:: Check Android SDK
set "SDK_OK=0"
if defined ANDROID_HOME (
    if exist "%ANDROID_HOME%\platform-tools\adb.exe" (
        set "SDK_OK=1"
        echo [OK] Android SDK: %ANDROID_HOME%
    )
)
if defined ANDROID_SDK_ROOT (
    if exist "%ANDROID_SDK_ROOT%\platform-tools\adb.exe" (
        set "SDK_OK=1"
        echo [OK] Android SDK: %ANDROID_SDK_ROOT%
    )
)
if "!SDK_OK!"=="0" (
    for %%P in (
        "%LOCALAPPDATA%\Android\Sdk"
        "%USERPROFILE%\AppData\Local\Android\Sdk"
        "C:\Android\Sdk"
        "D:\Android\Sdk"
    ) do (
        if exist "%%~P\platform-tools\adb.exe" (
            set "SDK_OK=1"
            set "ANDROID_HOME=%%~P"
            echo [OK] Android SDK auto-detected: %%~P
        )
    )
)
if "!SDK_OK!"=="0" echo [MISS] Android SDK not found

:: Check Gradle wrapper
set "GRADLE_OK=0"
if exist "android\gradlew.bat" (
    set "GRADLE_OK=1"
    echo [OK] Gradle wrapper found
) else (
    echo [MISS] android\gradlew.bat missing - run: npx cap add android
)

echo.
echo ============================================

if "!JAVA_OK!"=="1" if "!SDK_OK!"=="1" if "!GRADLE_OK!"=="1" (
    echo All checks passed. Ready to build APK.
    echo.
    goto :ask_build
)

echo Missing requirements. Please install:
echo.
if "!JAVA_OK!"=="0" (
    echo [1] Install JDK 17
    echo     winget install EclipseAdoptium.Temurin.17.JDK
    echo     or: https://adoptium.net/temurin/releases/?version=17
    echo.
)
if "!SDK_OK!"=="0" (
    echo [2] Install Android SDK
    echo     Recommended: Install Android Studio
    echo     https://developer.android.google.cn/studio
    echo     Then set: ANDROID_HOME=%%LOCALAPPDATA%%\Android\Sdk
    echo.
)
echo After installing, re-run this script.
echo.
pause
exit /b 1

:ask_build
echo Select build target:
echo  [1] Mobile - debug APK
echo  [2] Mobile - release APK
echo  [3] TV     - debug APK
echo  [4] TV     - release APK
echo  [5] Mobile + TV - debug APK
echo  [0] Exit
echo.
set /p android_choice=Enter choice (0-5): 

if "%android_choice%"=="0" exit /b 0
if "%android_choice%"=="1" goto :mobile_debug
if "%android_choice%"=="2" goto :mobile_release
if "%android_choice%"=="3" goto :tv_debug
if "%android_choice%"=="4" goto :tv_release
if "%android_choice%"=="5" goto :both_debug
echo Invalid choice.
pause
exit /b 1

:mobile_debug
echo Building mobile web assets...
call npm run build:mobile
if %errorlevel% neq 0 goto :build_fail
echo Syncing to Capacitor...
call npx cap sync android
if %errorlevel% neq 0 goto :build_fail
echo Building mobile debug APK...
cd android
call gradlew.bat assembleDebug
if %errorlevel% neq 0 ( cd .. & goto :build_fail )
cd ..
echo.
echo [DONE] APK: android\app\build\outputs\apk\debug\app-debug.apk
pause
exit /b 0

:mobile_release
echo Building mobile web assets...
call npm run build:mobile
if %errorlevel% neq 0 goto :build_fail
call npx cap sync android
if %errorlevel% neq 0 goto :build_fail
echo Building mobile release APK...
cd android
call gradlew.bat assembleRelease
if %errorlevel% neq 0 ( cd .. & goto :build_fail )
cd ..
echo.
echo [DONE] APK: android\app\build\outputs\apk\release\app-release.apk
pause
exit /b 0

:tv_debug
echo Building TV web assets...
call npm run build:tv
if %errorlevel% neq 0 goto :build_fail
set CAPACITOR_WEB_DIR=dist-tv
call npx cap sync android
if %errorlevel% neq 0 goto :build_fail
echo Building TV debug APK...
cd android
call gradlew.bat assembleDebug
if %errorlevel% neq 0 ( cd .. & goto :build_fail )
cd ..
set CAPACITOR_WEB_DIR=
echo.
echo [DONE] APK: android\app\build\outputs\apk\debug\app-debug.apk
pause
exit /b 0

:tv_release
echo Building TV web assets...
call npm run build:tv
if %errorlevel% neq 0 goto :build_fail
set CAPACITOR_WEB_DIR=dist-tv
call npx cap sync android
if %errorlevel% neq 0 goto :build_fail
echo Building TV release APK...
cd android
call gradlew.bat assembleRelease
if %errorlevel% neq 0 ( cd .. & goto :build_fail )
cd ..
set CAPACITOR_WEB_DIR=
echo.
echo [DONE] APK: android\app\build\outputs\apk\release\app-release.apk
pause
exit /b 0

:both_debug
echo Building Mobile APK...
call :mobile_debug
echo Building TV APK...
call :tv_debug
exit /b 0

:build_fail
echo.
echo [FAIL] Build failed. Check errors above.
pause
exit /b 1