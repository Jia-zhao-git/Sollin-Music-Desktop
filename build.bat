@echo off
chcp 936 >nul
title JiaMusic 项目管理脚本
cd /d "%~dp0"

:menu
cls
echo ============================================
echo          JiaMusic 项目管理脚本
echo ============================================
echo  [1] 启动开发模式   npm run electron:dev
echo  [2] 打包构建       npm run electron:build
echo  [3] 提交并推送到 GitHub
echo  [4] 退出
echo ============================================
set /p choice=请选择操作（输入 1-4 后回车）：

if "%choice%"=="1" goto dev
if "%choice%"=="2" goto build
if "%choice%"=="3" goto push
if "%choice%"=="4" goto end
echo 输入无效，请重新选择。
pause
goto menu

:dev
echo 正在启动开发模式（已在新窗口打开，可随时关闭该窗口）...
start "JiaMusic 开发模式" npm run electron:dev
goto menu

:build
echo 正在打包构建，请稍候...
call npm run electron:build
if %errorlevel%==0 (
    echo ============================================
    echo  构建完成！输出文件在 dist-electron 目录。
    echo ============================================
) else (
    echo ============================================
    echo  构建失败，请检查上方错误信息。
    echo ============================================
)
pause
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
