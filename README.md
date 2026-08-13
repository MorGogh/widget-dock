# widget-dock · DSH 小组件面板

> DeepSeek Harness (dsh) 客户端插件：在对话页右侧提供安静的工作状态栏与可定制工作台。

Widget dock plugin for DeepSeek Harness — keep API balance, token usage, session stats, goal progress, and cost estimates in one focused workbench.

## ✨ 功能 / Features

- **工作状态栏**：默认显示上下文、目标、回合三项信息，始终固定在右侧
- **工作台**：点击状态栏展开；卡片可用左右拖动或箭头切换，无需纵向滚动查找
- **自动最小化**：切换到「轨迹」时自动收起为状态栏，避免遮挡轨迹内容
- **按需定制**：可固定余额、Token、会话统计、目标和成本估算；不需要拖动、缩放或布局管理
- **组件编辑**：余额可改 API Key，成本可改单价
- **持久化**：所选项目和配置存入 localStorage，重启保留

## 🧩 内置小组件 / Widgets

| 图标 | 组件 | 数据来源 |
|---|---|---|
| 💰 | API 余额 | DeepSeek `user/balance` 接口（含充值跳转、KEY 编辑）|
| 📊 | Token 用量 | `tokenUsage` 投影（输入/输出/缓存）|
| 📈 | 会话统计 | `sessionStats` 投影（回合/步骤/耗时）|
| 🎯 | 目标进度 | `goal` 投影 |
| 🧾 | 成本估算 | token × 单价（单价可编辑）|

## 📦 安装 / Install

```bash
# 1. 把插件目录链接进 web profile 的 node_modules
mkdir -p ~/.dsh/profiles/web/node_modules
ln -sfn "$(pwd)" ~/.dsh/profiles/web/node_modules/widget-dock

# 2. 在 ~/.dsh/profiles/web/cordis.patch.yml 追加：
# - insert:
#     - id: widget-dock
#       name: 'widget-dock'

# 3. 重启 dsh web
dsh web
```

重启后：右上角出现 **工作状态**。点击“展开工作台”即可查看或定制信息；标题栏的 `—` 可手动最小化。

## 🔧 配置 / Configuration

- 余额组件**不内置密钥**：首次使用在组件内点击"KEY 编辑"填入 DeepSeek API Key（存 localStorage，仅本机）
- 成本估算单价默认：输入 ¥2 / 缓存读 ¥0.5 / 缓存写 ¥2 / 输出 ¥8（每百万 tokens，可在组件内编辑；价格以 DeepSeek 官方为准）

## 📄 协议 / License

MIT
