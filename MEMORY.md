# widget-dock 项目记忆

> 自动维护：每次重要进展后更新此文件，新对话请先读这里再动手。

## 项目概要

- DSH（DeepSeek Harness）客户端插件：对话页两侧空白区的可拖拽迷你卡片工作台。
- 技术形态：静态客户端插件，`lib/client.js` 内全部 UI 逻辑（React.createElement，无 JSX/import），`cordis.patch.yml` + `dsh.bundle` 自动注册，slot `conversation.input.left`（session 作用域）。
- 仓库：https://github.com/MorGogh/widget-dock （分支 main）
- npm：widget-dock（最新 1.0.1，已发布）
- 官方精选列表：awesome-dsh-plugin 已收录（PR #144 已合并）；另有一个刷新描述的 PR（分支 `wd-desc-update`，尚未推送/开 PR）。

## 当前版本功能（1.0.1）

- 22 个 WIDGETS 条目，21 张可用卡片：上下文水位/构成/压力/沙漏/剩余、响应仪表、目标冲刺、双模对比、工作区罗盘、声音提示、轮次彩蛋、自定义命令、计划模式、图像限制、灵感速记、会话账单、会话时光机、待办、权限模式、API 余额、Token 用量、会话统计、目标进度、成本估算。
- 尺寸档位 S/M/L/XL（160/220/300/400px），内容随尺寸渐进（Apple 风格）。
- 自由拖拽排序、跨侧拖放、固定卡片不移动、拖放不重叠（findSpot 空白搜索）。
- 面板对齐：动态测量标题栏底部（`.wSkVaW_header`）与会话列表右边缘（`.pI_x6G_sidebarCol`），左侧/顶部统一 14px 间距；左侧面板额外 12px（共 26px）避免滚动条压对话正文。
- 滚动条：与 DSH 会话列表同款（`--dsh-scrollbar-thumb` token，8px 圆角）；overlay 效果——滚动/悬停时淡入，停止 600ms 后淡出（`.scrolling` class + onScroll）。
- 会话时光机卡片：`typeof useSessions === "function"` 稳定调用（hook 顺序稳定），拿会话列表点击跳转。

## 关键代码位置（lib/client.js）

- `findChatContainer()` ~L26：对话容器（`.wSkVaW_root` + `--dsh-chat-content-width` 回退）
- `findHeaderBar()` / `findSidebar()` ~L46-86：标题栏/会话列表动态测量（带回退）
- `measure()` ~L1292：布局计算（14px 统一间距）
- `deckStyle()` ~L1382：deck 定位 + 动态 max-height
- `WIDGETS` ~L1166：卡片注册表
- `apply()` ~L1447：slot 注入，提前提取 `remote.commands.execute` / `sessions.open`（避免 guard）
- 状态持久化：`widget-dock:state`（布局）、`widget-dock:ui`（最小化）、`widget-dock:custom-commands`、`widget-dock:notepad`、`api-balance:api-key`

## ⚠️ 安全红线（最重要）

- **本地 `lib/client.js` 的 `EMBEDDED_KEY` 有值**（`sk-bf5280...`，仅本地副本）。GitHub/npm 版本必须为空。
- 发布流程：备份 → 清空 key → commit/push/publish → 验证远程无 key → 恢复备份。
- 备份文件：`/tmp/client.js.key-backup`（临时，机器重启会丢，每次发布前重新备份）。

## 待办 / 优化清单（用户认可方向）

1. ~~发布安全：pre-push hook / prepublishOnly 自动检测 `sk-` 密钥拦截泄露~~ ✅ 已完成（scripts/check-secret.mjs + .githooks/pre-push + package.json prepack/prepublishOnly 三重拦截，已验证：有 key 拦截、无 key 放行）
2. ~~卡片折叠：点击标题收起/展开内容，只留标题行~~ ✅ 已完成（config.collapsed 持久化，▾/▸ 箭头，拖动不误触折叠——didDragRef 标记区分拖与点）
3. ~~会话时光机正规化：注册全局 slot 合法拿 `useSessions`，去掉 typeof hack~~ ✅ 已完成（useSessions 本是 GlobalStandardProps，每个 session 作用域 slot 都注入；改为 WidgetDock 顶层无条件调用 + 选择器只取切片 {ids,titles,cwds,current} + eq 内容比较防无关重渲染；消费卡片改为适配切片，移除 byId 依赖）
4. ~~清理死代码：.wd-status 状态栏 CSS 残留~~ ✅ 已完成（8 行 CSS 已删）
5. 数据节流（token/余额卡片刷新间隔）、布局快照（JSON 导出/导入）、拖拽 lift 动画、空状态引导文案。

## 发布状态

- git main：`25deff7`（chore: bump 1.0.1）→ `db511d9`（对齐+overlay 滚动条）→ `b44f34a`（内容渐进）
- 待提交：MEMORY.md、scripts/check-secret.mjs、.githooks/pre-push、package.json（check-secret 脚本）、lib/client.js（删死代码 + 卡片折叠）——需清 key 后提交推送
- npm：1.0.1 已发布（含对齐+滚动条）；1.0.2 待发布（折叠+安全闸门）
- 待办：`wd-desc-update` 分支推送 + 新 PR（需用户在终端 push，token 缺 workflow scope）

## 环境事实

- 工作目录：/Users/cock/dsh-plugins/widget-dock
- DSH 安装：`~/.npm-global/lib/node_modules/@deepseek-ai/dsh`；web 前端打包产物在 `node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/`（压缩，类名带哈希）
- 本地 profile：`~/.dsh/profiles/web/`，node_modules/widget-dock 是 symlink → 项目目录
- 用户沟通：中文；用户定方向，助手操作。
