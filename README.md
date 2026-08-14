# 🐋 widget-dock · DSH 小组件面板

> DeepSeek Harness (dsh) 客户端插件：在对话两侧的空白区域提供可自由拖动的卡片工作台，一眼掌握 API 余额、Token 用量、会话统计等状态。
>
> Widget dock plugin for DeepSeek Harness — a draggable workbench of mini-cards on the blank areas beside the conversation.

[![GitHub stars](https://img.shields.io/github/stars/MorGogh/widget-dock?style=flat-square&label=Stars)](https://github.com/MorGogh/widget-dock/stargazers)
[![License](https://img.shields.io/github/license/MorGogh/widget-dock?style=flat-square)](LICENSE)
[![DSH Plugin](https://img.shields.io/badge/DSH-Plugin-4D6BFE?style=flat-square&logo=github)](https://github.com/topics/dsh-plugin)
[![Release](https://img.shields.io/github/v/release/MorGogh/widget-dock?style=flat-square)](https://github.com/MorGogh/widget-dock/releases)

---

## 🖼️ 效果预览 / Preview

| 工作台（对话页两侧） | 添加面板（右侧侧栏） |
|---|---|
| ![widget-dock 工作台](assets/screenshots/workbench.png) | ![添加面板](assets/screenshots/panel.png) |

## ✨ 功能 / Features

- **双侧工作台填满空白**：卡片吸附在对话内容的左/右两侧空白区，工作台宽度跟随可用空白（不再有 440px 上限），卡片按尺寸自动换行排布
- **卡片尺寸档位**：每张卡片头部有尺寸按钮，支持 **S / M / L / XL** 四档宽度（160 / 220 / 300 / 400px），内容随宽度自适应
- **头部随时拖动**：按住卡片头部（`⠿`）即可拖动——**无需进入排序模式**；同侧拖动排序，拖到另一侧自动换侧
- **右侧管理侧栏**：点击右侧工作台右上角 `＋` 打开侧栏，集中管理：添加面板、切换左右侧、最小化、关闭
- **窄窗口与轨迹页**：空间不足或切换到「轨迹」时，工作台缩成贴边标签，不遮挡正文
- **官方定价成本估算**：成本卡内置 DeepSeek **官方峰谷定价**（8/17 生效），支持 `v4-flash` / `v4-pro` 一键切换模型，单价可手动调整；费用按输入/输出/缓存分项显示
- **大数字友好**：Token 用量等大数字自动格式化（`102780061` → `1.03亿`），不会溢出卡片
- **组件编辑**：余额可改 API Key，成本可改单价
- **持久化**：卡片项目、位置、尺寸、配置全部存入 localStorage，重启保留

- **Dual-side workbench**: cards use only the blank space beside the conversation; workbench width follows the free space, cards wrap by size
- **Size tiers**: S / M / L / XL (160 / 220 / 300 / 400px) per card, content adapts
- **Always-draggable heads**: grab the card head (`⠿`) anytime — reorder within a side or drag across sides; no arrange mode needed
- **Right management drawer**: click `＋` at the top-right of the right workbench to add/manage/minimize/close
- **Official pricing cost estimate**: DeepSeek peak/off-peak pricing (effective 8/17), switch between `v4-flash` / `v4-pro`, itemized input/output/cache fees
- **Big-number friendly**: token counts auto-format (`102780061` → `1.03亿`), no overflow
- **Editable widgets**: edit your API Key in the balance card, adjust per-unit cost in the cost card
- **Persistent**: your layout, sizes and configuration survive restarts via localStorage

## 🧩 内置小组件 / Widgets

| 图标 | 组件 | 数据来源 |
|---|---|---|
| 📊 | 上下文压力 | `contextPressure` 投影（窗口占用比例）|
| ☑️ | 待办 | `todos` 投影（任务清单）|
| 🔐 | 权限模式 | `permissions` 投影（访问范围）|
| 💰 | API 余额 | DeepSeek `user/balance` 接口（含充值跳转、KEY 编辑）|
| 📈 | Token 用量 | `tokenUsage` 投影（输入/输出/缓存，自动格式化）|
| 🕒 | 会话统计 | `sessionStats` 投影（回合/步骤/耗时）|
| 🎯 | 目标进度 | `goal` 投影（阶段 + 目标）|
| 🧾 | 成本估算 | token × 官方单价（flash/pro 切换，分项费用）|

## 🚀 快速开始 / Quick Start

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

重启后：对话两侧出现工作台。点击右侧工作台右上角 `＋` 打开侧栏添加面板；按住卡片头部即可拖动排序/换侧。

> 安装遇到问题？可在 [Issues](https://github.com/MorGogh/widget-dock/issues) 提问，或查看下方 FAQ。

## 🔧 配置 / Configuration

- **API 余额**：组件**不内置密钥**——首次使用点击「KEY 编辑」填入 DeepSeek API Key（存 localStorage，仅本机）
- **成本估算**：默认按 `deepseek-v4-flash` 官方高峰价（输入 ¥3 / 缓存命中 ¥0.1 / 输出 ¥9 每百万 tokens，2026-08-17 生效）；组件内可切换 `v4-pro`（输入 ¥9 / 缓存命中 ¥0.3 / 输出 ¥27）或手动调整单价

## ❓ 常见问题 / FAQ

**Q：打开后没有工作台？**
A：确认已重启 `dsh web`，并在宽窗口下查看；空间不足时工作台会缩成贴边标签，点击展开。

**Q：余额显示不出来？**
A：余额组件需要 DeepSeek API Key，点击组件内「KEY 编辑」填入后刷新。

**Q：卡片拖不动？**
A：按住卡片**头部**（`⠿` 或名称区域）拖动；内容区是正常点击区，不会误拖。

**Q：布局会被重置吗？**
A：不会，布局、尺寸与配置保存在浏览器 localStorage 中，重启后保留。

**Q：支持 TUI / 其他平台吗？**
A：当前为 Web 客户端插件（`dsh.client`，platform: web）。TUI 支持在规划中，欢迎 PR。

## 📄 协议 / License

MIT

## 💝 赞助支持 / Sponsor

如果 widget-dock 对你有帮助，欢迎扫码打赏支持开发维护，感谢每一位支持者！

| 微信赞赏 | 支付宝赞赏 |
|---|---|
| ![WeChat QR](assets/sponsor/wechat-qr.jpg) | ![Alipay QR](assets/sponsor/alipay-qr.jpg) |
