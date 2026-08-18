@echo off
chcp 936 >nul
setlocal EnableDelayedExpansion
title JiaMusic - Android APK 打包工具
cd /d "%~dp0"

echo ============================================
echo  JiaMusic Android APK 打包工具
echo ============================================
echo.

:: 检查 JDK
set "JAVA_OK=0"
java -version >nul 2>&1
if %errorlevel%==0 (
    set "JAVA_OK=1"
    echo [OK] JDK 已安装
) else (
    echo [缺少] JDK 未安装或不在 PATH 中
)

:: 检查 Android SDK
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
            echo [OK] 自动检测到 Android SDK: %%~P
        )
    )
)
if "!SDK_OK!"=="0" echo [缺少] 未找到 Android SDK

:: 检查 Gradle wrapper
set "GRADLE_OK=0"
if exist "android\gradlew.bat" (
    set "GRADLE_OK=1"
    echo [OK] Gradle wrapper 存在
) else (
    echo [缺少] android\gradlew.bat 不存在，请先运行 npx cap add android
)

echo.
echo ============================================

if "!JAVA_OK!"=="1" if "!SDK_OK!"=="1" if "!GRADLE_OK!"=="1" (
    echo 环境检查通过！可以本地打包 APK。
    echo.
    goto :ask_build
)

echo 缺少必要环境，请按以下步骤安装：
echo.
if "!JAVA_OK!"=="0" (
    echo [1] 安装 JDK 17
    echo     方式一：winget install EclipseAdoptium.Temurin.17.JDK
    echo     方式二：https://adoptium.net/temurin/releases/?version=17
    echo.
)
if "!SDK_OK!"=="0" (
    echo [2] 安装 Android SDK
    echo     推荐：安装 Android Studio（含完整 SDK）
    echo     下载：https://developer.android.google.cn/studio
    echo     安装后设置环境变量：
    echo       ANDROID_HOME = %LOCALAPPDATA%\Android\Sdk
    echo.
)
echo 安装完成后重新运行此脚本。
echo.
pause
exit /b 1

:ask_build
echo 选择打包目标：
echo  [1] 手机端 debug APK
echo  [2] 手机端 release APK
echo  [3] TV 端 debug APK
echo  [4] TV 端 release APK
echo  [5] 手机 + TV debug APK（连续打包）
echo  [0] 退出
echo.
set /p android_choice=请输入选项（0-5）：

if "%android_choice%"=="0" exit /b 0
if "%android_choice%"=="1" goto :mobile_debug
if "%android_choice%"=="2" goto :mobile_release
if "%android_choice%"=="3" goto :tv_debug
if "%android_choice%"=="4" goto :tv_release
if "%android_choice%"=="5" goto :both_debug
echo 无效选项。
pause
exit /b 1

:mobile_debug
echo 正在构建手机端 Web 资源...
call npm run build:mobile
if %errorlevel% neq 0 goto :build_fail
echo 正在同步到 Capacitor...
call npx cap sync android
if %errorlevel% neq 0 goto :build_fail
echo 正在打包手机端 debug APK...
cd android
call gradlew.bat assembleDebug
if %errorlevel% neq 0 ( cd .. & goto :build_fail )
cd ..
echo.
echo [完成] APK 位置：android\app\build\outputs\apk\debug\app-debug.apk
pause
exit /b 0

:mobile_release
echo 正在构建手机端 Web 资源...
call npm run build:mobile
if %errorlevel% neq 0 goto :build_fail
call npx cap sync android
if %errorlevel% neq 0 goto :build_fail
echo 正在打包手机端 release APK...
cd android
call gradlew.bat assembleRelease
if %errorlevel% neq 0 ( cd .. & goto :build_fail )
cd ..
echo.
echo [完成] APK 位置：android\app\build\outputs\apk\release\app-release.apk
pause
exit /b 0

:tv_debug
echo 正在构建 TV 端 Web 资源...
call npm run build:tv
if %errorlevel% neq 0 goto :build_fail
set CAPACITOR_WEB_DIR=dist-tv
call npx cap sync android
if %errorlevel% neq 0 goto :build_fail
echo 正在打包 TV 端 debug APK...
cd android
call gradlew.bat assembleDebug
if %errorlevel% neq 0 ( cd .. & goto :build_fail )
cd ..
set CAPACITOR_WEB_DIR=
echo.
echo [完成] APK 位置：android\app\build\outputs\apk\debug\app-debug.apk
pause
exit /b 0

:tv_release
echo 正在构建 TV 端 Web 资源...
call npm run build:tv
if %errorlevel% neq 0 goto :build_fail
set CAPACITOR_WEB_DIR=dist-tv
call npx cap sync android
if %errorlevel% neq 0 goto :build_fail
echo 正在打包 TV 端 release APK...
cd android
call gradlew.bat assembleRelease
if %errorlevel% neq 0 ( cd .. & goto :build_fail )
cd ..
set CAPACITOR_WEB_DIR=
echo.
echo [完成] APK 位置：android\app\build\outputs\apk\release\app-release.apk
pause
exit /b 0

:both_debug
echo 开始连续打包手机端 + TV 端...
call :mobile_debug
echo 开始打包 TV 端...
call :tv_debug
exit /b 0

:build_fail
echo.
echo [失败] 构建失败，请检查上方错误信息。
pause
exit /b 1