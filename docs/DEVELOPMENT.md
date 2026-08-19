# 开发约定（Development Guidelines）

本文档记录 ZJ-Music 项目必须遵守的开发约束。

## 跨端开发前提：不得影响桌面端

> **修改或优化 TV 端、手机端（以及任何非桌面目标）时，不得影响桌面端（Electron）的现有功能。**

这是硬性前提，适用所有端相关的改动：

1. 桌面端（Electron）是主平台，功能完整度、稳定性优先级最高。
2. 任何面向 TV / 手机端的改动（UI、样式、交互、服务、构建配置）都必须先评估对桌面端的影响：
   - 共享代码（`src/` 下同一份代码）的改动要同时兼顾三端行为；
   - 端差异必须通过环境判断隔离（如 `hasElectronApi`、`VITE_APP_TARGET`、视口/指针特征），不能直接改坏桌面路径；
   - 桌面专属能力（Electron IPC、主进程、文件系统）保持不变。
3. 提交前必须验证桌面端不受影响：
   - `npm run build`（tsc + vite build + electron:compile）通过；
   - 涉及共享渲染逻辑时，桌面端关键功能（播放、音源、本地音乐、设置）做冒烟验证；
   - 新增 Electron IPC 或 preload 改动时，桌面端必须完整回归。
4. 若改动确实需要同时调整桌面端行为，必须单独说明并确认，不能"顺带"修改。

### 参考：三端环境判断

- 桌面端：存在 `window.electronAPI`
- 手机 / 浏览器：无 `window.electronAPI`（走 Web 运行时，如 LX 音源 `webLxSourceRuntime`）
- TV：构建目标 `VITE_APP_TARGET=tv` + 视口/指针特征（见 `useTvFocus`）
