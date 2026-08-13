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
    // 安全：不在代码中嵌入密钥。首次使用请在余额组件内填写 API Key（存 localStorage）。
    const EMBEDDED_KEY = "";
    const TOP_UP_URL = "https://platform.deepseek.com/top_up";
    const BALANCE_URL = "https://api.deepseek.com/user/balance";
    const DEFAULT_RATES = { input: 2, cacheRead: 0.5, cacheWrite: 2, output: 8 };
    const COL_W = 200;
    const COL_GAP = 14;

    // 对话容器选择器（编译产物类名；找不到时回退到视口计算）
    function findChatContainer() {
      try {
        const known = document.querySelector(".wSkVaW_root");
        if (known && known.getBoundingClientRect().width > 100) return known;
        // 回退：找设置了 --dsh-chat-content-width 的 flex 容器
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
      // 输入框工具行 ➕ 按钮
      ".wd-add-btn{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-elevated);color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:15px;line-height:1;transition:background .15s}",
      ".wd-add-btn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}",
      // 添加面板
      ".wd-panel{position:fixed;left:50%;transform:translateX(-50%);bottom:120px;width:330px;max-height:400px;overflow-y:auto;border-radius:12px;background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l1);box-shadow:0 12px 40px rgba(0,0,0,.18);padding:10px;z-index:9000}",
      ".wd-panel-title{font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary);padding:6px 8px 8px}",
      ".wd-panel-hint{font-size:10px;color:var(--dsw-alias-label-tertiary);padding:0 8px 8px}",
      ".wd-panel-item{display:flex;align-items:center;gap:10px;width:100%;padding:9px 10px;border:none;background:none;border-radius:9px;cursor:pointer;text-align:left;color:var(--dsw-alias-label-primary)}",
      ".wd-panel-item:hover{background:var(--dsw-alias-interactive-bg-hover)}",
      ".wd-panel-item.disabled{opacity:.4;cursor:default}",
      ".wd-panel-icon{font-size:16px;flex:none}",
      ".wd-panel-name{font-size:13px;font-weight:500}",
      ".wd-panel-desc{font-size:11px;color:var(--dsw-alias-label-tertiary);margin-top:1px}",
      ".wd-panel-check{margin-left:auto;font-size:12px;color:var(--dsw-alias-state-success-primary);flex:none}",
      ".wd-panel-item.dragging{opacity:.4}",
      // 左右列
      ".wd-col{position:fixed;top:88px;width:" + COL_W + "px;display:flex;flex-direction:column;gap:10px;z-index:500;max-height:calc(100vh - 120px);overflow-y:auto}",
      // 空列占位（拖放目标）
      ".wd-col-empty{height:120px;border:1.5px dashed var(--dsw-alias-border-l2);border-radius:12px;display:flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-tertiary);font-size:11px;transition:border-color .15s,background .15s}",
      ".wd-col-empty.drag-over{border-color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-interactive-bg-hover-accent);color:var(--dsw-alias-state-business-primary)}",
      ".wd-col.drag-over>.wd-col-empty{border-color:var(--dsw-alias-state-business-primary)}",
      // 组件卡片
      ".wd-item{border-radius:12px;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);box-shadow:0 4px 16px rgba(0,0,0,.07);overflow:hidden;color:var(--dsw-alias-label-primary)}",
      ".wd-item.drag-over{border-color:var(--dsw-alias-state-business-primary);box-shadow:0 0 0 2px var(--dsw-alias-state-business-primary)}",
      ".wd-item.dragging{opacity:.5}",
      // 组件头部
      ".wd-head{display:flex;align-items:center;gap:6px;padding:7px 10px 0;cursor:grab;user-select:none}",
      ".wd-grip{color:var(--dsw-alias-label-tertiary);font-size:11px;cursor:grab;flex:none}",
      ".wd-name{font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary);letter-spacing:.5px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      ".wd-btn{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border:none;background:none;border-radius:5px;color:var(--dsw-alias-label-tertiary);cursor:pointer;font-size:11px;flex:none;padding:0}",
      ".wd-btn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}",
      ".wd-btn.danger:hover{background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary)}",
      // 组件内容
      ".wd-body{padding:8px 12px 12px;font-size:12px;line-height:1.5}",
      // 编辑区
      ".wd-edit{border-top:1px solid var(--dsw-alias-border-l1);padding:8px 12px 12px;display:flex;flex-direction:column;gap:8px}",
      ".wd-edit-title{font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary)}",
      ".wd-input{height:30px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);padding:0 9px;font-size:11px;font-family:ui-monospace,Menlo,monospace;outline:none;width:100%;box-sizing:border-box}",
      ".wd-input:focus{border-color:var(--dsw-alias-state-business-primary)}",
      ".wd-edit-row{display:flex;gap:6px}",
      ".wd-edit-btn{flex:1;height:26px;border-radius:7px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-elevated);color:var(--dsw-alias-label-primary);cursor:pointer;font-size:11px}",
      ".wd-edit-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}",
      ".wd-edit-btn.primary{border-color:transparent;background:var(--dsw-alias-state-business-primary);color:#fff}",
      // ── 小组件内部样式 ──
      ".wd-balance-state{display:flex;align-items:center;gap:5px;margin-bottom:2px}",
      ".wd-balance-amount{display:flex;align-items:baseline;gap:4px}",
      ".wd-balance-val{font-size:26px;font-weight:600;font-variant-numeric:tabular-nums;line-height:1.15}",
      ".wd-balance-cur{font-size:11px;color:var(--dsw-alias-label-secondary)}",
      ".wd-balance-detail{margin-top:4px;font-size:10px;color:var(--dsw-alias-label-tertiary);display:flex;gap:8px}",
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
      ".wd-cmd-btn{height:28px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-elevated);color:var(--dsw-alias-label-primary);cursor:pointer;font-size:11px;font-family:ui-monospace,Menlo,monospace}",
      ".wd-cmd-btn:hover{background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-state-business-primary)}",
      ".wd-cmd-btn.done{opacity:.5}",
      ".wd-goal-phase{display:inline-block;padding:1px 8px;border-radius:999px;font-size:10px;margin-top:4px}",
      ".wd-goal-phase.active{background:var(--dsw-alias-state-business-primary);color:#fff}",
      ".wd-goal-phase.paused{background:var(--dsw-alias-state-warn-primary);color:#fff}",
      ".wd-goal-phase.blocked{background:var(--dsw-alias-state-error-primary);color:#fff}",
      ".wd-goal-text{margin-top:6px;font-size:11px;color:var(--dsw-alias-label-primary);word-break:break-word;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}",
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

    // ── 状态持久化 ────────────────────────────────────────────────────────
    function loadState() {
      try {
        const raw = localStorage.getItem(STATE_KEY);
        if (raw) {
          const s = JSON.parse(raw);
          if (s && Array.isArray(s.left) && Array.isArray(s.right)) return s;
        }
      } catch (e) { /* ignore */ }
      return { left: [], right: [] };
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

    // ── 小组件：1) API 余额 ───────────────────────────────────────────────
    function BalanceWidget({ api, config, onConfig }) {
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

      return React.createElement("div", null,
        React.createElement("div", { className: "wd-balance-state" },
          React.createElement("span", { className: "wd-dot " + (loading ? "" : (ok ? "ok" : "bad")) }),
          React.createElement("span", { className: "wd-empty", style: { marginTop: 0 } }, loading ? "查询中…" : (ok ? "账户可用" : (balance ? "账户异常" : "未连接")))
        ),
        React.createElement("div", { className: "wd-balance-amount" },
          React.createElement("span", { className: "wd-balance-cur" }, info ? info.currency : ""),
          React.createElement("span", { className: "wd-balance-val" }, info ? info.total_balance : "--"),
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
            "KEY: " + maskKey(getBalanceKey(config)) + " 编辑"
          )
      );
    }

    // 2) Token 用量
    function TokensWidget({ api }) {
      const usage = api.useProjection ? api.useProjection("tokenUsage") : null;
      const input = usage ? (usage.uncachedInputTokens || 0) + (usage.cacheReadTokens || 0) + (usage.cacheWriteTokens || 0) : null;
      const output = usage ? (usage.outputTokens || 0) : null;
      const total = input !== null ? input + output : null;
      return React.createElement("div", null,
        React.createElement("div", { className: "wd-balance-amount" },
          React.createElement("span", { className: "wd-balance-val" }, total !== null ? total.toLocaleString() : "--"),
          React.createElement("span", { className: "wd-balance-cur" }, "tokens")
        ),
        React.createElement("div", { className: "wd-balance-detail" },
          React.createElement("span", null, "输入 " + (input !== null ? input.toLocaleString() : "--")),
          React.createElement("span", null, "输出 " + (output !== null ? output.toLocaleString() : "--"))
        ),
        usage && (usage.cacheReadTokens || usage.cacheWriteTokens) ? React.createElement("div", { className: "wd-balance-detail" },
          React.createElement("span", null, "缓存读 " + (usage.cacheReadTokens || 0).toLocaleString()),
          React.createElement("span", null, "缓存写 " + (usage.cacheWriteTokens || 0).toLocaleString())
        ) : null,
        !usage ? React.createElement("div", { className: "wd-empty" }, "暂无用量数据") : null
      );
    }

    // 3) 会话统计
    function StatsWidget({ api }) {
      const stats = api.useProjection ? api.useProjection("sessionStats") : null;
      const totals = stats && stats.totals ? stats.totals : null;
      return React.createElement("div", null,
        React.createElement("div", { className: "wd-stat-row" }, React.createElement("span", null, "回合数"), React.createElement("b", null, totals ? totals.turns : "--")),
        React.createElement("div", { className: "wd-stat-row" }, React.createElement("span", null, "步骤数"), React.createElement("b", null, totals ? totals.steps : "--")),
        React.createElement("div", { className: "wd-stat-row" }, React.createElement("span", null, "模型耗时"), React.createElement("b", null, totals ? fmtTime(totals.llmMs) : "--")),
        React.createElement("div", { className: "wd-stat-row" }, React.createElement("span", null, "工具耗时"), React.createElement("b", null, totals ? fmtTime(totals.toolMs) : "--")),
        !stats ? React.createElement("div", { className: "wd-empty" }, "暂无统计") : null
      );
    }

    // 4) 快捷命令
    function CommandsWidget({ api }) {
      const [running, setRunning] = useState(null);
      const COMMANDS = [
        { label: "/compact", line: "/compact", title: "压缩上下文" },
        { label: "/goal", line: "/goal", title: "管理目标" },
        { label: "/model", line: "/model", title: "切换模型" },
        { label: "/plan", line: "/plan", title: "计划模式" },
        { label: "/help", line: "/help", title: "帮助" },
        { label: "/skills", line: "/skills", title: "技能列表" }
      ];
      const run = async (cmd) => {
        if (running) return;
        setRunning(cmd.line);
        try {
          if (api.remote && api.remote.commands && api.sessionId) {
            await api.remote.commands.execute(api.sessionId, cmd.line);
          }
        } catch (e) { /* command surface shows errors */ }
        window.setTimeout(() => setRunning(null), 800);
      };
      return React.createElement("div", null,
        React.createElement("div", { className: "wd-cmd-grid" },
          COMMANDS.map((cmd) => React.createElement("button", {
            key: cmd.line,
            className: "wd-cmd-btn" + (running === cmd.line ? " done" : ""),
            title: cmd.title,
            onClick: () => run(cmd)
          }, cmd.label))
        ),
        React.createElement("div", { className: "wd-empty", style: { marginTop: 6 } }, "点击直接执行命令")
      );
    }

    // 5) 目标进度
    function GoalWidget({ api }) {
      const projection = api.useProjection ? api.useProjection("goal") : null;
      const goal = projection ? projection.goal : null;
      if (!goal) {
        return React.createElement("div", null,
          React.createElement("div", { className: "wd-empty" }, "当前没有进行中的目标"),
          React.createElement("div", { className: "wd-cmd-grid" },
            React.createElement("button", { className: "wd-cmd-btn", onClick: () => { if (api.remote && api.remote.commands && api.sessionId) api.remote.commands.execute(api.sessionId, "/goal"); } }, "/goal 创建")
          )
        );
      }
      return React.createElement("div", null,
        React.createElement("div", { className: "wd-goal-phase " + (goal.phase || "active") }, goal.phase || "active"),
        React.createElement("div", { className: "wd-goal-text" }, goal.objective || "(无目标描述)")
      );
    }

    // 6) 成本估算
    function CostWidget({ api, config, onConfig }) {
      const [editing, setEditing] = useState(false);
      const rates = Object.assign({}, DEFAULT_RATES, config && config.rates ? config.rates : {});
      const [draft, setDraft] = useState(JSON.stringify(rates));
      const usage = api.useProjection ? api.useProjection("tokenUsage") : null;
      const calc = () => {
        if (!usage) return null;
        const uncached = usage.uncachedInputTokens || 0;
        const cacheRead = usage.cacheReadTokens || 0;
        const cacheWrite = usage.cacheWriteTokens || 0;
        const output = usage.outputTokens || 0;
        const yuan = (uncached * rates.input + cacheRead * rates.cacheRead + cacheWrite * rates.cacheWrite + output * rates.output) / 1e6;
        return { yuan: yuan, tokens: uncached + cacheRead + cacheWrite + output };
      };
      const c = calc();
      const saveRates = () => {
        try { onConfig({ rates: JSON.parse(draft) }); } catch (e) { /* ignore */ }
        setEditing(false);
      };
      return React.createElement("div", null,
        React.createElement("div", { className: "wd-balance-amount" },
          React.createElement("span", { className: "wd-balance-val" }, c ? "¥" + c.yuan.toFixed(4) : "--"),
          React.createElement("span", { className: "wd-balance-cur" }, "估算")
        ),
        React.createElement("div", { className: "wd-balance-detail" },
          React.createElement("span", null, c ? c.tokens.toLocaleString() + " tokens" : "无数据"),
          React.createElement("span", null, "输入 ¥" + rates.input + "/M · 输出 ¥" + rates.output + "/M")
        ),
        React.createElement("div", { className: "wd-empty", style: { marginTop: 4, cursor: "pointer", color: "var(--dsw-alias-state-business-primary)" }, onClick: () => setEditing(true) }, "编辑单价"),
        editing ? React.createElement("div", { className: "wd-edit" },
          React.createElement("div", { className: "wd-edit-title" }, "单价（元/百万 tokens）"),
          React.createElement("input", { className: "wd-input", value: draft, onChange: (e) => setDraft(e.target.value), spellCheck: false }),
          React.createElement("div", { className: "wd-edit-row" },
            React.createElement("button", { className: "wd-edit-btn primary", onClick: saveRates }, "保存"),
            React.createElement("button", { className: "wd-edit-btn", onClick: () => { setDraft(JSON.stringify(rates)); setEditing(false); } }, "取消")
          )
        ) : null
      );
    }

    const WIDGETS = {
      balance: { id: "balance", name: "API 余额", icon: "💰", desc: "DeepSeek 余额与充值入口", render: BalanceWidget },
      tokens: { id: "tokens", name: "Token 用量", icon: "📊", desc: "会话输入/输出 token 统计", render: TokensWidget },
      stats: { id: "stats", name: "会话统计", icon: "📈", desc: "回合、步骤与耗时", render: StatsWidget },
      commands: { id: "commands", name: "快捷命令", icon: "⚡", desc: "常用斜杠命令一键执行", render: CommandsWidget },
      goal: { id: "goal", name: "目标进度", icon: "🎯", desc: "当前目标状态与进度", render: GoalWidget },
      cost: { id: "cost", name: "成本估算", icon: "🧾", desc: "会话 token 花费估算", render: CostWidget }
    };

    // ── 单个组件卡片 ──────────────────────────────────────────────────────
    function WidgetItem({ widget, config, api, dragging, isOver, onDragStart, onDragEnd, onDragOver, onDrop, onRemove, onConfig }) {
      const Content = widget.render;
      return React.createElement("div", {
        className: "wd-item" + (dragging ? " dragging" : "") + (isOver ? " drag-over" : ""),
        draggable: true,
        onDragStart: onDragStart,
        onDragEnd: onDragEnd,
        onDragOver: onDragOver,
        onDrop: onDrop
      },
        React.createElement("div", { className: "wd-head" },
          React.createElement("span", { className: "wd-grip" }, "⠿"),
          React.createElement("span", { className: "wd-name" }, widget.icon + " " + widget.name),
          React.createElement("button", { className: "wd-btn", title: "移除", onClick: onRemove }, "✕")
        ),
        React.createElement("div", { className: "wd-body" },
          React.createElement(Content, { api: api, config: config || {}, onConfig: onConfig })
        )
      );
    }

    // ── 单列（空列也是拖放目标；支持拖入 + 排序）─────────────────────────
    function WidgetColumn({ side, items, api, pos, onAdd, onMove, onRemove, onConfig, dragWidgetId, setDragWidgetId }) {
      const [dragIndex, setDragIndex] = useState(null);
      const [overIndex, setOverIndex] = useState(null);
      const [overEmpty, setOverEmpty] = useState(false);
      const hasSpace = pos ? (side === "left" ? pos.leftSpace >= COL_W + COL_GAP * 2 : pos.rightSpace >= COL_W + COL_GAP * 2) : true;

      const colStyle = side === "left"
        ? { left: pos ? (pos.chatLeft + COL_GAP) : 14 }
        : { left: pos ? (pos.chatRight + COL_GAP) : "auto", right: pos ? "auto" : 14 };

      const handleDrop = () => {
        if (dragWidgetId) {
          onAdd(side, dragWidgetId);
          setDragWidgetId(null);
          return;
        }
        if (dragIndex !== null && dragIndex !== overIndex && overIndex !== null) {
          onMove(side, dragIndex, overIndex);
        }
        setDragIndex(null);
        setOverIndex(null);
        setOverEmpty(false);
      };

      // 无空间时不渲染该列（避免遮挡）
      if (!hasSpace) return null;

      return React.createElement("div", {
        className: "wd-col wd-col-" + side,
        style: colStyle,
        onDragOver: (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (dragWidgetId) setOverEmpty(true); },
        onDragLeave: () => setOverEmpty(false),
        onDrop: handleDrop
      },
        items.length === 0
          ? React.createElement("div", { className: "wd-col-empty" + (overEmpty ? " drag-over" : "") }, "拖放小组件到" + (side === "left" ? "左" : "右") + "侧")
          : items.map((item, i) => {
              const widget = WIDGETS[item.id];
              if (!widget) return null;
              return React.createElement(WidgetItem, {
                key: item.id + "-" + i,
                widget: widget,
                config: item.config,
                api: api,
                dragging: dragIndex === i,
                isOver: overIndex === i && dragIndex !== null && dragIndex !== i,
                onDragStart: (e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", item.id); setDragIndex(i); },
                onDragEnd: () => { setDragIndex(null); setOverIndex(null); setOverEmpty(false); setDragWidgetId(null); },
                onDragOver: (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (dragIndex !== null) setOverIndex(i); },
                onDrop: handleDrop,
                onRemove: () => onRemove(side, i),
                onConfig: (config) => onConfig(side, i, config)
              });
            })
      );
    }

    // ── 添加面板（支持拖出 + 点击）───────────────────────────────────────
    function AddPanel({ addedIds, onAdd, onClose, setDragWidgetId }) {
      return React.createElement("div", { className: "wd-panel" },
        React.createElement("div", { className: "wd-panel-title" }, "添加小组件"),
        React.createElement("div", { className: "wd-panel-hint" }, "拖到两侧空白处放置，或点击添加到右侧"),
        Object.keys(WIDGETS).map((key) => {
          const w = WIDGETS[key];
          const added = addedIds.indexOf(key) !== -1;
          return React.createElement("button", {
            key: key,
            className: "wd-panel-item" + (added ? " disabled" : ""),
            disabled: added,
            draggable: !added,
            onDragStart: (e) => {
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", key);
              setDragWidgetId(key);
            },
            onDragEnd: () => setDragWidgetId(null),
            onClick: () => { if (!added) onAdd("right", key); }
          },
            React.createElement("span", { className: "wd-panel-icon" }, w.icon),
            React.createElement("div", null,
              React.createElement("div", { className: "wd-panel-name" }, w.name),
              React.createElement("div", { className: "wd-panel-desc" }, w.desc)
            ),
            added ? React.createElement("span", { className: "wd-panel-check" }, "✓") : null
          );
        }),
        React.createElement("div", { className: "wd-panel-item", onClick: onClose },
          React.createElement("span", { className: "wd-panel-icon" }, "✕"),
          React.createElement("div", { className: "wd-panel-name" }, "关闭")
        )
      );
    }

    // ── 主容器 ────────────────────────────────────────────────────────────
    function WidgetDock({ useProjection, sessionId, remote }) {
      const [state, setState] = useState(loadState);
      const [panelOpen, setPanelOpen] = useState(false);
      const [pos, setPos] = useState(null);
      const [dragWidgetId, setDragWidgetId] = useState(null);

      // 测量对话容器，计算两侧空白位置（fixed 元素继承不到对话容器的 CSS 变量，必须实测）
      useEffect(() => {
        const measure = () => {
          const el = findChatContainer();
          if (!el) {
            setPos(null);
            return;
          }
          const r = el.getBoundingClientRect();
          const vw = window.innerWidth;
          setPos({
            chatLeft: r.left,
            chatRight: r.right,
            leftSpace: r.left,
            rightSpace: vw - r.right
          });
        };
        measure();
        window.addEventListener("resize", measure);
        const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
        if (ro) {
          const el = findChatContainer();
          if (el) ro.observe(el);
        }
        return () => {
          window.removeEventListener("resize", measure);
          if (ro) ro.disconnect();
        };
      }, []);

      const persist = (next) => { setState(next); saveState(next); };

      const addWidget = (side, id) => {
        const next = { left: state.left.slice(), right: state.right.slice() };
        if (next[side].some((x) => x.id === id)) return;
        next[side].push({ id: id, config: {} });
        persist(next);
      };
      const removeWidget = (side, index) => {
        const next = { left: state.left.slice(), right: state.right.slice() };
        next[side].splice(index, 1);
        persist(next);
      };
      const moveWidget = (side, from, to) => {
        const next = { left: state.left.slice(), right: state.right.slice() };
        const arr = next[side];
        const [item] = arr.splice(from, 1);
        arr.splice(to, 0, item);
        persist(next);
      };
      const updateConfig = (side, index, config) => {
        const next = { left: state.left.slice(), right: state.right.slice() };
        next[side][index] = Object.assign({}, next[side][index], { config: config });
        persist(next);
      };

      const addedIds = state.left.concat(state.right).map((x) => x.id);
      const api = { useProjection: useProjection, sessionId: sessionId, remote: remote };

      return React.createElement(React.Fragment, null,
        React.createElement("button", {
          className: "wd-add-btn",
          title: "添加小组件",
          onClick: () => setPanelOpen(!panelOpen)
        }, panelOpen ? "✕" : "+"),
        panelOpen ? React.createElement(AddPanel, { addedIds: addedIds, onAdd: addWidget, onClose: () => setPanelOpen(false), setDragWidgetId: setDragWidgetId }) : null,
        React.createElement(WidgetColumn, { side: "left", items: state.left, api: api, pos: pos, onAdd: addWidget, onMove: moveWidget, onRemove: removeWidget, onConfig: updateConfig, dragWidgetId: dragWidgetId, setDragWidgetId: setDragWidgetId }),
        React.createElement(WidgetColumn, { side: "right", items: state.right, api: api, pos: pos, onAdd: addWidget, onMove: moveWidget, onRemove: removeWidget, onConfig: updateConfig, dragWidgetId: dragWidgetId, setDragWidgetId: setDragWidgetId })
      );
    }

    // ── 插件入口 ──────────────────────────────────────────────────────────
    function apply(ctx) {
      const remote = ctx.get("remote");
      ctx.slots.inject("conversation.input.left", () => ctx.slots.register({
        name: "conversation.input.left",
        id: "widget-dock-add",
        order: 100
      }, (props) => React.createElement(WidgetDock, {
        useProjection: props.useProjection,
        sessionId: props.sessionId,
        remote: remote
      })));
    }

    const inject = ["slots", "remote"];
    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
