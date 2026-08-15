window.__ModuleLoader__.load({
  id: "widget-dock",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    let React = require("react");
    let { useState, useEffect, useCallback, useRef } = React;

    // ── 配置 ──────────────────────────────────────────────────────────────
    // 每对话独立布局：state 按 sessionId 分区存储（widget-dock:state:<sid>）；
    // 全局 key 只作旧版迁移种子（老用户的全局布局迁移到首个对话后不再写入）。
    const STATE_KEY = "widget-dock:state";
    const stateKey = (sessionId) => (sessionId ? STATE_KEY + ":" + sessionId : STATE_KEY);
    const BALANCE_KEY_STORAGE = "api-balance:api-key";
    // 图片转述（视觉代理降级管道）：图片 → 支持视觉的模型 → 文字描述 → 注入输入框给 DeepSeek。
    // 默认走 OpenAI 兼容 /chat/completions 的 image_url 格式（与 DSH pi-ai 同款 wire 格式）。
    // 默认指向本地 LM Studio（http://localhost:1234，已实测 qwen3.5-9b-mlx 支持视觉）；
    // 也可改成 OpenRouter / 阿里云 Qwen-VL 等任意 OpenAI 兼容端点。
    const VISION_KEY_STORAGE = "widget-dock:vision-key";
    const VISION_DEFAULT_MODEL = "qwen3.5-9b-mlx";
    const VISION_DEFAULT_URL = "http://localhost:1234/v1/chat/completions";
    // 旧版默认端点（OpenAI 官方）——config 里残留该值时视为未配置，自动回落到新默认（本地 LM Studio）
    const VISION_LEGACY_URL = "https://api.openai.com/v1/chat/completions";
    // 本地配置：以下密钥仅存在于本地副本，请勿提交到公开仓库（GitHub 版本为空）。
    const EMBEDDED_KEY = "";
    const TOP_UP_URL = "https://platform.deepseek.com/top_up";
    const BALANCE_URL = "https://api.deepseek.com/user/balance";
    // 成本估算单价（元/百万 tokens）——默认 DeepSeek v4-flash 高峰价（2026-08-17 生效的峰谷定价）
    // 输出 9 / 未缓存输入 3 / 缓存命中 0.1 / 缓存写入按未缓存输入计 3；空闲时段为高峰 5 折
    const DEFAULT_WIDGET_IDS = ["contextPressure", "todos", "permissions"];
    const UI_STATE_KEY = "widget-dock:ui";
    const LAYOUT_VERSION_KEY = "widget-dock:layout-version";
    // 卡片级 localStorage key 集中管理（组件内不再散落字符串）
    const SOUND_KEY = "widget-dock:sound";
    // 工作台展开/收起 per-session 分区；hero 态（无会话）回落全局 key
    const uiStateKey = (sessionId) => (sessionId ? UI_STATE_KEY + ":" + sessionId : UI_STATE_KEY);
    function readOpenState(sessionId) {
      try { return localStorage.getItem(uiStateKey(sessionId)) !== "minimized"; } catch (e) { return true; }
    }

    // 对话容器选择器：只依赖宿主明确提供的根节点
    function findChatContainer() {
      try {
        // 优先：已知编译产物类名
        const known = document.querySelector(".wSkVaW_root");
        if (known && known.getBoundingClientRect().width > 100) return known;
        // 回退：任意设置了 --dsh-chat-content-width 的 flex 容器（不依赖哈希类名）
        const all = document.querySelectorAll("div");
        for (let i = 0; i < all.length; i++) {
          const el = all[i];
          const cs = getComputedStyle(el);
          if (cs.getPropertyValue("--dsh-chat-content-width")) {
            const r = el.getBoundingClientRect();
            if (r.width > 300 && r.height > 200) return el;
          }
        }
      } catch (e) { /* ignore */ }
      return null;
    }

    // 标题栏：对话容器顶部的横向条（含标题行 + 页签），取其底部作为工作台顶部基准
    function findHeaderBar() {
      try {
        const chat = findChatContainer();
        if (!chat) return null;
        const known = chat.querySelector(".wSkVaW_header");
        if (known && known.getBoundingClientRect().height > 20) return known;
        // 回退：容器顶部 120px 内最宽的横向条（高度 24~130）
        const all = chat.querySelectorAll("div");
        let best = null;
        for (let i = 0; i < all.length; i++) {
          const r = all[i].getBoundingClientRect();
          if (r.height >= 24 && r.height <= 130 && r.width > chat.clientWidth * 0.5 && r.top >= -5 && r.top <= 100) {
            if (!best || r.bottom > best.getBoundingClientRect().bottom) best = all[i];
          }
        }
        return best;
      } catch (e) { /* ignore */ }
      return null;
    }

    // 会话列表：对话容器左侧的纵长侧栏，取其右边缘作为工作台左侧基准
    function findSidebar() {
      try {
        const chat = findChatContainer();
        if (!chat) return null;
        const known = document.querySelector(".pI_x6G_sidebarCol, .hHd-Xa_root");
        if (known && known.getBoundingClientRect().width >= 150) return known;
        // 回退：chat 左边缘外、宽 150~340 的纵长元素
        const cr = chat.getBoundingClientRect();
        const all = document.querySelectorAll("div,aside,nav,section");
        let best = null;
        for (let i = 0; i < all.length; i++) {
          const r = all[i].getBoundingClientRect();
          if (r.right <= cr.left + 10 && r.left >= 0 && r.width >= 150 && r.width <= 340 && r.height > 300) {
            if (!best || r.right > best.getBoundingClientRect().right) best = all[i];
          }
        }
        return best;
      } catch (e) { /* ignore */ }
      return null;
    }

    // ── 样式（DSH token，圆角 12px 原生风格）─────────────────────────────
    const css = [
      // 两侧工作台：仅占用对话正文以外的空间；空间够时卡片自动并排。
      // 滚动条与 DSH 会话列表同款：thumb 用 --dsh-scrollbar-thumb token（8px 圆角），
      // 不再写 scrollbar-width:none / display:none，避免掐断全局 scrollbar.css 链路。
      // 网格布局（150px 最小列 + auto-fill）：卡片按尺寸档位跨列（S=1 / M·L=2 / XL=3），
      // 保证任意组合的行都严格列对齐。
      ".wd-deck{position:fixed;top:90px;z-index:9000;display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));align-content:flex-start;gap:10px;max-height:calc(100vh - 130px);overflow-x:hidden;overflow-y:auto;padding-bottom:8px;color:var(--dsw-alias-label-primary);--wd-deck-h:calc(100vh - 130px);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l1);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l1)}",
      // 滚动条 overlay：平时隐藏，滚动中或悬停时淡入；停止滚动后自动隐藏。
      ".wd-deck::-webkit-scrollbar-thumb{opacity:0;transition:opacity .25s ease}",
      ".wd-deck:hover::-webkit-scrollbar-thumb,.wd-deck.scrolling::-webkit-scrollbar-thumb{opacity:1}",
      ".wd-deck.hidden{display:none}",
      // 控制条脱离卡片流，避免“工作台 / 添加 / 排序 / 最小化”挤占第一行卡片宽度。
      // 工作台内部底部“＋ 添加”入口（通栏细条，不悬浮、不占卡片格）。
      ".wd-deck-add{grid-column:1/-1;height:24px;margin-top:2px;border:1px dashed var(--dsw-alias-border-l1);border-radius:7px;background:none;color:var(--dsw-alias-label-tertiary);cursor:pointer;font-size:10px;display:flex;align-items:center;justify-content:center}",
      ".wd-deck-add:hover,.wd-deck-add.active{color:var(--dsw-alias-state-business-primary);border-color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-interactive-bg-hover)}",
      ".wd-deck-actions{display:flex;gap:4px}",
      // 尺寸菜单从卡片标题弹出，不能被卡片边界裁掉。max-width:100% 防止窄 deck
      // （列数 < 卡片跨列数）时隐式轨道溢出容器。hover 霓虹光。
      ".wd-workbench-card{position:relative;min-width:0;max-width:100%;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-base);box-shadow:0 4px 16px rgba(0,0,0,.07);overflow:visible;transition:box-shadow .25s ease,border-color .25s ease}",
      ".wd-workbench-card:hover{border-color:var(--dsw-alias-state-business-primary);box-shadow:0 6px 22px rgba(0,0,0,.1),0 0 16px rgba(57,100,254,.35),0 0 34px rgba(124,77,255,.2)}",
      // 新添加卡片：1.6 秒霓虹呼吸高亮
      ".wd-workbench-card.just-added{animation:wd-just-added 1.6s ease}",
      "@keyframes wd-just-added{0%,55%{border-color:var(--dsw-alias-state-business-primary);box-shadow:0 0 0 2px var(--dsw-alias-state-business-primary),0 0 20px rgba(57,100,254,.6),0 0 40px rgba(124,77,255,.3),0 4px 16px rgba(0,0,0,.07)}100%{border-color:var(--dsw-alias-border-l1);box-shadow:0 4px 16px rgba(0,0,0,.07)}}",
      ".wd-workbench-card.editing{cursor:grab;border-style:dashed}",
      ".wd-workbench-card.dragging{opacity:.45}",
      ".wd-workbench-card-head{display:flex;align-items:center;gap:6px;padding:8px 10px 0;font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary);cursor:grab;user-select:none}",
      ".wd-size-btn{margin-left:auto;height:18px;padding:0 6px;border:1px solid var(--dsw-alias-border-l1);border-radius:5px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-tertiary);cursor:pointer;font-size:9px;font-weight:700;line-height:1}",
      ".wd-size-btn:hover{color:var(--dsw-alias-state-business-primary);border-color:var(--dsw-alias-state-business-primary)}",
      ".wd-size-wrap{position:relative;margin-left:auto}",
      ".wd-size-wrap .wd-size-btn{margin-left:0}",
      ".wd-size-menu{position:absolute;right:0;top:23px;z-index:3;display:flex;gap:3px;padding:4px;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;background:var(--dsw-alias-bg-base);box-shadow:0 7px 20px rgba(0,0,0,.18)}",
      ".wd-size-option{height:22px;min-width:24px;padding:0 5px;border:0;border-radius:4px;background:none;color:var(--dsw-alias-label-secondary);font-size:9px;font-weight:700;cursor:pointer}",
      ".wd-size-option:hover,.wd-size-option.active{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-state-business-primary)}",
      ".wd-workbench-card .wd-body{padding-top:7px}",
      ".wd-deck-empty{grid-column:1/-1;border:1px dashed var(--dsw-alias-border-l1);border-radius:10px;padding:16px 10px;text-align:center;color:var(--dsw-alias-label-tertiary);font-size:10px}",
      ".wd-minibar{position:fixed;right:0;top:96px;z-index:9000;width:28px;height:72px;border:1px solid var(--dsw-alias-border-l1);border-right:0;border-radius:9px 0 0 9px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:11px;writing-mode:vertical-rl;letter-spacing:2px;box-shadow:0 4px 16px rgba(0,0,0,.08)}",
      ".wd-minibar:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}",
      // 右侧滑出侧栏（添加面板 + 排序）
      ".wd-picker{position:fixed;right:0;top:0;bottom:0;width:264px;z-index:9100;background:var(--dsw-alias-bg-base);border-left:1px solid var(--dsw-alias-border-l1);box-shadow:-10px 0 30px rgba(0,0,0,.14);padding:12px 12px 16px;overflow-y:auto;display:flex;flex-direction:column}",
      ".wd-picker-head{display:flex;align-items:center;justify-content:space-between;font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary);padding:2px 2px 8px}",
      ".wd-picker-search{width:100%;box-sizing:border-box;margin-bottom:8px;padding:6px 10px}",
      ".wd-picker-cats{display:flex;flex-wrap:wrap;gap:4px;padding-bottom:8px}",
      ".wd-picker-cat{height:22px;padding:0 9px;border:1px solid var(--dsw-alias-border-l1);border-radius:11px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:10px}",
      ".wd-picker-cat:hover{color:var(--dsw-alias-label-primary)}",
      ".wd-picker-cat.active{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-state-business-primary);border-color:var(--dsw-alias-state-business-primary)}",
      ".wd-picker-drag{flex:none;width:26px;height:26px;display:flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-tertiary);cursor:grab;font-size:13px;border-radius:5px;user-select:none;-webkit-user-drag:element}",
      ".wd-picker-drag:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}",
      ".wd-picker-drag:active{cursor:grabbing}",
      // 拖拽添加时侧栏幽灵化：降 z-index 到 deck 之下 + 半透明（不碰 pointer-events，避免取消拖拽会话）
      ".wd-picker-ghost{opacity:.15;z-index:8900;transition:opacity .15s}",
      ".wd-picker-added{display:flex;flex-direction:column;align-items:flex-end;gap:3px;flex:none}",
      ".wd-picker-sizes{display:flex;gap:2px;padding:2px;border:1px solid var(--dsw-alias-border-l1);border-radius:5px}",
      ".wd-picker-sizes .wd-size-option{min-width:18px;height:16px;padding:0 3px;font-size:8px}",
      ".wd-picker-note{padding:3px 2px 8px;font-size:10px;color:var(--dsw-alias-label-tertiary)}",
      ".wd-picker-list{display:flex;flex-direction:column;gap:4px}",
      // 侧栏卡片行
      ".wd-panel-item{display:flex;align-items:center;gap:10px;width:100%;padding:9px 10px;border:none;background:none;border-radius:9px;cursor:pointer;text-align:left;color:var(--dsw-alias-label-primary)}",
      ".wd-panel-item:hover{background:var(--dsw-alias-interactive-bg-hover)}",
      ".wd-panel-item.added{opacity:.85}",
      ".wd-panel-name{font-size:13px;font-weight:500}",
      ".wd-panel-desc{font-size:11px;color:var(--dsw-alias-label-tertiary);margin-top:1px}",
      ".wd-panel-check{margin-left:auto;font-size:12px;color:var(--dsw-alias-state-success-primary);flex:none}",
      ".wd-place-actions{display:flex;align-items:center;gap:4px;margin-left:auto;flex:none}",
      ".wd-place-btn{height:24px;padding:0 6px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary);font-size:10px;cursor:pointer}",
      ".wd-place-btn:hover{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary)}",
      ".wd-place-btn.current{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);font-weight:600}",
      ".wd-btn{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border:none;background:none;border-radius:5px;color:var(--dsw-alias-label-tertiary);cursor:pointer;font-size:11px;flex:none;padding:0}",
      ".wd-btn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}",
      ".wd-btn.danger:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-state-error-primary)}",
      ".wd-body{padding:8px 12px 12px;font-size:12px;line-height:1.5;flex:1;overflow-x:hidden;overflow-y:auto;min-height:0;max-height:min(150px,calc(var(--wd-deck-h,800px) * 0.18))}",
      // 编辑区
      ".wd-edit{border-top:1px solid var(--dsw-alias-border-l1);padding:8px 12px 12px;display:flex;flex-direction:column;gap:8px}",
      ".wd-edit-title{font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary)}",
      ".wd-input{height:30px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);padding:0 9px;font-size:11px;font-family:ui-monospace,Menlo,monospace;outline:none;width:100%;box-sizing:border-box}",
      ".wd-input:focus{border-color:var(--dsw-alias-state-business-primary)}",
      ".wd-edit-row{display:flex;gap:6px}",
      ".wd-edit-btn{flex:1;height:26px;border-radius:7px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);cursor:pointer;font-size:11px}",
      ".wd-edit-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}",
      ".wd-edit-btn.primary{border-color:transparent;background:var(--dsw-alias-state-business-primary);color:#fff}",
      // ── 小组件内部样式 ──
      ".wd-balance-state{display:flex;align-items:center;gap:5px;margin-bottom:2px}",
      ".wd-balance-amount{display:flex;align-items:baseline;gap:4px}",
      ".wd-balance-val{font-size:26px;font-weight:600;font-variant-numeric:tabular-nums;line-height:1.15}",
      ".wd-balance-cur{font-size:11px;color:var(--dsw-alias-label-secondary)}",
      ".wd-balance-detail{margin-top:4px;font-size:10px;color:var(--dsw-alias-label-tertiary);display:flex;gap:8px;flex-wrap:wrap}",
      ".wd-balance-actions{display:flex;align-items:center;justify-content:space-between;margin-top:8px;padding-top:7px;border-top:1px solid var(--dsw-alias-border-l1)}",
      ".wd-link{display:inline-flex;align-items:center;gap:3px;background:none;border:none;color:var(--dsw-alias-state-business-primary);cursor:pointer;font-size:11px;padding:0;font-weight:500;text-decoration:none}",
      ".wd-link:hover{text-decoration:underline}",
      ".wd-err{color:var(--dsw-alias-state-error-primary);font-size:10px;margin-top:4px;word-break:break-all}",
      ".wd-dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-label-tertiary);display:inline-block;flex:none}",
      ".wd-dot.ok{background:var(--dsw-alias-state-success-primary)}",
      ".wd-dot.bad{background:var(--dsw-alias-state-error-primary)}",
      ".wd-stat-row{display:flex;justify-content:space-between;padding:2px 0;font-size:11px}",
      ".wd-stat-row b{font-variant-numeric:tabular-nums}",
      ".wd-cmd-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:6px}",
      ".wd-cmd-btn{height:28px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);cursor:pointer;font-size:11px;font-family:ui-monospace,Menlo,monospace}",
      ".wd-cmd-btn:disabled{opacity:.5;cursor:default}",
      ".wd-cmd-btn:disabled:hover{border-color:var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base)}",
      ".wd-cmd-btn:hover{background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-state-business-primary)}",
      ".wd-cmd-btn.done{opacity:.5}",
      ".wd-goal-phase{display:inline-block;padding:1px 8px;border-radius:999px;font-size:10px;margin-top:4px}",
      ".wd-goal-phase.active{background:var(--dsw-alias-state-business-primary);color:#fff}",
      ".wd-goal-phase.paused{background:var(--dsw-alias-state-business-primary);color:#fff}",
      ".wd-goal-phase.blocked{background:var(--dsw-alias-state-error-primary);color:#fff}",
      ".wd-goal-text{margin-top:6px;font-size:11px;color:var(--dsw-alias-label-primary);word-break:break-word;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}",
      ".wd-permission-risk{margin-top:6px;font-size:10px;color:var(--dsw-alias-state-error-primary)}",
      // 推理强度：模型选择框 + 滑轨
      ".wd-reason-root{position:relative}",
      // 当前档位大数字：蓝紫渐变 + 呼吸光晕
      ".wd-reason-glow{background:linear-gradient(120deg,var(--dsw-alias-state-business-primary),#7c4dff);-webkit-background-clip:text;background-clip:text;color:transparent;animation:wd-glow-breathe 2.5s ease-in-out infinite}",
      "@keyframes wd-glow-breathe{0%,100%{filter:drop-shadow(0 0 6px rgba(57,100,254,.35))}50%{filter:drop-shadow(0 0 16px rgba(124,77,255,.65))}}",
      ".wd-reason-model{position:relative}",
      ".wd-reason-model-btn{width:100%;height:26px;display:flex;align-items:center;justify-content:space-between;padding:0 9px;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);cursor:pointer;font-size:11px;transition:box-shadow .2s ease,border-color .2s ease}",
      ".wd-reason-model-btn:hover,.wd-reason-model-btn.open{border-color:var(--dsw-alias-state-business-primary);box-shadow:0 0 14px rgba(57,100,254,.45),0 0 30px rgba(124,77,255,.2)}",
      // 切换模型成功：按钮紫色脉冲闪光
      ".wd-reason-model-btn.flash{animation:wd-model-flash .6s ease}",
      "@keyframes wd-model-flash{0%{border-color:#7c4dff;box-shadow:0 0 0 0 rgba(124,77,255,.8),0 0 18px rgba(124,77,255,.7)}100%{border-color:var(--dsw-alias-border-l1);box-shadow:0 0 0 14px rgba(124,77,255,0)}}",
      ".wd-reason-model-btn:disabled{opacity:.5;cursor:default}",
      ".wd-reason-caret{font-size:8px;color:var(--dsw-alias-label-tertiary)}",
      ".wd-reason-menu{position:fixed;max-height:180px;overflow-y:auto;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-base);box-shadow:0 8px 24px rgba(0,0,0,.16),0 0 20px rgba(57,100,254,.15);padding:4px;z-index:9200}",
      ".wd-reason-group{padding:2px 0}",
      ".wd-reason-group-title{padding:3px 8px 2px;font-size:9px;font-weight:600;letter-spacing:.5px;color:var(--dsw-alias-label-tertiary)}",
      ".wd-reason-option{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;padding:5px 8px;border:0;border-radius:6px;background:none;color:var(--dsw-alias-label-primary);cursor:pointer;font-size:11px;text-align:left}",
      ".wd-reason-option:hover{background:var(--dsw-alias-interactive-bg-hover);box-shadow:inset 0 0 12px rgba(57,100,254,.12)}",
      ".wd-reason-option.selected{color:var(--dsw-alias-state-business-primary);font-weight:600;text-shadow:0 0 10px rgba(57,100,254,.5)}",
      ".wd-reason-option:disabled{opacity:.5;cursor:default}",
      ".wd-reason-check{font-size:10px;flex:none}",
      // 滑轨：霓虹渐变流光填充 + 彩虹旋光 thumb + 发光 tick
      ".wd-reason-track{position:relative;height:32px;margin-top:6px;touch-action:none;cursor:pointer;outline:none}",
      ".wd-reason-track:focus-visible .wd-reason-thumb{box-shadow:0 0 0 3px rgba(57,100,254,.4),0 0 18px rgba(57,100,254,.7)}",
      ".wd-reason-range{position:absolute;left:14px;right:14px;top:0;bottom:0}",
      ".wd-reason-rail{position:absolute;left:-12px;right:-12px;top:4px;height:24px;border-radius:12px;background:var(--dsw-alias-interactive-bg-hover)}",
      // 蓝→紫→蓝 流光扫过（background-position 动画）
      ".wd-reason-fill{position:absolute;left:-12px;top:4px;height:24px;border-radius:12px;background:linear-gradient(90deg,#3964fe,#7c4dff,#ff4d8f,#7c4dff,#3964fe);background-size:300% 100%;animation:wd-fill-flow 4s linear infinite;box-shadow:0 0 14px rgba(57,100,254,.5)}",
      "@keyframes wd-fill-flow{0%{background-position:0% 0}100%{background-position:300% 0}}",
      // 拖动时：流光加速 + 色相旋转脉冲
      ".wd-reason-track.dragging .wd-reason-fill{animation:wd-fill-flow 1.2s linear infinite,wd-hue-pulse .8s ease infinite;box-shadow:0 0 26px rgba(124,77,255,.8)}",
      "@keyframes wd-hue-pulse{0%,100%{filter:brightness(1)}50%{filter:brightness(1.4)}}",
      ".wd-reason-tick{position:absolute;top:10px;width:12px;height:12px;margin-left:-6px;border-radius:50%;background:var(--dsw-alias-label-tertiary);transition:box-shadow .2s ease,background .2s ease}",
      ".wd-reason-tick.on{background:#fff;box-shadow:0 0 8px #3964fe,0 0 16px rgba(57,100,254,.8)}",
      ".wd-reason-thumb{position:absolute;top:2.5px;width:27px;height:27px;margin-left:-13.5px;border-radius:50%;background:#fff;box-sizing:border-box;transition:left .16s cubic-bezier(.2,.8,.3,1),box-shadow .2s ease,transform .15s ease}",
      // thumb 彩虹旋光环（conic-gradient 伪元素持续旋转）
      ".wd-reason-thumb::before{content:'';position:absolute;inset:-4px;border-radius:50%;background:conic-gradient(#3964fe,#7c4dff,#ff4d8f,#ffb84d,#3964fe);animation:wd-thumb-spin 2.5s linear infinite;filter:blur(2px)}",
      "@keyframes wd-thumb-spin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}",
      ".wd-reason-track.dragging .wd-reason-thumb{box-shadow:0 2px 8px rgba(0,0,0,.3),0 0 26px rgba(124,77,255,.9);transform:scale(1.15)}",
      ".wd-reason-track.dragging .wd-reason-thumb::before{inset:-6px;animation-duration:1s}",
      ".wd-reason-single{display:flex;align-items:center;justify-content:space-between;padding:8px 4px;font-size:12px;color:var(--dsw-alias-label-primary)}",
      // 卡片 emoji 动态效果
      // ⭐ 星星：旋转 + 发光闪烁（GitHub 卡）
      ".wd-emoji-star{display:inline-block;animation:wd-star-twinkle 2.4s ease-in-out infinite}",
      "@keyframes wd-star-twinkle{0%,100%{transform:rotate(0deg) scale(1);filter:drop-shadow(0 0 0 rgba(255,200,60,0))}50%{transform:rotate(18deg) scale(1.18);filter:drop-shadow(0 0 6px rgba(255,200,60,.75))}}",
      // 🖼️ 图片：呼吸浮动（图片转述卡）
      ".wd-emoji-float{display:inline-block;animation:wd-float-bob 3s ease-in-out infinite}",
      "@keyframes wd-float-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}",
      // 🔊 声音：开启时声波扩散（声音提示卡）
      ".wd-emoji-sound{display:inline-block;position:relative}",
      ".wd-emoji-sound.on{animation:wd-sound-bounce 1.6s ease-in-out infinite}",
      ".wd-emoji-sound.on::after{content:'';position:absolute;left:50%;top:50%;width:20px;height:20px;margin:-10px 0 0 -10px;border:2px solid var(--dsw-alias-state-business-primary);border-radius:50%;opacity:0;pointer-events:none;animation:wd-sound-wave 1.6s ease-out infinite}",
      "@keyframes wd-sound-bounce{0%,100%{transform:scale(1)}50%{transform:scale(1.15)}}",
      "@keyframes wd-sound-wave{0%{transform:scale(.6);opacity:.9}100%{transform:scale(2.2);opacity:0}}",
      // 🎰 转盘：摇摆 + 光晕（轮次彩蛋卡）
      ".wd-emoji-slot{display:inline-block;animation:wd-slot-swing 2.8s ease-in-out infinite}",
      "@keyframes wd-slot-swing{0%,100%{transform:rotate(-14deg);filter:drop-shadow(0 0 3px rgba(255,180,90,.5))}50%{transform:rotate(14deg);filter:drop-shadow(0 0 8px rgba(255,180,90,.9))}}",
      // 拉到最大档位的紫色粒子：从中心逐渐持续向外散开（delay 阶梯 + backwards 隐藏延迟期）
      ".wd-reason-burst{position:absolute;top:16px;margin-left:-2px;width:4px;height:4px;pointer-events:none;z-index:5}",
      ".wd-reason-particle{position:absolute;left:0;top:0;border-radius:50%;opacity:0;animation-name:wd-particle-burst;animation-timing-function:cubic-bezier(.1,.7,.4,1);animation-fill-mode:backwards}",
      "@keyframes wd-particle-burst{0%{opacity:0;transform:translate(0,0) scale(.5)}12%{opacity:1}100%{opacity:0;transform:translate(var(--dx),var(--dy)) scale(.15)}}",
      // 拖尾光点：从 thumb 向运动反方向飘散淡出
      ".wd-reason-trail{position:absolute;top:14px;border-radius:50%;pointer-events:none;z-index:4;opacity:0;animation:wd-trail-fade .6s ease-out forwards}",
      "@keyframes wd-trail-fade{0%{opacity:.9;transform:translate(0,0) scale(1)}100%{opacity:0;transform:translate(var(--tdx),var(--tdy)) scale(.25)}}",
      ".wd-empty{font-size:10px;color:var(--dsw-alias-label-tertiary);margin-top:4px}"
    ].join("");

    const tagId = "widget-dock/styles";
    if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
      const tag = document.createElement("style");
      tag.dataset.plugin = "widget-dock";
      tag.dataset.pluginCss = tagId;
      tag.textContent = css;
      document.head.appendChild(tag);
    }

    // ── 状态持久化（items: [{id, config, x, y}]，兼容旧 left/right 结构）──
    // 读取并解析某 key 的状态；返回 { items, initialized } 或 null
    function parseState(key) {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        const s = JSON.parse(raw);
        if (s && Array.isArray(s.items)) return { items: s.items, initialized: !!s.initialized };
        // 迁移旧结构：left/right 数组 → items（带默认坐标），视为未初始化（补默认卡一次）
        if (s && Array.isArray(s.left) && Array.isArray(s.right)) {
          const items = [];
          const vw = window.innerWidth;
          s.left.forEach((it, i) => items.push(Object.assign({}, it, { x: 20, y: 90 + i * 240 })));
          s.right.forEach((it, i) => items.push(Object.assign({}, it, { x: vw - 220, y: 90 + i * 240 })));
          return { items: items, initialized: false };
        }
      } catch (e) { /* ignore */ }
      return null;
    }
    // 归一化条目：旧版 rebalance + 首次初始化补默认卡。纯计算，不写存储（除布局版本标记）。
    function normalizeItems(items, addDefaults) {
      let shouldRebalance = false;
      try { shouldRebalance = localStorage.getItem(LAYOUT_VERSION_KEY) !== "3"; } catch (e) { /* ignore */ }
      const next = Array.isArray(items) ? items.map((item, index) => {
        const side = shouldRebalance ? (index < 4 ? "right" : "left") : (item && item.side ? item.side : (index < 4 ? "right" : "left"));
        return Object.assign({}, item, { side: side });
      }) : [];
      if (addDefaults) {
        DEFAULT_WIDGET_IDS.forEach((id) => {
          if (!next.some((item) => item && item.id === id)) next.push({ id: id, config: {}, side: "right" });
        });
      }
      return { items: next, initialized: true };
    }
    // 纯读取：不写任何存储。初始化器可安全调用。
    function loadState(sessionId) {
      // hero 态（无会话）：默认布局，不读写
      if (!sessionId) return normalizeItems([], true);
      const own = parseState(stateKey(sessionId));
      if (own) return normalizeItems(own.items, !own.initialized);
      return normalizeItems([], true);
    }
    // 老用户一次性迁移：本会话无自己的布局且旧全局布局存在时，继承并删除全局 key。
    function migrateLegacy(sessionId) {
      if (!sessionId) return;
      try {
        const key = stateKey(sessionId);
        if (localStorage.getItem(key)) return;             // 已有自己的布局
        const legacy = localStorage.getItem(STATE_KEY);
        if (legacy) {
          localStorage.setItem(key, legacy);
          localStorage.removeItem(STATE_KEY);
        }
      } catch (e) { /* ignore */ }
    }
    function saveState(sessionId, state) {
      if (!sessionId) return;
      try { localStorage.setItem(stateKey(sessionId), JSON.stringify(state)); } catch (e) { /* ignore */ }
    }

    // ── 通用工具 ──────────────────────────────────────────────────────────
    function getBalanceKey(config) {
      try {
        if (config && config.apiKey) return config.apiKey;
        const stored = localStorage.getItem(BALANCE_KEY_STORAGE);
        if (stored) return stored;
      } catch (e) { /* ignore */ }
      return EMBEDDED_KEY;
    }
    function getVisionKey(config) {
      try {
        if (config && config.apiKey) return config.apiKey;
        const stored = localStorage.getItem(VISION_KEY_STORAGE);
        if (stored) return stored;
      } catch (e) { /* ignore */ }
      return "";
    }
    // 视觉配置归一化：config 里残留旧默认端点时视为未配置（自动回落本地默认），模型同理
    function visionUrl(config) {
      const u = config && config.url;
      if (!u || u === VISION_LEGACY_URL) return VISION_DEFAULT_URL;
      return u;
    }
    function visionModel(config) {
      const m = config && config.model;
      if (!m || m === "qwen-vl-plus") return VISION_DEFAULT_MODEL;
      return m;
    }
    function maskKey(key) {
      if (!key) return "未配置";
      if (key.length <= 10) return key;
      return key.slice(0, 6) + "…" + key.slice(-4);
    }
    function fmtTime(ms) {
      if (!ms) return "0s";
      const s = Math.round(ms / 1000);
      if (s < 60) return s + "s";
      const m = Math.floor(s / 60);
      return m + "m" + (s % 60) + "s";
    }
    // 大数字格式化：102780061 → "1.03亿"；12850 → "1.3万"；1234 → "1,234"
    function fmtNum(n) {
      if (n == null) return "--";
      if (n >= 1e8) return trimZero((n / 1e8).toFixed(2)) + "亿";
      if (n >= 1e4) return trimZero((n / 1e4).toFixed(1)) + "万";
      return n.toLocaleString();
    }
    function trimZero(s) {
      return s.indexOf(".") >= 0 ? s.replace(/\.?0+$/, "") : s;
    }
    // 卡片尺寸档位判断：S(<190) / M(<260) / L(<350) / XL(≥350)
    function tierOf(width) {
      return width < 190 ? "S" : (width < 260 ? "M" : (width < 350 ? "L" : "XL"));
    }
    // 容量/像素格式化（图像限制等卡片共用）
    function fmtBytes(b) {
      return b >= 1e6 ? (b / 1e6).toFixed(1) + "MB" : Math.round(b / 1024) + "KB";
    }
    function fmtPixels(p) {
      return p >= 1e6 ? (p / 1e6).toFixed(1) + "MP" : p.toLocaleString() + "px";
    }

    // ── 错误边界 ──────────────────────────────────────────────────────────
    class ErrorBoundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = { error: null };
      }
      static getDerivedStateFromError(error) {
        return { error: error };
      }
      componentDidCatch(error) {
        console.error("[widget-dock]", this.props.widgetName || "widget", error);
      }
      render() {
        if (this.state.error) {
          return React.createElement("div", { className: "wd-err" },
            "组件渲染失败: " + String(this.state.error.message || this.state.error)
          );
        }
        return this.props.children;
      }
    }

    // ── 通用 hook：计时器统一登记，卸载时自动清理 ─────────────────────────
    function useTimers() {
      const timersRef = useRef([]);
      const later = (fn, ms) => { const id = window.setTimeout(fn, ms); timersRef.current.push(id); return id; };
      useEffect(() => () => { timersRef.current.forEach((t) => window.clearTimeout(t)); }, []);
      return later;
    }

    // ── 小组件：1) API 余额 ───────────────────────────────────────────────
    function BalanceWidget({ api, config, onConfig, width }) {
      const [balance, setBalance] = useState(null);
      const [error, setError] = useState(null);
      const [loading, setLoading] = useState(true);
      const [editing, setEditing] = useState(false);
      const [draft, setDraft] = useState(getBalanceKey(config));

      const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
          const key = getBalanceKey(config);
          if (!key) throw new Error("未配置 KEY");
          const res = await fetch(BALANCE_URL, { headers: { Authorization: "Bearer " + key } });
          if (res.status === 401) throw new Error("KEY 无效");
          if (!res.ok) throw new Error("HTTP " + res.status);
          setBalance(await res.json());
        } catch (e) {
          setError(e.message || "查询失败");
          setBalance(null);
        } finally {
          setLoading(false);
        }
      }, [config]);

      useEffect(() => { load(); }, [load]);
      useEffect(() => {
        const id = window.setInterval(load, 5 * 60 * 1000);
        return () => window.clearInterval(id);
      }, [load]);

      const info = balance && balance.balance_infos && balance.balance_infos[0];
      const ok = balance && balance.is_available;
      // 内容随尺寸渐进：S=核心数字 → M=+明细 → L=+KEY → XL=+操作
      const tier = tierOf(width);
      const valSize = tier === "XL" ? 42 : (tier === "L" ? 34 : (tier === "M" ? 30 : 26));

      return React.createElement("div", null,
        tier !== "S" ? React.createElement("div", { className: "wd-balance-state" },
          React.createElement("span", { className: "wd-dot " + (loading ? "" : (ok ? "ok" : "bad")) }),
          React.createElement("span", { className: "wd-empty", style: { marginTop: 0 } }, loading ? "查询中…" : (ok ? "账户可用" : (balance ? "账户异常" : "未连接")))
        ) : null,
        React.createElement("div", { className: "wd-balance-amount" },
          React.createElement("span", { className: "wd-balance-cur" }, info ? info.currency : ""),
          React.createElement("span", { className: "wd-balance-val", style: { fontSize: valSize } }, info ? info.total_balance : "--"),
          React.createElement("span", { className: "wd-balance-cur" }, "元")
        ),
        tier !== "S" ? React.createElement("div", { className: "wd-balance-detail" },
          React.createElement("span", null, "充值 " + (info ? info.topped_up_balance : "--")),
          React.createElement("span", null, "赠送 " + (info ? info.granted_balance : "--"))
        ) : null,
        (tier === "L" || tier === "XL") ? React.createElement("div", { className: "wd-empty", style: { marginTop: 4, cursor: "pointer", color: "var(--dsw-alias-state-business-primary)" }, onClick: () => setEditing(true) },
          getBalanceKey(config) ? "KEY: " + maskKey(getBalanceKey(config)) + " · 编辑" : "配置 API Key"
        ) : null,
        error ? React.createElement("div", { className: "wd-err" }, error) : null,
        tier === "XL" ? React.createElement("div", { className: "wd-balance-actions" },
          React.createElement("button", { className: "wd-link", onClick: load }, "↻ 刷新"),
          React.createElement("a", { className: "wd-link", href: TOP_UP_URL, target: "_blank", rel: "noreferrer" }, "充值 ↗")
        ) : null,
        editing ? React.createElement("div", { className: "wd-edit" },
          React.createElement("div", { className: "wd-edit-title" }, "API KEY"),
          React.createElement("input", { className: "wd-input", value: draft, onChange: (e) => setDraft(e.target.value), spellCheck: false, placeholder: "sk-…" }),
          React.createElement("div", { className: "wd-edit-row" },
            React.createElement("button", {
              className: "wd-edit-btn primary",
              onClick: () => { onConfig({ apiKey: draft.trim() }); setEditing(false); load(); }
            }, "保存"),
            React.createElement("button", { className: "wd-edit-btn", onClick: () => { setDraft(getBalanceKey(config)); setEditing(false); } }, "取消")
          )
        ) : (tier === "S" || tier === "M") ? React.createElement("div", { className: "wd-empty", style: { cursor: "pointer", color: "var(--dsw-alias-state-business-primary)" }, onClick: () => setEditing(true) },
            getBalanceKey(config) ? "密钥已配置 · 编辑" : "配置 API Key"
          ) : null
      );
    }

    // 2) Token 用量
    function TokensWidget({ api, width }) {
      const usage = api.useProjection("tokenUsage");
      const input = usage ? (usage.uncachedInputTokens || 0) + (usage.cacheReadTokens || 0) + (usage.cacheWriteTokens || 0) : null;
      const output = usage ? (usage.outputTokens || 0) : null;
      const total = input !== null ? input + output : null;
      // 内容随尺寸渐进：S=总token → M=+输入/输出 → L=+缓存 → XL=+全部
      const tier = tierOf(width);
      const valSize = tier === "XL" ? 38 : (tier === "L" ? 32 : (tier === "M" ? 28 : 24));
      return React.createElement("div", null,
        React.createElement("div", { className: "wd-balance-amount" },
          React.createElement("span", { className: "wd-balance-val", style: { fontSize: valSize } }, total !== null ? fmtNum(total) : "--"),
          React.createElement("span", { className: "wd-balance-cur" }, "tokens")
        ),
        tier !== "S" ? React.createElement("div", { className: "wd-balance-detail" },
          React.createElement("span", null, "输入 " + (input !== null ? fmtNum(input) : "--")),
          React.createElement("span", null, "输出 " + (output !== null ? fmtNum(output) : "--"))
        ) : null,
        (tier === "L" || tier === "XL") && usage && (usage.cacheReadTokens || usage.cacheWriteTokens) ? React.createElement("div", { className: "wd-balance-detail" },
          React.createElement("span", null, "缓存读 " + fmtNum(usage.cacheReadTokens || 0)),
          React.createElement("span", null, "缓存写 " + fmtNum(usage.cacheWriteTokens || 0))
        ) : null,
        !usage ? React.createElement("div", { className: "wd-empty" }, "暂无用量：发送一条消息后自动统计") : null
      );
    }

    // 3) 会话统计
    function StatsWidget({ api, width }) {
      // sessionStats 投影顶层就是 totals 字段（turns/steps/llmMs/toolMs 直接访问）
      const stats = api.useProjection("sessionStats");
      // 内容随尺寸渐进：S=回合 → M=+步骤 → L=+模型耗时 → XL=+工具耗时
      const tier = tierOf(width);
      return React.createElement("div", null,
        React.createElement("div", { className: "wd-stat-row" }, React.createElement("span", null, "回合数"), React.createElement("b", null, stats && stats.turns != null ? stats.turns : "--")),
        tier !== "S" ? React.createElement("div", { className: "wd-stat-row" }, React.createElement("span", null, "步骤数"), React.createElement("b", null, stats && stats.steps != null ? stats.steps : "--")) : null,
        (tier === "L" || tier === "XL") ? React.createElement("div", { className: "wd-stat-row" }, React.createElement("span", null, "模型耗时"), React.createElement("b", null, stats && stats.llmMs != null ? fmtTime(stats.llmMs) : "--")) : null,
        tier === "XL" ? React.createElement("div", { className: "wd-stat-row" }, React.createElement("span", null, "工具耗时"), React.createElement("b", null, stats && stats.toolMs != null ? fmtTime(stats.toolMs) : "--")) : null,
        !stats ? React.createElement("div", { className: "wd-empty" }, "暂无统计：发送消息后自动更新") : null
      );
    }

    // 4) 快捷命令
    function CommandsWidget({ api, width }) {
      const [running, setRunning] = useState(null);
      const [notice, setNotice] = useState(null);
      const COMMANDS = [
        { label: "/compact", line: "/compact", title: "压缩上下文" },
        { label: "/goal", line: "/goal", title: "管理目标" },
        { label: "/model", line: "/model", title: "切换模型" },
        { label: "/plan", line: "/plan", title: "计划模式" },
        { label: "/help", line: "/help", title: "帮助" },
        { label: "/skills", line: "/skills", title: "技能列表" }
      ];
      const canExecute = !!(api.executeCommand);
      const later = useTimers();
      const run = async (cmd) => {
        if (running) return;
        if (!canExecute) { setNotice("命令通道暂不可用"); return; }
        setRunning(cmd.line);
        setNotice(null);
        try {
          await api.executeCommand(cmd.line);
          setNotice("已执行 " + cmd.label);
        } catch (e) { setNotice("执行失败: " + (e.message || e)); }
        later(() => setRunning(null), 800);
      };
      // 内容随尺寸渐进：S=2个 → M=4个 → L=6个(2列) → XL=6个(3列)
      const tier = tierOf(width);
      const shown = tier === "S" ? COMMANDS.slice(0, 2) : (tier === "M" ? COMMANDS.slice(0, 4) : COMMANDS);
      const cols = tier === "XL" ? "1fr 1fr 1fr" : "1fr 1fr";
      return React.createElement("div", null,
        React.createElement("div", { className: "wd-cmd-grid", style: { gridTemplateColumns: cols } },
          shown.map((cmd) => React.createElement("button", {
            key: cmd.line,
            className: "wd-cmd-btn" + (running === cmd.line ? " done" : ""),
            title: cmd.title,
            onClick: () => run(cmd)
          }, cmd.label))
        ),
        tier === "XL" ? React.createElement("div", { className: "wd-empty", style: { marginTop: 6 } }, notice || "点击直接执行命令") : null
      );
    }

    // 5) 目标进度
    function GoalWidget({ api, width }) {
      const projection = api.useProjection("goal");
      const goal = projection ? projection.goal : null;
      const [notice, setNotice] = useState(null);
      const [running, setRunning] = useState(false);
      // 内容随尺寸渐进：S=阶段/提示 → M=+目标1行 → L=+目标3行 → XL=+操作提示
      const tier = tierOf(width);
      const canExecute = !!(api.executeCommand);
      const later = useTimers();
      const createGoal = async () => {
        if (running) return;
        if (!canExecute) { setNotice("命令通道不可用"); return; }
        setRunning(true);
        setNotice("正在执行 /goal …");
        try {
          await api.executeCommand("/goal ");
          setNotice("已执行 /goal，请看对话区输入目标");
        } catch (e) {
          setNotice("执行失败: " + (e.message || e));
        } finally {
          later(() => setRunning(false), 900);
        }
      };
      if (!goal) {
        return React.createElement("div", null,
          React.createElement("div", { className: "wd-empty" }, "当前没有进行中的目标"),
          tier !== "S" ? React.createElement("div", { className: "wd-cmd-grid" },
            React.createElement("button", { className: "wd-cmd-btn" + (running ? " done" : ""), onClick: createGoal }, "/goal 创建")
          ) : null,
          tier === "XL" ? React.createElement("div", { className: "wd-empty", style: { marginTop: 4 } }, notice || "点击后请在对话区输入目标") : null
        );
      }
      const objective = String(goal.objective || "(无目标描述)").replace(/\s+/g, " ");
      return React.createElement("div", null,
        React.createElement("div", { className: "wd-goal-phase " + (goal.phase || "active") }, goal.phase === "complete" ? "已完成" : (goal.phase === "blocked" ? "受阻" : "进行中")),
        tier !== "S" ? React.createElement("div", { className: "wd-goal-text", title: objective, style: { WebkitLineClamp: tier === "M" ? 1 : 3 } }, objective) : null
      );
    }

    // 6) 成本估算
    // DeepSeek 官方定价（2026-08-17 生效，高峰价，元/百万 tokens）
    const OFFICIAL_RATES = {
      flash: { input: 3, cacheRead: 0.1, cacheWrite: 3, output: 9 },
      pro: { input: 9, cacheRead: 0.3, cacheWrite: 9, output: 27 }
    };

    function CostWidget({ api, config, onConfig, width }) {
      const [editing, setEditing] = useState(false);
      const model = (config && config.model) || "flash";
      // 单价：模型对应官方价（用户手动编辑过则用自定义）
      const rates = Object.assign({}, OFFICIAL_RATES[model] || OFFICIAL_RATES.flash, config && config.rates ? config.rates : {});
      const [draft, setDraft] = useState(rates);
      const usage = api.useProjection("tokenUsage");

      // 分项计算：输入 / 缓存 / 输出 各自的费用（元）
      const calc = () => {
        if (!usage) return null;
        const uncached = usage.uncachedInputTokens || 0;
        const cacheRead = usage.cacheReadTokens || 0;
        const cacheWrite = usage.cacheWriteTokens || 0;
        const output = usage.outputTokens || 0;
        const inputFee = uncached * rates.input / 1e6;
        const cacheFee = (cacheRead * rates.cacheRead + cacheWrite * rates.cacheWrite) / 1e6;
        const outputFee = output * rates.output / 1e6;
        return {
          yuan: inputFee + cacheFee + outputFee,
          inputFee: inputFee,
          cacheFee: cacheFee,
          outputFee: outputFee,
          tokens: uncached + cacheRead + cacheWrite + output
        };
      };
      const c = calc();
      // 切换模型：应用该模型官方价，清除手动单价
      const switchModel = (next) => {
        onConfig({ model: next, rates: undefined });
        setDraft(OFFICIAL_RATES[next] || OFFICIAL_RATES.flash);
      };
      const saveRates = () => {
        const next = {
          input: Math.max(0, parseFloat(draft.input) || 0),
          cacheRead: Math.max(0, parseFloat(draft.cacheRead) || 0),
          cacheWrite: Math.max(0, parseFloat(draft.cacheWrite) || 0),
          output: Math.max(0, parseFloat(draft.output) || 0)
        };
        onConfig({ model: model, rates: next });
        setEditing(false);
      };
      const field = (key, label) => React.createElement("label", { key: key, style: { display: "flex", alignItems: "center", gap: 8, fontSize: 11 } },
        React.createElement("span", { style: { flex: 1, color: "var(--dsw-alias-label-secondary)" } }, label),
        React.createElement("input", {
          className: "wd-input",
          style: { width: 70 },
          type: "number",
          min: 0,
          step: 0.1,
          value: draft[key],
          onChange: (e) => setDraft(Object.assign({}, draft, { [key]: e.target.value }))
        }),
        React.createElement("span", { style: { color: "var(--dsw-alias-label-tertiary)" } }, "元/M")
      );
      const modelBtn = (id, label) => React.createElement("button", {
        key: id,
        className: "wd-edit-btn" + (model === id ? " primary" : ""),
        style: { height: 26, fontSize: 11 },
        onClick: () => switchModel(id)
      }, label);
      // 内容随尺寸渐进：S=总价 → M=+分项 → L=+单价 → XL=+编辑入口
      const tier = tierOf(width);
      return React.createElement("div", null,
        React.createElement("div", { className: "wd-balance-amount" },
          React.createElement("span", { className: "wd-balance-val" }, c ? "≈¥" + c.yuan.toFixed(4) : "--"),
          React.createElement("span", { className: "wd-balance-cur" }, "估算")
        ),
        tier !== "S" ? React.createElement("div", { className: "wd-balance-detail", style: { display: "block" } },
          c ? React.createElement("div", null,
            React.createElement("div", null, "输入 ≈" + c.inputFee.toFixed(4) + " · 输出 ≈" + c.outputFee.toFixed(4)),
            React.createElement("div", null, "缓存 ≈" + c.cacheFee.toFixed(4) + " · 共 " + fmtNum(c.tokens) + " tokens")
          ) : React.createElement("div", null, "无用量数据")
        ) : null,
        (tier === "L" || tier === "XL") ? React.createElement("div", { className: "wd-empty", style: { marginTop: 4 } },
          "⚡" + model + " · 输入 ¥" + rates.input + "/M · 输出 ¥" + rates.output + "/M"
        ) : null,
        tier === "XL" ? React.createElement("div", { className: "wd-empty", style: { marginTop: 4, cursor: "pointer", color: "var(--dsw-alias-state-business-primary)" }, onClick: () => setEditing(true) }, "调整单价") : null,
        editing ? React.createElement("div", { className: "wd-edit" },
          React.createElement("div", { className: "wd-edit-title" }, "模型（切换自动应用官方高峰价）"),
          React.createElement("div", { className: "wd-edit-row" },
            modelBtn("flash", "⚡ v4-flash"),
            modelBtn("pro", "🚀 v4-pro")
          ),
          React.createElement("div", { className: "wd-edit-title" }, "单价（元/百万 tokens，可手动调整）"),
          field("input", "输入（未缓存）"),
          field("cacheRead", "缓存读取"),
          field("cacheWrite", "缓存写入"),
          field("output", "输出"),
          React.createElement("div", { className: "wd-edit-row" },
            React.createElement("button", { className: "wd-edit-btn primary", onClick: saveRates }, "保存"),
            React.createElement("button", { className: "wd-edit-btn", onClick: () => { setDraft(OFFICIAL_RATES[model] || OFFICIAL_RATES.flash); onConfig({ model: model, rates: undefined }); } }, "恢复官方价"),
            React.createElement("button", { className: "wd-edit-btn", onClick: () => { setDraft(rates); setEditing(false); } }, "取消")
          )
        ) : null
      );
    }

    // 7) 上下文压力：用下一次请求的估算占用，而非累计用量，帮助判断何时该压缩。
    function ContextPressureWidget({ api, width }) {
      const pressure = api.useProjection("contextPressure");
      const projected = pressure && (pressure.projectedTokens || pressure.pressureTokens);
      const windowSize = pressure && pressure.contextWindow;
      const ratio = projected && windowSize ? Math.min(100, Math.round(projected / windowSize * 100)) : null;
      // 内容随尺寸渐进：S=百分比 → M=+tokens → L=+窗口 → XL=+警告
      const tier = tierOf(width);
      return React.createElement("div", null,
        React.createElement("div", { className: "wd-balance-amount" },
          React.createElement("span", { className: "wd-balance-val" }, ratio == null ? "--" : ratio + "%"),
          React.createElement("span", { className: "wd-balance-cur" }, "上下文占用")
        ),
        tier !== "S" ? React.createElement("div", { className: "wd-balance-detail" },
          React.createElement("span", null, projected ? fmtNum(projected) + " tokens" : "等待模型用量"),
          React.createElement("span", null, windowSize ? "窗口 " + fmtNum(windowSize) : "窗口未知")
        ) : null,
        tier === "XL" && ratio !== null && ratio >= 80 ? React.createElement("div", { className: "wd-err" }, "上下文接近上限，建议压缩对话") : null
      );
    }

    // 7b) 上下文构成：系统提示 / 工具 / 对话消息 各占多少（token + 占比条）
    function ContextCompositionWidget({ api, width }) {
      const breakdown = api.useProjection("contextBreakdown");
      const tier = tierOf(width);
      const sys = breakdown ? (breakdown.systemTokens || 0) : null;
      const tools = breakdown ? (breakdown.toolsTokens || 0) : null;
      const msg = breakdown ? (breakdown.messageTokens || 0) : null;
      const total = sys != null ? sys + tools + msg : null;
      const pct = (v) => (total ? Math.round(v / total * 100) : 0);
      const bar = tier !== "S" && total ? React.createElement("div", { style: { display: "flex", height: 8, borderRadius: 4, overflow: "hidden", marginTop: 6 } },
        React.createElement("div", { title: "系统提示", style: { width: pct(sys) + "%", background: "var(--dsw-alias-state-business-primary)" } }),
        React.createElement("div", { title: "工具", style: { width: pct(tools) + "%", background: "var(--dsw-alias-state-success-primary)" } }),
        React.createElement("div", { title: "对话消息", style: { width: pct(msg) + "%", background: "var(--dsw-alias-label-tertiary)" } })
      ) : null;
      const detail = (tier === "L" || tier === "XL") && total ? React.createElement("div", { className: "wd-balance-detail", style: { display: "block" } },
        React.createElement("div", null, "系统 " + fmtNum(sys) + " · 工具 " + fmtNum(tools)),
        React.createElement("div", null, "消息 " + fmtNum(msg) + " · 共 " + fmtNum(total))
      ) : null;
      return React.createElement("div", null,
        React.createElement("div", { className: "wd-balance-amount" },
          React.createElement("span", { className: "wd-balance-val" }, total != null ? fmtNum(total) : "--"),
          React.createElement("span", { className: "wd-balance-cur" }, "上下文构成")
        ),
        bar,
        detail,
        !total ? React.createElement("div", { className: "wd-empty" }, "暂无构成数据：发送消息后统计") : null
      );
    }

    // 7c) 用量热力图：GitHub 风格按天历史（自记账：订阅 tokenUsage 投影，增量累计到 localStorage）
    function HeatmapWidget({ api, width }) {
      const usage = api.useProjection("tokenUsage");
      const stats = api.useProjection("sessionStats");
      const tier = tierOf(width);
      // 状态：days（按日期累计的 {tokens, turns, cost}）+ lastBySid（每个会话各自的基线，
      // 用于精确算增量——切会话/刷新后按 sid 续记，不丢不重）
      const [data, setData] = useState(() => {
        try {
          const raw = localStorage.getItem(HEATMAP_KEY);
          const parsed = raw ? JSON.parse(raw) : null;
          return parsed && typeof parsed === "object" ? parsed : { days: {}, lastBySid: {} };
        } catch (e) { return { days: {}, lastBySid: {} }; }
      });
      // dataRef：effect 依赖只有 [usage, sessionId, turns]；读写最新 data 避免闭包旧值和无限循环
      const dataRef = useRef(data);
      dataRef.current = data;
      // turnsRef：记录上次看到的回合数，回合推进时视为"新的一轮产生"
      const turnsRef = useRef(stats && stats.turns != null ? stats.turns : 0);

      // 每轮实际 token 记账：回合推进（或投影增量）时，把该轮 token 增量计入当天。
      // 基线按 sid 分开存：同一会话内 total 增大 → 差额记当天；切会话后新 sid 从自己的基线续记。
      useEffect(() => {
        if (!usage) return;
        const total = (usage.uncachedInputTokens || 0) + (usage.cacheReadTokens || 0) + (usage.cacheWriteTokens || 0) + (usage.outputTokens || 0);
        const sid = api.sessionId;
        const turns = stats && stats.turns != null ? stats.turns : 0;
        const today = new Date();
        const date = today.getFullYear() + "-" + String(today.getMonth() + 1).padStart(2, "0") + "-" + String(today.getDate()).padStart(2, "0");
        const base = dataRef.current;
        const day = base.days[date] || { tokens: 0, turns: 0, cost: 0 };
        let next = null;
        // 该会话有基线且总 token 增大 → 增量记入当天（含切回旧会话的续记）
        if (base.lastBySid[sid] != null && total > base.lastBySid[sid]) {
          const delta = total - base.lastBySid[sid];
          const cost = (delta * 3) / 1e6; // 按 flash 输入价粗估，展示趋势即可
          next = {
            days: Object.assign({}, base.days, { [date]: { tokens: day.tokens + delta, turns: day.turns + (turns > turnsRef.current ? 1 : 0), cost: day.cost + cost } }),
            lastBySid: Object.assign({}, base.lastBySid, { [sid]: total })
          };
        } else if (base.lastBySid[sid] === undefined || total !== base.lastBySid[sid]) {
          // 新会话/刷新：建立该会话基线（不记当轮，避免把历史累计当增量）
          next = { days: base.days, lastBySid: Object.assign({}, base.lastBySid, { [sid]: total }) };
        }
        turnsRef.current = turns;
        if (next) {
          setData(next);
          try { localStorage.setItem(HEATMAP_KEY, JSON.stringify(next)); } catch (e) { /* ignore */ }
        }
      }, [usage, api.sessionId, stats]);

      // 渲染最近 13 周热力图（每格一天，颜色按当日 token 量分档）
      const renderGrid = () => {
        const cells = [];
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const start = new Date(today);
        start.setDate(start.getDate() - 12 * 7 - 6); // 13 周前周日
        const dayMs = 86400000;
        const maxVal = Math.max(1, ...Object.keys(data.days).map((d) => data.days[d].tokens));
        for (let i = 0; i < 13 * 7; i++) {
          const d = new Date(start.getTime() + i * dayMs);
          const key = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
          const day = data.days[key];
          const val = day ? day.tokens : 0;
          const ratio = val / maxVal;
          const level = val === 0 ? 0 : (ratio > 0.75 ? 4 : ratio > 0.5 ? 3 : ratio > 0.25 ? 2 : 1);
          const bg = ["var(--dsw-alias-interactive-bg-hover)", "rgba(57,100,254,.25)", "rgba(57,100,254,.45)", "rgba(57,100,254,.7)", "rgba(57,100,254,.95)"][level];
          cells.push(React.createElement("div", {
            key: key,
            title: key + (day ? " · " + fmtNum(day.tokens) + " tokens · " + (day.turns || 0) + " 轮 · ≈¥" + day.cost.toFixed(2) : " · 无用量"),
            style: { width: 9, height: 9, borderRadius: 2, background: bg, flex: "none" }
          }));
        }
        return cells;
      };

      // 今日统计 + 总览
      const today = new Date();
      const todayKey = today.getFullYear() + "-" + String(today.getMonth() + 1).padStart(2, "0") + "-" + String(today.getDate()).padStart(2, "0");
      const todayDay = data.days[todayKey];
      const totalTokens = Object.keys(data.days).reduce((sum, k) => sum + (data.days[k].tokens || 0), 0);
      const activeDays = Object.keys(data.days).filter((k) => data.days[k].tokens > 0).length;

      return React.createElement("div", null,
        React.createElement("div", { className: "wd-balance-amount" },
          React.createElement("span", { className: "wd-balance-val", style: { fontSize: 22 } }, todayDay ? fmtNum(todayDay.tokens) : "0"),
          React.createElement("span", { className: "wd-balance-cur" }, "今日 tokens")
        ),
        tier !== "S" ? React.createElement("div", { className: "wd-balance-detail" },
          React.createElement("span", null, "累计 " + fmtNum(totalTokens)),
          React.createElement("span", null, activeDays + " 天活跃")
        ) : null,
        (tier === "L" || tier === "XL") && todayDay ? React.createElement("div", { className: "wd-balance-detail" },
          React.createElement("span", null, "今日 " + (todayDay.turns || 0) + " 轮"),
          React.createElement("span", null, "≈¥" + (todayDay.cost || 0).toFixed(2))
        ) : null,
        // 热力图：S/M 横向滚动，L/XL 完整 13 周
        React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 2, marginTop: 6, overflowX: "auto", paddingBottom: 2 } },
          Array.from({ length: 7 }, (_, dow) => React.createElement("div", { key: dow, style: { display: "flex", gap: 2 } },
            renderGrid().filter((_, idx) => idx % 7 === dow)
          ))
        ),
        !usage ? React.createElement("div", { className: "wd-empty" }, "发送消息后开始累计（历史从安装之日起记录）") : null
      );
    }

    // 8) 待办：Harness 维护的当前轮任务清单，只读展示（todos 投影首次写入前为 null）
    function TodosWidget({ api, width }) {
      const todos = api.useProjection("todos");
      const list = Array.isArray(todos) ? todos : [];
      const complete = list.filter((item) => item.status === "completed").length;
      const active = list.filter((item) => item.status === "in_progress").length;
      // 内容随尺寸渐进：S=完成数 → M=+1项 → L=+3项 → XL=+全部与进行中
      const tier = tierOf(width);
      const showCount = tier === "S" ? 0 : (tier === "M" ? 1 : (tier === "L" ? 3 : list.length));
      return React.createElement("div", null,
        React.createElement("div", { className: "wd-balance-amount" },
          React.createElement("span", { className: "wd-balance-val" }, list.length ? complete + "/" + list.length : "0"),
          React.createElement("span", { className: "wd-balance-cur" }, "已完成")
        ),
        list.length && showCount > 0 ? React.createElement("div", { className: "wd-balance-detail", style: { display: "block" } },
          list.slice(0, showCount).map((item, index) => React.createElement("div", { key: index, style: { marginTop: index ? 3 : 0 } },
            (item.status === "completed" ? "✓ " : (item.status === "in_progress" ? "• " : "○ ")) + item.content
          )),
          list.length > showCount ? React.createElement("div", { style: { marginTop: 3 } }, "还有 " + (list.length - showCount) + " 项") : null
        ) : (!list.length ? React.createElement("div", { className: "wd-empty" }, "当前会话暂无任务清单（agent 创建任务后自动显示）") : null),
        tier === "XL" && active ? React.createElement("div", { className: "wd-empty" }, active + " 项进行中") : null
      );
    }

    // 8b) 自定义命令：用户自己添加的斜杠命令按钮组（localStorage 持久化）
    function CustomCommandsWidget({ api, width }) {
      const [cmds, setCmds] = useState(() => {
        try { const raw = localStorage.getItem(CUSTOM_CMDS_KEY); return raw ? JSON.parse(raw) : []; } catch (e) { return []; }
      });
      const [editing, setEditing] = useState(false);
      const [draft, setDraft] = useState("");
      const [notice, setNotice] = useState(null);
      const [running, setRunning] = useState(null);
      const saveCmds = (next) => { setCmds(next); try { localStorage.setItem(CUSTOM_CMDS_KEY, JSON.stringify(next)); } catch (e) { /* ignore */ } };
      const later = useTimers();
      const addCmd = () => {
        const raw = draft.trim();
        const line = raw.startsWith("/") ? raw : "/" + raw;
        if (!line || line === "/") return;
        if (cmds.length >= 20) { setNotice("最多 20 条命令"); return; }
        saveCmds(cmds.concat([{ line: line, label: line }]));
        setDraft("");
      };
      const removeCmd = (i) => { saveCmds(cmds.filter((_, idx) => idx !== i)); };
      const run = async (cmd) => {
        if (running) return;
        if (!api.executeCommand) { setNotice("命令通道不可用"); return; }
        setRunning(cmd.line);
        setNotice(null);
        try { await api.executeCommand(cmd.line); setNotice("已执行 " + cmd.line); }
        catch (e) { setNotice("执行失败: " + (e.message || e)); }
        later(() => setRunning(null), 800);
      };
      const tier = tierOf(width);
      const shown = tier === "S" ? cmds.slice(0, 2) : cmds;
      return React.createElement("div", null,
        cmds.length ? React.createElement("div", { className: "wd-cmd-grid", style: { gridTemplateColumns: "1fr 1fr" } },
          shown.map((cmd, i) => React.createElement("button", {
            key: cmd.line + "-" + i,
            className: "wd-cmd-btn" + (running === cmd.line ? " done" : ""),
            title: cmd.line,
            onClick: () => run(cmd)
          }, cmd.label))
        ) : React.createElement("div", { className: "wd-empty" }, "还没有自定义命令"),
        tier !== "S" ? React.createElement("div", { className: "wd-empty", style: { marginTop: 4, cursor: "pointer", color: "var(--dsw-alias-state-business-primary)" }, onClick: () => setEditing(!editing) }, editing ? "完成" : "＋ 添加命令") : null,
        notice ? React.createElement("div", { className: "wd-empty", style: { marginTop: 2 } }, notice) : null,
        editing ? React.createElement("div", { className: "wd-edit" },
          React.createElement("input", {
            className: "wd-input",
            value: draft,
            onChange: (e) => setDraft(e.target.value),
            placeholder: "输入命令，如 compact 或 /goal",
            onKeyDown: (e) => { if (e.key === "Enter") { e.preventDefault(); addCmd(); } }
          }),
          React.createElement("div", { className: "wd-edit-row" },
            React.createElement("button", { className: "wd-edit-btn primary", onClick: addCmd }, "添加"),
            React.createElement("button", { className: "wd-edit-btn", onClick: () => setEditing(false) }, "完成")
          ),
          cmds.length ? React.createElement("div", { className: "wd-empty", style: { marginTop: 4 } },
            cmds.map((c, i) => React.createElement("span", { key: c.line + "-" + i, style: { marginRight: 10 } },
              c.label,
              React.createElement("span", { style: { cursor: "pointer", color: "var(--dsw-alias-state-error-primary)", marginLeft: 3 }, onClick: () => removeCmd(i) }, "✕")
            ))
          ) : null
        ) : null
      );
    }

    // 8c) GitHub 仓库：显示 star/fork/issue/语言/最后推送，点击跳转（公开 API 无需 key）
    function GithubWidget({ api, config, onConfig, width }) {
      const [repo, setRepo] = useState(() => {
        try { return localStorage.getItem(GITHUB_KEY_STORAGE) || (config && config.repo) || "MorGogh/widget-dock"; } catch (e) { return "MorGogh/widget-dock"; }
      });
      const [info, setInfo] = useState(null);
      const [error, setError] = useState(null);
      const [loading, setLoading] = useState(true);
      const [editing, setEditing] = useState(false);
      const [draft, setDraft] = useState(repo);
      const tier = tierOf(width);
      const later = useTimers();

      const load = useCallback(async () => {
        setLoading(true); setError(null);
        try {
          const r = repo.trim().replace(/^https?:\/\/github\.com\//, "").replace(/\/$/, "");
          if (!r || r.indexOf("/") < 0) throw new Error("格式：owner/repo");
          const res = await fetch("https://api.github.com/repos/" + r, { headers: { Accept: "application/vnd.github+json" } });
          if (res.status === 404) throw new Error("仓库不存在");
          if (res.status === 403) throw new Error("API 限流，稍后再试");
          if (!res.ok) throw new Error("HTTP " + res.status);
          const d = await res.json();
          setInfo({
            fullName: d.full_name,
            description: d.description,
            stars: d.stargazers_count,
            forks: d.forks_count,
            openIssues: d.open_issues_count,
            language: d.language,
            pushedAt: d.pushed_at,
            htmlUrl: d.html_url,
            license: d.license && d.license.spdx_id
          });
        } catch (e) { setError(e.message || "查询失败"); setInfo(null); }
        finally { setLoading(false); }
      }, [repo]);

      useEffect(() => { load(); }, [load]);
      // 5 分钟自动刷新（star 数等会变化）
      useEffect(() => {
        const id = window.setInterval(load, 5 * 60 * 1000);
        return () => window.clearInterval(id);
      }, [load]);

      const saveRepo = () => {
        const r = draft.trim();
        if (!r || r.indexOf("/") < 0) { setError("格式：owner/repo"); return; }
        try { localStorage.setItem(GITHUB_KEY_STORAGE, r); } catch (e) { /* ignore */ }
        onConfig({ repo: r });
        setRepo(r);
        setEditing(false);
        load();
      };
      const fmtAgo = (iso) => {
        if (!iso) return "--";
        const diff = Date.now() - new Date(iso).getTime();
        const d = Math.floor(diff / 86400000);
        if (d <= 0) { const h = Math.floor(diff / 3600000); return h > 0 ? h + " 小时前" : "刚刚"; }
        if (d < 30) return d + " 天前";
        const m = Math.floor(d / 30);
        return m + " 个月前";
      };

      return React.createElement("div", null,
        React.createElement("div", { className: "wd-balance-amount" },
          React.createElement("span", { className: "wd-balance-val wd-emoji-star", style: { fontSize: 20 } }, info ? "⭐" : "🐙"),
          React.createElement("span", { className: "wd-balance-cur" }, info ? info.stars.toLocaleString() : "GitHub")
        ),
        // 仓库名（L/XL 显示全名）
        tier !== "S" ? React.createElement("div", { className: "wd-balance-detail", style: { display: "block" } },
          React.createElement("span", { style: { color: "var(--dsw-alias-label-primary)", fontWeight: 600 } }, info ? info.fullName : repo)
        ) : null,
        tier !== "S" ? React.createElement("div", { className: "wd-balance-detail" },
          React.createElement("span", null, "🍴 " + (info ? info.forks.toLocaleString() : "--")),
          React.createElement("span", null, "🐞 " + (info ? info.openIssues : "--")),
          React.createElement("span", null, info && info.language ? info.language : "")
        ) : null,
        (tier === "L" || tier === "XL") && info && info.description ? React.createElement("div", { className: "wd-empty", style: { marginTop: 4 } },
          String(info.description).slice(0, 80)
        ) : null,
        tier === "XL" && info ? React.createElement("div", { className: "wd-balance-detail", style: { marginTop: 4 } },
          React.createElement("span", null, "最后推送 " + fmtAgo(info.pushedAt)),
          React.createElement("span", null, info.license || "")
        ) : null,
        loading ? React.createElement("div", { className: "wd-empty" }, "查询中…") : null,
        error ? React.createElement("div", { className: "wd-err" }, error) : null,
        // 操作行
        React.createElement("div", { className: "wd-cmd-grid", style: { gridTemplateColumns: "1fr 1fr", marginTop: 6 } },
          React.createElement("a", {
            className: "wd-cmd-btn",
            style: { textDecoration: "none", display: "flex", alignItems: "center", justifyContent: "center" },
            href: info ? info.htmlUrl : "https://github.com/" + repo,
            target: "_blank",
            rel: "noreferrer"
          }, "打开 ↗"),
          React.createElement("button", {
            className: "wd-cmd-btn",
            onClick: () => { setDraft(repo); setEditing(!editing); }
          }, editing ? "完成" : "换仓库")
        ),
        editing ? React.createElement("div", { className: "wd-edit" },
          React.createElement("input", {
            className: "wd-input",
            value: draft,
            onChange: (e) => setDraft(e.target.value),
            placeholder: "owner/repo，如 deepseek-ai/deepseek-v3",
            spellCheck: false,
            onKeyDown: (e) => { if (e.key === "Enter") { e.preventDefault(); saveRepo(); } }
          }),
          React.createElement("div", { className: "wd-edit-row" },
            React.createElement("button", { className: "wd-edit-btn primary", onClick: saveRepo }, "保存"),
            React.createElement("button", { className: "wd-edit-btn", onClick: () => setEditing(false) }, "取消")
          )
        ) : null
      );
    }

    // 8d) 会话时光机：最近会话列表，点击跳转
    function SessionTimeMachineWidget({ api, width }) {
      const [notice, setNotice] = useState(null);
      // 数据来自 WidgetDock 顶层的 useSessions 选择器切片（sessionsData：{ids, titles, current}），
      // 此处不做 hook 调用，保持 hook 顺序稳定。
      const sessions = api.sessionsData;
      const tier = tierOf(width);
      const ids = sessions && Array.isArray(sessions.ids) ? sessions.ids : null;
      const limit = tier === "S" ? 3 : (tier === "M" ? 5 : (tier === "L" ? 8 : 12));
      const shown = ids ? ids.slice(0, limit) : [];
      const openSession = (id) => {
        if (api.openSession) {
          api.openSession(id);
          setNotice("已打开会话");
        } else {
          setNotice("跳转通道不可用");
        }
      };
      return React.createElement("div", null,
        React.createElement("div", { className: "wd-balance-amount" },
          React.createElement("span", { className: "wd-balance-val" }, ids ? ids.length : "--"),
          React.createElement("span", { className: "wd-balance-cur" }, "会话")
        ),
        !sessions ? React.createElement("div", { className: "wd-empty" }, "会话数据不可用") :
        ids && ids.length ? React.createElement("div", { className: "wd-balance-detail", style: { display: "block", marginTop: 4 } },
          shown.map((id) => {
            const label = (sessions.titles && sessions.titles[id]) || String(id).slice(0, 8);
            const isCurrent = sessions.current === id;
            return React.createElement("div", {
              key: id,
              style: { display: "flex", alignItems: "center", gap: 6, padding: "2px 0", cursor: "pointer", color: "var(--dsw-alias-label-secondary)" },
              title: "打开这个会话",
              onClick: () => openSession(id)
            },
              React.createElement("span", { style: { flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } },
                (isCurrent ? "● " : "○ ") + label),
              isCurrent ? React.createElement("span", { style: { color: "var(--dsw-alias-state-business-primary)", fontSize: 9, flex: "none" } }, "当前") : null
            );
          })
        ) : React.createElement("div", { className: "wd-empty" }, "暂无会话"),
        notice ? React.createElement("div", { className: "wd-empty", style: { marginTop: 4, color: "var(--dsw-alias-state-business-primary)" } }, notice) : null
      );
    }

    // 9) 权限模式：读取 Harness 当前会话的有效预设，不在工作台里重复提供切换入口。
    function PermissionsWidget({ api }) {
      const permissions = api.useProjection("permissions");
      const current = permissions && permissions.currentValue;
      const option = permissions && Array.isArray(permissions.options) ? permissions.options.find((item) => item.value === current) : null;
      const label = option ? option.name : (current === "danger-full-access" ? "完全访问" : (current || "未提供"));
      const risk = current === "danger-full-access";
      return React.createElement("div", null,
        React.createElement("div", { className: "wd-balance-amount" },
          React.createElement("span", { className: "wd-balance-val", style: { fontSize: 20 } }, label),
          React.createElement("span", { className: "wd-balance-cur" }, "访问模式")
        ),
        React.createElement("div", { className: "wd-balance-detail" },
          React.createElement("span", null, option && option.description ? option.description : "由输入框中的权限控制器管理")
        ),
        risk ? React.createElement("div", { className: "wd-permission-risk" }, "高权限：可直接执行受限操作") : null
      );
    }

    // 9b) 计划模式：当前 plan 协作状态（active / pending）
    function PlanWidget({ api, width }) {
      const plan = api.useProjection("plan");
      const tier = tierOf(width);
      const active = plan ? !!plan.active : false;
      const pending = plan ? !!plan.pending : false;
      const label = plan ? (active ? "计划中" : "普通模式") : "未启用";
      return React.createElement("div", null,
        React.createElement("div", { className: "wd-balance-amount" },
          React.createElement("span", { className: "wd-balance-val", style: { fontSize: 22 } }, label),
          React.createElement("span", { className: "wd-balance-cur" }, "计划模式")
        ),
        tier !== "S" ? React.createElement("div", { className: "wd-balance-detail", style: { display: "block" } },
          pending ? React.createElement("div", null, "切换中…") :
          active ? React.createElement("div", null, "模型会先规划步骤，再执行") :
          React.createElement("div", null, "模型直接执行，不做前置规划")
        ) : null,
        tier === "XL" ? React.createElement("div", { className: "wd-empty", style: { marginTop: 4 } }, "可在输入框旁切换计划模式") : null
      );
    }

    // 9c) 推理强度：读取会话模型目录（modelDirectories 服务），滑轨拖动切换 reasoningEffort + 模型选择框
    function ReasoningWidget({ api, width }) {
      const tier = tierOf(width);
      const later = useTimers();
      const [state, setState] = useState(null);
      const [error, setError] = useState(null);
      const [modelOpen, setModelOpen] = useState(false);
      const [modelFlash, setModelFlash] = useState(false);
      const [menuPos, setMenuPos] = useState(null);
      const [localPos, setLocalPos] = useState(0);
      const [dragging, setDragging] = useState(false);
      // 获取目录：modelDirectory 是 inject 的函数（返回该会话的 ModelDirectory）
      const getDir = () => {
        try {
          const dir = api.modelDirectory ? api.modelDirectory() : null;
          return dir;
        } catch (e) { return null; }
      };
      // 订阅目录 store（快照 + 变化重渲染）
      useEffect(() => {
        const dir = getDir();
        if (!dir || !dir.store) { setState(null); return; }
        setState(dir.store.getSnapshot());
        const unsub = dir.store.subscribe(() => setState(dir.store.getSnapshot()));
        dir.load && dir.load().catch(() => {});
        return unsub;
      }, [api.sessionId]);
      // 点击外部关闭模型菜单（菜单 fixed 定位，需同时排除菜单自身）
      useEffect(() => {
        if (!modelOpen) return;
        const closeOutside = (event) => {
          const t = event.target;
          if (!t || !t.closest) return;
          if (!t.closest(".wd-reason-root") && !t.closest(".wd-reason-menu")) setModelOpen(false);
        };
        document.addEventListener("mousedown", closeOutside);
        return () => document.removeEventListener("mousedown", closeOutside);
      }, [modelOpen]);

      const current = state && state.current;
      const groups = (state && state.groups) || [];
      // 找到当前选择对应的模型及其 reasoning 档位
      let currentChoice = null;
      for (const group of groups) for (const model of group.models) {
        if (current && current.provider === group.id && current.model === model.id) currentChoice = { group, model };
      }
      const reasoning = currentChoice ? currentChoice.model.reasoning : undefined;
      const efforts = (reasoning && reasoning.efforts) || [];
      const effectiveEffort = (current && current.reasoningEffort) || (reasoning && reasoning.defaultEffort) || undefined;
      const sliderIndex = efforts.findIndex((level) => level.id === effectiveEffort);
      const resolvedIndex = sliderIndex < 0 ? (efforts.length > 0 ? Math.floor(efforts.length / 2) : 0) : sliderIndex;
      const busy = state && state.status === "selecting";
      // 本地拖动位置跟随外部变化（切换模型/加载完成时复位）
      useEffect(() => { setLocalPos(resolvedIndex); }, [resolvedIndex, efforts]);
      // 粒子爆炸：burst 每次 +1 触发一次（React key 变化重建粒子组）
      const [burst, setBurst] = useState(0);
      // 拖尾：拖动中 thumb 留下的粒子轨迹（向运动反方向飘散）
      const [trail, setTrail] = useState([]);
      const trailSeqRef = useRef(0);
      const trailPrevXRef = useRef(null);
      const trailLastAtRef = useRef(0);
      // 清理 1 秒前的拖尾粒子（动画已淡出）
      useEffect(() => {
        const id = window.setInterval(() => {
          const cutoff = Date.now() - 1000;
          setTrail((t) => t.filter((p) => p.at > cutoff));
        }, 600);
        return () => window.clearInterval(id);
      }, []);

      const chooseEffort = (effort) => {
        if (!current || busy) return;
        if (effectiveEffort === effort) return;
        // 拉到最大档位（最后一个 effort）→ 紫色粒子炸开
        if (efforts.length > 1 && effort === efforts[efforts.length - 1].id) setBurst((b) => b + 1);
        const selection = { provider: current.provider, model: current.model };
        if (effort !== undefined) selection.reasoningEffort = effort;
        try {
          const dir = getDir();
          if (dir && dir.select) { dir.select(selection).catch(() => { setError("切换失败"); }); setError(null); }
        } catch (e) { setError("切换失败: " + (e.message || e)); }
      };
      const chooseModel = (provider, model) => {
        if (!current || busy) return;
        if (current.provider === provider && current.model === model) { setModelOpen(false); return; }
        const target = groups.reduce((acc, g) => acc.concat(g.models), []).find((m) => m.id === model);
        const targetReasoning = target && target.reasoning;
        const targetEfforts = (targetReasoning && targetReasoning.efforts) || [];
        let effort;
        if (current && current.reasoningEffort && targetEfforts.some((e) => e.id === current.reasoningEffort)) {
          effort = current.reasoningEffort;
        } else if (targetReasoning && targetReasoning.defaultEffort) {
          effort = targetReasoning.defaultEffort;
        } else if (targetEfforts.length > 0) {
          effort = targetEfforts[Math.floor(targetEfforts.length / 2)].id;
        }
        const selection = { provider: provider, model: model };
        if (effort !== undefined) selection.reasoningEffort = effort;
        try {
          const dir = getDir();
          if (dir && dir.select) { dir.select(selection).catch(() => { setError("切换模型失败"); }); setError(null); }
          // 切换成功动画反馈：滑轨处粒子小爆 + 按钮闪光
          setBurst((b) => b + 1);
          setModelFlash(true);
          later(() => setModelFlash(false), 600);
          setModelOpen(false);
        } catch (e) { setError("切换模型失败: " + (e.message || e)); }
      };
      // 滑轨拖动：onChange 实时预览位置，onSubmit 松手/键盘提交
      const onSliderChange = (i) => setLocalPos(i);
      const onSliderSubmit = (i) => {
        const effort = efforts[Math.round(i)];
        if (effort) chooseEffort(effort.id);
      };

      // 模型选择框内容（分组菜单）——fixed 定位脱离卡片裁剪，避免 body 滚动条随内容跳动
      const modelMenu = modelOpen && menuPos ? React.createElement("div", {
        className: "wd-reason-menu",
        style: { position: "fixed", left: menuPos.left + "px", top: menuPos.top + "px", width: menuPos.width + "px" }
      },
        groups.length ? groups.map((group) => React.createElement("div", { key: group.id, className: "wd-reason-group" },
          React.createElement("div", { className: "wd-reason-group-title" }, group.name),
          group.models.map((model) => {
            const selected = current !== null && current.provider === group.id && current.model === model.id;
            return React.createElement("button", {
              key: model.id,
              className: "wd-reason-option" + (selected ? " selected" : ""),
              title: model.description || model.name,
              disabled: busy,
              onClick: () => chooseModel(group.id, model.id)
            },
              React.createElement("span", null, model.name),
              selected ? React.createElement("span", { className: "wd-reason-check" }, "✓") : null
            );
          })
        )) : React.createElement("div", { className: "wd-empty" }, "没有可用的模型"))
      : null;

      // 滑轨（参考官方 slider：pointer 拖拽 + 键盘 + 滚轮）
      const n = efforts.length;
      const sliderEl = (() => {
        if (efforts.length === 0) return null;
        if (efforts.length === 1) return React.createElement("div", { className: "wd-reason-single" }, "支持档位：" + efforts[0].name);
        // thumb 位置用浮点 localPos（拖动平滑跟手），显示值用整数档位
        const leftPct = n <= 1 ? (resolvedIndex >= 0 ? 100 : 0) : (localPos / (n - 1)) * 100;
        const shown = Math.round(localPos);
        return React.createElement("div", {
          className: "wd-reason-track" + (dragging ? " dragging" : ""),
          role: "slider",
          "aria-label": "推理强度",
          "aria-valuemin": 0,
          "aria-valuemax": n - 1,
          "aria-valuenow": shown,
          "aria-valuetext": efforts[shown] ? efforts[shown].name : "",
          tabIndex: busy ? -1 : 0,
          onPointerDown: (e) => {
            if (busy) return;
            e.preventDefault();
            e.currentTarget.setPointerCapture(e.pointerId);
            const rect = e.currentTarget.getBoundingClientRect();
            const ratio = (e.clientX - rect.left - 14) / (rect.width - 28);
            setLocalPos(Math.max(0, Math.min(n - 1, ratio * (n - 1))));
            e.currentTarget._wdDragging = true;
            setDragging(true);
            trailPrevXRef.current = Math.max(0, Math.min(n - 1, ratio * (n - 1)));
            trailLastAtRef.current = Date.now();
          },
          onPointerMove: (e) => {
            if (!e.currentTarget._wdDragging || busy) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const ratio = (e.clientX - rect.left - 14) / (rect.width - 28);
            const pos = Math.max(0, Math.min(n - 1, ratio * (n - 1)));
            setLocalPos(pos);
            // 拖尾：往右拖（dx>0）粒子向左飘（-dx），留在运动轨迹后方；每 40ms 一颗
            const now = Date.now();
            if (trailPrevXRef.current !== null && Math.abs(pos - trailPrevXRef.current) > 0.02 && now - trailLastAtRef.current > 40) {
              trailLastAtRef.current = now;
              const dir = pos - trailPrevXRef.current;
              const id = ++trailSeqRef.current;
              const hue = 250 + Math.floor(Math.random() * 60);
              const drift = (18 + Math.random() * 26) * (dir > 0 ? -1 : 1);
              setTrail((t) => t.concat([{
                id: id,
                leftPct: (pos / (n - 1)) * 100,
                dx: drift + (Math.random() - 0.5) * 10,
                dy: (Math.random() - 0.5) * 16,
                size: 2.5 + Math.random() * 3.5,
                hue: hue,
                at: now
              }]).slice(-40));
            }
            trailPrevXRef.current = pos;
          },
          onPointerUp: (e) => {
            if (!e.currentTarget._wdDragging) return;
            e.currentTarget._wdDragging = false;
            setDragging(false);
            trailPrevXRef.current = null;
            const rect = e.currentTarget.getBoundingClientRect();
            const ratio = (e.clientX - rect.left - 14) / (rect.width - 28);
            const snapped = Math.round(Math.max(0, Math.min(n - 1, ratio * (n - 1))));
            setLocalPos(snapped);
            onSliderSubmit(snapped);
          },
          onPointerCancel: () => { setDragging(false); trailPrevXRef.current = null; },
          onKeyDown: (e) => {
            if (busy) return;
            const dir = e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : 0;
            if (!dir) return;
            e.preventDefault();
            const next = Math.max(0, Math.min(n - 1, Math.round(localPos) + dir));
            setLocalPos(next);
            onSliderSubmit(next);
          },
          onWheel: (e) => {
            if (busy || e.deltaY === 0) return;
            e.preventDefault();
            const next = Math.max(0, Math.min(n - 1, Math.round(localPos) + (e.deltaY < 0 ? 1 : -1)));
            setLocalPos(next);
            onSliderSubmit(next);
          }
        },
          React.createElement("div", { className: "wd-reason-range" },
            React.createElement("div", { className: "wd-reason-rail" }),
            React.createElement("div", { className: "wd-reason-fill", style: { width: "calc(" + leftPct + "% + 12px)" } }),
            efforts.map((effort, i) => React.createElement("div", {
              key: effort.id,
              className: "wd-reason-tick" + (i <= shown ? " on" : ""),
              style: { left: (n <= 1 ? 0 : (i / (n - 1)) * 100) + "%" }
            })),
            React.createElement("div", { className: "wd-reason-thumb", style: { left: leftPct + "%" } }),
            // 拖尾粒子：拖动中留在轨迹后方的光点
            trail.map((p) => React.createElement("span", {
              key: p.id,
              className: "wd-reason-trail",
              style: {
                left: p.leftPct + "%",
                "--tdx": p.dx.toFixed(1) + "px",
                "--tdy": p.dy.toFixed(1) + "px",
                width: p.size + "px",
                height: p.size + "px",
                background: "hsl(" + p.hue + " 90% 65%)",
                boxShadow: "0 0 " + (p.size + 3) + "px hsl(" + p.hue + " 90% 60%)"
              }
            })),
            // 拉到最大档位：紫色粒子从中心逐渐持续向外散（burst 变化 → key 重建 → 动画重播）
            burst > 0 ? React.createElement("div", { key: burst, className: "wd-reason-burst", style: { left: leftPct + "%" } },
              Array.from({ length: 22 }, (_, i) => {
                const angle = (i / 22) * Math.PI * 2 + (Math.random() - 0.5) * 0.6;
                const dist = 22 + Math.random() * 42;
                const size = 3 + Math.random() * 5;
                const hue = 250 + Math.floor(Math.random() * 60); // 紫→粉紫色相
                return React.createElement("span", {
                  key: i,
                  className: "wd-reason-particle",
                  style: {
                    "--dx": (Math.cos(angle) * dist).toFixed(1) + "px",
                    "--dy": (Math.sin(angle) * dist).toFixed(1) + "px",
                    width: size + "px",
                    height: size + "px",
                    background: "hsl(" + hue + " 90% 65%)",
                    boxShadow: "0 0 " + (size + 4) + "px hsl(" + hue + " 90% 60%)",
                    // delay 阶梯 0→0.5s：粒子从中心逐渐持续向外散（Claude 风格）
                    animationDelay: (i / 22 * 0.5).toFixed(2) + "s",
                    animationDuration: (0.5 + Math.random() * 0.35).toFixed(2) + "s"
                  }
                });
              })
            ) : null
          )
        );
      })();

      return React.createElement("div", { className: "wd-reason-root" },
        React.createElement("div", { className: "wd-balance-amount" },
          React.createElement("span", { className: "wd-balance-val wd-reason-glow", style: { fontSize: 20 } }, efforts[Math.round(localPos)] ? efforts[Math.round(localPos)].name : (current ? (currentChoice ? currentChoice.model.name : current.model) : "--")),
          React.createElement("span", { className: "wd-balance-cur" }, "推理强度")
        ),
        // 模型选择框
        React.createElement("div", { className: "wd-reason-model", style: { marginTop: 6 } },
          React.createElement("button", {
            className: "wd-reason-model-btn" + (modelOpen ? " open" : "") + (modelFlash ? " flash" : ""),
            disabled: busy || !current,
            onClick: (e) => {
              if (!modelOpen) {
                const rect = e.currentTarget.getBoundingClientRect();
                setMenuPos({ left: rect.left, top: rect.bottom + 3, width: rect.width });
              }
              setModelOpen(!modelOpen);
            }
          }, current ? (currentChoice ? currentChoice.model.name : current.model) : "选择模型", React.createElement("span", { className: "wd-reason-caret" }, modelOpen ? "▲" : "▼")),
          modelMenu
        ),
        // 滑轨
        sliderEl,
        !state ? React.createElement("div", { className: "wd-empty" }, "模型目录不可用（未安装模型选择插件？）") : null,
        !efforts.length && state ? React.createElement("div", { className: "wd-empty" }, "当前模型不支持调节推理强度") : null,
        error ? React.createElement("div", { className: "wd-err" }, error) : null,
        tier === "XL" ? React.createElement("div", { className: "wd-empty", style: { marginTop: 4 } }, "拖动滑块或滚轮切换；强度越高思考越久，费用也越高") : null
      );
    }

    // 9d) 图像限制：当前会话的图片上传配额
    function ImageLimitsWidget({ api, width }) {
      const limits = api.useProjection("imageLimits");
      const tier = tierOf(width);
      return React.createElement("div", null,
        React.createElement("div", { className: "wd-balance-amount" },
          React.createElement("span", { className: "wd-balance-val", style: { fontSize: 22 } }, limits ? fmtBytes(limits.maxImageBytes) : "--"),
          React.createElement("span", { className: "wd-balance-cur" }, "单图上限")
        ),
        tier !== "S" && limits ? React.createElement("div", { className: "wd-balance-detail" },
          React.createElement("span", null, "每消息 " + limits.maxImagesPerMessage + " 张"),
          React.createElement("span", null, "像素 " + fmtPixels(limits.maxImagePixels))
        ) : null,
        tier === "XL" && limits ? React.createElement("div", { className: "wd-empty", style: { marginTop: 4 } },
          "支持格式: " + (limits.mediaTypes || []).join(" / ")
        ) : null,
        !limits ? React.createElement("div", { className: "wd-empty" }, "当前会话不支持图片") : null
      );
    }

    // 9d) 图片转述：图片 → 视觉模型 → 文字描述 → 注入输入框（DeepSeek 不读图，靠转述降级）
    // 自动协作模式：检测到输入框有图片（imageIds>0）→ 从 DOM 抓 blob URL → fetch 拿字节 →
    // 视觉模型转述 → setDraft 注入描述 + removeImage 移除原图 → 用户直接发送给 DeepSeek。
    function ImageRelayWidget({ api, config, onConfig, width }) {
      const [desc, setDesc] = useState(null);
      const [error, setError] = useState(null);
      const [busy, setBusy] = useState(false);
      const [editing, setEditing] = useState(false);
      const [autoMode, setAutoMode] = useState(() => {
        try { return localStorage.getItem(AUTO_RELAY_KEY) !== "off"; } catch (e) { return true; }
      });
      const [keyDraft, setKeyDraft] = useState(getVisionKey(config));
      const [modelDraft, setModelDraft] = useState(visionModel(config));
      const [urlDraft, setUrlDraft] = useState(visionUrl(config));
      const fileRef = useRef(null);
      const later = useTimers();
      // 草稿订阅在卡片内部（只重渲染本卡片）；顶层不再订阅 draft，避免击键触发全工作台重渲染
      const inputDraft = typeof api.useInput === "function" ? api.useInput((s) => (s && typeof s.draft === "string" ? s.draft : ""), (a, b) => a === b) : "";
      // draftRef：转述耗时 30-60 秒，期间用户可能打字；写入描述时用最新 draft，而不是闭包捕获的旧值
      const draftRef = useRef(inputDraft);
      draftRef.current = inputDraft;
      const tier = tierOf(width);
      const hasImages = api.inputImageCount > 0;
      // 描述区块锚点：HTML 注释，用户文本几乎不可能包含，精确清理旧区块
      const DESC_OPEN = "<!-- wd-image-desc -->";
      const DESC_CLOSE = "<!-- /wd-image-desc -->";
      const stripDescBlock = (draft) => String(draft).replace(new RegExp("\\n*" + DESC_OPEN + "[\\s\\S]*?" + DESC_CLOSE + "\\n*", "g"), "").trim();
      const buildBlock = (text) => "\n\n" + DESC_OPEN + "\n📷 已转述图片（供 AI 理解，可忽略）\n" + text + "\n" + DESC_CLOSE + "\n";

      // 只调视觉模型拿描述文本；不碰输入框（写入由调用方决定）
      const visionText = async (blob, mime) => {
        setBusy(true); setError(null);
        try {
          const key = getVisionKey(config);
          const model = visionModel(config);
          const url = visionUrl(config);
          // 本地端点（LM Studio / Ollama / vLLM 本地）不校验 key，跳过必填校验
          const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/i.test(url);
          if (!key && !isLocal) throw new Error("未配置视觉模型 KEY");
          // 读图片 → base64（OpenAI 兼容 image_url 格式，与 DSH pi-ai 同款 wire 格式）
          const b64 = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => { const r = reader.result; resolve(String(r).split(",")[1] || ""); };
            reader.onerror = () => reject(new Error("读取图片失败"));
            reader.readAsDataURL(blob);
          });
          if (!b64) throw new Error("图片编码失败");
          const res = await fetch(url, {
            method: "POST",
            headers: Object.assign({ "Content-Type": "application/json" }, key ? { "Authorization": "Bearer " + key } : {}),
            body: JSON.stringify({
              model: model,
              max_tokens: 1200,
              messages: [{ role: "user", content: [
                { type: "image_url", image_url: { url: "data:" + (mime || "image/png") + ";base64," + b64 } },
                { type: "text", text: "直接输出这张图片的内容描述（主要元素、文字、布局、细节），用连贯的中文段落。不要复述我的指令，不要写分析过程，不要用编号列表。只输出描述本身。" }
              ] }]
            })
          });
          if (!res.ok) {
            let detail = "";
            try { const j = await res.json(); detail = (j && (j.error && (j.error.message || j.error.code))) || ""; } catch (e) { /* ignore */ }
            throw new Error("HTTP " + res.status + (detail ? ": " + detail : ""));
          }
          const j = await res.json();
          const msg = j && j.choices && j.choices[0] && j.choices[0].message;
          // 只取最终答案 content——推理模型（qwen3.5）在 reasoning_content 里输出思考过程，
          // 绝不能用它兜底（LM Studio separateReasoningContentInAPI 已分离两者）。
          const text = (msg && msg.content ? msg.content : "").trim();
          if (!text) throw new Error("模型未返回描述（本地推理可能被截断，可调大 max_tokens）");
          return text;
        } catch (e) {
          setError(e.message || "转述失败");
          return null;
        } finally {
          setBusy(false);
        }
      };

      // 把描述块写入输入框：新批次（距上次图片清空后第一次）先清旧区块；同一批多图逐个追加
      const writeDescBlock = (text, isNewBatch) => {
        if (!api || !api.inputActions || !api.inputActions.setDraft) return;
        try {
          const base = isNewBatch ? stripDescBlock(draftRef.current) : draftRef.current;
          api.inputActions.setDraft(base ? base + buildBlock(text) : buildBlock(text).trim());
          later(() => {
            try {
              const ta = document.querySelector("textarea[uV2eYG_input], .uV2eYG_input, textarea[placeholder]");
              if (ta && typeof ta.setSelectionRange === "function") {
                const pos = base.length;
                ta.focus();
                ta.setSelectionRange(pos, pos);
              }
            } catch (e) { /* 光标调整失败不影响功能 */ }
          }, 30);
        } catch (e) { /* setDraft 不可用时描述留在卡片上 */ }
      };

      // 自动协作状态：已处理过的图片 id（防止重复转述、失败重试死循环）+ 当前批次标记
      const processedIdsRef = useRef(new Set());
      const batchRef = useRef(0);
      // 图片清空 → 重置批次和已处理集合，允许下一批重新触发
      useEffect(() => {
        if (!hasImages) { processedIdsRef.current.clear(); batchRef.current = 0; }
      }, [hasImages]);

      useEffect(() => {
        if (!autoMode || !hasImages || busy) return;
        const ids = api.inputImageIds || [];
        const pending = ids.filter((id) => !processedIdsRef.current.has(id));
        if (!pending.length) return;
        const id = pending[0];
        processedIdsRef.current.add(id);
        const t = later(async () => {
          try {
            // 从 DOM 抓输入框附件区的图片 blob URL。必须限定 composer 附件容器
            // （.uV2eYG_attachments），否则历史消息里的图片（也是 blob:）会被误抓。
            const rail = document.querySelector(".uV2eYG_attachments");
            const imgs = Array.from((rail || document).querySelectorAll("img[src^='blob:']"));
            const img = imgs[0];
            if (!img || !img.src) { setError("未找到输入框图片，请重试"); processedIdsRef.current.delete(id); return; }
            const blob = await fetch(img.src).then((r) => r.blob());
            const mime = blob.type || "image/png";
            const text = await visionText(blob, mime);
            if (text) {
              const isNewBatch = batchRef.current === 0;
              batchRef.current = 1;
              writeDescBlock(text, isNewBatch);
              setDesc("[图片转述] " + text);
              // 移除已转述的这张原图（图片本身发不出去，描述就是替身）
              if (api.inputActions && api.inputActions.removeImage) {
                try {
                  api.inputActions.removeImage(id);
                  later(() => {
                    const still = api.inputImageIds && api.inputImageIds.indexOf(id) >= 0;
                    if (still) setError("转述完成，但原图未能自动移除——请手动删除输入框图片");
                  }, 400);
                } catch (e) { setError("转述完成，请手动删除输入框图片"); }
              }
            }
            // text 为 null 时 visionText 已 setError；图片保留在输入框供用户手动处理
          } catch (e) {
            setError("自动转述失败: " + (e.message || e) + "（图片保留在输入框，可重试）");
          }
        }, 300);
        return () => window.clearTimeout(t);
      }, [hasImages, autoMode, busy, api.inputImageIds]);

      const toggleAuto = () => {
        const next = !autoMode;
        setAutoMode(next);
        try { localStorage.setItem(AUTO_RELAY_KEY, next ? "on" : "off"); } catch (e) { /* ignore */ }
      };

      // 手动选图：append 到草稿下方（不覆盖用户已输入内容），新批次先清旧区块
      const pickRelay = async (file) => {
        const text = await visionText(file, file.type);
        if (text) {
          writeDescBlock(text, true);
          setDesc("[图片转述] " + text);
        }
      };

      return React.createElement("div", null,
        React.createElement("div", { className: "wd-balance-amount" },
          React.createElement("span", { className: "wd-balance-val wd-emoji-float", style: { fontSize: 20 } }, hasImages ? "🖼️" : "👁️"),
          React.createElement("span", { className: "wd-balance-cur" }, "图片转述")
        ),
        tier !== "S" ? React.createElement("div", { className: "wd-balance-detail" },
          React.createElement("span", null, hasImages ? "输入框有 " + api.inputImageCount + " 张图" : "选图转文字喂给 DeepSeek")
        ) : null,
        // 自动协作模式开关（默认开）：输入框贴图后自动转述并移除原图
        tier !== "S" ? React.createElement("div", { className: "wd-auto-row", style: { display: "flex", alignItems: "center", gap: 6, marginTop: 6, fontSize: 10, color: "var(--dsw-alias-label-tertiary)" } },
          React.createElement("button", {
            className: "wd-auto-toggle" + (autoMode ? " on" : ""),
            style: { flex: "none", width: 26, height: 14, borderRadius: 7, border: "1px solid var(--dsw-alias-border-l1)", background: autoMode ? "var(--dsw-alias-state-business-primary)" : "var(--dsw-alias-interactive-bg-hover)", position: "relative", cursor: "pointer", padding: 0 },
            onClick: toggleAuto,
            title: autoMode ? "自动协作已开启：输入框贴图自动转述" : "自动协作已关闭：手动选图转述"
          }, React.createElement("span", { style: { position: "absolute", top: 1, left: autoMode ? 13 : 1, width: 10, height: 10, borderRadius: 5, background: "#fff", transition: "left .15s" } })),
          React.createElement("span", null, autoMode ? "自动：贴图即转述" : "手动模式"),
          busy ? React.createElement("span", { style: { color: "var(--dsw-alias-state-business-primary)", marginLeft: "auto" } }, "正在理解图片…") : null
        ) : null,
        // 选图按钮（S/M/L/XL 都有）
        React.createElement("div", { className: "wd-cmd-grid", style: { gridTemplateColumns: "1fr 1fr", marginTop: 6 } },
          React.createElement("button", {
            className: "wd-cmd-btn",
            disabled: busy,
            onClick: () => { if (fileRef.current) fileRef.current.click(); }
          }, busy ? "转述中…" : "选择图片"),
          React.createElement("button", {
            className: "wd-cmd-btn",
            disabled: !desc,
            title: desc ? "复制最近一次描述" : "先转述图片",
            onClick: () => { if (desc) { try { navigator.clipboard.writeText(desc); } catch (e) { /* ignore */ } } }
          }, "复制描述")
        ),
        React.createElement("input", {
          ref: fileRef,
          type: "file",
          accept: "image/*",
          style: { display: "none" },
          onChange: (e) => { const f = e.target.files && e.target.files[0]; if (f) pickRelay(f); e.target.value = ""; }
        }),
        // 摘要而非全文：描述已进输入框（分隔区块），卡片只显示状态，符合"用户不看描述"的诉求
        desc ? React.createElement("div", { className: "wd-empty", style: { marginTop: 4, color: "var(--dsw-alias-state-success-primary)" } }, "已转述 ✓ 描述已附在输入框（点复制可手动取）") : null,
        error ? React.createElement("div", { className: "wd-err" }, error) : null,
        (tier === "L" || tier === "XL") ? React.createElement("div", { className: "wd-empty", style: { marginTop: 4, cursor: "pointer", color: "var(--dsw-alias-state-business-primary)" }, onClick: () => setEditing(!editing) },
          editing ? "收起配置" : "配置视觉模型"
        ) : null,
        editing ? React.createElement("div", { className: "wd-edit" },
          React.createElement("div", { className: "wd-edit-title" }, "视觉模型（OpenAI 兼容）"),
          React.createElement("input", { className: "wd-input", value: urlDraft, onChange: (e) => setUrlDraft(e.target.value), spellCheck: false, placeholder: "API 端点" }),
          React.createElement("input", { className: "wd-input", value: modelDraft, onChange: (e) => setModelDraft(e.target.value), spellCheck: false, placeholder: "模型名，如 qwen-vl-plus / gpt-4o-mini" }),
          React.createElement("input", { className: "wd-input", value: keyDraft, onChange: (e) => setKeyDraft(e.target.value), spellCheck: false, placeholder: "API KEY" }),
          React.createElement("div", { className: "wd-edit-row" },
            React.createElement("button", {
              className: "wd-edit-btn primary",
              onClick: () => {
                onConfig({ apiKey: keyDraft.trim(), model: modelDraft.trim() || VISION_DEFAULT_MODEL, url: urlDraft.trim() || VISION_DEFAULT_URL });
                try { localStorage.setItem(VISION_KEY_STORAGE, keyDraft.trim()); } catch (e) { /* ignore */ }
                setEditing(false);
              }
            }, "保存"),
            React.createElement("button", { className: "wd-edit-btn", onClick: () => setEditing(false) }, "完成")
          )
        ) : (tier === "S" || tier === "M") ? React.createElement("div", { className: "wd-empty", style: { marginTop: 4 } },
            getVisionKey(config) ? "模型: " + visionModel(config) : "未配置 KEY（本地 LM Studio 无需）"
          ) : null
      );
    }

    // 9e) 灵感速记：临时便签（localStorage 持久化）
    function NotepadWidget({ api, width }) {
      const [notes, setNotes] = useState(() => {
        try { const raw = localStorage.getItem(NOTEPAD_KEY); return raw ? JSON.parse(raw) : []; } catch (e) { return []; }
      });
      const [draft, setDraft] = useState("");
      const [editing, setEditing] = useState(false);
      const saveNotes = (next) => { setNotes(next); try { localStorage.setItem(NOTEPAD_KEY, JSON.stringify(next)); } catch (e) { /* ignore */ } };
      const addNote = () => {
        const text = draft.trim();
        if (!text) return;
        saveNotes([{ text: text, at: Date.now() }].concat(notes).slice(0, 20));
        setDraft("");
      };
      const removeNote = (i) => { saveNotes(notes.filter((_, idx) => idx !== i)); };
      const tier = tierOf(width);
      const shown = tier === "S" ? notes.slice(0, 1) : (tier === "M" ? notes.slice(0, 3) : (tier === "L" ? notes.slice(0, 6) : notes));
      return React.createElement("div", null,
        React.createElement("div", { className: "wd-balance-amount" },
          React.createElement("span", { className: "wd-balance-val", style: { fontSize: 22 } }, notes.length ? notes.length : "0"),
          React.createElement("span", { className: "wd-balance-cur" }, "便签")
        ),
        shown.length ? React.createElement("div", { className: "wd-balance-detail", style: { display: "block" } },
          shown.map((n, i) => React.createElement("div", { key: (n.at ? n.at + "-" : "") + i, style: { display: "flex", gap: 6, marginTop: i ? 3 : 0 } },
            React.createElement("span", { style: { flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, n.text),
            React.createElement("span", { style: { cursor: "pointer", color: "var(--dsw-alias-state-error-primary)", flex: "none" }, onClick: () => removeNote(i) }, "✕")
          ))
        ) : React.createElement("div", { className: "wd-empty" }, "还没有便签"),
        tier !== "S" ? React.createElement("div", { className: "wd-empty", style: { marginTop: 4, cursor: "pointer", color: "var(--dsw-alias-state-business-primary)" }, onClick: () => setEditing(!editing) }, editing ? "完成" : "＋ 记一条") : null,
        editing ? React.createElement("div", { className: "wd-edit" },
          React.createElement("input", {
            className: "wd-input",
            value: draft,
            onChange: (e) => setDraft(e.target.value),
            placeholder: "随手记下想法…",
            onKeyDown: (e) => { if (e.key === "Enter") { e.preventDefault(); addNote(); } }
          }),
          React.createElement("div", { className: "wd-edit-row" },
            React.createElement("button", { className: "wd-edit-btn primary", onClick: addNote }, "保存"),
            React.createElement("button", { className: "wd-edit-btn", onClick: () => setEditing(false) }, "完成")
          )
        ) : null
      );
    }

    // 9f) 会话账单：本会话花费 + 余额 + 还能聊多少轮（估算）
    function SessionBillWidget({ api, config, onConfig, width }) {
      const [balance, setBalance] = useState(null);
      const [error, setError] = useState(null);
      const [loading, setLoading] = useState(true);
      const usage = api.useProjection("tokenUsage");
      const stats = api.useProjection("sessionStats");
      const model = (config && config.model) || "flash";
      const rates = OFFICIAL_RATES[model] || OFFICIAL_RATES.flash;
      const tier = tierOf(width);

      const loadBalance = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
          const key = getBalanceKey(config);
          if (!key) throw new Error("未配置 KEY");
          const res = await fetch(BALANCE_URL, { headers: { Authorization: "Bearer " + key } });
          if (!res.ok) throw new Error("HTTP " + res.status);
          const data = await res.json();
          const info = data && data.balance_infos && data.balance_infos[0];
          setBalance(info ? parseFloat(info.total_balance) : null);
        } catch (e) { setError(e.message || "查询失败"); setBalance(null); }
        finally { setLoading(false); }
      }, [config]);
      useEffect(() => { loadBalance(); }, [loadBalance]);

      // 本会话成本（元）
      const cost = usage ? (
        ((usage.uncachedInputTokens || 0) * rates.input +
          (usage.cacheReadTokens || 0) * rates.cacheRead +
          (usage.cacheWriteTokens || 0) * rates.cacheWrite +
          (usage.outputTokens || 0) * rates.output) / 1e6
      ) : 0;
      const turns = stats && stats.turns != null ? stats.turns : 0;
      const avgPerTurn = turns > 0 && cost > 0 ? cost / turns : null;
      const roundsLeft = balance != null && avgPerTurn ? Math.max(0, Math.floor(balance / avgPerTurn)) : null;

      return React.createElement("div", null,
        React.createElement("div", { className: "wd-balance-amount" },
          React.createElement("span", { className: "wd-balance-val" }, "≈¥" + cost.toFixed(4)),
          React.createElement("span", { className: "wd-balance-cur" }, "本会话花费")
        ),
        tier !== "S" ? React.createElement("div", { className: "wd-balance-detail" },
          React.createElement("span", null, "余额 " + (balance != null ? "¥" + balance : "--")),
          React.createElement("span", null, "回合 " + (turns || "--"))
        ) : null,
        (tier === "L" || tier === "XL") && roundsLeft != null ? React.createElement("div", { className: "wd-empty", style: { marginTop: 4, color: roundsLeft < 10 ? "var(--dsw-alias-state-error-primary)" : "var(--dsw-alias-state-success-primary)" } },
          "按当前节奏还能聊约 " + roundsLeft + " 轮（估）"
        ) : null,
        tier === "XL" ? React.createElement("div", { className: "wd-empty", style: { marginTop: 4, cursor: "pointer", color: "var(--dsw-alias-state-business-primary)" }, onClick: () => onConfig({ model: model === "flash" ? "pro" : "flash" }) },
          "模型: " + model + "（点击切换）"
        ) : null,
        error ? React.createElement("div", { className: "wd-err" }, error) : null
      );
    }

    // 10) 上下文水位：占比 + 剩余量 进度条
    function ContextGaugeWidget({ api, width }) {
      const pressure = api.useProjection("contextPressure");
      const tier = tierOf(width);
      const projected = pressure && (pressure.projectedTokens || pressure.pressureTokens);
      const windowSize = pressure && pressure.contextWindow;
      const ratio = projected && windowSize ? Math.min(100, Math.round(projected / windowSize * 100)) : null;
      const remain = ratio != null ? Math.max(0, 100 - ratio) : null;
      return React.createElement("div", null,
        React.createElement("div", { className: "wd-balance-amount" },
          React.createElement("span", { className: "wd-balance-val" }, remain != null ? remain + "%" : "--"),
          React.createElement("span", { className: "wd-balance-cur" }, "上下文剩余")
        ),
        ratio != null ? React.createElement("div", { style: { height: 10, borderRadius: 5, background: "var(--dsw-alias-bg-layer-1, rgba(0,0,0,.06))", overflow: "hidden", marginTop: 6 } },
          React.createElement("div", { style: { width: ratio + "%", height: "100%", background: ratio >= 80 ? "var(--dsw-alias-state-error-primary)" : "var(--dsw-alias-state-business-primary)" } })
        ) : null,
        tier !== "S" && projected ? React.createElement("div", { className: "wd-balance-detail", style: { marginTop: 4 } },
          React.createElement("span", null, "已用 " + fmtNum(projected)),
          React.createElement("span", null, windowSize ? "窗口 " + fmtNum(windowSize) : "")
        ) : null,
        !pressure ? React.createElement("div", { className: "wd-empty" }, "暂无水位数据") : null
      );
    }

    // 11) 响应仪表：最近回合的平均模型耗时
    function ResponseMeterWidget({ api, width }) {
      const stats = api.useProjection("sessionStats");
      const tier = tierOf(width);
      const turns = stats && stats.turns != null ? stats.turns : 0;
      const llmMs = stats && stats.llmMs != null ? stats.llmMs : 0;
      const ttftMs = stats && stats.ttftMs != null ? stats.ttftMs : 0;
      const avg = turns > 0 ? llmMs / turns : null;
      return React.createElement("div", null,
        React.createElement("div", { className: "wd-balance-amount" },
          React.createElement("span", { className: "wd-balance-val" }, avg != null ? fmtTime(avg) : "--"),
          React.createElement("span", { className: "wd-balance-cur" }, "平均耗时/轮")
        ),
        tier !== "S" ? React.createElement("div", { className: "wd-balance-detail" },
          React.createElement("span", null, "回合 " + (turns || "--")),
          React.createElement("span", null, "总耗时 " + fmtTime(llmMs))
        ) : null,
        tier === "XL" && ttftMs > 0 ? React.createElement("div", { className: "wd-empty", style: { marginTop: 4 } },
          "首字延迟 " + fmtTime(ttftMs / Math.max(1, stats.ttftSteps || 1))
        ) : null,
        !stats ? React.createElement("div", { className: "wd-empty" }, "暂无耗时数据") : null
      );
    }

    // 12) 目标冲刺：目标 + 已用回合 + 估算成本
    function GoalSprintWidget({ api, width }) {
      const projection = api.useProjection("goal");
      const stats = api.useProjection("sessionStats");
      const usage = api.useProjection("tokenUsage");
      const tier = tierOf(width);
      const goal = projection ? projection.goal : null;
      const turns = stats && stats.turns != null ? stats.turns : 0;
      const cost = usage ? ((usage.uncachedInputTokens || 0) * 3 + (usage.outputTokens || 0) * 9) / 1e6 : 0;
      return React.createElement("div", null,
        React.createElement("div", { className: "wd-balance-amount" },
          React.createElement("span", { className: "wd-balance-val", style: { fontSize: 18 } }, goal ? (goal.phase || "active") : "无目标"),
          React.createElement("span", { className: "wd-balance-cur" }, "冲刺中")
        ),
        tier !== "S" && goal ? React.createElement("div", { className: "wd-goal-text", style: { WebkitLineClamp: 2 } }, String(goal.objective || "")) : null,
        tier !== "S" ? React.createElement("div", { className: "wd-balance-detail", style: { marginTop: 4 } },
          React.createElement("span", null, "已用 " + (turns || 0) + " 轮"),
          React.createElement("span", null, "≈¥" + cost.toFixed(4))
        ) : null,
        !goal && tier === "XL" ? React.createElement("div", { className: "wd-empty", style: { marginTop: 4 } }, "用 /goal 创建目标后开始冲刺") : null
      );
    }

    // 13) 双模对比：同量 flash vs pro 成本
    function DualModelWidget({ api, width }) {
      const usage = api.useProjection("tokenUsage");
      const tier = tierOf(width);
      const calc = (rates) => {
        if (!usage) return 0;
        return ((usage.uncachedInputTokens || 0) * rates.input + (usage.outputTokens || 0) * rates.output) / 1e6;
      };
      const f = calc(OFFICIAL_RATES.flash);
      const p = calc(OFFICIAL_RATES.pro);
      const diff = p - f;
      return React.createElement("div", null,
        React.createElement("div", { className: "wd-balance-amount" },
          React.createElement("span", { className: "wd-balance-val" }, "×" + (f > 0 ? (p / f).toFixed(1) : "--")),
          React.createElement("span", { className: "wd-balance-cur" }, "pro/flash 差价")
        ),
        tier !== "S" ? React.createElement("div", { className: "wd-balance-detail" },
          React.createElement("span", null, "flash ¥" + f.toFixed(4)),
          React.createElement("span", null, "pro ¥" + p.toFixed(4))
        ) : null,
        tier === "XL" && diff > 0 ? React.createElement("div", { className: "wd-empty", style: { marginTop: 4 } },
          "换 pro 会多花 ¥" + diff.toFixed(4)
        ) : null,
        !usage ? React.createElement("div", { className: "wd-empty" }, "暂无用量数据") : null
      );
    }

    // 14) 工作区罗盘：当前会话工作目录
    function WorkspaceCompassWidget({ api, width }) {
      const sessions = api.sessionsData;
      const tier = tierOf(width);
      const current = sessions && sessions.current;
      const cwd = current && sessions.cwds && sessions.cwds[current] ? sessions.cwds[current] : null;
      const short = cwd ? cwd.split("/").slice(-2).join("/") : null;
      return React.createElement("div", null,
        React.createElement("div", { className: "wd-balance-amount" },
          React.createElement("span", { className: "wd-balance-val", style: { fontSize: 16 } }, short || "--"),
          React.createElement("span", { className: "wd-balance-cur" }, "工作区")
        ),
        tier !== "S" && cwd ? React.createElement("div", { className: "wd-balance-detail" },
          React.createElement("span", { style: { fontFamily: "ui-monospace,Menlo,monospace", fontSize: 10 } }, cwd)
        ) : null,
        !cwd ? React.createElement("div", { className: "wd-empty" }, "暂无工作区信息") : null
      );
    }

    // 15) 声音提示：回复完成提示音开关
    function SoundToggleWidget({ api, width }) {
      const [on, setOn] = useState(() => { try { return localStorage.getItem(SOUND_KEY) !== "off"; } catch (e) { return true; } });
      const stats = api.useProjection("sessionStats");
      const prevTurns = useRef(0);
      const tier = tierOf(width);

      // 播放提示音（Web Audio 合成，无音频文件）
      const playBeep = () => {
        try {
          const Ctx = window.AudioContext || window.webkitAudioContext;
          if (!Ctx) return;
          const ctx = new Ctx();
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.type = "sine";
          osc.frequency.value = 880;
          gain.gain.setValueAtTime(0.18, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
          osc.start();
          osc.stop(ctx.currentTime + 0.35);
        } catch (e) { /* ignore */ }
      };

      // 监听回合数：回合 +1 = 模型回复完成 → 响铃；切会话时重置基线（旧会话回合数不作新会话基线）
      const lastSidRef = useRef(api.sessionId);
      useEffect(() => {
        if (!on) return;
        const turns = stats && stats.turns != null ? stats.turns : 0;
        if (lastSidRef.current !== api.sessionId) {
          lastSidRef.current = api.sessionId;
          prevTurns.current = turns;   // 新会话：以当前回合为基线，不响铃
          return;
        }
        if (turns > prevTurns.current && prevTurns.current > 0) playBeep();
        prevTurns.current = turns;
      }, [stats, on, api.sessionId]);

      const toggle = () => {
        const next = !on;
        setOn(next);
        try { localStorage.setItem(SOUND_KEY, next ? "on" : "off"); } catch (e) { /* ignore */ }
        if (next) playBeep();   // 开启时响一下确认
      };
      return React.createElement("div", null,
        React.createElement("div", { className: "wd-balance-amount" },
          React.createElement("span", { className: "wd-balance-val wd-emoji-sound" + (on ? " on" : ""), style: { fontSize: 20 } }, on ? "🔊" : "🔇"),
          React.createElement("span", { className: "wd-balance-cur" }, "回复提示音")
        ),
        tier !== "S" ? React.createElement("div", { className: "wd-balance-detail" },
          React.createElement("span", null, on ? "回复完成时播放提示" : "已静音")
        ) : null,
        tier === "XL" ? React.createElement("div", { className: "wd-empty", style: { marginTop: 4, cursor: "pointer", color: "var(--dsw-alias-state-business-primary)" }, onClick: toggle }, on ? "点击静音" : "点击开启") : null
      );
    }

    // 16) 上下文沙漏：剩余上下文 + 估算可容纳消息
    function ContextHourglassWidget({ api, width }) {
      const pressure = api.useProjection("contextPressure");
      const tier = tierOf(width);
      const projected = pressure && (pressure.projectedTokens || pressure.pressureTokens);
      const windowSize = pressure && pressure.contextWindow;
      const ratio = projected && windowSize ? Math.min(100, Math.round(projected / windowSize * 100)) : null;
      const remain = ratio != null ? Math.max(0, 100 - ratio) : null;
      const remainTokens = projected && windowSize ? Math.max(0, windowSize - projected) : null;
      const estMsgs = remainTokens ? Math.max(0, Math.floor(remainTokens / 1200)) : null;
      return React.createElement("div", null,
        React.createElement("div", { className: "wd-balance-amount" },
          React.createElement("span", { className: "wd-balance-val" }, remain != null ? remain + "%" : "--"),
          React.createElement("span", { className: "wd-balance-cur" }, "沙漏剩余")
        ),
        tier !== "S" && estMsgs != null ? React.createElement("div", { className: "wd-balance-detail" },
          React.createElement("span", null, "约 " + estMsgs + " 条消息"),
          React.createElement("span", null, "剩 " + fmtNum(remainTokens) + " tokens")
        ) : null,
        ratio != null && ratio >= 80 ? React.createElement("div", { className: "wd-err" }, "快满了，建议压缩") : null,
        !pressure ? React.createElement("div", { className: "wd-empty" }, "暂无数据") : null
      );
    }

    // 17) 轮次彩蛋：随机鼓励语录
    const FORTUNES = ["上下文是财富，压缩是美德。", "今天也要好好用 Token。", "少即是多，慢即是快。", "坚持就是胜利，反正 AI 不累。", "记得充值。", "计划模式让每一步更稳。", "固定卡片，桌面不乱。", "DeepSeek 与你同在。"];
    function FortuneWidget({ api, width }) {
      const [idx, setIdx] = useState(() => Math.floor(Math.random() * FORTUNES.length));
      const tier = tierOf(width);
      return React.createElement("div", null,
        React.createElement("div", { className: "wd-balance-amount" },
          React.createElement("span", { className: "wd-balance-val wd-emoji-slot", style: { fontSize: 20 } }, "🎰"),
          React.createElement("span", { className: "wd-balance-cur" }, "今日彩蛋")
        ),
        React.createElement("div", { className: "wd-balance-detail", style: { display: "block", marginTop: 4 } },
          React.createElement("div", null, FORTUNES[idx])
        ),
        tier === "XL" ? React.createElement("div", { className: "wd-empty", style: { marginTop: 4, cursor: "pointer", color: "var(--dsw-alias-state-business-primary)" }, onClick: () => setIdx((idx + 1) % FORTUNES.length) }, "换一条") : null
      );
    }

    // 卡片分类（添加侧栏的筛选标签）
    const WIDGET_CATS = [
      { id: "all", name: "全部" },
      { id: "data", name: "数据" },
      { id: "context", name: "上下文" },
      { id: "task", name: "任务" },
      { id: "image", name: "图片" },
      { id: "command", name: "命令" },
      { id: "tool", name: "工具" },
      { id: "fun", name: "趣味" }
    ];
    const WIDGETS = {
      gauge: { id: "gauge", cat: "context", name: "上下文水位", desc: "剩余上下文进度条", render: ContextGaugeWidget },
      meter: { id: "meter", cat: "data", name: "响应仪表", desc: "平均回复耗时", render: ResponseMeterWidget },
      sprint: { id: "sprint", cat: "task", name: "目标冲刺", desc: "目标 + 已用轮次 + 成本", render: GoalSprintWidget },
      dual: { id: "dual", cat: "data", name: "双模对比", desc: "flash vs pro 成本差", render: DualModelWidget },
      compass: { id: "compass", cat: "tool", name: "工作区罗盘", desc: "当前工作目录", render: WorkspaceCompassWidget },
      github: { id: "github", cat: "tool", name: "GitHub 仓库", desc: "star/fork/更新状态", render: GithubWidget },
      sound: { id: "sound", cat: "fun", name: "声音提示", desc: "回复完成提示音开关", render: SoundToggleWidget },
      hourglass: { id: "hourglass", cat: "context", name: "上下文沙漏", desc: "剩余可容纳消息数", render: ContextHourglassWidget },
      fortune: { id: "fortune", cat: "fun", name: "轮次彩蛋", desc: "随机鼓励语录", render: FortuneWidget },
      context: { id: "context", cat: "context", name: "上下文构成", desc: "系统/工具/消息占上下文比例", render: ContextCompositionWidget },
      heatmap: { id: "heatmap", cat: "data", name: "用量热力图", desc: "GitHub 风格每日用量", render: HeatmapWidget },
      custom: { id: "custom", cat: "command", name: "自定义命令", desc: "自己添加的快捷命令", render: CustomCommandsWidget },
      plan: { id: "plan", cat: "task", name: "计划模式", desc: "当前 plan 协作状态", render: PlanWidget },
      reasoning: { id: "reasoning", cat: "task", name: "推理强度", desc: "调节模型推理档位", render: ReasoningWidget },
      imagelimits: { id: "imagelimits", cat: "image", name: "图像限制", desc: "图片上传配额", render: ImageLimitsWidget },
      imagerelay: { id: "imagerelay", cat: "image", name: "图片转述", desc: "图片转文字喂给 DeepSeek", render: ImageRelayWidget },
      notepad: { id: "notepad", cat: "fun", name: "灵感速记", desc: "临时便签", render: NotepadWidget },
      bill: { id: "bill", cat: "data", name: "会话账单", desc: "花费、余额与剩余轮次", render: SessionBillWidget },
      sessions: { id: "sessions", cat: "tool", name: "会话时光机", desc: "最近会话列表，点击跳转", render: SessionTimeMachineWidget },
      contextPressure: { id: "contextPressure", cat: "context", name: "上下文压力", desc: "下一次请求的窗口占用", render: ContextPressureWidget },
      todos: { id: "todos", cat: "task", name: "待办", desc: "当前任务清单", render: TodosWidget },
      permissions: { id: "permissions", cat: "tool", name: "权限模式", desc: "当前访问范围", render: PermissionsWidget },
      balance: { id: "balance", cat: "data", name: "API 余额", desc: "账户余额与充值", render: BalanceWidget },
      tokens: { id: "tokens", cat: "data", name: "Token 用量", desc: "输入、输出与缓存", render: TokensWidget },
      stats: { id: "stats", cat: "data", name: "会话统计", desc: "回合、步骤与耗时", render: StatsWidget },
      goal: { id: "goal", cat: "task", name: "目标进度", desc: "当前目标状态", render: GoalWidget },
      cost: { id: "cost", cat: "data", name: "成本估算", desc: "按当前单价估算", render: CostWidget }
    };
    // 卡片尺寸档位：SIZES 用于内容渐进 tier 判定（逻辑宽度）；SPANS 是网格跨列数
    // （deck 为 150px 最小列宽网格，卡片按档位跨列保证任意组合的行都列对齐）。
    const SIZES = { S: 160, M: 220, L: 300, XL: 400 };
    const SPANS = { S: 1, M: 2, L: 2, XL: 3 };
    const SIZE_ORDER = ["S", "M", "L", "XL"];

    function WorkbenchCard({ item, index, api, onRemove, onConfig, dragging, highlight, onDragStart, onDragEnd, onDragOver, onDrop }) {
      const widget = WIDGETS[item.id];
      const Content = widget.render;
      const config = item.config || {};
      const size = config.size && SIZES[config.size] ? config.size : "M";
      const width = SIZES[size];
      const span = SPANS[size] || 2;
      const [sizeOpen, setSizeOpen] = useState(false);
      const setSize = (next) => { onConfig(item.id, Object.assign({}, config, { size: next })); setSizeOpen(false); };
      return React.createElement("section", {
        className: "wd-workbench-card" + (dragging ? " dragging" : "") + (highlight ? " just-added" : ""),
        style: { gridColumn: "span " + span, width: "auto" },
        onDragOver: (event) => event.preventDefault(),
        onDrop: (event) => { event.preventDefault(); onDrop(event, index); }
      },
        // 头部随时可拖（无需进入排序模式）
        React.createElement("div", {
          className: "wd-workbench-card-head",
          draggable: true,
          title: "按住拖动：排序 / 拖到另一侧切换位置",
          onDragStart: (event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", item.id); onDragStart(item.id); },
          onDragEnd: onDragEnd
        },
          React.createElement("span", null, widget.name),
          React.createElement("div", { className: "wd-size-wrap" },
            React.createElement("button", {
              className: "wd-size-btn",
              title: "卡片尺寸：小 / 中 / 大 / 超大",
              onClick: (e) => { e.stopPropagation(); setSizeOpen(!sizeOpen); }
            }, size),
            sizeOpen ? React.createElement("div", { className: "wd-size-menu", role: "menu", "aria-label": "卡片尺寸" },
              SIZE_ORDER.map((option) => React.createElement("button", { key: option, className: "wd-size-option" + (option === size ? " active" : ""), onClick: (e) => { e.stopPropagation(); setSize(option); } }, option))
            ) : null
          ),
          React.createElement("button", { className: "wd-btn", title: "从工作台移除", onClick: (e) => { e.stopPropagation(); onRemove(item.id); } }, "✕")
        ),
        React.createElement("div", { className: "wd-body" },
          React.createElement(ErrorBoundary, { widgetName: widget.name },
            React.createElement(Content, { api: api, config: config, onConfig: (config) => onConfig(item.id, config), width: width })
          )
        )
      );
    }

    function WidgetPicker({ items, onToggle, onMove, onConfig, onClose, onMinimize, onDragAddStart, onDragAddEnd, ghost }) {
      const [query, setQuery] = useState("");
      const [cat, setCat] = useState("all");
      const filtered = Object.keys(WIDGETS).filter((id) => {
        const widget = WIDGETS[id];
        if (cat !== "all" && widget.cat !== cat) return false;
        if (query) {
          const q = query.toLowerCase();
          if ((widget.name + widget.desc).toLowerCase().indexOf(q) < 0) return false;
        }
        return true;
      });
      return React.createElement("div", { className: "wd-picker" + (ghost ? " wd-picker-ghost" : "") },
        React.createElement("div", { className: "wd-picker-head" },
          React.createElement("span", null, "添加 / 管理面板"),
          React.createElement("div", { className: "wd-deck-actions" },
            React.createElement("button", { className: "wd-btn", title: "最小化工作台", onClick: onMinimize }, "—"),
            React.createElement("button", { className: "wd-btn", title: "关闭侧栏", onClick: onClose }, "✕")
          )
        ),
        // 搜索 + 分类标签
        React.createElement("input", {
          className: "wd-input wd-picker-search",
          value: query,
          onChange: (e) => setQuery(e.target.value),
          placeholder: "🔍 搜索卡片…",
          spellCheck: false
        }),
        React.createElement("div", { className: "wd-picker-cats" },
          WIDGET_CATS.map((c) => React.createElement("button", {
            key: c.id,
            className: "wd-picker-cat" + (cat === c.id ? " active" : ""),
            onClick: () => setCat(c.id)
          }, c.name))
        ),
        React.createElement("div", { className: "wd-picker-note" }, "点击快速添加；或拖卡片到工作台任意位置"),
        React.createElement("div", { className: "wd-picker-list" }, filtered.length ? filtered.map((id) => {
          const widget = WIDGETS[id];
          const item = items.find((entry) => entry.id === id);
          const added = !!item;
          const size = item && item.config && item.config.size ? item.config.size : "M";
          return React.createElement("div", { key: id, className: "wd-panel-item" + (added ? " added" : "") },
            // 拖拽柄（加大 + 防文本选中抢占；按钮保持普通点击不被拖拽吞掉）
            React.createElement("span", {
              className: "wd-picker-drag",
              draggable: true,
              title: "按住这里拖到工作台任意位置",
              onDragStart: (event) => {
                event.dataTransfer.effectAllowed = "copy";
                event.dataTransfer.setData("text/plain", "wd-add:" + id);
                if (onDragAddStart) onDragAddStart();
              },
              onDragEnd: () => { if (onDragAddEnd) onDragAddEnd(); }
            }, "⠿"),
            React.createElement("button", { className: "wd-panel-item", style: { padding: 0, flex: 1 }, onClick: () => onToggle(id) },
              React.createElement("div", null,
                React.createElement("div", { className: "wd-panel-name" }, widget.name),
                React.createElement("div", { className: "wd-panel-desc" }, widget.desc)
              )),
            added ? React.createElement("div", { className: "wd-picker-added" },
              React.createElement("div", { className: "wd-picker-sizes" },
                SIZE_ORDER.map((s) => React.createElement("button", {
                  key: s,
                  className: "wd-size-option" + (size === s ? " active" : ""),
                  title: "尺寸 " + s,
                  onClick: () => onConfig(id, Object.assign({}, item.config, { size: s }))
                }, s))
              ),
              React.createElement("div", { className: "wd-place-actions" },
                React.createElement("button", { className: "wd-place-btn" + (item.side === "left" ? " current" : ""), title: "放到左侧工作台", onClick: () => onMove(id, "left") }, "左侧"),
                React.createElement("button", { className: "wd-place-btn" + (item.side === "right" ? " current" : ""), title: "放到右侧工作台", onClick: () => onMove(id, "right") }, "右侧")
              )
            ) : React.createElement("span", { className: "wd-panel-check" }, "添加")
          );
        }) : React.createElement("div", { className: "wd-empty", style: { padding: 12 } }, "没有匹配的卡片"))
      );
    }

    function WidgetDock({ useProjection, useSessions, useInput, inputActions: propsInputActions, sessionId, executeCommand, openSession, modelDirectory }) {
      const [state, setState] = useState(() => loadState(sessionId));
      const [open, setOpen] = useState(() => readOpenState(sessionId));
      // sidRef：异步回调写入时用当前生效的 sessionId，避免切对话瞬间写错分区
      const sidRef = useRef(sessionId);
      sidRef.current = sessionId;
      // openRef：轨迹页签自动隐藏时记录用户展开状态（open 的最新值供 effect 闭包读取）
      const openRef = useRef(open);
      openRef.current = open;
      const [pickerOpen, setPickerOpen] = useState(false);
      // 拖拽添加时侧栏"幽灵化"（透明 + 穿透点击）而非卸载——卸载拖拽源会取消浏览器拖拽会话
      const [pickerGhost, setPickerGhost] = useState(false);
      const [draggedId, setDraggedId] = useState(null);
      const [lastAddedId, setLastAddedId] = useState(null);
      // 切对话：一次性迁移旧全局布局 → 加载该对话布局 → 重置拖拽/展开状态
      useEffect(() => {
        migrateLegacy(sessionId);
        try { localStorage.setItem(LAYOUT_VERSION_KEY, "3"); } catch (e) { /* ignore */ }
        setState(loadState(sessionId));
        setDraggedId(null);
        setPickerOpen(false);
        setPickerGhost(false);
        setOpen(readOpenState(sessionId));
      }, [sessionId]);
      // state 变化统一持久化（副作用移出 setState updater，保证 updater 纯函数）
      useEffect(() => {
        saveState(sidRef.current, state);
      }, [state]);
      // 幽灵化兜底：dragend 丢失时 2.5 秒后自动恢复侧栏（否则侧栏半透明且被 deck 挡住，按钮点不到）
      const ghostTimerRef = useRef(null);
      const enterGhost = () => {
        setPickerGhost(true);
        if (ghostTimerRef.current) window.clearTimeout(ghostTimerRef.current);
        ghostTimerRef.current = window.setTimeout(() => setPickerGhost(false), 2500);
      };
      const exitGhost = () => {
        setPickerGhost(false);
        if (ghostTimerRef.current) { window.clearTimeout(ghostTimerRef.current); ghostTimerRef.current = null; }
      };
      useEffect(() => () => { if (ghostTimerRef.current) window.clearTimeout(ghostTimerRef.current); }, []);
      const [layout, setLayout] = useState(null);
      // useSessions 是 GlobalStandardProps（每个 session 作用域 slot 都注入）：
      // 在组件顶层无条件调用，选择器只取卡片需要的切片，避免整个列表变化引发全量重渲染。
      // eq 做内容比较：列表任何字段变化都会重新执行选择器，但只要 ids/current/titles
      // 没变就不触发重渲染（jobs、subagents 等无关字段变化不打扰卡片）。
      const sessionsData = useSessions((s) => {
        const titles = {};
        const cwds = {};
        for (let i = 0; i < s.ids.length; i++) {
          const row = s.byId[s.ids[i]];
          if (row) {
            titles[s.ids[i]] = row.displayTitle || row.title || "";
            if (row.cwd) cwds[s.ids[i]] = row.cwd;
          }
        }
        return { ids: s.ids, titles: titles, cwds: cwds, current: s.current };
      }, (a, b) => {
        if (!a || !b || a.current !== b.current || a.ids.length !== b.ids.length) return false;
        for (let i = 0; i < a.ids.length; i++) {
          if (a.ids[i] !== b.ids[i]) return false;
          if (a.titles[a.ids[i]] !== b.titles[b.ids[i]]) return false;
          if (a.cwds[a.ids[i]] !== b.cwds[b.ids[i]]) return false;
        }
        return true;
      });
      // 函数式状态更新：所有变更基于最新 state，快速连点不丢操作；
      // 结果统一补 initialized 标记（该会话已完成默认卡初始化，删除默认卡后不复活）。
      const commit = (updater) => {
        setState((previous) => {
          const base = previous && Array.isArray(previous.items) ? previous : normalizeItems([], true);
          const next = updater(base);
          if (!next || next === base) return base;
          return Object.assign({}, next, { initialized: true });
        });
      };
      const items = state.items.filter((item) => WIDGETS[item.id]);
      // useInput：读取输入框实时状态（imageIds 判断是否有待发图片）；选择器返回原语避免无谓重渲染
      const inputImageCount = typeof useInput === "function" ? useInput((s) => (s && s.imageIds ? s.imageIds.length : 0)) : null;
      // 输入框当前图片 id 列表（自动转述后移除原图用）；eq 内容比较，避免无关输入变化触发重渲染
      const inputImageIds = typeof useInput === "function" ? useInput((s) => (s && s.imageIds ? s.imageIds.slice() : null), (a, b) => (a == null && b == null) || (Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]))) : null;
      // inputActions 注入图片转述卡片的 setDraft（写入输入框草稿）；useInput 传给卡片内部订阅 draft（避免顶层订阅导致击键全量重渲染）
      const api = { useProjection: useProjection, useInput: useInput, sessionsData: sessionsData, sessionId: sessionId, executeCommand: executeCommand, openSession: openSession, inputImageCount: inputImageCount, inputImageIds: inputImageIds, inputActions: propsInputActions, modelDirectory: modelDirectory };
      const setMinimized = (minimized) => {
        setOpen(!minimized);
        try { localStorage.setItem(uiStateKey(sidRef.current), minimized ? "minimized" : "expanded"); } catch (e) { /* ignore */ }
      };
      useEffect(() => {
        const measure = () => {
          const chat = findChatContainer();
          if (!chat) { setLayout(null); return; }
          const rect = chat.getBoundingClientRect();
          const viewport = window.innerWidth;
          const declaredWidth = parseFloat(getComputedStyle(chat).getPropertyValue("--dsh-chat-content-width"));
          const contentWidth = Number.isFinite(declaredWidth) && declaredWidth > 0 ? Math.min(rect.width, declaredWidth) : Math.min(rect.width, 748);
          const contentLeft = rect.left + Math.max(0, (rect.width - contentWidth) / 2);
          const contentRight = contentLeft + contentWidth;
          // 顶部基准：标题栏底部 + 14px（与左侧间距一致，视觉上四面留白统一）
          const header = findHeaderBar();
          const headerBottom = header ? header.getBoundingClientRect().bottom : 76;
          const top = Math.max(40, headerBottom + 14);
          // 左侧基准：会话列表右边缘 + 14px
          const sidebar = findSidebar();
          const sidebarRight = sidebar ? sidebar.getBoundingClientRect().right : (Number.isFinite(rect.left) ? rect.left : 280);
          const leftStart = Math.max(0, sidebarRight + 14);
          // 左侧卡片始终靠左，正文前保留 26px 安全距离（滚动条贴 deck 右缘时也不会压住对话正文，
          // 与右侧滚动条离屏幕右缘 26px 对称）。
          const leftWidth = Math.max(0, contentLeft - leftStart - 26);
          const rightWidth = Math.max(0, viewport - contentRight - 26);
          // 用满可用空白（不再限制 440px 上限），卡片按尺寸档位自动换行填满
          setLayout({
            left: { x: leftStart, width: leftWidth },
            right: { x: contentRight + 14, width: rightWidth },
            top: top
          });
        };
        measure();
        window.addEventListener("resize", measure);
        const observer = new ResizeObserver(measure);
        const chat = findChatContainer();
        if (chat) observer.observe(chat);
        return () => { window.removeEventListener("resize", measure); observer.disconnect(); };
      }, []);
      useEffect(() => {
        // 轨迹页签：临时收起工作台（不写存储）；切回对话页签时恢复用户此前的展开状态
        const trajRef = { current: false };
        const wasOpenRef = { current: true };
        const syncTrajectory = () => {
          const active = document.querySelector('[role="tab"][aria-selected="true"]');
          const isTrajectory = !!(active && String(active.textContent || "").trim() === "轨迹");
          if (isTrajectory && !trajRef.current) {
            trajRef.current = true;
            wasOpenRef.current = openRef.current;
            setOpen(false);
          } else if (!isTrajectory && trajRef.current) {
            trajRef.current = false;
            if (wasOpenRef.current) setOpen(true);
          }
        };
        syncTrajectory();
        const observer = new MutationObserver(syncTrajectory);
        observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["aria-selected"] });
        return () => observer.disconnect();
      }, []);
      // 选侧：优先有实际空间的一侧（deck 宽度 ≥180 才可见），两侧都可见时按卡片数平衡
      const pickSide = (itemsList) => {
        const leftOk = !!(layout && layout.left.width >= 180);
        const rightOk = !!(layout && layout.right.width >= 180);
        if (!leftOk) return "right";
        if (!rightOk) return "left";
        const leftCount = itemsList.filter((item) => item.side === "left").length;
        const rightCount = itemsList.filter((item) => item.side === "right").length;
        return leftCount <= rightCount ? "left" : "right";
      };
      const toggle = (id) => {
        commit((prev) => {
          const index = prev.items.findIndex((item) => item.id === id);
          if (index >= 0) {
            const items = prev.items.slice();
            items.splice(index, 1);
            return { items: items };
          }
          return { items: prev.items.concat([{ id: id, config: {}, side: pickSide(prev.items) }]) };
        });
      };
      // 指定侧/位置插入新卡片（拖拽添加）；高亮呼吸提示
      const addAt = (id, side, index) => {
        commit((prev) => {
          if (prev.items.some((item) => item.id === id)) return prev;
          const targetItems = prev.items.filter((item) => item.side === side);
          const before = targetItems.slice(0, index);
          const after = targetItems.slice(index);
          const other = prev.items.filter((item) => item.side !== side);
          return { items: other.concat(before, [{ id: id, config: {}, side: side }], after) };
        });
        setLastAddedId(id);
        window.setTimeout(() => setLastAddedId((current) => (current === id ? null : current)), 1600);
        // 函数式更新 + 卸载安全：React 18 对卸载后 setState 无害；保持简单
      };
      const remove = (id) => {
        commit((prev) => ({ items: prev.items.filter((item) => item.id !== id) }));
      };
      const updateConfig = (id, config) => {
        commit((prev) => {
          if (!prev.items.some((item) => item.id === id)) return prev;
          return { items: prev.items.map((item) => item.id === id ? Object.assign({}, item, { config: config }) : item) };
        });
      };
      const moveToSide = (id, side) => {
        commit((prev) => ({ items: prev.items.map((item) => item.id === id ? Object.assign({}, item, { side: side }) : item) }));
      };
      const moveItem = (targetSide, targetIndex) => {
        if (!draggedId) return;
        const draggedIdLocal = draggedId;
        commit((prev) => {
          const dragged = prev.items.find((item) => item.id === draggedIdLocal);
          if (!dragged) return prev;
          const without = prev.items.filter((item) => item.id !== draggedIdLocal);
          const targetItems = without.filter((item) => item.side === targetSide);
          const before = targetItems.slice(0, targetIndex);
          const after = targetItems.slice(targetIndex);
          const other = without.filter((item) => item.side !== targetSide);
          return { items: other.concat(before, [Object.assign({}, dragged, { side: targetSide })], after) };
        });
        setDraggedId(null);
      };
      const deckItems = (side) => items.filter((item) => item.side === side);
      const canShowDecks = !!(layout && (layout.left.width >= 180 || layout.right.width >= 180));
      const deckStyle = (side) => {
        if (!layout || layout[side].width < 180) return { display: "none" };
        const top = layout.top != null ? layout.top : 90;
        const maxH = Math.max(200, window.innerHeight - top - 40);
        return {
          left: layout[side].x + "px",
          top: top + "px",
          width: layout[side].width + "px",
          maxHeight: maxH + "px",
          "--wd-deck-h": maxH + "px"
        };
      };
      const renderDeck = (side, title) => {
        const deck = deckItems(side);
        const visible = !!(layout && layout[side].width >= 180);
        // drop 分发：wd-add:xxx = 侧栏拖入的新卡片；否则 = 既有卡片排序
        const onDeckDrop = (event, index) => {
          event.preventDefault();
          exitGhost();
          try {
            const raw = event.dataTransfer && event.dataTransfer.getData("text/plain");
            if (raw && raw.indexOf("wd-add:") === 0) {
              addAt(raw.slice(7), side, index);
              return;
            }
          } catch (e) { /* ignore */ }
          moveItem(side, index);
        };
        return React.createElement("aside", {
          className: "wd-deck " + side + (!visible ? " hidden" : ""),
          style: deckStyle(side),
          onDragOver: (event) => event.preventDefault(),
          onDrop: (event) => onDeckDrop(event, deck.length),
          // 滚动条自动隐藏：滚动中加 .scrolling，停止 600ms 后移除
          onScroll: (event) => {
            const el = event.currentTarget;
            el.classList.add("scrolling");
            clearTimeout(el._wdScrollTimer);
            el._wdScrollTimer = setTimeout(() => el.classList.remove("scrolling"), 600);
          }
        },
          deck.length ? deck.map((item, index) => React.createElement(WorkbenchCard, {
            key: item.id,
            item: item,
            index: index,
            api: api,
            dragging: draggedId === item.id,
            highlight: lastAddedId === item.id,
            onDragStart: setDraggedId,
            onDragEnd: () => setDraggedId(null),
            onDrop: onDeckDrop,
            onRemove: remove,
            onConfig: updateConfig
          })) : React.createElement("div", { className: "wd-deck-empty" }, "拖到这里"),
          // 工作台内部底部：＋ 添加入口（不悬浮、不占卡片格，随时可打开添加/管理侧栏）
          React.createElement("button", {
            className: "wd-deck-add" + (pickerOpen ? " active" : ""),
            title: pickerOpen ? "收起侧栏" : "打开添加/管理侧栏",
            onClick: () => setPickerOpen(!pickerOpen)
          }, pickerOpen ? "✕ 收起" : "＋ 添加")
        );
      };

      return React.createElement(React.Fragment, null,
        (!open || !canShowDecks) ? React.createElement("button", { className: "wd-minibar", title: canShowDecks ? "展开工作台" : "当前窗口较窄，工作台已收起", onClick: () => setMinimized(false) }, "工作台") : React.createElement(React.Fragment, null,
          renderDeck("left"),
          renderDeck("right")
        ),
        // 右侧滑出侧栏：添加面板 / 管理
        pickerOpen ? React.createElement(WidgetPicker, {
          items: items,
          onToggle: toggle,
          onMove: moveToSide,
          onConfig: updateConfig,
          onClose: () => setPickerOpen(false),
          onMinimize: () => { setPickerOpen(false); setMinimized(true); },
          // 拖拽添加：侧栏幽灵化让 deck 可投放；dragend 恢复
          onDragAddStart: enterGhost,
          onDragAddEnd: exitGhost,
          ghost: pickerGhost
        }) : null
      );
    }

    // ── 插件入口 ──────────────────────────────────────────────────────────
    function apply(ctx) {
      // 在 apply 上下文（有 remote/sessions 权限）提前提取绑定函数，
      // 避免在点击回调里访问 remote.commands 触发 guard 拦截
      const remote = ctx.get("remote");
      const executeFn = remote && remote.commands ? (sid, line) => remote.commands.execute(sid, line) : null;
      const sessionsSvc = ctx.get("sessions");
      const openFn = sessionsSvc ? (sid) => sessionsSvc.open(sid) : null;
      // 推理强度：modelDirectories 服务（dsh-client-ui-model-selection 注册）提供
      // 会话级模型目录（store 订阅当前选择与 efforts，select 切换档位）
      const modelDirs = ctx.get("modelDirectories") || null;
      ctx.slots.inject("conversation.input.left", () => ctx.slots.register({
        name: "conversation.input.left",
        id: "widget-dock",
        order: 100,
        inject: (sessionId) => ({
          executeCommand: (line) => {
            if (!executeFn || !sessionId) return Promise.reject(new Error("命令通道不可用"));
            return executeFn(sessionId, line);
          },
          openSession: (sid) => {
            if (openFn && sid) openFn(sid);
          },
          modelDirectory: modelDirs ? () => modelDirs.directoryFor(sessionId) : null
        })
      }, (props) => React.createElement(WidgetDock, {
        useProjection: props.useProjection,
        useSessions: props.useSessions,
        useInput: props.useInput,
        inputActions: props.inputActions,
        sessionId: props.sessionId,
        executeCommand: props.executeCommand,
        openSession: props.openSession,
        modelDirectory: props.modelDirectory
      })));
    }

    const inject = ["slots", "remote", "remote.commands", "sessions"];
    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
