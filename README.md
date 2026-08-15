# 🐋 widget-dock · DSH 小组件面板

> DeepSeek Harness (dsh) 客户端插件：在对话两侧空白区提供**网格对齐的卡片工作台**——余额、Token、成本、上下文、热度图、GitHub、推理强度、图片转述等 27 张卡片一眼掌握。
>
> Widget dock plugin for DeepSeek Harness — a grid-aligned workbench of 27 mini-cards beside the conversation.

[![GitHub stars](https://img.shields.io/github/stars/MorGogh/widget-dock?style=flat-square&label=Stars)](https://github.com/MorGogh/widget-dock/stargazers)
[![License](https://img.shields.io/github/license/MorGogh/widget-dock?style=flat-square)](LICENSE)
[![DSH Plugin](https://img.shields.io/badge/DSH-Plugin-4D6BFE?style=flat-square&logo=github)](https://github.com/topics/dsh-plugin)
[![npm](https://img.shields.io/npm/v/widget-dock?style=flat-square)](https://www.npmjs.com/package/widget-dock)
[![Release](https://img.shields.io/github/v/release/MorGogh/widget-dock?style=flat-square)](https://github.com/MorGogh/widget-dock/releases)

---

## ✨ 功能 / Features

- **网格对齐工作台**：卡片按尺寸档位跨列（S=1 / M·L=2 / XL=3 列），任何组合的行都严格列对齐（iOS 小组件式）
- **27 张卡片**：余额、Token、成本、上下文压力/构成/水位/沙漏、会话统计、待办、目标、权限、计划、热度图、GitHub 仓库、推理强度、图片转述、便签、声音、彩蛋……（见下表）
- **每对话独立布局**：切换会话各自记住卡片组合、尺寸、位置
- **添加面板重设计**：搜索 + 分类标签 + 拖到任意位置添加（新卡霓虹高亮）+ 尺寸/换侧快捷操作
- **随时拖动**：按住卡片头部（`⠿`）拖动排序 / 跨侧换位，无需进入排序模式
- **推理强度卡**：拖动滑轨切换 reasoningEffort（带拖尾粒子、拉到顶紫色粒子渐散），内置模型选择框
- **图片转述卡**：贴图自动转视觉模型 → 文字描述注入输入框 → DeepSeek 纯文本理解（默认接本地 LM Studio）
- **用量热力图**：GitHub 风格 13 周每日用量（每会话分基线自记账，跨会话不丢不重）
- **官方定价成本估算**：DeepSeek 官方峰谷价，flash/pro 一键切换，单价可手动调整 / 一键恢复官方价
- **估算诚实标注**：估算值带 `≈`，精确数据（余额/token/上下文）不混标
- **持久化**：布局、配置存入 localStorage（每对话分区），重启保留

## 🧩 内置小组件 / Widgets（27）

| 分类 | 卡片 |
|---|---|
| 数据 | API 余额 · Token 用量 · 会话统计 · 成本估算 · 会话账单 · 双模对比 · 响应仪表 · 用量热力图 |
| 上下文 | 上下文压力 · 上下文构成 · 上下文水位 · 上下文沙漏 |
| 任务 | 目标进度 · 目标冲刺 · 计划模式 · 推理强度 |
| 图片 | 图片转述 · 图像限制 |
| 工具 | 工作区罗盘 · 会话时光机 · 权限模式 · GitHub 仓库 |
| 命令 | 快捷命令 · 自定义命令 |
| 趣味 | 声音提示 · 灵感速记 · 轮次彩蛋 |

## 🚀 快速开始 / Quick Start

**推荐（npm 安装）**：

```bash
dsh plugin --profile web add widget-dock
```

**或手动链接**：

```bash
mkdir -p ~/.dsh/profiles/web/node_modules
ln -sfn "$(pwd)" ~/.dsh/profiles/web/node_modules/widget-dock
# 在 ~/.dsh/profiles/web/cordis.patch.yml 追加：
# - insert:
#     - id: widget-dock
#       name: 'widget-dock'
dsh web
```

重启后：对话两侧出现工作台。点击工作台底部「＋ 添加」打开侧栏——搜索或按分类找卡片，点击快速添加，或**拖到工作台任意位置**（侧栏会变淡让位）。

### 开发者：发布安全闸门

仓库内置防密钥泄露三重拦截（`scripts/check-secret.mjs` + `.githooks/pre-push` + `prepack`/`prepublishOnly`）：只要 `lib/client.js` 里的 `EMBEDDED_KEY` 非空，`git push` / `npm publish` 都会被拒绝。clone 后启用一次：

```bash
git config core.hooksPath .githooks
```

## 🔧 配置 / Configuration

- **API 余额**：组件**不内置密钥**——首次使用点「KEY 编辑」填入 DeepSeek API Key（存 localStorage，仅本机）
- **成本估算**：默认按 `deepseek-v4-flash` 官方高峰价（输入 ¥3 / 缓存命中 ¥0.1 / 输出 ¥9 每百万 tokens）；可切 `v4-pro` 或手动调价，编辑面板有「恢复官方价」
- **图片转述**：默认接本地 LM Studio（`http://localhost:1234`，`qwen3.5-9b-mlx`）；也可配置任意 OpenAI 兼容端点（OpenRouter / 阿里云 Qwen-VL）
- **GitHub 仓库**：默认 `MorGogh/widget-dock`，可换任意 `owner/repo`
- **推理强度**：走 DSH 自带模型选择服务（`modelDirectories`），切换档位实时生效

## ❓ 常见问题 / FAQ

**Q：打开后没有工作台？**
A：确认已重启 `dsh web`，并在宽窗口下查看；空间不足时工作台缩成贴边标签「工作台」，点击展开。

**Q：余额显示不出来？**
A：余额卡需要 DeepSeek API Key，点「KEY 编辑」填入后刷新。

**Q：卡片拖不动？**
A：按住卡片**头部**（`⠿`）拖动；内容区是正常点击区，不会误拖。

**Q：布局会被重置吗？**
A：不会。布局、尺寸与配置按**会话**存 localStorage，重启保留；切换对话各自独立。

**Q：图片转述怎么用？**
A：输入框直接贴图（或卡片里选图）→ 自动转视觉模型 → 描述以分隔区块附到输入框下方 → 你正常提问发送，DeepSeek 结合描述回答。需要本地 LM Studio 或其他视觉模型端点。

**Q：支持 TUI / 其他平台吗？**
A：当前为 Web 客户端插件（`dsh.client`，platform: web）。欢迎 PR。

## 📄 协议 / License

MIT

## 💝 赞助支持 / Sponsor

如果 widget-dock 对你有帮助，欢迎扫码打赏支持开发维护，感谢每一位支持者！

| 微信赞赏 | 支付宝赞赏 |
|---|---|
| ![WeChat QR](assets/sponsor/wechat-qr.jpg) | ![Alipay QR](assets/sponsor/alipay-qr.jpg) |
