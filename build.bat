@echo off
chcp 65001 >nul
title JiaMusic 项目管理脚本
cd /d "%~dp0"

:menu
cls
echo ============================================
echo          JiaMusic 项目管理脚本
echo ============================================
echo  [1] 启动开发模式   npm run electron:dev
echo  [2] 打包构建       多端打包菜单
echo  [3] Android APK  手机端 / TV 端打包
echo  [4] 提交并推送到 GitHub
echo  [5] 退出
echo ============================================
set /p choice=请选择操作（输入 1-5 后回车）：

if "%choice%"=="1" goto dev
if "%choice%"=="2" goto build_menu
if "%choice%"=="3" goto android_build
if "%choice%"=="4" goto push
if "%choice%"=="5" goto end
echo 输入无效，请重新选择。
pause
goto menu

:dev
echo 正在启动开发模式（已在新窗口打开，可随时关闭该窗口）...
start "JiaMusic 开发模式" npm run electron:dev
goto menu

:build_menu
cls
echo ============================================
echo              JiaMusic 多端打包
echo ============================================
echo  [1] Web 静态包             npm run build:web
echo  [2] 手机端 H5 包           npm run build:mobile
echo  [3] TV 端 Web 包           npm run build:tv
echo  [4] 桌面端：当前平台       npm run electron:build
echo  [5] Windows 全架构         npm run electron:build:win
echo  [6] Windows x64            npm run electron:build:win:x64
echo  [7] macOS 全架构           npm run electron:build:mac
echo  [8] macOS x64              npm run electron:build:mac:x64
echo  [9] macOS arm64            npm run electron:build:mac:arm64
echo  [10] Linux 全架构          npm run electron:build:linux
echo  [11] Linux x64             npm run electron:build:linux:x64
echo  [12] Windows + Linux x64   连续打包
echo  [0] 返回主菜单
echo ============================================
echo 提示：手机端 / TV 端这里打的是可部署 Web 包；APK/TV APK 需要额外接入 Android 容器。
echo 提示：macOS 安装包通常需要在 macOS 系统上打包。
echo ============================================
set /p build_choice=请选择打包目标（输入 0-12 后回车）：

set "build_title="
set "build_cmd="

if "%build_choice%"=="0" goto menu
if "%build_choice%"=="1" set "build_title=Web 静态包"& set "build_cmd=npm run build:web"
if "%build_choice%"=="2" set "build_title=手机端 H5 包"& set "build_cmd=npm run build:mobile"
if "%build_choice%"=="3" set "build_title=TV 端 Web 包"& set "build_cmd=npm run build:tv"
if "%build_choice%"=="4" set "build_title=桌面端：当前平台"& set "build_cmd=npm run electron:build"
if "%build_choice%"=="5" set "build_title=Windows 全架构"& set "build_cmd=npm run electron:build:win"
if "%build_choice%"=="6" set "build_title=Windows x64"& set "build_cmd=npm run electron:build:win:x64"
if "%build_choice%"=="7" set "build_title=macOS 全架构"& set "build_cmd=npm run electron:build:mac"
if "%build_choice%"=="8" set "build_title=macOS x64"& set "build_cmd=npm run electron:build:mac:x64"
if "%build_choice%"=="9" set "build_title=macOS arm64"& set "build_cmd=npm run electron:build:mac:arm64"
if "%build_choice%"=="10" set "build_title=Linux 全架构"& set "build_cmd=npm run electron:build:linux"
if "%build_choice%"=="11" set "build_title=Linux x64"& set "build_cmd=npm run electron:build:linux:x64"
if "%build_choice%"=="12" goto build_win_linux_x64

if "%build_cmd%"=="" (
    echo 输入无效，请重新选择。
    pause
    goto build_menu
)

goto run_build

:run_build
echo 正在打包：%build_title%
echo 执行命令：%build_cmd%
echo ============================================
call %build_cmd%
if %errorlevel%==0 (
    echo ============================================
    echo  %build_title% 构建完成！
    echo  Web 输出目录：dist
    echo  手机端输出目录：dist-mobile
    echo  TV 端输出目录：dist-tv
    echo  桌面端输出目录：release
    echo ============================================
) else (
    echo ============================================
    echo  %build_title% 构建失败，请检查上方错误信息。
    echo ============================================
)
pause
goto build_menu

:build_win_linux_x64
echo 正在连续打包：Windows x64 + Linux x64
echo ============================================
call npm run electron:build:win:x64
if not %errorlevel%==0 goto build_combo_failed
call npm run electron:build:linux:x64
if not %errorlevel%==0 goto build_combo_failed
echo ============================================
echo  Windows x64 + Linux x64 构建完成！
echo  桌面端输出目录：release
echo ============================================
pause
goto build_menu

:build_combo_failed
echo ============================================
echo  连续打包失败，请检查上方错误信息。
echo ============================================
pause
goto build_menu

:android_build
call android-build.bat
goto menu

:push
echo 正在检查工作区修改...
git add -A
git diff --cached --quiet
if %errorlevel%==0 (
    echo 当前没有需要提交的修改，已跳过。
    pause
    goto menu
)
set /p msg=请输入提交说明（直接回车使用默认说明）：
if "%msg%"=="" set "msg=更新：%date% %time%"
git commit -m "%msg%"
git push origin main
if %errorlevel%==0 (
    echo ============================================
    echo  已成功提交并推送到 GitHub！
    echo ============================================
) else (
    echo ============================================
    echo  推送失败，请检查网络或 SSH 权限。
    echo ============================================
)
pause
goto menu

:end
exit
