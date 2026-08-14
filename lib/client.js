window.__ModuleLoader__.load({
  id: "widget-dock",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    let React = require("react");
    let { useState, useEffect, useCallback, useRef } = React;

    // ── 配置 ──────────────────────────────────────────────────────────────
    const STATE_KEY = "widget-dock:state";
    const BALANCE_KEY_STORAGE = "api-balance:api-key";
    // 密钥只从浏览器本地存储或卡片设置中读取，绝不写入插件源码。
    const EMBEDDED_KEY = "";
    const TOP_UP_URL = "https://platform.deepseek.com/top_up";
    const BALANCE_URL = "https://api.deepseek.com/user/balance";
    // 成本估算单价（元/百万 tokens）——默认 DeepSeek v4-flash 高峰价（2026-08-17 生效的峰谷定价）
    // 输出 9 / 未缓存输入 3 / 缓存命中 0.1 / 缓存写入按未缓存输入计 3；空闲时段为高峰 5 折，可自行编辑
    const DEFAULT_RATES = { input: 3, cacheRead: 0.1, cacheWrite: 3, output: 9 };
    const DEFAULT_WIDGET_IDS = ["contextPressure", "todos", "permissions"];
    const UI_STATE_KEY = "widget-dock:ui";
    const LAYOUT_VERSION_KEY = "widget-dock:layout-version";

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

    // ── 样式（DSH token，圆角 12px 原生风格）─────────────────────────────
    const css = [
      // 右侧工作状态栏：默认只显示三项关键信号，不打断对话。
      ".wd-status{position:fixed;right:18px;top:92px;width:184px;z-index:500;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-base);box-shadow:0 5px 20px rgba(0,0,0,.08);overflow:hidden;color:var(--dsw-alias-label-primary)}",
      ".wd-status-title{display:flex;align-items:center;justify-content:space-between;padding:9px 10px 7px;font-size:10px;font-weight:600;letter-spacing:.8px;color:var(--dsw-alias-label-tertiary)}",
      ".wd-status-row{display:flex;align-items:baseline;justify-content:space-between;gap:8px;padding:6px 10px;border-top:1px solid var(--dsw-alias-border-l1)}",
      ".wd-status-label{font-size:11px;color:var(--dsw-alias-label-secondary)}",
      ".wd-status-value{font-size:12px;font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      ".wd-status-open{width:100%;border:0;border-top:1px solid var(--dsw-alias-border-l1);background:none;color:var(--dsw-alias-state-business-primary);height:31px;cursor:pointer;font-size:11px;font-weight:500}",
      ".wd-status-open:hover{background:var(--dsw-alias-interactive-bg-hover)}",
      // 两侧工作台：仅占用对话正文以外的空间；空间够时卡片自动并排。
      ".wd-deck{position:fixed;top:122px;z-index:9000;display:flex;flex-wrap:wrap;align-content:flex-start;gap:10px;color:var(--dsw-alias-label-primary)}",
      ".wd-deck.hidden{display:none}",
      ".wd-deck.editing{outline:1px dashed var(--dsw-alias-state-business-primary);outline-offset:5px;border-radius:12px}",
      // 控制条脱离卡片流，避免“工作台 / 添加 / 排序 / 最小化”挤占第一行卡片宽度。
      // 右侧工作台右上角小按钮（打开侧栏，不占卡片列表行）
      ".wd-deck-open{position:absolute;right:0;top:-26px;width:24px;height:22px;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:13px;line-height:1;display:flex;align-items:center;justify-content:center}",
      ".wd-deck-open:hover,.wd-deck-open.active{color:var(--dsw-alias-state-business-primary);border-color:var(--dsw-alias-state-business-primary)}",
      ".wd-deck-actions{display:flex;gap:4px}",
      ".wd-deck-arrange{height:24px;padding:0 7px;border:0;border-radius:7px;background:none;color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:10px}",
      ".wd-deck-arrange:hover,.wd-deck-arrange.active{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}",
      ".wd-arrange-tip{flex-basis:100%;display:flex;align-items:center;gap:6px;margin:-1px 0 1px;padding:7px 8px;border-radius:8px;background:var(--dsw-alias-interactive-bg-hover);font-size:10px;color:var(--dsw-alias-label-secondary)}",
      // 尺寸菜单从卡片标题弹出，不能被卡片边界裁掉。
      ".wd-workbench-card{position:relative;min-width:0;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-base);box-shadow:0 4px 16px rgba(0,0,0,.07);overflow:visible}",
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
      ".wd-empty-workbench{padding:20px 16px 22px;text-align:center;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:1.6}",
      // 右侧滑出侧栏（添加面板 + 排序）
      ".wd-picker{position:fixed;right:0;top:0;bottom:0;width:264px;z-index:9100;background:var(--dsw-alias-bg-base);border-left:1px solid var(--dsw-alias-border-l1);box-shadow:-10px 0 30px rgba(0,0,0,.14);padding:12px 12px 16px;overflow-y:auto;display:flex;flex-direction:column}",
      ".wd-picker-head{display:flex;align-items:center;justify-content:space-between;font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary);padding:2px 2px 8px}",
      ".wd-picker-note{padding:3px 2px 8px;font-size:10px;color:var(--dsw-alias-label-tertiary)}",
      ".wd-picker-list{display:flex;flex-direction:column;gap:4px}",
      // 添加面板
      ".wd-panel{position:fixed;left:50%;transform:translateX(-50%);bottom:120px;width:330px;max-height:400px;overflow-y:auto;border-radius:12px;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);box-shadow:0 12px 40px rgba(0,0,0,.18);padding:10px;z-index:9000}",
      ".wd-panel-title{font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary);padding:6px 8px 8px}",
      ".wd-panel-hint{font-size:10px;color:var(--dsw-alias-label-tertiary);padding:0 8px 8px}",
      ".wd-panel-item{display:flex;align-items:center;gap:10px;width:100%;padding:9px 10px;border:none;background:none;border-radius:9px;cursor:pointer;text-align:left;color:var(--dsw-alias-label-primary)}",
      ".wd-panel-item:hover{background:var(--dsw-alias-interactive-bg-hover)}",
      ".wd-panel-item.added{opacity:.85}",
      ".wd-panel-icon{font-size:16px;flex:none}",
      ".wd-panel-name{font-size:13px;font-weight:500}",
      ".wd-panel-desc{font-size:11px;color:var(--dsw-alias-label-tertiary);margin-top:1px}",
      ".wd-panel-check{margin-left:auto;font-size:12px;color:var(--dsw-alias-state-success-primary);flex:none}",
      ".wd-place-actions{display:flex;align-items:center;gap:4px;margin-left:auto;flex:none}",
      ".wd-place-btn{height:24px;padding:0 6px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary);font-size:10px;cursor:pointer}",
      ".wd-place-btn:hover{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary)}",
      ".wd-place-btn.current{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);font-weight:600}",
      // 左右拖放区（平时不拦截交互，拖拽时激活）
      ".wd-dropzone{position:fixed;top:0;bottom:0;pointer-events:none;z-index:400;border:1.5px dashed transparent}",
      ".wd-dropzone.dragging{pointer-events:auto}",
      ".wd-dropzone.active{background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-state-business-primary)}",
      ".wd-dropzone-label{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);font-size:12px;color:var(--dsw-alias-state-business-primary);opacity:0;transition:opacity .15s;pointer-events:none}",
      ".wd-dropzone.active .wd-dropzone-label{opacity:1}",
      // 自由悬浮组件
      ".wd-float{position:fixed;z-index:500;border-radius:12px;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);box-shadow:0 4px 16px rgba(0,0,0,.07);overflow:hidden;color:var(--dsw-alias-label-primary);display:flex;flex-direction:column}",
      ".wd-float.dragging{opacity:.85;box-shadow:0 10px 30px rgba(0,0,0,.15)}",
      ".wd-head{display:flex;align-items:center;gap:6px;padding:7px 10px 0;cursor:grab;user-select:none;flex:none}",
      ".wd-head.dragging{cursor:grabbing}",
      ".wd-grip{color:var(--dsw-alias-label-tertiary);font-size:11px;cursor:grab;flex:none}",
      ".wd-name{font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary);letter-spacing:.5px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      ".wd-btn{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border:none;background:none;border-radius:5px;color:var(--dsw-alias-label-tertiary);cursor:pointer;font-size:11px;flex:none;padding:0}",
      ".wd-btn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}",
      ".wd-btn.danger:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-state-error-primary)}",
      ".wd-body{padding:8px 12px 12px;font-size:12px;line-height:1.5;flex:1;overflow-x:hidden;overflow-y:auto;min-height:0}",
      // 尺寸调节手柄（横向调宽、纵向调高）
      ".wd-resize{position:absolute;right:2px;bottom:2px;width:14px;height:14px;cursor:nwse-resize;z-index:10}",
      ".wd-resize::after{content:'';position:absolute;right:3px;bottom:3px;width:7px;height:7px;border-right:2px solid var(--dsw-alias-label-tertiary);border-bottom:2px solid var(--dsw-alias-label-tertiary);border-bottom-right-radius:2px}",
      ".wd-resize:hover::after{border-color:var(--dsw-alias-state-business-primary)}",
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
      ".wd-cmd-btn:hover{background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-state-business-primary)}",
      ".wd-cmd-btn.done{opacity:.5}",
      ".wd-goal-phase{display:inline-block;padding:1px 8px;border-radius:999px;font-size:10px;margin-top:4px}",
      ".wd-goal-phase.active{background:var(--dsw-alias-state-business-primary);color:#fff}",
      ".wd-goal-phase.paused{background:var(--dsw-alias-state-business-primary);color:#fff}",
      ".wd-goal-phase.blocked{background:var(--dsw-alias-state-error-primary);color:#fff}",
      ".wd-goal-text{margin-top:6px;font-size:11px;color:var(--dsw-alias-label-primary);word-break:break-word;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}",
      ".wd-permission-risk{margin-top:6px;font-size:10px;color:var(--dsw-alias-state-error-primary)}",
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
    function loadState() {
      const withDefaults = (items) => {
        let shouldRebalance = false;
        try { shouldRebalance = localStorage.getItem(LAYOUT_VERSION_KEY) !== "3"; } catch (e) { /* ignore */ }
        const next = Array.isArray(items) ? items.map((item, index) => {
          const side = shouldRebalance ? (index < 4 ? "right" : "left") : (item && item.side ? item.side : (index < 4 ? "right" : "left"));
          return Object.assign({}, item, { side: side });
        }) : [];
        DEFAULT_WIDGET_IDS.forEach((id) => {
          if (!next.some((item) => item && item.id === id)) next.push({ id: id, config: {}, side: "right" });
        });
        try { localStorage.setItem(LAYOUT_VERSION_KEY, "3"); } catch (e) { /* ignore */ }
        return { items: next };
      };
      try {
        const raw = localStorage.getItem(STATE_KEY);
        if (raw) {
          const s = JSON.parse(raw);
          if (s && Array.isArray(s.items)) return withDefaults(s.items);
          // 迁移旧结构：left/right 数组 → items（带默认坐标）
          if (s && Array.isArray(s.left) && Array.isArray(s.right)) {
            const items = [];
            const vw = window.innerWidth;
            s.left.forEach((it, i) => items.push(Object.assign({}, it, { x: 20, y: 90 + i * 240 })));
            s.right.forEach((it, i) => items.push(Object.assign({}, it, { x: vw - 220, y: 90 + i * 240 })));
            return withDefaults(items);
          }
        }
      } catch (e) { /* ignore */ }
      return withDefaults([]);
    }
    function saveState(state) {
      try { localStorage.setItem(STATE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
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
      const valSize = width >= 300 ? 34 : (width >= 240 ? 28 : 24);

      return React.createElement("div", null,
        React.createElement("div", { className: "wd-balance-state" },
          React.createElement("span", { className: "wd-dot " + (loading ? "" : (ok ? "ok" : "bad")) }),
          React.createElement("span", { className: "wd-empty", style: { marginTop: 0 } }, loading ? "查询中…" : (ok ? "账户可用" : (balance ? "账户异常" : "未连接")))
        ),
        React.createElement("div", { className: "wd-balance-amount" },
          React.createElement("span", { className: "wd-balance-cur" }, info ? info.currency : ""),
          React.createElement("span", { className: "wd-balance-val", style: { fontSize: valSize } }, info ? info.total_balance : "--"),
          React.createElement("span", { className: "wd-balance-cur" }, "元")
        ),
        React.createElement("div", { className: "wd-balance-detail" },
          React.createElement("span", null, "充值 " + (info ? info.topped_up_balance : "--")),
          React.createElement("span", null, "赠送 " + (info ? info.granted_balance : "--"))
        ),
        error ? React.createElement("div", { className: "wd-err" }, error) : null,
        React.createElement("div", { className: "wd-balance-actions" },
          React.createElement("button", { className: "wd-link", onClick: load }, "↻ 刷新"),
          React.createElement("a", { className: "wd-link", href: TOP_UP_URL, target: "_blank", rel: "noreferrer" }, "充值 ↗")
        ),
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
        ) : React.createElement("div", { className: "wd-empty", style: { cursor: "pointer", color: "var(--dsw-alias-state-business-primary)" }, onClick: () => setEditing(true) },
            getBalanceKey(config) ? "密钥已配置 · 编辑" : "配置 API Key"
          )
      );
    }

    // 2) Token 用量
    function TokensWidget({ api, width }) {
      const usage = api.useProjection("tokenUsage");
      const input = usage ? (usage.uncachedInputTokens || 0) + (usage.cacheReadTokens || 0) + (usage.cacheWriteTokens || 0) : null;
      const output = usage ? (usage.outputTokens || 0) : null;
      const total = input !== null ? input + output : null;
      const valSize = width >= 300 ? 34 : (width >= 240 ? 28 : 24);
      return React.createElement("div", null,
        React.createElement("div", { className: "wd-balance-amount" },
          React.createElement("span", { className: "wd-balance-val", style: { fontSize: valSize } }, total !== null ? fmtNum(total) : "--"),
          React.createElement("span", { className: "wd-balance-cur" }, "tokens")
        ),
        React.createElement("div", { className: "wd-balance-detail" },
          React.createElement("span", null, "输入 " + (input !== null ? fmtNum(input) : "--")),
          React.createElement("span", null, "输出 " + (output !== null ? fmtNum(output) : "--"))
        ),
        usage && (usage.cacheReadTokens || usage.cacheWriteTokens) ? React.createElement("div", { className: "wd-balance-detail" },
          React.createElement("span", null, "缓存读 " + fmtNum(usage.cacheReadTokens || 0)),
          React.createElement("span", null, "缓存写 " + fmtNum(usage.cacheWriteTokens || 0))
        ) : null,
        !usage ? React.createElement("div", { className: "wd-empty" }, "暂无用量：发送一条消息后自动统计") : null
      );
    }

    // 3) 会话统计
    function StatsWidget({ api }) {
      // sessionStats 投影顶层就是 totals 字段（turns/steps/llmMs/toolMs 直接访问）
      const stats = api.useProjection("sessionStats");
      return React.createElement("div", null,
        React.createElement("div", { className: "wd-stat-row" }, React.createElement("span", null, "回合数"), React.createElement("b", null, stats && stats.turns != null ? stats.turns : "--")),
        React.createElement("div", { className: "wd-stat-row" }, React.createElement("span", null, "步骤数"), React.createElement("b", null, stats && stats.steps != null ? stats.steps : "--")),
        React.createElement("div", { className: "wd-stat-row" }, React.createElement("span", null, "模型耗时"), React.createElement("b", null, stats && stats.llmMs != null ? fmtTime(stats.llmMs) : "--")),
        React.createElement("div", { className: "wd-stat-row" }, React.createElement("span", null, "工具耗时"), React.createElement("b", null, stats && stats.toolMs != null ? fmtTime(stats.toolMs) : "--")),
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
      const run = async (cmd) => {
        if (running) return;
        if (!canExecute) { setNotice("命令通道暂不可用"); return; }
        setRunning(cmd.line);
        setNotice(null);
        try {
          await api.executeCommand(cmd.line);
          setNotice("已执行 " + cmd.label);
        } catch (e) { setNotice("执行失败: " + (e.message || e)); }
        window.setTimeout(() => setRunning(null), 800);
      };
      return React.createElement("div", null,
        React.createElement("div", { className: "wd-cmd-grid", style: width >= 320 ? { gridTemplateColumns: "1fr 1fr 1fr" } : undefined },
          COMMANDS.map((cmd) => React.createElement("button", {
            key: cmd.line,
            className: "wd-cmd-btn" + (running === cmd.line ? " done" : ""),
            title: cmd.title,
            onClick: () => run(cmd)
          }, cmd.label))
        ),
        React.createElement("div", { className: "wd-empty", style: { marginTop: 6 } }, notice || "点击直接执行命令")
      );
    }

    // 5) 目标进度
    function GoalWidget({ api }) {
      const projection = api.useProjection("goal");
      const goal = projection ? projection.goal : null;
      const [notice, setNotice] = useState(null);
      const [running, setRunning] = useState(false);
      const canExecute = !!(api.executeCommand);
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
          window.setTimeout(() => setRunning(false), 900);
        }
      };
      if (!goal) {
        return React.createElement("div", null,
          React.createElement("div", { className: "wd-empty" }, "当前没有进行中的目标"),
          React.createElement("div", { className: "wd-cmd-grid" },
            React.createElement("button", { className: "wd-cmd-btn" + (running ? " done" : ""), onClick: createGoal }, "/goal 创建")
          ),
          React.createElement("div", { className: "wd-empty", style: { marginTop: 4 } }, notice || "点击后请在对话区输入目标")
        );
      }
      const objective = String(goal.objective || "(无目标描述)").replace(/\s+/g, " ");
      return React.createElement("div", null,
        React.createElement("div", { className: "wd-goal-phase " + (goal.phase || "active") }, goal.phase === "complete" ? "已完成" : (goal.phase === "blocked" ? "受阻" : "进行中")),
        React.createElement("div", { className: "wd-goal-text", title: objective, style: { WebkitLineClamp: 2 } }, objective)
      );
    }

    // 6) 成本估算
    // DeepSeek 官方定价（2026-08-17 生效，高峰价，元/百万 tokens）
    const OFFICIAL_RATES = {
      flash: { input: 3, cacheRead: 0.1, cacheWrite: 3, output: 9 },
      pro: { input: 9, cacheRead: 0.3, cacheWrite: 9, output: 27 }
    };

    function CostWidget({ api, config, onConfig }) {
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
      return React.createElement("div", null,
        React.createElement("div", { className: "wd-balance-amount" },
          React.createElement("span", { className: "wd-balance-val" }, c ? "¥" + c.yuan.toFixed(4) : "--"),
          React.createElement("span", { className: "wd-balance-cur" }, "本次会话估算")
        ),
        React.createElement("div", { className: "wd-balance-detail", style: { display: "block" } },
          c ? React.createElement("div", null,
            React.createElement("div", null, "输入 " + c.inputFee.toFixed(4) + " 元 · 输出 " + c.outputFee.toFixed(4) + " 元"),
            React.createElement("div", null, "缓存 " + c.cacheFee.toFixed(4) + " 元 · 共 " + fmtNum(c.tokens) + " tokens")
          ) : React.createElement("div", null, "无用量数据")
        ),
        React.createElement("div", { className: "wd-empty", style: { marginTop: 4, cursor: "pointer", color: "var(--dsw-alias-state-business-primary)" }, onClick: () => setEditing(true) }, "调整单价"),
        editing ? React.createElement("div", { className: "wd-edit" },
          React.createElement("div", { className: "wd-edit-title" }, "模型（自动应用官方高峰价）"),
          React.createElement("div", { className: "wd-edit-row" },
            modelBtn("flash", "⚡ v4-flash"),
            modelBtn("pro", "🚀 v4-pro")
          ),
          React.createElement("div", { className: "wd-edit-title" }, "单价（元/百万 tokens，价格以官方为准）"),
          field("input", "输入（未缓存）"),
          field("cacheRead", "缓存读取"),
          field("cacheWrite", "缓存写入"),
          field("output", "输出"),
          React.createElement("div", { className: "wd-edit-row" },
            React.createElement("button", { className: "wd-edit-btn primary", onClick: saveRates }, "保存"),
            React.createElement("button", { className: "wd-edit-btn", onClick: () => { setDraft(rates); setEditing(false); } }, "取消")
          )
        ) : null
      );
    }

    // 7) 上下文压力：用下一次请求的估算占用，而非累计用量，帮助判断何时该压缩。
    function ContextPressureWidget({ api }) {
      const pressure = api.useProjection("contextPressure");
      const projected = pressure && (pressure.projectedTokens || pressure.pressureTokens);
      const windowSize = pressure && pressure.contextWindow;
      const ratio = projected && windowSize ? Math.min(100, Math.round(projected / windowSize * 100)) : null;
      return React.createElement("div", null,
        React.createElement("div", { className: "wd-balance-amount" },
          React.createElement("span", { className: "wd-balance-val" }, ratio == null ? "--" : ratio + "%"),
          React.createElement("span", { className: "wd-balance-cur" }, "上下文占用")
        ),
        React.createElement("div", { className: "wd-balance-detail" },
          React.createElement("span", null, projected ? fmtNum(projected) + " tokens" : "等待模型用量"),
          React.createElement("span", null, windowSize ? "窗口 " + fmtNum(windowSize) : "窗口未知")
        ),
        ratio !== null && ratio >= 80 ? React.createElement("div", { className: "wd-err" }, "上下文接近上限，建议压缩对话") : null
      );
    }

    // 8) 待办：Harness 维护的当前轮任务清单，只读展示（todos 投影首次写入前为 null）
    function TodosWidget({ api }) {
      const todos = api.useProjection("todos");
      const list = Array.isArray(todos) ? todos : [];
      const complete = list.filter((item) => item.status === "completed").length;
      const active = list.filter((item) => item.status === "in_progress").length;
      return React.createElement("div", null,
        React.createElement("div", { className: "wd-balance-amount" },
          React.createElement("span", { className: "wd-balance-val" }, list.length ? complete + "/" + list.length : "0"),
          React.createElement("span", { className: "wd-balance-cur" }, "已完成")
        ),
        list.length ? React.createElement("div", { className: "wd-balance-detail", style: { display: "block" } },
          list.slice(0, 3).map((item, index) => React.createElement("div", { key: index, style: { marginTop: index ? 3 : 0 } },
            (item.status === "completed" ? "✓ " : (item.status === "in_progress" ? "• " : "○ ")) + item.content
          )),
          list.length > 3 ? React.createElement("div", { style: { marginTop: 3 } }, "还有 " + (list.length - 3) + " 项") : null
        ) : React.createElement("div", { className: "wd-empty" }, "当前会话暂无任务清单（agent 创建任务后自动显示）"),
        active ? React.createElement("div", { className: "wd-empty" }, active + " 项进行中") : null
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

    const WIDGETS = {
      contextPressure: { id: "contextPressure", name: "上下文压力", desc: "下一次请求的窗口占用", render: ContextPressureWidget },
      todos: { id: "todos", name: "待办", desc: "当前任务清单", render: TodosWidget },
      permissions: { id: "permissions", name: "权限模式", desc: "当前访问范围", render: PermissionsWidget },
      balance: { id: "balance", name: "API 余额", desc: "账户余额与充值", render: BalanceWidget },
      tokens: { id: "tokens", name: "Token 用量", desc: "输入、输出与缓存", render: TokensWidget },
      stats: { id: "stats", name: "会话统计", desc: "回合、步骤与耗时", render: StatsWidget },
      goal: { id: "goal", name: "目标进度", desc: "当前目标状态", render: GoalWidget },
      cost: { id: "cost", name: "成本估算", desc: "按当前单价估算", render: CostWidget }
    };
    // 卡片尺寸档位（宽度 px）：小 / 中 / 大 / 超大
    const SIZES = { S: 160, M: 220, L: 300, XL: 400 };
    const SIZE_ORDER = ["S", "M", "L", "XL"];

    function WorkbenchCard({ item, index, api, onRemove, onConfig, dragging, onDragStart, onDragEnd, onDragOver, onDrop }) {
      const widget = WIDGETS[item.id];
      const Content = widget.render;
      const config = item.config || {};
      const size = config.size && SIZES[config.size] ? config.size : "M";
      const width = SIZES[size];
      const [sizeOpen, setSizeOpen] = useState(false);
      const setSize = (next) => { onConfig(item.id, Object.assign({}, config, { size: next })); setSizeOpen(false); };
      return React.createElement("section", {
        className: "wd-workbench-card" + (dragging ? " dragging" : ""),
        style: { width: width + "px" },
        onDragOver: (event) => event.preventDefault(),
        onDrop: (event) => { event.preventDefault(); onDrop(item.side, index); }
      },
        // 头部随时可拖（无需进入排序模式）
        React.createElement("div", {
          className: "wd-workbench-card-head",
          draggable: true,
          title: "按住拖动：排序 / 拖到另一侧切换位置",
          onDragStart: (event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", item.id); onDragStart(item.id); },
          onDragEnd: onDragEnd
        },
          React.createElement("span", { className: "wd-grip" }, "⠿"),
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

    function WidgetPicker({ items, onToggle, onMove, onClose, onMinimize }) {
      return React.createElement("div", { className: "wd-picker" },
        React.createElement("div", { className: "wd-picker-head" },
          React.createElement("span", null, "添加 / 管理面板"),
          React.createElement("div", { className: "wd-deck-actions" },
            React.createElement("button", { className: "wd-btn", title: "最小化工作台", onClick: onMinimize }, "—"),
            React.createElement("button", { className: "wd-btn", title: "关闭侧栏", onClick: onClose }, "✕")
          )
        ),
        React.createElement("div", { className: "wd-picker-note" }, "点击添加；已显示的卡片可直接切换到左侧或右侧；卡片头部随时可拖动排序/换侧"),
        React.createElement("div", { className: "wd-picker-list" }, Object.keys(WIDGETS).map((id) => {
          const widget = WIDGETS[id];
          const item = items.find((entry) => entry.id === id);
          const added = !!item;
          return React.createElement("div", { key: id, className: "wd-panel-item" + (added ? " added" : "") },
            React.createElement("button", { className: "wd-panel-item", style: { padding: 0, flex: 1 }, onClick: () => onToggle(id) },
            React.createElement("div", null,
              React.createElement("div", { className: "wd-panel-name" }, widget.name),
              React.createElement("div", { className: "wd-panel-desc" }, widget.desc)
            )),
            added ? React.createElement("div", { className: "wd-place-actions" },
              React.createElement("button", { className: "wd-place-btn" + (item.side === "left" ? " current" : ""), title: "放到左侧工作台", onClick: () => onMove(id, "left") }, "左侧"),
              React.createElement("button", { className: "wd-place-btn" + (item.side === "right" ? " current" : ""), title: "放到右侧工作台", onClick: () => onMove(id, "right") }, "右侧")
            ) : React.createElement("span", { className: "wd-panel-check" }, "添加")
          );
        }))
      );
    }

    function WidgetDock({ useProjection, sessionId, executeCommand }) {
      const [state, setState] = useState(loadState);
      const [open, setOpen] = useState(() => {
        try { return localStorage.getItem(UI_STATE_KEY) !== "minimized"; } catch (e) { return true; }
      });
      const [pickerOpen, setPickerOpen] = useState(false);
      const [draggedId, setDraggedId] = useState(null);
      const [layout, setLayout] = useState(null);
      const usage = useProjection("tokenUsage");
      const goalProjection = useProjection("goal");
      const stats = useProjection("sessionStats");
      const persist = (next) => { setState(next); saveState(next); };
      const items = state.items.filter((item) => WIDGETS[item.id]);
      const api = { useProjection: useProjection, sessionId: sessionId, executeCommand: executeCommand };
      const tokenTotal = usage ? (usage.uncachedInputTokens || 0) + (usage.cacheReadTokens || 0) + (usage.cacheWriteTokens || 0) + (usage.outputTokens || 0) : null;
      const goal = goalProjection && goalProjection.goal;
      const turnCount = stats && stats.turns != null ? stats.turns : null;
      const setMinimized = (minimized) => {
        setOpen(!minimized);
        try { localStorage.setItem(UI_STATE_KEY, minimized ? "minimized" : "expanded"); } catch (e) { /* ignore */ }
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
          const leftStart = 294;
          // 左侧卡片始终靠左，正文前保留 42px 安全距离，避免视觉上贴着对话。
          const leftWidth = Math.max(0, contentLeft - leftStart - 42);
          const rightWidth = Math.max(0, viewport - contentRight - 26);
          // 用满可用空白（不再限制 440px 上限），卡片按尺寸档位自动换行填满
          setLayout({ left: { x: leftStart, width: leftWidth }, right: { x: contentRight + 14, width: rightWidth } });
        };
        measure();
        window.addEventListener("resize", measure);
        const observer = new ResizeObserver(measure);
        const chat = findChatContainer();
        if (chat) observer.observe(chat);
        return () => { window.removeEventListener("resize", measure); observer.disconnect(); };
      }, []);
      useEffect(() => {
        const syncTrajectory = () => {
          const active = document.querySelector('[role="tab"][aria-selected="true"]');
          if (active && String(active.textContent || "").trim() === "轨迹") setMinimized(true);
        };
        syncTrajectory();
        const observer = new MutationObserver(syncTrajectory);
        observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["aria-selected"] });
        return () => observer.disconnect();
      }, []);
      const toggle = (id) => {
        const index = items.findIndex((item) => item.id === id);
        if (index >= 0) {
          const next = { items: items.slice() };
          next.items.splice(index, 1);
          persist(next);
        } else {
          const side = deckItems("right").length < 4 ? "right" : "left";
          persist({ items: items.concat([{ id: id, config: {}, side: side }]) });
        }
      };
      const remove = (id) => {
        persist({ items: items.filter((item) => item.id !== id) });
      };
      const updateConfig = (id, config) => {
        // 配置由卡片内事件触发，必须基于最新 state 写入；不能使用渲染时捕获的 items。
        setState((previous) => {
          const source = previous && Array.isArray(previous.items) ? previous.items : [];
          const found = source.some((item) => item.id === id);
          if (!found) return previous;
          const next = {
            items: source.map((item) => item.id === id ? Object.assign({}, item, { config: config }) : item)
          };
          saveState(next);
          return next;
        });
      };
      const moveToSide = (id, side) => {
        const next = { items: items.map((item) => item.id === id ? Object.assign({}, item, { side: side }) : item) };
        persist(next);
      };
      const moveItem = (targetSide, targetIndex) => {
        if (!draggedId) return;
        const dragged = items.find((item) => item.id === draggedId);
        if (!dragged) return;
        const without = items.filter((item) => item.id !== draggedId);
        const targetItems = without.filter((item) => item.side === targetSide);
        const before = targetItems.slice(0, targetIndex);
        const after = targetItems.slice(targetIndex);
        const other = without.filter((item) => item.side !== targetSide);
        persist({ items: other.concat(before, [Object.assign({}, dragged, { side: targetSide })], after) });
        setDraggedId(null);
      };
      const deckItems = (side) => items.filter((item) => item.side === side);
      const canShowDecks = !!(layout && (layout.left.width >= 180 || layout.right.width >= 180));
      const deckStyle = (side) => {
        if (!layout || layout[side].width < 180) return { display: "none" };
        return {
          left: layout[side].x + "px",
          width: layout[side].width + "px"
        };
      };
      const renderDeck = (side, title) => {
        const deck = deckItems(side);
        return React.createElement("aside", {
          className: "wd-deck " + side + (!layout || layout[side].width < 180 ? " hidden" : ""),
          style: deckStyle(side),
          onDragOver: (event) => event.preventDefault(),
          onDrop: (event) => { event.preventDefault(); moveItem(side, deck.length); }
        },
          // 右侧工作台右上角小按钮：打开添加/管理侧栏（不占列表上方的行）
          side === "right" ? React.createElement("button", {
            className: "wd-deck-open" + (pickerOpen ? " active" : ""),
            title: pickerOpen ? "收起侧栏" : "打开添加/管理侧栏",
            onClick: () => setPickerOpen(!pickerOpen)
          }, pickerOpen ? "✕" : "＋") : null,
          deck.length ? deck.map((item, index) => React.createElement(WorkbenchCard, {
            key: item.id,
            item: item,
            index: index,
            api: api,
            dragging: draggedId === item.id,
            onDragStart: setDraggedId,
            onDragEnd: () => setDraggedId(null),
            onDrop: moveItem,
            onRemove: remove,
            onConfig: updateConfig
          })) : React.createElement("div", { className: "wd-deck-empty" }, "拖到这里")
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
          onClose: () => setPickerOpen(false),
          onMinimize: () => { setPickerOpen(false); setMinimized(true); }
        }) : null
      );
    }

    // ── 插件入口 ──────────────────────────────────────────────────────────
    function apply(ctx) {
      ctx.slots.inject("conversation.input.left", () => ctx.slots.register({
        name: "conversation.input.left",
        id: "widget-dock",
        order: 100,
        // 注入普通函数而非服务对象：避免子组件直接访问 remote 触发 guard 拦截
        inject: (sessionId) => ({
          executeCommand: (line) => {
            const r = ctx.get("remote");
            if (!r || !r.commands || !sessionId) return Promise.reject(new Error("命令通道不可用"));
            return r.commands.execute(sessionId, line);
          }
        })
      }, (props) => React.createElement(WidgetDock, {
        useProjection: props.useProjection,
        sessionId: props.sessionId,
        executeCommand: props.executeCommand
      })));
    }

    const inject = ["slots", "remote"];
    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
