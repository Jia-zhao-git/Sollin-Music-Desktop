@echo off
chcp 936 >nul
setlocal EnableDelayedExpansion
title JiaMusic - Android APK 打包工具
cd /d "%~dp0"

:: 读取版本号（通过临时 JS 文件避免引号转义问题）
echo process.stdout.write(require('./package.json').version) > "%TEMP%\getver.js"
for /f "delims=" %%V in ('node "%TEMP%\getver.js"') do set "APP_VER=%%V"
del "%TEMP%\getver.js" >nul 2>&1
if "%APP_VER%"=="" set "APP_VER=1.0.0"

echo ============================================
echo  JiaMusic Android APK 打包工具  v%APP_VER%
echo ============================================
echo.

:: ─── 自动查找 JDK 21（Capacitor 7.x 要求）──
set "JAVA_OK=0"

java -version >nul 2>&1
if %errorlevel%==0 (
    set "JAVA_OK=1"
    echo [OK] JDK 已在 PATH 中
    goto :check_sdk
)

for %%P in (
    "C:\Program Files\Eclipse Adoptium\jdk-21*"
    "C:\Program Files\Java\jdk-21*"
    "C:\Program Files\Microsoft\jdk-21*"
    "C:\Program Files\BellSoft\LibericaJDK-21*"
) do (
    if exist "%%~P\bin\java.exe" (
        set "JAVA_HOME=%%~P"
        set "PATH=%%~P\bin;!PATH!"
        set "JAVA_OK=1"
        echo [OK] 自动检测到 JDK 21: %%~P
        goto :check_sdk
    )
)

for %%P in (
    "C:\Program Files\Eclipse Adoptium\jdk-17.0.20.8-hotspot"
    "C:\Program Files\Eclipse Adoptium\jdk-17*"
    "C:\Program Files\Java\jdk-17*"
    "C:\Program Files\Microsoft\jdk-17*"
) do (
    if exist "%%~P\bin\java.exe" (
        set "JAVA_HOME=%%~P"
        set "PATH=%%~P\bin;!PATH!"
        set "JAVA_OK=1"
        echo [警告] 检测到 JDK 17，Capacitor 7.x 需要 JDK 21，可能编译失败
        echo [警告] 建议：winget install EclipseAdoptium.Temurin.21.JDK
        goto :check_sdk
    )
)

for /f "tokens=2*" %%A in ('reg query "HKLM\SOFTWARE\JavaSoft\JDK" /v CurrentVersion 2^>nul') do set "JDK_VER=%%B"
if defined JDK_VER (
    for /f "tokens=2*" %%A in ('reg query "HKLM\SOFTWARE\JavaSoft\JDK\!JDK_VER!" /v JavaHome 2^>nul') do set "JAVA_HOME=%%B"
    if defined JAVA_HOME (
        if exist "!JAVA_HOME!\bin\java.exe" (
            set "PATH=!JAVA_HOME!\bin;!PATH!"
            set "JAVA_OK=1"
            echo [OK] 从注册表找到 JDK !JDK_VER!: !JAVA_HOME!
        )
    )
)

if "!JAVA_OK!"=="0" echo [缺少] 未找到 JDK

:check_sdk
set "SDK_OK=0"
if defined ANDROID_HOME (
    if exist "%ANDROID_HOME%\platform-tools\adb.exe" (
        set "SDK_OK=1"
        echo [OK] Android SDK: %ANDROID_HOME%
        goto :check_gradle
    )
)
if defined ANDROID_SDK_ROOT (
    if exist "%ANDROID_SDK_ROOT%\platform-tools\adb.exe" (
        set "SDK_OK=1"
        set "ANDROID_HOME=%ANDROID_SDK_ROOT%"
        echo [OK] Android SDK: %ANDROID_SDK_ROOT%
        goto :check_gradle
    )
)
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
        goto :check_gradle
    )
)
echo [缺少] 未找到 Android SDK

:check_gradle
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
    echo 环境检查通过！
    echo.
    goto :ask_build
)

echo 缺少必要环境，请按以下步骤安装：
echo.
if "!JAVA_OK!"=="0" (
    echo [1] 安装 JDK 21（Capacitor 7.x 必须）
    echo     方式一：winget install EclipseAdoptium.Temurin.21.JDK
    echo     方式二：https://adoptium.net/temurin/releases/?version=21
    echo.
)
if "!SDK_OK!"=="0" (
    echo [2] 安装 Android SDK
    echo     推荐：安装 Android Studio（含完整 SDK）
    echo     下载：https://developer.android.google.cn/studio
    echo.
)
echo 安装完成后重新运行此脚本。
echo.
pause
exit /b 1

:ask_build
echo 选择打包目标：
echo  [1] 手机端 debug APK
echo  [2] 手机端 release APK（需签名配置）
echo  [3] TV 端 debug APK
echo  [4] TV 端 release APK（需签名配置）
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
set "GRADLE_ERR=%errorlevel%"
cd ..
if %GRADLE_ERR% neq 0 goto :build_fail
call :copy_apk "android\app\build\outputs\apk\debug\app-debug.apk" "ZJ-android-%APP_VER%-debug.apk"
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
set "GRADLE_ERR=%errorlevel%"
cd ..
if %GRADLE_ERR% neq 0 goto :build_fail
set "RELEASE_SRC="
if exist "android\app\build\outputs\apk\release\app-release.apk" set "RELEASE_SRC=android\app\build\outputs\apk\release\app-release.apk"
if exist "android\app\build\outputs\apk\release\app-release-unsigned.apk" set "RELEASE_SRC=android\app\build\outputs\apk\release\app-release-unsigned.apk"
if "%RELEASE_SRC%"=="" goto :build_fail
call :copy_apk "%RELEASE_SRC%" "ZJ-android-%APP_VER%.apk"
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
set "GRADLE_ERR=%errorlevel%"
cd ..
set CAPACITOR_WEB_DIR=
if %GRADLE_ERR% neq 0 goto :build_fail
call :copy_apk "android\app\build\outputs\apk\debug\app-debug.apk" "ZJ-tv-%APP_VER%-debug.apk"
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
set "GRADLE_ERR=%errorlevel%"
cd ..
set CAPACITOR_WEB_DIR=
if %GRADLE_ERR% neq 0 goto :build_fail
set "RELEASE_SRC="
if exist "android\app\build\outputs\apk\release\app-release.apk" set "RELEASE_SRC=android\app\build\outputs\apk\release\app-release.apk"
if exist "android\app\build\outputs\apk\release\app-release-unsigned.apk" set "RELEASE_SRC=android\app\build\outputs\apk\release\app-release-unsigned.apk"
if "%RELEASE_SRC%"=="" goto :build_fail
call :copy_apk "%RELEASE_SRC%" "ZJ-tv-%APP_VER%.apk"
pause
exit /b 0

:both_debug
echo 开始连续打包手机端 + TV 端...
call :mobile_debug
echo 开始打包 TV 端...
call :tv_debug
exit /b 0

:copy_apk
set "SRC=%~1"
set "DEST_NAME=%~2"
if not exist "release" mkdir release
if not exist "%SRC%" (
    echo [警告] APK 文件不存在：%SRC%
    goto :eof
)
copy /y "%SRC%" "release\%DEST_NAME%" >nul
echo.
echo [完成] APK 已复制到 release\%DEST_NAME%
for %%F in ("release\%DEST_NAME%") do echo [大小] %%~zF bytes
goto :eof

:build_fail
echo.
echo [失败] 构建失败，请检查上方错误信息。
pause
exit /b 1