# widget-dock · DSH 小组件面板

> DeepSeek Harness (dsh) 客户端插件：在对话页面的两侧空白处挂载可拖动、可排序的小组件面板。

Widget dock plugin for DeepSeek Harness — add mini-apps (API balance, token usage, session stats, quick commands, goal progress, cost estimate) to the blank areas beside the conversation.

## ✨ 功能 / Features

- **➕ 输入框左下角入口**：点击弹出"添加小组件"面板（`conversation.input.left`）
- **拖出放置**：从面板把组件拖到左/右侧空白处落位（空列显示虚线占位框）；点击组件则添加到右侧
- **两侧吸附**：组件吸附在对话内容外侧空白，**不遮挡对话**（JS 实测容器位置 + ResizeObserver 自适应，空间不足自动隐藏）
- **拖动排序**：按住组件头部 ⠿ 在同列内拖放排序
- **组件编辑**：余额卡可改 API Key，成本卡可改单价
- **持久化**：位置/配置存 localStorage，重启保留

## 🧩 内置小组件 / Widgets

| 图标 | 组件 | 数据来源 |
|---|---|---|
| 💰 | API 余额 | DeepSeek `user/balance` 接口（含充值跳转、KEY 编辑）|
| 📊 | Token 用量 | `tokenUsage` 投影（输入/输出/缓存）|
| 📈 | 会话统计 | `sessionStats` 投影（回合/步骤/耗时）|
| ⚡ | 快捷命令 | `/compact` `/goal` `/model` 等一键执行 |
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

重启后：输入框工具行左下角出现 **➕** → 打开面板 → 拖出或点击添加组件。

## 🔧 配置 / Configuration

- 余额组件**不内置密钥**：首次使用在组件内点击"KEY 编辑"填入 DeepSeek API Key（存 localStorage，仅本机）
- 成本估算单价默认：输入 ¥2 / 缓存读 ¥0.5 / 缓存写 ¥2 / 输出 ¥8（每百万 tokens，可在组件内编辑；价格以 DeepSeek 官方为准）

## 📄 协议 / License

MIT
