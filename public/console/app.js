(() => {
  // console/shared/api.js
  async function api(path, method, body, _retried = 0) {
    const headers = body ? { "content-type": "application/json" } : {};
    const token = localStorage.getItem("consoleToken");
    if (token) headers["x-console-token"] = token;
    const res = await fetch(path, { method: method || "GET", headers, body: body ? JSON.stringify(body) : void 0 });
    if (res.status === 401) {
      if (_retried >= 2) {
        localStorage.removeItem("consoleToken");
        throw new Error("未授权");
      }
      const t = prompt("请输入控制台访问令牌：");
      if (t) {
        localStorage.setItem("consoleToken", t.trim());
        return api(path, method, body, _retried + 1);
      }
      localStorage.removeItem("consoleToken");
      throw new Error("未授权");
    }
    return res.json();
  }
  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }
  function initialize() {
    (function() {
      const qs = new URLSearchParams(location.search);
      const token = qs.get("token");
      if (token) {
        localStorage.setItem("consoleToken", token);
        history.replaceState({}, "", location.pathname + location.hash);
      }
    })();
  }

  // console/shared/session-options.js
  function initialize2() {
    const splitKinds = { aiNotifyId: "aiNotifyKind", tsId: "tsKind" };
    let keys = [], sessions = [];
    function enhance() {
      for (const input of document.querySelectorAll("input[type=text],input:not([type]),textarea")) {
        if (input.matches(".comp-form-json") || input.dataset.sessionPicker || input.closest(".session-options") || /token|secret|password|apikey/i.test(input.id)) continue;
        const field = input.closest("[data-config-key]"), name = field?.dataset.configKey || "", hint = (input.placeholder || "") + " " + input.id;
        const opaque = /sessionId/i.test(input.id), kindId = splitKinds[input.id];
        if (!opaque && !kindId && !/(?:group:|private:|session|会话)/i.test(hint) && !/(?:session|conversation|targetKey|notifyKey)/i.test(name)) continue;
        input.dataset.sessionPicker = "1";
        if (input.tagName !== "TEXTAREA") {
          const list = document.createElement("datalist");
          list.id = (input.id || "session-" + document.querySelectorAll("datalist[data-sessions]").length) + "-sessions";
          list.dataset.sessions = "1";
          const fill2 = () => {
            const kind = kindId ? document.getElementById(kindId)?.value : null;
            const rows = opaque ? sessions.map((s) => [s.sessionId || s.id, s.key]) : keys.filter((k) => !kind || k.startsWith(kind + ":")).map((k) => [kindId ? k.split(":").slice(1).join(":") : k, k]);
            list.replaceChildren(...rows.filter((r) => r[0]).map(([v, label2]) => new Option(label2 || v, v)));
          };
          fill2();
          if (kindId) document.getElementById(kindId)?.addEventListener("change", fill2);
          input.setAttribute("list", list.id);
          input.setAttribute("aria-label", input.getAttribute("aria-label") || "选择或输入会话");
          input.after(list);
          continue;
        }
        const select = document.createElement("select");
        select.className = "session-options";
        select.setAttribute("aria-label", "选择已有会话");
        const fill = () => {
          const kind = kindId ? document.getElementById(kindId)?.value : null;
          const rows = opaque ? sessions.map((s) => [s.sessionId || s.id, s.key]) : keys.filter((k) => !kind || k.startsWith(kind + ":")).map((k) => [k, k]);
          select.replaceChildren(new Option("选择已有会话…", ""), ...rows.filter((r) => r[0]).map(([v, label2]) => new Option(label2 || v, v)));
        };
        fill();
        if (kindId) document.getElementById(kindId)?.addEventListener("change", fill);
        select.addEventListener("change", () => {
          if (!select.value) return;
          const value2 = kindId ? select.value.split(":").slice(1).join(":") : select.value;
          input.value = input.tagName === "TEXTAREA" ? [.../* @__PURE__ */ new Set([...input.value.split("\n").filter(Boolean), value2])].join("\n") : value2;
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
          select.value = "";
        });
        input.before(select);
      }
    }
    Promise.allSettled([api("/api/socialV2/states"), api("/api/sessions")]).then(([a, b]) => {
      sessions = b.status === "fulfilled" ? b.value.sessions || [] : [];
      keys = [.../* @__PURE__ */ new Set([...(a.status === "fulfilled" ? a.value.conversations || [] : []).map((s) => s.key), ...sessions.map((s) => s.key)])].filter((k) => /^(private|group):\d+$/.test(k));
      enhance();
      new MutationObserver(enhance).observe(document.getElementById("mainContent"), { childList: true, subtree: true });
    });
  }

  // console/layers/O/context-request-diff.js
  var toolName = (t) => t.name || t.function?.name || "未命名工具";
  var schema = (t) => {
    const { chars: _chars, ...definition } = t;
    return JSON.stringify(definition);
  };
  var moduleValue = (m) => JSON.stringify({ text: m.text, parts: m.parts?.map((p) => ({ text: p.text, destination: p.destination })), included: m.included, inRequest: m.inRequest });
  function compareRequests(older, current) {
    if (!older || !current) return null;
    const before = new Map((older.tools || []).map((t) => [toolName(t), schema(t)])), after = new Map((current.tools || []).map((t) => [toolName(t), schema(t)]));
    const prior = new Map((older.modules || []).map((m) => [m.id, m]));
    return { toolsAdded: [...after.keys()].filter((name) => !before.has(name)), toolsRemoved: [...before.keys()].filter((name) => !after.has(name)), toolsChanged: [...after.keys()].filter((name) => before.has(name) && before.get(name) !== after.get(name)), modulesChanged: (current.modules || []).filter((m) => !prior.has(m.id) || moduleValue(prior.get(m.id)) !== moduleValue(m)).map((m) => ({ id: m.id, name: m.name || m.id })), messageCharsDelta: (current.messageChars || 0) - (older.messageChars || 0), toolCharsDelta: (current.toolChars || 0) - (older.toolChars || 0) };
  }

  // console/layers/O/context-knowledge.js
  var label = (entry) => entry.term || entry.alias || entry.content || entry.id;
  var value = (entry) => entry.summary || entry.meaning || (entry.qq ? "QQ " + entry.qq : "");
  function knowledgePanel(row, current, { actual: actual2 = false, allowed = true } = {}) {
    if (!current && !row.knowledge) return "";
    const recorded = row.knowledge, report = actual2 ? recorded : current;
    let evidence = actual2 ? row.inRequest === true ? "已在实际请求正文中确认" : row.inRequest === false ? "实际请求未包含完整模块正文" : "旧记录未提供逐模块发送证据" : recorded ? "本轮采集时入选 " + recorded.selectedCount + " 条" : "历史记录未保存条数，不能按行数推算";
    if (actual2 && row.included === false && !(row.notCaptured && typeof row.inRequest !== "boolean")) evidence = "当时未注入：" + (row.reason || "未选用");
    if (!report?.available) return '<p class="context-knowledge-note">' + esc(evidence) + (actual2 ? "" : "；当前组件未启用或尚未提供统计接口") + "。</p>";
    const expected = allowed ? report.selectedCount : 0;
    const pairs = [["库总量", report.total], ["已确认", report.confirmed], ["本会话适用", report.eligible], ["条数上限", report.limit], [actual2 ? "当时入选" : "当前预计", expected]];
    const reason = !allowed ? "O 层已关闭，本轮不发送本模块。" : report.limit === 0 ? "默认注入上限为0，仅保留按需查询。" : report.eligible === 0 ? "没有适用于此会话的已确认资料，不从其他会话补数。" : report.limited > 0 ? "有" + report.limited + "条适用资料因上限未入选。" : "";
    return '<div class="context-knowledge-stats">' + pairs.map(([title, count]) => "<span>" + esc(title) + " <strong>" + esc(count ?? "未知") + "</strong></span>").join("") + '</div><p class="context-knowledge-note">' + esc(evidence) + "。" + esc(reason) + '</p><p class="context-knowledge-note">筛除：未确认 ' + esc(report.total - report.confirmed) + " 条 · 确认但内容不完整 " + esc(report.unusable) + " 条 · 不适用当前会话 " + esc(report.outOfScope) + ' 条。<a href="#' + esc(report.page) + '">调整' + esc(report.name) + "来源与上限</a></p>" + (report.selected?.length ? '<details class="context-knowledge-selection"><summary>查看' + (actual2 ? "当时" : "当前策略") + "入选的 " + report.selected.length + " 条资料</summary><ul>" + report.selected.map((entry) => "<li><strong>" + esc(label(entry)) + "</strong><span>" + esc(value(entry)) + "</span></li>").join("") + "</ul></details>" : "");
  }
  function visualGroups(rows, catalog = []) {
    const ids = new Set(catalog.map((row) => row.id)), byId = new Map(rows.map((row) => [row.id, row]));
    const core = rows.filter((row) => ids.has(row.id));
    for (const slot of catalog) if (!byId.has(slot.id)) core.push({ ...slot, text: "", notCaptured: true, included: false, reason: "本轮未产出" });
    return { core: core.map((row, index) => ({ ...row, index })), extra: rows.filter((row) => !ids.has(row.id)) };
  }

  // console/layers/O/context-attribution.js
  function attributeText(text = "", modules = [], catalog = []) {
    const numbers = new Map(catalog.map((row, index) => [row.id, index + 1])), names2 = new Map(catalog.map((row) => [row.id, row.name])), patterns = /* @__PURE__ */ new Map();
    for (const row of modules) {
      if (row.notCaptured) continue;
      for (const part of row.parts?.length ? row.parts : [{ text: row.text }]) {
        const value2 = String(part.text || "").trim();
        if (!value2) continue;
        const id = row.id === "role-card" && part.id === "ctx-context-dynamics:expression" ? "ctx-context-dynamics" : row.id;
        const catalogName = names2.get(id);
        const owner = { id, name: catalogName && catalogName !== id ? catalogName : id !== row.id ? "心情与表情策略" : row.name || id, number: numbers.get(id), part: part.name, ...id !== row.id ? { evidence: "来源为心情组件；此段放入系统提示" } : {} };
        if (!patterns.has(value2)) patterns.set(value2, []);
        patterns.get(value2).push(owner);
      }
    }
    const candidates = [];
    for (const [value2, owners] of patterns) {
      let start = text.indexOf(value2);
      while (start !== -1) {
        candidates.push({ start, end: start + value2.length, owners });
        start = text.indexOf(value2, start + value2.length);
      }
    }
    candidates.sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start);
    const ranges = [];
    for (const row of candidates) if (!ranges.some((r) => row.start < r.end && row.end > r.start)) ranges.push(row);
    ranges.sort((a, b) => a.start - b.start);
    const segments = [];
    let cursor = 0;
    for (const row of ranges) {
      if (row.start > cursor) segments.push({ text: text.slice(cursor, row.start), owners: [] });
      segments.push({ text: text.slice(row.start, row.end), owners: row.owners });
      cursor = row.end;
    }
    if (cursor < text.length) segments.push({ text: text.slice(cursor), owners: [] });
    return segments;
  }
  function messageLabel(row) {
    if (row.role === "tool" || row.toolResults?.length) return "工具返回数据";
    if (row.toolCalls?.length) return "bot 发起的工具调用";
    if (row.role === "assistant") return "bot 生成的文字（QQ 投递未核验）";
    if (row.source === "compact-checkpoint") return "会话压缩摘要";
    if (row.source === "runtime-context") return "运行环境说明";
    if (row.source === "qq-context-dialogue") return "先前回合任务与 QQ 来信";
    if (row.source === "qq-context-current") return "先前回合背景快照";
    if (row.source === "qq-context-stable") return "稳定会话资料（user 前缀）";
    if (row.source === "qq-context-update") return "心情、日程与资料的状态更新";
    return { system: "系统设定与角色要求", developer: "系统补充说明", user: "会话输入记录" }[row.role] || row.name || row.id;
  }
  function partLabel(part) {
    if (part.id === "receipt-state" || part.name === "收件状态") return "收件处理进度（放入背景资料）";
    if (part.id === "new-messages" || part.name === "新增聊天原文") return "新增聊天原文（随本轮任务提供）";
    return (part.name || "组件内容") + (part.destination === "background" ? "（放入背景资料）" : part.destination === "task" ? "（随本轮任务提供）" : "");
  }
  function unmatchedLabel(message2 = {}) {
    if (message2.source === "qq-context-stable") return { tag: "稳定资料", title: "稳定会话资料与状态解释规则", description: "保存会话背景、会话协议及稳定规则；若此消息还包含早期聊天，聊天原文保留在资料之后。" };
    if (message2.source === "qq-context-update") return { tag: "动态更新", title: "组件状态更新与撤回说明", description: "组件有变化时才追加；同组件最后一条更新生效，早先状态仍保留在历史中。" };
    if (message2.role === "system") return { tag: "系统记录", title: "DSH 系统提示与框架规则", description: "提供运行身份、权限边界和系统约定；此段没有与组件采集原文完整匹配。" };
    if (message2.role === "tool" || message2.toolResults?.length) return { tag: "工具记录", title: "工具返回数据", description: "记录工具执行结果、查询数据或错误，供模型继续处理。" };
    if (message2.toolCalls?.length) return { tag: "工具记录", title: "bot 的工具调用与附带文字", description: "记录模型选择的工具、参数及同次生成的说明；调用 ID 用于配对返回结果。" };
    if (message2.role === "assistant") return { tag: "生成记录", title: "bot 生成文字", description: "保留模型的回复或内部处理文字；是否发送到 QQ 需要结合发送工具结果判断。" };
    if (message2.source === "compact-checkpoint") return { tag: "会话记录", title: "DSH 会话压缩摘要", description: "在压缩较早对话时生成，保留后续处理所需的聊天经过和任务线索。" };
    if (message2.source === "runtime-context") return { tag: "环境记录", title: "DSH 运行环境更新", description: "由运行时按需补充当前环境信息；具体状态以这条记录正文为准。" };
    if (message2.source === "tool-registry") return { tag: "工具记录", title: "DSH 工具注册变更", description: "在可用工具发生变化时补充注册信息；非文本内容的完整载荷未被本次预览采集。" };
    if (message2.source === "qq-context-dialogue") return { tag: "回合记录", title: "桥接回合说明与任务衔接", description: "说明本次唤醒原因、任务要求或回合衔接信息；能够验证的 QQ 来信会单独标为 C36。" };
    if (message2.source === "qq-context-current") return { tag: "背景记录", title: "桥接补充背景资料", description: "由桥接随本轮背景提供；此段与保存的组件原文未完整匹配，保留供核对。" };
    if (message2.role === "user" && message2.source === "user") return { tag: "会话记录", title: "会话输入记录（来源组件未记录）", description: "这是以 user 角色进入模型请求的文字；旧采集未说明它是聊天原文还是管理补充。" };
    return { tag: "上下文记录", title: "其他上下文记录（来源组件未记录）", description: "按实际请求原样保留；当前只知道消息角色与来源字段，无法确认具体触发机制。" };
  }
  function jsonEnd(text, start) {
    if (!["[", "{"].includes(text[start])) return -1;
    const stack = [];
    let quoted = false, escaped = false;
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (escaped) escaped = false;
        else if (c === "\\") escaped = true;
        else if (c === '"') quoted = false;
        continue;
      }
      if (c === '"') {
        quoted = true;
        continue;
      }
      if (c === "[" || c === "{") stack.push(c);
      else if (c === "]" || c === "}") {
        if (stack.pop() !== (c === "]" ? "[" : "{")) return -1;
        if (!stack.length) return i + 1;
      }
    }
    return -1;
  }
  var record = (value2) => value2 && typeof value2 === "object" && !Array.isArray(value2);
  var qqTime = (value2) => Number.isFinite(value2) || typeof value2 === "string" && /^(?:(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01]) )?(?:[01]\d|2[0-3]):[0-5]\d$/.test(value2);
  var qqRows = (value2) => Array.isArray(value2) && value2.every((row) => record(row) && (Number.isSafeInteger(row.seq) || (row.messageId !== void 0 || row.id !== void 0) && (row.userId !== void 0 || row.senderId !== void 0) || typeof row.sender === "string" && typeof row.text === "string" && qqTime(row.at)));
  function attributeMessage(message2 = {}, modules = [], catalog = []) {
    const text = String(message2.text || "");
    if (message2.role === "user" && message2.source === "qq-context-update" && message2.contextSegments?.length) {
      const out2 = [];
      let cursor2 = 0;
      for (const segment of message2.contextSegments) {
        if (!message2.contextUpdates?.some((update) => update.id === segment.id) || !segment.text) continue;
        const start = text.indexOf(segment.text, cursor2);
        if (start < 0) continue;
        out2.push(...attributeText(text.slice(cursor2, start), modules, catalog));
        const index = catalog.findIndex((slot) => slot.id === segment.id);
        const slotName = catalog[index]?.name, ownerName = slotName && slotName !== segment.id ? slotName : modules.find((row) => row.id === segment.id)?.name || segment.id;
        out2.push({ text: segment.text, owners: [{ id: segment.id, number: index < 0 ? void 0 : index + 1, name: ownerName, evidence: message2.effectiveComponents?.includes(segment.id) ? "本次请求的当前状态" : "历史状态更新" }] });
        cursor2 = start + segment.text.length;
      }
      out2.push(...attributeText(text.slice(cursor2), modules, catalog));
      return out2;
    }
    if (message2.source === "qq-context-stable" && message2.wrappedSource === "qq-context-dialogue") message2 = { ...message2, source: "qq-context-dialogue" };
    if (message2.role !== "user" || !["qq-context-dialogue", "qq-context-current"].includes(message2.source)) return attributeText(text, modules, catalog);
    const header = /(^|\n)(【(?:新增 QQ 消息数据|历史 QQ 消息数据|历史 QQ 消息数据；当轮规则已由当前 context 取代|QQ 收件状态)】)[ \t]*\r?\n/g;
    const ranges = [];
    let match;
    while (match = header.exec(text)) {
      const receipt = match[2] === "【QQ 收件状态】";
      if (receipt !== (message2.source === "qq-context-current")) continue;
      let start = header.lastIndex;
      while (/\s/.test(text[start] || "") && start < text.length) start++;
      const end = jsonEnd(text, start);
      if (end < 0) continue;
      let value2;
      try {
        value2 = JSON.parse(text.slice(start, end));
      } catch {
        continue;
      }
      const legacy = match[2].includes("当轮规则");
      if (receipt ? !(record(value2) && Array.isArray(value2.receipts) && Number.isFinite(value2.unreadCount)) : legacy ? !(record(value2) && qqRows(value2.messages)) : !qqRows(value2)) continue;
      const index = catalog.findIndex((row) => row.id === "message-snapshot"), slot = catalog[index];
      const part = receipt ? "收件状态" : legacy ? "历史来信与收件处理进度" : match[2] === "【历史 QQ 消息数据】" ? "历史聊天原文（保留对话经过）" : "聊天原文（随该回合任务提供）";
      ranges.push({ start: match.index + match[1].length, end, owner: { id: "message-snapshot", number: index < 0 ? 36 : index + 1, name: slot?.name || "本轮 QQ 消息与收件状态", part, evidence: "桥接来源标记与 JSON 结构已核对" } });
      header.lastIndex = end;
    }
    const out = [];
    let cursor = 0;
    for (const range of ranges) {
      out.push(...attributeText(text.slice(cursor, range.start), modules, catalog));
      out.push({ text: text.slice(range.start, range.end), owners: [range.owner] });
      cursor = range.end;
    }
    out.push(...attributeText(text.slice(cursor), modules, catalog));
    return out;
  }

  // console/layers/O/context-inspector.js
  var KIND_LABELS = { system: "系统提示", context: "补充资料", user: "用户输入", assistant: "bot 文字", call: "工具调用", result: "工具返回", definition: "工具定义", component: "组件来源" };
  var REGION_LABELS = { system: "系统规则", stable: "稳定资料", history: "聊天与工具记录", dynamic: "动态资料更新" };
  function requestEntries(request) {
    const callNames = new Map((request.messages || []).flatMap((row) => (row.toolCalls || []).map((call) => [call.id, call.name])));
    const latest = /* @__PURE__ */ new Map();
    for (const [index, row] of (request.messages || []).entries()) for (const update of row.contextUpdates || []) latest.set(update.id, index);
    return (request.messages || []).map((row, index) => {
      const kind = row.toolCalls?.length ? "call" : row.role === "tool" || row.toolResults?.length ? "result" : row.role === "system" ? "system" : row.role === "assistant" ? "assistant" : row.role === "developer" || !["user", void 0, "DSH 会话历史"].includes(row.source) ? "context" : "user";
      const current = !!request.nonce && request.nonce === row.contextNonce;
      const toolNames = kind === "call" ? (row.toolCalls || []).map((c) => c.name) : kind === "result" ? (row.toolResults || []).map((c) => c.name || callNames.get(c.toolCallId) || c.toolCallId) : [];
      const name = toolNames.length ? toolNames.filter(Boolean).join("、") : current && row.source === "qq-context-current" ? "本轮背景快照" : current && row.source === "qq-context-dialogue" ? "本轮任务与新增 QQ 来信" : messageLabel(row);
      const region = row.role === "system" ? "system" : row.source === "qq-context-stable" ? "stable" : row.source === "qq-context-update" ? "dynamic" : "history";
      const effectiveComponents = (row.contextUpdates || []).filter((u) => latest.get(u.id) === index).map((u) => u.id);
      const withdrawnComponents = (row.contextUpdates || []).filter((u) => latest.get(u.id) === index && u.hash === null).map((u) => u.id);
      const stateLabel = region === "dynamic" ? effectiveComponents.length ? "当前有效 " + effectiveComponents.length + " 项" + (withdrawnComponents.length ? " · 含撤回" : "") : "历史状态，已有后续更新" : "";
      return { ...row, key: "message:" + index, position: index + 1, kind, name: region === "dynamic" ? "动态资料更新（" + (effectiveComponents.length ? "当前有效" : "历史") + "）" : name, region, effectiveComponents, withdrawnComponents, stateLabel };
    });
  }
  function filterEntries(rows, { query = "", kind = "", region = "" } = {}) {
    const needle = query.trim().toLocaleLowerCase();
    return rows.filter((row) => (!region || row.region === region) && (!kind || row.kind === kind) && (!needle || [row.name, row.id, row.text, row.source, row.componentNumber ? "C" + String(row.componentNumber).padStart(2, "0") : "", JSON.stringify(row.toolCalls || []), JSON.stringify(row.toolResults || [])].join(" ").toLocaleLowerCase().includes(needle))).map((row, index) => ({ ...row, listNumber: index + 1 }));
  }
  function componentAvailability(row) {
    if (row.relatedStyleText) return "当前心情、形态与风格已放入系统提示";
    if (row.notCaptured) return "本次未采集该组件";
    if (row.included === false || !row.text?.trim()) return "本次未提供正文";
    if (row.inRequest === true) return "本次请求已携带";
    if (row.inRequest === false) return "正文未在请求中完整确认";
    return "有采集正文，实发证据未记录";
  }
  var dynamicSources = [["ctx-context-dynamics", "05 · 心情"], ["ctx-memory-context", "12 · 记忆与临时画像"], ["life-schedule-reminder", "25 · 日程"]];
  var badge = (kind) => '<span class="context-kind context-kind-' + kind + '">' + esc(KIND_LABELS[kind] || kind) + "</span>";
  var listName = (row) => ["call", "result", "definition"].includes(row.kind) ? String(row.name || row.id).split("、").map((name) => name.startsWith("mcp__") ? name.split("__").at(-1) : name).join("、") : row.name || row.id;
  function inspectorHtml(request, catalog, state, { renderText, renderComponent }) {
    const messages = requestEntries(request), tools = (request.tools || []).map((row, index) => ({ ...row, key: "tool:" + index, position: index + 1, kind: "definition", name: row.name || "未命名工具", text: JSON.stringify(row, null, 2) }));
    const modules = new Map((request.modules || []).map((row) => [row.id, row]));
    const moodStyle = modules.get("role-card")?.parts?.find((part) => part.id === "ctx-context-dynamics:expression");
    const confirmedStyle = moodStyle?.text?.trim() && (request.messages || []).some((m) => m.text?.includes(moodStyle.text.trim())) ? moodStyle.text : "";
    const components = catalog.map((slot, index) => ({ ...slot, ...modules.get(slot.id), ...slot.id === "ctx-context-dynamics" && confirmedStyle ? { relatedStyleText: confirmedStyle } : {}, notCaptured: !modules.has(slot.id) || modules.get(slot.id)?.notCaptured === true, key: "component:" + slot.id, position: index + 1, componentNumber: index + 1, kind: "component", name: slot.name && slot.name !== slot.id ? slot.name : modules.get(slot.id)?.name || slot.id }));
    const extras = (request.modules || []).filter((row) => !catalog.some((slot) => slot.id === row.id)).map((row, index) => ({ ...row, key: "extra:" + row.id, position: catalog.length + index + 1, kind: "component" }));
    const all = state.view === "tools" ? tools : state.view === "components" ? [...components, ...extras] : messages;
    const rows = filterEntries(all, { query: state.query, kind: state.view === "messages" ? state.kind : "", region: state.view === "messages" ? state.region : "" });
    const selected2 = rows.find((row) => row.key === state.selected) || rows.find((row) => row.source === "qq-context-current" && row.contextNonce === request.nonce) || rows[0];
    const nav = [["messages", "消息序列", messages.length], ["tools", "工具列表", tools.length], ["components", "组件来源", components.length + (extras.length ? " + " + extras.length : "")]];
    const navHtml = '<div class="context-inspector-nav" role="group" aria-label="请求查看内容">' + nav.map(([id, name, count]) => '<button type="button" data-inspector-view="' + id + '" aria-pressed="' + (state.view === id) + '">' + name + " <span>" + count + "</span></button>").join("") + "</div>";
    const shortcuts = '<div class="context-source-shortcuts"><span>动态资料定位</span>' + dynamicSources.filter(([id]) => catalog.some((row) => row.id === id)).map(([id, label2]) => '<button type="button" data-inspector-component="' + id + '">' + label2 + "</button>").join("") + "</div>";
    const mapping = state.view === "components" ? '<label class="context-component-lookup">按组件名称定位到固定编号<select id="contextComponentLookup"><option value="">选择组件…</option>' + components.map((row) => '<option value="' + esc(row.id) + '"' + (selected2?.id === row.id ? " selected" : "") + ">" + String(row.componentNumber).padStart(2, "0") + " ｜ " + esc(row.name) + "</option>").join("") + "</select></label>" : "";
    const controls = '<div class="context-inspector-controls"><label class="context-search"><span>搜索' + (state.view === "messages" ? "本次请求" : state.view === "tools" ? "工具" : "组件") + '</span><input id="contextInspectorSearch" type="search" value="' + esc(state.query) + '" placeholder="名称、正文或调用 ID"></label>' + (state.view === "messages" ? '<label><span>类型</span><select id="contextInspectorKind"><option value="">全部类型</option>' + Object.entries(KIND_LABELS).filter(([kind]) => !["definition", "component"].includes(kind)).map(([kind, label2]) => '<option value="' + kind + '"' + (state.kind === kind ? " selected" : "") + ">" + label2 + "</option>").join("") + "</select></label>" : "") + "</div>";
    const list = '<div class="context-sequence" role="group" aria-label="' + (state.view === "messages" ? "按请求顺序排列的消息" : state.view === "tools" ? "本次请求的工具定义" : "39 个组件及附加规则") + '"><div class="context-sequence-caption">' + (state.view === "messages" ? "按模型收到的顺序" : state.view === "tools" ? "实际 tools 字段" : "固定组件目录") + " <span>" + rows.length + " 项</span></div>" + rows.map((row) => '<button type="button" class="context-sequence-row" data-inspector-select="' + esc(row.key) + '" data-request-position="' + row.position + '" aria-pressed="' + (row.key === selected2?.key) + '"><span class="context-sequence-number">' + String(row.listNumber).padStart(3, "0") + '</span><span class="context-sequence-main">' + badge(row.kind) + (row.componentNumber ? '<span class="context-component-code">组件 ' + String(row.componentNumber).padStart(2, "0") + "</span>" : row.role ? '<span class="context-protocol-role">' + esc(row.role) + "</span>" : "") + '<strong title="' + esc(row.name || row.id) + '">' + esc(listName(row)) + '</strong><span class="context-sequence-preview">' + esc((row.text || "本轮无采集正文").replace(/\s+/g, " ").slice(0, 100)) + '</span></span><span class="context-sequence-size">' + (row.text?.length || 0).toLocaleString() + "</span></button>").join("") + (rows.length ? "" : '<p class="context-empty">没有匹配项，试试其他关键词或类型。</p>') + "</div>";
    let detail = '<p class="context-empty">没有可查看的记录。</p>';
    if (selected2) {
      const calls = [...(selected2.toolCalls || []).map((c) => "<div><dt>调用工具</dt><dd>" + esc(c.name) + " · " + esc(c.id) + "</dd></div>"), ...(selected2.toolResults || []).map((c) => "<div><dt>对应调用</dt><dd>" + esc(c.name || "") + " · " + esc(c.toolCallId) + "</dd></div>")].join("");
      detail = '<header class="context-detail-heading">' + badge(selected2.kind) + "<h3>" + esc(selected2.name || selected2.id) + "</h3><p>" + (selected2.kind === "component" ? selected2.componentNumber ? "组件 C" + String(selected2.componentNumber).padStart(2, "0") : "附加规则" : selected2.kind === "definition" ? "本次请求的工具定义" : "请求位置 " + selected2.position + " / " + messages.length) + " · " + (selected2.text?.length || 0).toLocaleString() + " 个文本字符</p></header>";
      if (selected2.kind === "component") {
        const locations = messages.filter((message2) => message2.effectiveComponents.includes(selected2.id));
        if (locations.length) detail += '<p class="context-detail-note">当前状态位置：' + locations.map((message2) => '<button type="button" data-inspector-message="' + esc(message2.key) + '">消息 ' + message2.position + (message2.withdrawnComponents.includes(selected2.id) ? " · 已撤回" : " · 当前有效") + "</button>").join(" ") + "</p>";
        const related = selected2.id === "ctx-context-dynamics" ? modules.get("role-card")?.parts?.find((p) => p.id === "ctx-context-dynamics:expression") : null;
        detail += '<p class="context-detail-note">' + esc(componentAvailability(selected2)) + "。" + (!selected2.relatedStyleText && selected2.included === false && selected2.reason ? "记录原因：" + esc(selected2.reason) + "。" : "") + "这是所选请求当时的快照。</p>";
        if (related?.text && selected2.relatedStyleText) detail += '<div class="context-text-frame context-tone-4"><div class="context-frame-label"><strong>05 · 系统提示中的当前心情、形态与风格</strong></div><pre>' + esc(selected2.relatedStyleText) + '</pre></div><p class="context-detail-note"><button type="button" data-inspector-component="role-card">定位到 01 · 系统提示中的放置位置</button></p>';
        if (!selected2.text?.trim() && ["memoryWrite", "selfReview", "selfOptimize", "userFeedbackReview", "slangLearn"].includes(request.scene) && ["ctx-context-dynamics", "life-schedule-reminder"].includes(selected2.id)) detail += '<p class="context-detail-note">这次是后台整理任务，心情和日程组件按场景跳过。</p>';
        if (!selected2.relatedStyleText || selected2.text?.trim()) detail += renderComponent(selected2);
      } else detail += '<dl class="context-detail-fields"><div><dt>消息角色</dt><dd>' + esc(selected2.role || "未记录") + "</dd></div><div><dt>来源</dt><dd>" + esc(selected2.source || (selected2.kind === "definition" ? "tools 字段" : "未记录")) + "</dd></div>" + calls + "</dl>" + (selected2.kind === "definition" ? '<pre class="context-tool-schema">' + esc(selected2.text) + "</pre>" : '<div class="context-detail-text">' + renderText(selected2.text || "", request.modules || [], catalog, selected2) + "</div>");
      if (selected2.source === "qq-context-current") detail += '<p class="context-detail-note">这是旧版按桥接批次提供的背景快照；不会按新版规则改写这份历史证据。</p>';
      if (selected2.region === "stable") detail += '<p class="context-detail-note">稳定资料以 user 角色提供，独立于系统硬规则；首次放入消息前部，内容变化时才更新。</p>';
      if (selected2.region === "dynamic") detail += '<p class="context-detail-note">' + esc(selected2.stateLabel) + "。" + (selected2.effectiveComponents.length ? "本条仍有效的组件：" + selected2.effectiveComponents.map(esc).join("、") + "。" : "") + "同组件以最后一次更新为准；旧状态保留在历史原位置，不代表现在仍是这个值。</p>";
      if (selected2.kind === "assistant") detail += '<p class="context-detail-note">这是模型生成记录，不能据此认定已发送到 QQ。</p>';
      if (selected2.kind !== "component" && selected2.kind !== "definition") detail += '<p class="context-detail-note">C 编号对应 39 个组件。其他内容在原位置说明记录类型与用途；历史来信仅在桥接来源和数据结构均可核对时标为 C36。</p>';
    }
    const toolsNote = state.view === "tools" ? '<p class="context-tools-note">工具定义来自所选请求独立的 tools 字段，与系统提示、messages 消息列表并列。这里的分区位置不表示模型内部的编码顺序。</p>' : "";
    const regions = '<div class="context-layout-map" role="group" aria-label="请求结构筛选"><button type="button" data-inspector-region="" aria-pressed="' + (!state.region && state.view === "messages") + '"><strong>完整顺序</strong><span>' + messages.length + " 条消息</span></button>" + Object.entries(REGION_LABELS).map(([id, label2]) => '<button type="button" data-inspector-region="' + id + '" aria-pressed="' + (state.region === id && state.view === "messages") + '"><strong>' + label2 + "</strong><span>" + messages.filter((row) => row.region === id).length + " 条</span></button>").join("") + '<button type="button" data-inspector-region="tools"><strong>工具定义</strong><span>' + tools.length + " 个 · 独立字段</span></button></div>";
    const refresh3 = request.layoutVersion === 2 ? '<p class="context-refresh-note">逐请求刷新：' + esc(request.contextRefresh?.status === "fresh" ? "已读取最新组件资料" : request.contextRefresh?.status === "stale" ? "刷新未成功，沿用上次可靠资料" : "尚无刷新证据") + "。状态改变才追加更新，原始记录与工具配对保留。</p>" : '<p class="context-refresh-note">旧版请求记录：按当时实际内容展示，不能据此判断新版装填已生效。</p>';
    return regions + refresh3 + navHtml + shortcuts + mapping + toolsNote + controls + '<div class="context-inspector-split">' + list + '<section class="context-detail" aria-label="选中项详情" data-inspector-detail="' + esc(selected2?.key || "") + '">' + detail + "</section></div>";
  }

  // console/layers/O/context-request-stages.js
  function identity(row) {
    if (row.requestId) return "id:" + row.requestId;
    return "legacy:" + JSON.stringify([row.sessionId, row.nonce, row.at, row.turn, row.step, row.requestInRound, row.messages, row.tools, row.modules]);
  }
  var ordinal = (row) => Number.isSafeInteger(row.requestInRound) && row.requestInRound > 0 ? "第 " + row.requestInRound + " 次模型调用" : "模型调用序号未记录";
  function requestStageOptions(stages = []) {
    const groups = /* @__PURE__ */ new Map();
    for (const stage of stages) {
      if (!stage.request) continue;
      const key2 = identity(stage.request);
      if (!groups.has(key2)) groups.set(key2, { request: stage.request, aliases: [] });
      groups.get(key2).aliases.push(stage.kind);
    }
    return [...groups.values()].map((group) => {
      const { request, aliases } = group, latest = aliases.includes("current"), first = aliases.includes("initial"), previous = aliases.includes("previous");
      const kind = latest ? "current" : first ? "initial" : "previous";
      const title = latest ? first ? "最新记录（也是首次）" : "最新记录" : first ? previous ? "首次记录（也是上一次）" : "首次记录" : "上一次记录";
      const time3 = Number.isFinite(request.at) ? new Date(request.at).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }) : "时间未记录";
      return { ...group, kind, title, label: ordinal(request) + " · " + title + " · " + time3 };
    });
  }
  function requestStageSummary(row) {
    if (!row) return "尚未采集到模型调用记录。";
    return (row.processingId ? "本次持续处理" : "旧采集批次") + "：" + ordinal(row) + " · 携带 " + (row.messages?.length || 0) + " 条消息记录（含历史） · " + (row.toolCount ?? row.tools?.length ?? 0) + " 个可用工具";
  }

  // console/shared/page-loaders.js
  var loaders = /* @__PURE__ */ new Map();
  function registerPageLoader(page, loader) {
    loaders.set(page, loader);
  }
  function loadPageData(page) {
    return loaders.get(page)?.();
  }

  // console/layers/O/context-visual.js
  var saved;
  var draft;
  var data;
  var actual = true;
  var dragged = "";
  var revision = 0;
  var loading = false;
  var selectedRequestId = "";
  var inspectedRequest;
  var inspectorState = { view: "messages", selected: "", query: "", kind: "", region: "" };
  var $ = (id) => document.getElementById(id);
  var copy = (x) => JSON.parse(JSON.stringify(x));
  var notice = (text) => {
    $("contextNotice").textContent = text;
  };
  var changed = () => JSON.stringify(saved) !== JSON.stringify(draft);
  var sceneNames = { message: "用户来信", probability: "普通消息按概率触发唤醒", atMention: "有人 @ bot", nameMention: "有人叫 bot 的名字", bootstrap: "会话首次唤醒", timeBubble: "定时冒泡", careCheck: "主动关心", proactiveCheck: "静默后主动开口", idleRescue: "长时间静默后主动开口", reminder: "日程提醒", scheduledContact: "约定时间联系", newsShare: "每日视频推荐", replyCheck: "检查是否需要回复", budgetRecovery: "预算恢复后补发", selfReview: "自查", selfOptimize: "自我优化", slangLearn: "黑话学习", memoryWrite: "整理记忆", memoryUpdate: "更新记忆" };
  var sceneName = (value2) => sceneNames[String(value2 || "").split(/[:@]/)[0]] || value2 || "未记录原因";
  var reasonText = (value2) => ({ "O 层屏蔽": "已在本页关闭，本轮不发送", "本轮未产出": "组件本轮没有提供内容", "本场景无需演练": "本轮未触发演练，不发送这部分" })[value2] || value2;
  var sourceText = (value2) => ({ "qq-context-current": "本轮整理后的背景信息", "qq-context-dialogue": "聊天内容与本轮任务", "runtime-context": "DSH 运行环境说明", "system-prompt": "系统设定与角色要求" })[value2] || value2;
  var metric = (label2, value2) => '<div class="context-stat"><span>' + esc(label2) + "</span><strong>" + esc(value2) + "</strong></div>";
  function framedText(text, modules, catalog, message2 = {}) {
    const fallback = unmatchedLabel(message2);
    return attributeMessage({ ...message2, text }, modules, catalog).map((segment) => {
      if (!segment.text.trim()) return '<pre class="context-text-gap" aria-hidden="true">' + esc(segment.text) + "</pre>";
      const owner = segment.owners[0], tone = owner?.number ? (owner.number - 1) % 5 : 0;
      const labels2 = owner ? segment.owners.map((o) => '<span class="context-pill">' + esc(o.number ? "组件 C" + String(o.number).padStart(2, "0") : "附加规则") + "</span><strong>" + esc(o.name) + (o.part ? " · " + esc(partLabel({ name: o.part })) : "") + "</strong>" + (o.evidence ? '<span class="context-frame-evidence">' + esc(o.evidence) + "</span>" : "")).join("<span> / </span>") : '<span class="context-pill">' + esc(fallback.tag) + "</span><strong>" + esc(fallback.title) + "</strong>";
      return '<div class="context-text-frame' + (owner ? " context-tone-" + tone : " is-unattributed") + '"' + (owner ? ' data-context-owner="' + esc(owner.id) + '"' : "") + '><div class="context-frame-label">' + labels2 + "</div>" + (!owner ? '<p class="context-knowledge-note">' + esc(fallback.description) + "</p>" : "") + "<pre>" + esc(segment.text) + "</pre></div>";
    }).join("");
  }
  function render() {
    if (!data) return;
    $("contextSave").disabled = !draft || !changed();
    $("contextReset").disabled = !draft || !changed();
    $("contextSave").hidden = actual;
    $("contextReset").hidden = actual;
    $("contextConsole").querySelector(".context-options").hidden = actual;
    $("contextConsole").querySelector(".context-help").hidden = actual;
    $("contextConsole").querySelector(".context-scope-badge").textContent = actual ? "真实请求 · 只读查看" : "全局设置 · 按会话预览";
    $("contextCompactHistory").checked = draft?.compactHistory !== false;
    $("contextDraftTab").setAttribute("aria-pressed", String(!actual));
    $("contextActualTab").setAttribute("aria-pressed", String(actual));
    const stages = data.requestStages || data.request?.requestStages || [{ kind: "initial", label: "本轮初始请求", request: null }, { kind: "previous", label: "上一次请求", request: null }, { kind: "current", label: "当前请求（旧记录）", request: data.request }];
    const options = requestStageOptions(stages), selected2 = options.find((option) => option.aliases.includes(selectedRequestId)) || options.find((option) => option.kind === "current") || options.at(-1);
    selectedRequestId = selected2?.kind || "";
    const request = selected2?.request, preview = data.preview;
    $("contextRequestPicker").hidden = !actual;
    $("contextRequestDiff").hidden = !actual;
    $("contextRequestSelect").replaceChildren(...options.length ? options.map((option) => new Option(option.label, option.kind)) : [new Option("尚无模型调用记录", "")]);
    $("contextRequestSelect").value = selectedRequestId;
    $("contextRequestSelect").disabled = !options.length;
    $("contextRequestSummary").textContent = requestStageSummary(request);
    const olderKind = selectedRequestId === "current" ? "previous" : "initial", older = selected2?.aliases.includes(olderKind) ? void 0 : stages.find((stage) => stage.kind === olderKind)?.request;
    const delta = selected2?.aliases.includes("initial") ? null : compareRequests(older, request), join = (items2) => items2.length ? items2.map((item) => esc(item.name || item)).join("、") : "无";
    $("contextRequestDiff").innerHTML = delta ? "<strong>" + (selectedRequestId === "current" ? "最新调用与上一次调用比较" : "上一次调用与首次调用比较") + "</strong><p>工具新增：" + join(delta.toolsAdded) + "；移除：" + join(delta.toolsRemoved) + "；用途或参数说明变化：" + join(delta.toolsChanged) + "</p><p>模块变化：" + join(delta.modulesChanged) + "；消息字符变化 " + (delta.messageCharsDelta >= 0 ? "+" : "") + delta.messageCharsDelta + "；工具说明字符变化 " + (delta.toolCharsDelta >= 0 ? "+" : "") + delta.toolCharsDelta + "</p>" : selected2?.aliases.includes("initial") ? "这是本次处理的首次模型调用，保留作比较基线；相同请求已合并展示。" : "上一次调用尚未采集，无法比较；缺失记录不补造。";
    if (request && Number.isSafeInteger(request.turn)) $("contextRequestDiff").innerHTML += '<p class="meta">日志定位：DSH 内部回合 ' + esc(request.turn) + (Number.isSafeInteger(request.step) ? " / 步骤 " + esc(request.step) : "") + "。这是内部处理编号，与消息条数、工具调用次数分别计数。</p>";
    $("contextRequestDiff").innerHTML = "<summary>查看本次请求的变化</summary><div>" + $("contextRequestDiff").innerHTML + "</div>";
    if (actual && data.capture?.nonce && request?.nonce && data.capture.nonce !== request.nonce) notice("这份请求使用的是另一批背景快照。下方按该次实际请求自己的组件记录展示。");
    if (actual) {
      if (!request) {
        $("contextMetrics").textContent = "还没有记录到这个会话实际发给 AI 的内容。等下一次正常聊天或定时冒泡后再刷新；查看这里不会调用 AI。";
        $("contextModules").replaceChildren();
        return;
      }
      $("contextMetrics").innerHTML = metric("实际请求记录时间", new Date(request.at).toLocaleString()) + metric("消息数据 · 含历史", request.messageChars + " 字符") + metric("工具清单", request.toolCount + " 个 / " + request.toolChars + " 字符");
      inspectedRequest = request;
      $("contextModules").innerHTML = '<p class="context-section-note">下方是本次请求携带的完整消息记录（含历史）。消息角色按 system / user / assistant / tool 标注，彩色标签说明内容用途。</p><div id="contextInspector" class="context-inspector"></div>';
      renderInspector();
      return;
    }
    if (!preview) {
      $("contextMetrics").textContent = "这个会话还没有可预览的记录。下一次正常聊天或定时冒泡后会自动记录，再点“刷新已有记录”查看。";
      $("contextModules").replaceChildren();
      return;
    }
    $("contextMetrics").innerHTML = metric("采集场景", sceneName(data.capture.scene)) + metric("全部组件原文", preview.beforeChars + " 字符") + metric("当前设置保留", preview.afterChars + " 字符 / 约 " + Math.ceil(preview.afterChars / 2) + " token") + '<p class="context-metrics-note">采集于 ' + esc(new Date(data.capture.at).toLocaleString()) + " · 资料统计按当前策略，正文保留采集时内容。</p>";
    const groups = visualGroups(preview.modules, data.catalog || preview.modules);
    $("contextModules").innerHTML = section("modules", "模块（" + groups.core.length + "个，空模块保留位置）", groups.core.map((m) => card(m, true)).join("")) + (groups.extra.length ? section("rules", "其他附加规则", groups.extra.map((m) => card({ ...m, index: void 0 }, true)).join("")) : "");
  }
  function renderInspector({ keepPosition = false, keepSearch = false } = {}) {
    const host = $("contextInspector");
    if (!host || !inspectedRequest) return;
    const scroll = keepPosition ? host.querySelector(".context-sequence")?.scrollTop : void 0;
    const cursor = keepSearch ? $("contextInspectorSearch")?.selectionStart : null;
    host.innerHTML = inspectorHtml(inspectedRequest, data.catalog || [], inspectorState, { renderText: framedText, renderComponent: (row) => card({ ...row, index: void 0, protected: true }, false) });
    const list = host.querySelector(".context-sequence"), active = list?.querySelector('[aria-pressed="true"]');
    if (scroll !== void 0) list.scrollTop = scroll;
    else if (active) list.scrollTop = Math.max(0, active.offsetTop - list.offsetTop - list.clientHeight / 3);
    if (keepSearch) {
      const input = $("contextInspectorSearch");
      input.focus();
      if (input.type !== "search" && cursor !== null) input.setSelectionRange(cursor, cursor);
    }
  }
  function section(id, title, body, folded = false) {
    return folded ? '<details class="context-section" data-context-group="' + id + '"><summary>' + esc(title) + "</summary>" + body + "</details>" : '<section class="context-section" data-context-group="' + id + '"><h3 class="context-section-title">' + esc(title) + "</h3>" + body + "</section>";
  }
  function card(m, editable) {
    const delivery = !editable ? m.notCaptured && typeof m.inRequest !== "boolean" ? "未采集，不能判定实发" : m.included === false ? "未注入：" + reasonText(m.reason) : m.inRequest === true ? "已在实际请求正文中确认" : m.inRequest === false ? "实际请求未完整包含此模块" : "旧记录没有逐模块实发证据" : m.truncated ? "内容超过组件上限，已截断" : "";
    const locked = m.protected || !editable, title = (editable ? data.knowledge?.[m.id]?.name : null) || m.name || m.id, tag = m.placement === "fixed" ? "系统设定与角色要求" : m.placement === "stable" ? "稳定会话资料（user 前缀）" : m.id === "wake-action" ? "任务说明（随本轮任务提供）" : m.id === "message-snapshot" ? "收件处理进度与聊天原文" : "动态资料（变化时更新）", placeholder = !m.text?.trim();
    const request = data.requestStages?.find((s) => s.kind === selectedRequestId)?.request || data.request;
    const annotated = !editable && (String(m.id).startsWith("actual-") && m.id !== "actual-tools" || m.requestIndex !== void 0);
    const content = annotated ? '<div class="context-framed-content">' + framedText(m.text || "", request?.modules || [], data.catalog || []) + "</div>" : "<pre>" + esc(m.text || "（这部分没有文字内容）") + "</pre>";
    const tone = Number.isInteger(m.index) ? " context-tone-" + m.index % 5 : "";
    return '<article class="context-module' + tone + (placeholder ? " is-placeholder" : m.included === false ? " is-excluded" : "") + '" data-context-id="' + esc(m.id) + '"><div class="context-module-head">' + (editable ? '<button type="button" class="context-drag" draggable="true" data-context-move="drag" aria-label="拖动 ' + esc(title) + '">⠿</button>' : "") + "<h3>" + (Number.isInteger(m.index) ? '<span class="context-number">' + esc(m.index + 1) + ".</span> " : m.requestIndex ? '<span class="context-number">#' + esc(m.requestIndex) + "</span> " : "") + esc(title) + "</h3>" + (editable ? '<label title="' + (locked ? "身份、权限和任务等必要内容不能在这里关闭" : "勾选表示允许把这部分内容发给 AI；保存后适用于所有会话") + '"><input type="checkbox" data-context-toggle="' + esc(m.id) + '" ' + (!draft.disabled.includes(m.id) || locked ? "checked " : "") + (locked ? "disabled " : "") + ">" + (locked ? "必要内容，不能关闭" : "允许发给 AI") + '</label><button type="button" data-context-move="up" aria-label="上移 ' + esc(title) + '">↑</button><button type="button" data-context-move="down" aria-label="下移 ' + esc(title) + '">↓</button>' : "") + '</div><div class="context-source"><span class="context-pill">' + esc(sourceText(m.source) || m.layer || "系统") + "</span>" + (editable ? '<span class="context-pill">' + esc(tag) + "</span>" : "") + "<span>" + esc(m.chars ?? m.text?.length ?? 0) + " 字符</span>" + (delivery ? '<span class="context-delivery">' + esc(delivery) + "</span>" : "") + (!placeholder && m.reason ? "<span>" + esc(reasonText(m.reason)) + "</span>" : "") + "</div>" + (m.toolCalls?.length || m.toolResults?.length ? '<p class="context-knowledge-note">' + (m.toolCalls || []).map((c) => "具体调用：" + esc(c.name) + " · 调用ID " + esc(c.id)).join("；") + (m.toolResults || []).map((c) => "返回对应调用ID：" + esc(c.toolCallId)).join("；") + "</p>" : "") + (m.references ? '<details class="context-references"><summary>查看组件来源清单' + (m.attributionVerified === false ? " · 缺少同轮标记" : "") + "</summary><ul>" + m.references.map((ref) => "<li>" + esc(ref) + "</li>").join("") + "</ul></details>" : "") + knowledgePanel(m, data.knowledge?.[m.id], { actual: !editable, allowed: editable ? !(draft?.enabled !== false && draft.disabled.includes(m.id)) : m.included !== false }) + (m.id === "message-snapshot" && m.parts?.length ? '<p class="context-knowledge-note">两部分共用开关；新增来信按消息序号去重。</p>' + m.parts.map((part) => "<details><summary>" + esc(partLabel(part)) + "</summary><pre>" + esc(part.text || "本轮无新增正文") + "</pre></details>").join("") : placeholder ? '<p class="context-placeholder">本轮暂无内容，位置保留。</p>' : '<details class="context-content"' + (annotated && m.requestIndex === void 0 ? " open" : "") + "><summary>" + (editable ? "查看组件原文" : annotated ? "查看按组件标注的原文" : "查看原文") + "</summary>" + content + "</details>") + "</article>";
  }
  async function refresh(keepDraft = false) {
    const ticket = ++revision;
    loading = true;
    try {
      const key2 = $("contextSession").value;
      const response = await api("/api/context/preview" + (key2 ? "?key=" + encodeURIComponent(key2) : ""));
      if (response.ok === false) throw Error(response.error);
      if (ticket !== revision) return;
      data = response;
      if (!keepDraft || !draft) {
        saved = copy(response.policy);
        draft = copy(saved);
      }
      const selected2 = key2;
      $("contextSession").replaceChildren(new Option("选择要查看的私聊或群聊…", ""), ...(response.sessions || []).map((s) => new Option(s.key, s.key)));
      $("contextSession").value = selected2;
      if (!selected2 && response.sessions?.length) {
        $("contextSession").value = response.sessions[0].key;
        loading = false;
        await refresh(true);
        return;
      }
      notice(changed() ? "有未保存的修改；保存后将用于所有私聊和群聊。" : !response.capture ? "还没有可查看的记录。" : response.capture.active ? "已采集上下文。实际请求只读查看，组件设置需单独保存。" : "采集这条记录时，新版整理功能尚未启用，bot 当时仍按原方式发送。");
      if (keepDraft && changed()) {
        loading = false;
        await project();
        return;
      }
      render();
    } catch (error) {
      notice("读取失败：" + error.message);
    } finally {
      if (ticket === revision) loading = false;
    }
  }
  async function project() {
    const ticket = ++revision;
    try {
      const response = await api("/api/context/preview", "POST", { key: $("contextSession").value, draft });
      if (response.ok === false) throw Error(response.error);
      if (ticket !== revision) return;
      data = response;
      notice(changed() ? "预览已更新，但还没有保存；bot 暂时继续使用原设置。" : "当前预览与上次保存的设置一致。");
      render();
    } catch (error) {
      notice("无法更新预览：" + error.message);
    }
  }
  function move(id, target) {
    if (!data?.preview || actual) return;
    const rows = [...data.preview.modules], from = rows.findIndex((x) => x.id === id), to = rows.findIndex((x) => x.id === target);
    if (from < 0 || to < 0 || from === to) return;
    if (rows[from].placement !== rows[to].placement) {
      notice("请在同一装填层内调序：系统规则、稳定资料、动态资料各有固定位置。");
      return;
    }
    const [item] = rows.splice(from, 1);
    rows.splice(to, 0, item);
    draft.order = rows.map((x) => x.id);
    void project();
  }
  function initialize3() {
    $("contextRefresh").addEventListener("click", () => refresh(true));
    $("contextSession").addEventListener("change", () => refresh(true));
    $("contextDraftTab").addEventListener("click", () => {
      actual = false;
      render();
    });
    $("contextActualTab").addEventListener("click", () => {
      actual = true;
      render();
    });
    $("contextRequestSelect").addEventListener("change", (event) => {
      selectedRequestId = event.target.value;
      inspectorState.selected = "";
      render();
    });
    $("contextReset").addEventListener("click", () => {
      draft = copy(saved);
      void project();
    });
    $("contextCompactHistory").addEventListener("change", (event) => {
      draft.compactHistory = event.target.checked;
      void project();
    });
    $("contextModules").addEventListener("change", (event) => {
      const id = event.target.dataset.contextToggle;
      if (!id || !draft) return;
      draft.disabled = draft.disabled.filter((x) => x !== id);
      if (!event.target.checked) draft.disabled.push(id);
      void project();
    });
    $("contextModules").addEventListener("input", (event) => {
      if (event.target.id !== "contextInspectorSearch") return;
      inspectorState.query = event.target.value;
      renderInspector({ keepSearch: true });
    });
    $("contextModules").addEventListener("change", (event) => {
      if (event.target.id !== "contextInspectorKind") return;
      inspectorState.kind = event.target.value;
      renderInspector();
    });
    const locateComponent = (id) => {
      inspectorState.view = "components";
      inspectorState.selected = "component:" + id;
      inspectorState.query = "";
      renderInspector();
    };
    $("contextModules").addEventListener("change", (event) => {
      if (event.target.id === "contextComponentLookup" && event.target.value) locateComponent(event.target.value);
    });
    $("contextModules").addEventListener("click", (event) => {
      const button = event.target.closest("[data-inspector-component]");
      if (button) locateComponent(button.dataset.inspectorComponent);
    });
    $("contextModules").addEventListener("click", (event) => {
      const button = event.target.closest("[data-inspector-message]");
      if (button) {
        inspectorState.view = "messages";
        inspectorState.region = "";
        inspectorState.query = "";
        inspectorState.kind = "";
        inspectorState.selected = button.dataset.inspectorMessage;
        renderInspector();
      }
    });
    $("contextModules").addEventListener("click", (event) => {
      const region = event.target.closest("[data-inspector-region]"), view = event.target.closest("[data-inspector-view]"), row = event.target.closest("[data-inspector-select]");
      if (region) {
        inspectorState.view = region.dataset.inspectorRegion === "tools" ? "tools" : "messages";
        inspectorState.region = region.dataset.inspectorRegion === "tools" ? "" : region.dataset.inspectorRegion;
        inspectorState.kind = "";
        inspectorState.query = "";
        inspectorState.selected = "";
        renderInspector();
      } else if (view) {
        inspectorState.view = view.dataset.inspectorView;
        inspectorState.region = "";
        inspectorState.query = "";
        inspectorState.selected = "";
        renderInspector();
      } else if (row) {
        inspectorState.selected = row.dataset.inspectorSelect;
        renderInspector({ keepPosition: true });
      }
    });
    $("contextModules").addEventListener("click", (event) => {
      const btn = event.target.closest("[data-context-move]"), row = btn?.closest("[data-context-id]");
      if (!row || !["up", "down"].includes(btn.dataset.contextMove)) return;
      const rows = data.preview.modules, i = rows.findIndex((x) => x.id === row.dataset.contextId), direction = btn.dataset.contextMove === "up" ? -1 : 1;
      let j = i + direction;
      while (rows[j] && rows[j].placement !== rows[i].placement) j += direction;
      if (rows[j]) move(row.dataset.contextId, rows[j].id);
    });
    $("contextModules").addEventListener("dragstart", (event) => {
      const handle = event.target.closest("[draggable]");
      if (!handle) return;
      dragged = handle.closest("[data-context-id]").dataset.contextId;
      event.dataTransfer.setData("text/plain", dragged);
    });
    $("contextModules").addEventListener("dragover", (event) => {
      if (dragged) event.preventDefault();
    });
    $("contextModules").addEventListener("drop", (event) => {
      event.preventDefault();
      const row = event.target.closest("[data-context-id]");
      if (row && dragged) move(dragged, row.dataset.contextId);
      dragged = "";
    });
    $("contextModules").addEventListener("dragend", () => {
      dragged = "";
    });
    $("contextSave").addEventListener("click", async () => {
      if (!draft || loading) return;
      const submitted = copy(draft);
      $("contextSave").disabled = true;
      try {
        const response = await api("/api/context/policy", "POST", { policy: submitted });
        if (response.ok === false) throw Error(response.error);
        saved = submitted;
        render();
        notice(changed() ? "已保存全局设置；你在保存期间继续修改的部分还没有保存。" : "已保存全局设置：适用于所有私聊和群聊，从各会话的下一次唤醒开始使用。组件功能与工具权限保持原样。");
      } catch (error) {
        notice("保存失败：" + error.message);
        render();
      }
    });
    registerPageLoader("context-visual", () => refresh(true));
  }

  // console/layers/L/proactive-preview.js
  var time = (value2) => value2 ? new Date(value2).toLocaleString("zh-CN", { hour12: false }) : "—";
  var sources = { default: "默认值（尚无 AI 评估）", ai: "AI 评估", activity: "旧活动评分（待重新评估）", purpose: "旧发送评分（待重新评估）" };
  async function refreshProactivePreview() {
    const root = document.getElementById("proactivePreview");
    try {
      const response = await api("/api/socialV2/states");
      if (response.ok === false) throw Error(response.error || "读取失败");
      root.innerHTML = (response.conversations || []).map((row) => {
        const p = row.proactive;
        if (!p) return '<div class="runtime-preview"><b>' + esc(row.key) + "</b><p>主动组件未启用或判定不可用</p></div>";
        const interval = p.effectiveInterval;
        return '<div class="runtime-preview"><b>' + esc(row.key) + '</b><dl class="runtime-facts"><dt>当前会话</dt><dd>' + esc(p.conversationAwake === true ? "已唤醒：接收、回复与等待中" : p.conversationAwake === false ? "未开启：使用主动概率与唤醒加成" : "运行进程尚未提供会话状态") + "</dd>" + (p.lastIncomingDecision ? "<dt>最近群聊来信</dt><dd>" + esc((p.lastIncomingDecision.phase === "conversation" ? "会话中：不抽签，继续接收" : "开启会话：p=" + Math.round(p.lastIncomingDecision.baseProbability * 100) + "% + q=" + Math.round(p.lastIncomingDecision.extraProbability * 100) + "% → " + Math.round(p.lastIncomingDecision.probability * 100) + "% · " + (p.lastIncomingDecision.accepted ? "通过" : "未通过")) + " · " + time(p.lastIncomingDecision.at)) + "</dd>" : "") + "<dt>静默主动阶段</dt><dd>" + esc(p.stage ?? "—") + "</dd><dt>无人来信时的主动概率</dt><dd>" + esc(p.effectiveProbability == null ? "—" : (p.effectiveProbability * 100).toFixed(1) + "%") + "</dd><dt>聊天意愿（用户忙闲）</dt><dd>" + esc(p.willingness ?? "—") + " / 100 · " + esc(sources[p.source] || p.source || "未知来源") + "</dd><dt>上次 AI 评估</dt><dd>" + esc(p.lastAI ? p.lastAI.value + " · " + p.lastAI.reason + " · " + time(p.lastAI.at) : "尚无 AI 评估") + "</dd><dt>实际检验区间</dt><dd>" + esc(interval ? interval.minMinutes + "–" + interval.maxMinutes + " 分钟" : "—") + "</dd><dt>下次判定</dt><dd>" + esc(time(p.nextAt)) + "</dd><dt>阻断 / 暂停</dt><dd>" + esc(p.blockedReason || (row.paused ? "已暂停" : "无")) + "</dd><dt>当前状态</dt><dd>" + esc([p.phase, p.intent, p.lastFinishedReason].filter(Boolean).join(" · ") || "—") + "</dd></dl></div>";
      }).join("") || '<p class="meta">暂无会话</p>';
    } catch (error) {
      root.textContent = "读取失败：" + error.message;
    }
  }
  function initialize4() {
    document.getElementById("proactivePreviewRefresh").addEventListener("click", refreshProactivePreview);
    registerPageLoader("setting-l-1", refreshProactivePreview);
  }

  // console/layers/C/source-keys.js
  function readSourceKeys(id) {
    const keys = [...new Set(document.getElementById(id).value.split(/[\s,，;；]+/).filter(Boolean))];
    if (keys.length > 50 || keys.some((key2) => !/^(group|private):[1-9]\d{0,19}$/.test(key2))) throw Error("适用来源请填写 group:群号 或 private:QQ号，每行一个，最多50个。");
    return keys;
  }
  var sourceKeysText = (entry) => (entry.sourceKeys || []).join("\n");
  function sourceKeysMarkup(entry) {
    const keys = entry.sourceKeys || [];
    if (!keys.length) return '<span class="meta">仅供查询</span>';
    const render2 = (key2) => '<code class="learning-source-key">' + esc(key2) + "</code>";
    return keys.slice(0, 2).map(render2).join(" ") + (keys.length > 2 ? "<details><summary>另有 " + (keys.length - 2) + " 个来源</summary>" + keys.slice(2).map(render2).join(" ") + "</details>" : "");
  }
  async function requireLearningScopes() {
    let result;
    try {
      result = await api("/api/learning/sources");
    } catch {
      throw Error("资料多来源后端尚未启用，请先完成桥接整合后再保存。");
    }
    if (result.scopeVersion !== 1) throw Error("资料多来源后端尚未启用，请先完成桥接整合后再保存。");
  }

  // console/layers/C/learning-common.js
  async function learningCall(tool, input = {}) {
    const out = await api("/api/plugins/call", "POST", { tool, input });
    if (out.ok === false || out.result?.ok === false) throw Error(out.error || out.result?.error || "操作失败");
    return out.result || out;
  }
  function learningEvidence(rows) {
    if (!rows?.length) return '<div class="meta">暂无采集语境；此记录可能来自手动维护。</div>';
    return "<details><summary>查看采集语境（" + rows.length + '）</summary><ul class="learning-evidence">' + rows.map((e) => "<li><small>" + esc(e.key || "手动") + " · " + esc(e.time ? new Date(e.time).toLocaleString() : "") + "</small><p>" + esc(e.text || "") + "</p></li>").join("") + "</ul></details>";
  }
  function learningLinks(urls) {
    return (urls || []).map((value2) => {
      try {
        const u = new URL(value2);
        return /^https?:$/.test(u.protocol) ? '<a href="' + esc(u.href) + '" target="_blank" rel="noopener noreferrer">' + esc(u.hostname + u.pathname) + "</a>" : "";
      } catch {
        return "";
      }
    }).filter(Boolean).join(" · ");
  }
  function initialize5() {
  }

  // console/layers/C/terms.js
  function initialize6() {
    (() => {
      let entries = [], config = {}, active = "candidate", selected2 = /* @__PURE__ */ new Set();
      const msg = document.getElementById("termsMsg");
      const statuses = { candidate: "待审核", confirmed: "已确认", rejected: "已拒绝" }, researchLabels = { pending: "待研究", running: "研究中", researched: "已取得公开来源", failed: "研究失败", manual: "手动编辑", rejected: "已拒绝" };
      function search() {
        return document.getElementById("termsSearch" + (active === "candidate" ? "Cand" : active[0].toUpperCase() + active.slice(1))).value.trim().toLowerCase();
      }
      function render2() {
        const suffix = active === "candidate" ? "Candidate" : active[0].toUpperCase() + active.slice(1), box = document.getElementById("terms" + suffix + "List"), q = search(), limit = Number(document.getElementById("termsLimit" + (active === "candidate" ? "Cand" : active[0].toUpperCase() + active.slice(1))).value) || 100;
        const list = entries.filter((e) => e.status === active), filtered = list.filter((e) => !q || [e.term, e.topic, e.category, e.summary, (e.sourceKeys || []).join(" "), ...e.aliases || [], ...e.sources || [], ...(e.evidence || []).map((x) => x.text)].join(" ").toLowerCase().includes(q)), shown = filtered.slice(0, limit);
        if (!shown.length) {
          box.innerHTML = '<div class="meta" style="padding:8px">' + (list.length ? "没有符合条件的词条" : active === "candidate" ? "暂无候选；可刷新群消息或手动添加" : "暂无" + statuses[active] + "词条") + "</div>";
          return;
        }
        let html = '<div class="meta" style="padding:6px 8px">共 ' + filtered.length + " 条，显示 " + shown.length + " 条（可滚动查找）</div><table><tr><th>选择</th><th>词条</th><th>次数</th><th>适用会话</th><th>摘要 / 主题</th><th>参考来源</th><th>语境证据</th><th>操作</th></tr>";
        for (const e of shown) {
          const actions = active === "candidate" ? '<button class="small" data-term-edit="' + esc(e.id) + '">查看 / 编辑</button><button class="small primary" data-term-confirm="' + esc(e.id) + '" ' + (!e.summary ? 'disabled title="确认前需要摘要"' : "") + '>确认</button><details class="compact-actions"><summary>更多</summary><div class="compact-actions-menu"><button class="small" data-term-research="' + esc(e.id) + '" ' + (e.research?.status === "running" ? "disabled" : "") + '>研究来源</button><button class="small" data-term-reject="' + esc(e.id) + '">拒绝</button></div></details>' : active === "confirmed" ? '<button class="small" data-term-edit="' + esc(e.id) + '">编辑</button><button class="small danger" data-term-reject="' + esc(e.id) + '">撤销确认</button>' : '<button class="small" data-term-restore="' + esc(e.id) + '">恢复候选</button>';
          const unverified = active === "candidate" && !e.sources?.length, sourceStatus = e.research?.status === "failed" ? "研究失败：" + (e.research.error || "未取得摘要") : e.research?.status === "running" ? "正在研究" : e.research?.status === "pending" ? "待研究" : "未附参考来源";
          html += '<tr data-term-id="' + esc(e.id) + '"><td>' + (active !== "rejected" ? '<input type="checkbox" data-term-select="' + esc(e.id) + '" ' + (selected2.has(e.id) ? "checked" : "") + ">" : "—") + "</td><td><b>" + esc(e.term) + '</b><br><span class="' + (active === "candidate" ? "pill b" : active === "confirmed" ? "pill g" : "pill r") + '">' + statuses[active] + "</span></td><td>" + esc(e.count || 1) + "</td><td>" + sourceKeysMarkup(e) + "</td><td>" + (unverified && e.summary ? '<span class="meta">待核实摘要：</span>' : "") + esc(e.summary || "待补充摘要") + '<br><span class="meta">' + esc(e.topic || "未分类") + " · " + esc(e.category || "兴趣知识") + " · " + esc(researchLabels[e.research?.status] || "未研究") + "</span></td><td>" + (e.sources?.length ? learningLinks(e.sources) : '<span class="meta">' + esc(sourceStatus) + "</span>") + "</td><td>" + learningEvidence(e.evidence) + '</td><td class="row">' + actions + "</td></tr>";
        }
        box.innerHTML = html + "</table>";
        box.querySelectorAll("[data-term-select]").forEach((cb) => cb.addEventListener("change", () => {
          cb.checked ? selected2.add(cb.dataset.termSelect) : selected2.delete(cb.dataset.termSelect);
        }));
        box.querySelectorAll("[data-term-edit]").forEach((b) => b.addEventListener("click", () => edit2(entries.find((e) => e.id === b.dataset.termEdit))));
        for (const [attr, tool, label2] of [["research", "term_research", "研究完成，结果仍待管理员审核"], ["confirm", "term_confirm", "词条已确认"], ["reject", "term_reject", "词条已拒绝"]]) box.querySelectorAll("[data-term-" + attr + "]").forEach((b) => b.addEventListener("click", async () => {
          b.disabled = true;
          msg.textContent = attr === "research" ? "正在核实公开资料；不会自动确认……" : "正在保存……";
          try {
            await learningCall(tool, { id: b.dataset["term" + attr[0].toUpperCase() + attr.slice(1)] });
            msg.textContent = label2;
            await loadTerms(false);
          } catch (e) {
            msg.textContent = e.message;
          } finally {
            b.disabled = false;
          }
        }));
        box.querySelectorAll("[data-term-restore]").forEach((b) => b.addEventListener("click", async () => {
          const e = entries.find((x) => x.id === b.dataset.termRestore);
          try {
            await learningCall("term_save", { ...e, status: "candidate" });
            msg.textContent = "已恢复为候选";
            await loadTerms(false);
          } catch (error) {
            msg.textContent = error.message;
          }
        }));
      }
      function edit2(entry = {}) {
        document.getElementById("termEditId").value = entry.id || "";
        document.getElementById("termName").value = entry.term || "";
        document.getElementById("termTopic").value = entry.topic || "";
        document.getElementById("termCategory").value = entry.category || "兴趣知识";
        document.getElementById("termSourceKeys").value = sourceKeysText(entry);
        document.getElementById("termAliases").value = (entry.aliases || []).join("，");
        document.getElementById("termSummary").value = entry.summary || "";
        document.getElementById("termSources").value = (entry.sources || []).join("\n");
        document.getElementById("termEditMsg").textContent = "";
        document.getElementById("termEditorTitle").textContent = entry.id ? "编辑词条：" + (entry.term || "") : "新增词条";
        document.getElementById("termEditorOverlay").classList.add("open");
      }
      const loadTerms = async (withConfig = true) => {
        try {
          const data2 = await learningCall("term_list");
          entries = data2.entries || [];
          config = data2.config || config;
          const categoryOptions = document.getElementById("termCategoryOptions"), existing = new Set([...categoryOptions.options].map((x) => x.value));
          for (const entry of entries) if (entry.category && !existing.has(entry.category)) {
            const option = document.createElement("option");
            option.value = entry.category;
            categoryOptions.append(option);
            existing.add(entry.category);
          }
          if (withConfig) {
            document.getElementById("termsAutoExtract").checked = config.autoExtract !== false;
            document.getElementById("termsAutoResearch").checked = config.autoResearch !== false;
            document.getElementById("termsMinMessages").value = config.minMessages ?? 12;
            document.getElementById("termsCooldown").value = Math.max(1, Number(config.cooldownMs || 18e5) / 6e4);
            document.getElementById("termsMaxCalls").value = config.maxCallsPerHour ?? 4;
            document.getElementById("termsInjectMax").value = config.injectMax ?? 3;
          }
          const counts = { candidate: entries.filter((e) => e.status === "candidate").length, confirmed: entries.filter((e) => e.status === "confirmed").length, rejected: entries.filter((e) => e.status === "rejected").length };
          document.getElementById("termsStats").textContent = "待审核 " + counts.candidate + " · 已确认 " + counts.confirmed + " · 已拒绝 " + counts.rejected + " · 待提取群消息 " + Object.values(data2.windows || {}).reduce((a, b) => a + Number(b || 0), 0);
          render2();
        } catch (e) {
          document.getElementById("termsCandidateList").innerHTML = '<p class="err">词条读取失败：' + esc(e.message) + "</p>";
        }
      };
      document.querySelectorAll("#termsTabs [data-term-tab]").forEach((button) => button.addEventListener("click", () => {
        active = button.dataset.termTab;
        document.querySelectorAll("#termsTabs [data-term-tab]").forEach((x) => x.classList.toggle("active", x === button));
        document.querySelectorAll("#section-terms .terms-panel").forEach((panel) => panel.classList.toggle("active", panel.id === "termsPanel" + active[0].toUpperCase() + active.slice(1)));
        render2();
      }));
      for (const status of ["candidate", "confirmed", "rejected"]) {
        const suffix = status === "candidate" ? "Cand" : status[0].toUpperCase() + status.slice(1);
        document.getElementById("termsSearch" + suffix).addEventListener("input", render2);
        document.getElementById("termsLimit" + suffix).addEventListener("change", render2);
      }
      for (const status of ["candidate", "confirmed"]) document.getElementById("terms" + status[0].toUpperCase() + status.slice(1) + "SelectAll").addEventListener("change", (event) => {
        const q = status === "candidate" ? search() : "";
        for (const e of entries.filter((x) => x.status === status && (!q || [x.term, x.topic, x.category, x.summary, ...x.sourceKeys || [], ...x.aliases || [], ...x.sources || [], ...(x.evidence || []).map((y) => y.text)].join(" ").toLowerCase().includes(q)))) {
          if (event.target.checked) selected2.add(e.id);
          else selected2.delete(e.id);
        }
        render2();
      });
      document.getElementById("termsResearchSelected").addEventListener("click", async (event) => {
        const button = event.currentTarget, targets = [...selected2].map((id) => entries.find((e) => e.id === id)).filter((e) => e?.status === "candidate" && e.research?.status !== "running");
        if (!targets.length) {
          msg.textContent = "请先勾选待审核词条";
          return;
        }
        button.disabled = true;
        try {
          let success = 0, failed = 0;
          const errors = [];
          for (let i = 0; i < targets.length; i++) {
            const entry = targets[i];
            msg.textContent = "正在研究来源（" + (i + 1) + "/" + targets.length + "）：" + entry.term + "；结果仍待审核";
            try {
              await learningCall("term_research", { id: entry.id });
              success++;
              selected2.delete(entry.id);
            } catch (error) {
              failed++;
              errors.push(entry.term + "：" + error.message);
              selected2.delete(entry.id);
            }
          }
          msg.textContent = "批量研究完成：成功 " + success + " 条，失败 " + failed + " 条；研究结果仍需管理员确认。" + (errors.length ? " " + errors.join("；") : "");
          await loadTerms(false);
        } catch (error) {
          msg.textContent = "批量研究未开始：" + error.message;
        } finally {
          button.disabled = false;
        }
      });
      async function rejectSelected(status) {
        for (const id of selected2) {
          if (entries.some((x) => x.id === id && x.status === status)) try {
            await learningCall("term_reject", { id });
          } catch (error) {
            msg.textContent = error.message;
          }
        }
        selected2.clear();
        await loadTerms(false);
      }
      document.getElementById("termsConfirmSelected").addEventListener("click", async () => {
        let confirmed = 0, skipped = 0;
        for (const id of selected2) {
          const e = entries.find((x) => x.id === id);
          if (e?.status !== "candidate") continue;
          if (!e.summary) {
            skipped++;
            continue;
          }
          try {
            await learningCall("term_confirm", { id });
            confirmed++;
          } catch {
            skipped++;
          }
        }
        selected2.clear();
        msg.textContent = "批量确认 " + confirmed + " 条；" + skipped + " 条缺少摘要或确认失败，请单独编辑。";
        await loadTerms(false);
      });
      document.getElementById("termsRejectSelected").addEventListener("click", () => rejectSelected("candidate"));
      document.getElementById("termsRejectConfirmedSelected").addEventListener("click", () => rejectSelected("confirmed"));
      document.getElementById("termsRefresh").addEventListener("click", async (event) => {
        const button = event.currentTarget;
        button.disabled = true;
        msg.textContent = "正在补扫近期群消息并提取一个候选……";
        try {
          const result = await learningCall("term_refresh");
          msg.textContent = result.processed ? "刷新完成：扫描 " + (result.scanned || 0) + " 条消息，新增 1 个待审核词条。" : "刷新完成：扫描 " + (result.scanned || 0) + " 条消息，暂未发现足够明确的兴趣词条。";
          await loadTerms(false);
        } catch (e) {
          msg.textContent = e.message;
        } finally {
          button.disabled = false;
        }
      });
      document.getElementById("termsNew").addEventListener("click", () => edit2());
      async function quickAdd(status) {
        const ids = ["termManualName", "termManualTopic", "termManualSummary", "termManualSource", "termManualCategory"], values = Object.fromEntries(ids.map((id) => [id, document.getElementById(id).value.trim()]));
        try {
          await requireLearningScopes();
          const input = { term: values.termManualName, topic: values.termManualTopic, category: values.termManualCategory, summary: values.termManualSummary, sources: values.termManualSource ? [values.termManualSource] : [], sourceKeys: readSourceKeys("termManualSourceKeys"), status };
          await learningCall("term_save", input);
          msg.textContent = status === "confirmed" ? "自定义词条已确认入库" : "自定义词条已加入候选";
          for (const id of ids.slice(0, 4)) document.getElementById(id).value = "";
          await loadTerms(false);
        } catch (error) {
          msg.textContent = error.message;
        }
      }
      document.getElementById("termManualDraft").addEventListener("click", () => quickAdd("candidate"));
      document.getElementById("termManualConfirm").addEventListener("click", () => quickAdd("confirmed"));
      async function save2(status) {
        const editMsg = document.getElementById("termEditMsg");
        let scope;
        try {
          scope = readSourceKeys("termSourceKeys");
        } catch (error) {
          editMsg.textContent = error.message;
          return;
        }
        const input = { id: document.getElementById("termEditId").value || void 0, term: document.getElementById("termName").value, topic: document.getElementById("termTopic").value, category: document.getElementById("termCategory").value, sourceKeys: scope, aliases: document.getElementById("termAliases").value.split(/[,，、]/).map((x) => x.trim()).filter(Boolean), summary: document.getElementById("termSummary").value, sources: document.getElementById("termSources").value.split(/\r?\n/).map((x) => x.trim()).filter(Boolean), status };
        try {
          await requireLearningScopes();
          const r = await learningCall("term_save", input);
          document.getElementById("termEditId").value = r.entry.id;
          editMsg.textContent = status === "confirmed" ? "已保存并确认" : "草稿已保存";
          await loadTerms(false);
          document.getElementById("termEditorOverlay").classList.remove("open");
        } catch (e) {
          editMsg.textContent = e.message;
        }
      }
      document.getElementById("termSaveDraft").addEventListener("click", () => save2("candidate"));
      document.getElementById("termSaveConfirmed").addEventListener("click", () => save2("confirmed"));
      document.getElementById("termsConfigSave").addEventListener("click", async () => {
        const configMsg = document.getElementById("termsConfigMsg");
        const patch = { autoExtract: document.getElementById("termsAutoExtract").checked, autoResearch: document.getElementById("termsAutoResearch").checked, minMessages: Number(document.getElementById("termsMinMessages").value), cooldownMs: Number(document.getElementById("termsCooldown").value) * 6e4, maxCallsPerHour: Number(document.getElementById("termsMaxCalls").value), injectMax: Number(document.getElementById("termsInjectMax").value) };
        try {
          await requireLearningScopes();
          const out = await api("/api/plugins/config", "POST", { id: "ctx-interest-terms", config: patch });
          if (out.ok === false) throw Error(out.error);
          configMsg.textContent = "学习设置已保存";
          await loadTerms(false);
        } catch (e) {
          configMsg.textContent = e.message;
        }
      });
      document.getElementById("termEditorCancel").addEventListener("click", () => document.getElementById("termEditorOverlay").classList.remove("open"));
      document.getElementById("termEditorOverlay").addEventListener("click", (event) => {
        if (event.target.id === "termEditorOverlay") event.currentTarget.classList.remove("open");
      });
      registerPageLoader("terms", loadTerms);
    })();
  }

  // console/layers/C/affairs-budget.js
  var componentId = "ctx-memory-context";
  var el = (id) => document.getElementById(id);
  var dirty = false;
  var saving = false;
  async function readConfig() {
    const result = await api("/api/plugins/detail?id=" + componentId);
    if (!result.ok || !result.plugin) throw Error(result.error || "无法读取事务预算");
    return result.plugin;
  }
  async function loadAffairsBudget() {
    if (dirty || saving) return;
    try {
      const plugin = await readConfig();
      if (dirty || saving) return;
      const input = el("v2AffairsBudget"), rule = plugin.configSchema.affairsMaxChars;
      input.min = rule.min;
      input.max = rule.max;
      input.value = plugin.config.affairsMaxChars;
      input.disabled = false;
      el("v2AffairsBudgetSave").disabled = false;
      el("v2AffairsBudgetMsg").textContent = "";
    } catch (error) {
      el("v2AffairsBudgetMsg").textContent = "读取预算失败：" + error.message;
    }
  }
  function initializeAffairsBudget(refreshPreview) {
    const input = el("v2AffairsBudget"), button = el("v2AffairsBudgetSave"), message2 = el("v2AffairsBudgetMsg");
    input.addEventListener("input", () => {
      dirty = true;
      message2.textContent = "尚未保存";
    });
    button.addEventListener("click", async () => {
      if (!input.reportValidity()) return;
      const value2 = input.valueAsNumber;
      if (!Number.isInteger(value2)) {
        message2.textContent = "请填写整数预算";
        return;
      }
      saving = true;
      input.disabled = true;
      button.disabled = true;
      message2.textContent = "保存中…";
      let saved2 = false;
      try {
        const result = await api("/api/plugins/config", "POST", { id: componentId, config: { affairsMaxChars: value2 } });
        if (!result.ok) throw Error(result.error || "保存失败");
        saved2 = true;
        const plugin = await readConfig();
        if (plugin.config.affairsMaxChars !== value2) throw Error("预算读回不一致，请刷新核对");
        input.value = plugin.config.affairsMaxChars;
        dirty = false;
        const refreshed = await refreshPreview();
        message2.textContent = "已保存并重载" + (refreshed ? "，预览已刷新" : "");
      } catch (error) {
        message2.textContent = (saved2 ? "已保存，复核失败：" : "保存失败：") + error.message;
      } finally {
        saving = false;
        input.disabled = false;
        button.disabled = false;
      }
    });
  }

  // console/layers/C/affairs.js
  var labels = { needs_review: "待核实", pending: "待处理", doing: "进行中", waiting: "等待结果", done: "已完成", cancelled: "已取消", superseded: "被替代" };
  var el2 = (id) => document.getElementById(id);
  var selected = null;
  var offset = 0;
  var total = 0;
  var sequence = 0;
  var items = /* @__PURE__ */ new Map();
  var key = () => el2("v2AffairsKey").value;
  var message = (text) => {
    el2("v2AffairsMsg").textContent = text;
    el2("v2AffairEditorMsg").textContent = text;
  };
  function edit(item = null, show = true) {
    selected = item;
    el2("v2AffairEditorMsg").textContent = "";
    for (const [field, id] of [["title", "Title"], ["detail", "Detail"], ["nextAction", "NextAction"], ["source", "Source"]]) el2("v2Affair" + id).value = item?.[field] || "";
    el2("v2AffairStatus").value = item?.status || "pending";
    el2("v2AffairPriority").value = String(item?.priority ?? 1);
    el2("v2AffairEditorTitle").textContent = item ? "编辑事务" : "新增事务";
    if (show && !el2("v2AffairEditor").open) el2("v2AffairEditor").showModal();
  }
  async function load() {
    const requestKey = key(), requestId = ++sequence;
    if (!requestKey) {
      message("请选择会话");
      return;
    }
    message("加载中…");
    try {
      const query = new URLSearchParams({ key: requestKey, status: el2("v2AffairsFilter").value, offset, limit: 20 });
      const result = await api("/api/socialV2/affairs?" + query);
      if (requestId !== sequence || requestKey !== key()) return;
      if (!result.ok) throw new Error(result.error || "加载失败");
      items = new Map(result.items.map((item) => [item.id, item]));
      total = result.total;
      el2("v2AffairsList").innerHTML = result.items.length ? result.items.map((item) => `<article class="affair-card"><div class="affair-card-heading"><strong>${esc(item.title)}</strong><span class="affair-badge" data-status="${esc(item.status)}">${esc(labels[item.status])}</span></div><p class="affair-progress">${esc(item.detail || "尚无进度记录")}</p>${item.nextAction ? `<div class="affair-next"><span>下一步</span>${esc(item.nextAction)}</div>` : ""}<div class="affair-card-footer"><span class="meta">${item.updatedAt ? new Date(item.updatedAt).toLocaleDateString() + " 更新" : ""}</span><div><button class="small" type="button" data-affair-id="${esc(item.id)}">编辑</button>${["needs_review", "pending", "doing", "waiting"].includes(item.status) ? `<button class="small" type="button" data-affair-done="${esc(item.id)}">标记完成</button>` : ""}</div></div></article>`).join("") : "当前范围没有事务";
      el2("v2AffairsPage").textContent = `共 ${total} 项 · 第 ${Math.floor(offset / 20) + 1} 页`;
      el2("v2AffairsPrev").disabled = offset === 0;
      el2("v2AffairsNext").disabled = offset + 20 >= total;
      el2("v2AffairsPreview").textContent = result.preview?.text || "（当前预算未选中事务）";
      el2("v2AffairsPreviewInfo").textContent = `选中 ${result.preview?.selectedIds?.length || 0} 项，未选中 ${result.preview?.omittedIds?.length || 0} 项。组合记忆总预算可能进一步收紧；未选中内容仍完整保存。`;
      message("已加载 " + result.items.length + " 项");
      return true;
    } catch (error) {
      if (requestId === sequence) message("读取失败：" + error.message);
      return false;
    }
  }
  async function loadKeys() {
    try {
      const result = await api("/api/socialV2/states");
      if (!result.ok) throw new Error(result.error || "无法读取会话");
      const previous = key(), keys = result.conversations.map((item) => item.key).filter((value2) => /^(private|group):\d+$/.test(value2));
      el2("v2AffairsKey").innerHTML = keys.map((value2) => `<option value="${esc(value2)}">${esc(value2)}</option>`).join("");
      if (keys.includes(previous)) el2("v2AffairsKey").value = previous;
      await load();
    } catch (error) {
      message("读取会话失败：" + error.message);
    }
  }
  async function save() {
    if (!key()) {
      message("请选择会话");
      return;
    }
    const requestKey = key(), payload = {
      key: requestKey,
      action: "upsert",
      title: el2("v2AffairTitle").value.trim(),
      detail: el2("v2AffairDetail").value,
      nextAction: el2("v2AffairNextAction").value,
      source: el2("v2AffairSource").value,
      status: el2("v2AffairStatus").value,
      priority: Number(el2("v2AffairPriority").value),
      ...selected ? { id: selected.id, expectedRevision: selected.revision } : {}
    };
    if (!payload.title) {
      message("请填写事项标题");
      return;
    }
    el2("v2AffairsSave").disabled = true;
    try {
      const result = await api("/api/socialV2/affairs", "POST", payload);
      if (!result.ok) throw new Error(result.error || "保存失败");
      if (requestKey !== key()) return;
      el2("v2AffairEditor").close();
      selected = null;
      await load();
      message("已保存");
    } catch (error) {
      message("保存失败：" + error.message + "。表单内容已保留；如有版本冲突，请刷新并重新打开该事务。");
    } finally {
      el2("v2AffairsSave").disabled = false;
    }
  }
  function initialize7() {
    initializeAffairsBudget(async () => {
      if (!key()) return false;
      const refreshed = await load();
      if (refreshed === false) throw Error("事务预览刷新失败，请点“刷新事务”重试");
      return refreshed;
    });
    el2("v2AffairsLoad").addEventListener("click", () => key() ? load() : loadKeys());
    el2("v2AffairsNew").addEventListener("click", () => edit());
    el2("v2AffairsSave").addEventListener("click", save);
    el2("v2AffairsCancel").addEventListener("click", () => el2("v2AffairEditor").close());
    el2("v2AffairsList").addEventListener("click", (event) => {
      const button = event.target.closest("[data-affair-id]");
      if (button) edit(items.get(button.dataset.affairId));
      const done = event.target.closest("[data-affair-done]");
      if (done) {
        const item = items.get(done.dataset.affairDone);
        done.disabled = true;
        void api("/api/socialV2/affairs", "POST", { key: key(), action: "upsert", id: item.id, expectedRevision: item.revision, status: "done" }).then((result) => {
          if (!result.ok) throw Error(result.error || "更新失败");
          return load();
        }).catch((error) => {
          message(error.message);
          done.disabled = false;
        });
      }
    });
    for (const id of ["v2AffairsKey", "v2AffairsFilter"]) el2(id).addEventListener("change", () => {
      offset = 0;
      edit(null, false);
      el2("v2AffairEditor").close();
      void load();
    });
    el2("v2AffairsPrev").addEventListener("click", () => {
      offset = Math.max(0, offset - 20);
      void load();
    });
    el2("v2AffairsNext").addEventListener("click", () => {
      offset += 20;
      void load();
    });
    registerPageLoader("setting-c-1", () => Promise.all([loadKeys(), loadAffairsBudget()]));
  }

  // console/layers/G/session-token.js
  async function changeConsoleToken(generate) {
    const input = document.getElementById("consoleTokenInput");
    const msg = document.getElementById("consoleTokenMsg");
    const token = generate ? "" : input.value.trim();
    if (!generate && token && token.length < 16) {
      msg.textContent = "❌ 令牌至少需要 16 位";
      msg.className = "meta err";
      return;
    }
    const r = await api("/api/console/token", "POST", { token });
    if (!r.ok) {
      msg.textContent = "❌ " + (r.error || "修改失败");
      msg.className = "meta err";
      return;
    }
    localStorage.setItem("consoleToken", r.token);
    input.value = r.token;
    msg.textContent = r.generated ? "已生成随机令牌，当前页面已自动使用。可点击显示后复制。" : "已保存新令牌";
    msg.className = "meta ok";
  }
  function initialize8() {
    document.getElementById("consoleTokenSave").addEventListener("click", () => changeConsoleToken(false));
    document.getElementById("consoleTokenRandom").addEventListener("click", () => changeConsoleToken(true));
  }

  // console/layers/G/security.js
  function formatSecurityRules(rules, title) {
    const entries = Array.isArray(rules) ? rules : [];
    return `【${title}】
` + (entries.length ? entries.map((rule) => `• ${rule.enabled === false ? "停用" : "启用"}｜${rule.label || rule.id || "未命名规则"}
  正则表达式：${rule.pattern || ""}
  flags：${rule.flags || "（无）"}`).join("\n") : "（无规则）");
  }
  function formatSecurityPolicy(security, guard = {}) {
    const terms = (value2) => Array.isArray(value2) && value2.length ? value2.join("、") : "无";
    return [
      `入站防护总开关：${guard.enabled === false ? "停用" : "启用"}；命中注入规则：${guard.quarantineInjection === false ? "不隔离" : "隔离并标记"}；命中违禁规则：${guard.blockForbidden === false ? "不拒收" : "拒收"}`,
      formatSecurityRules(security.sensitiveRules, "出站泄漏检测"),
      `补充出站敏感词：${terms(security.extraSensitiveTerms)}`,
      formatSecurityRules(security.injectionRules, "入站提示词注入检测"),
      formatSecurityRules(security.forbiddenRules, "入站违禁内容检测"),
      `补充入站拦截词：${terms(security.extraForbiddenTerms)}`,
      "已知会话令牌：固定精确匹配保护（独立于上述可配置规则）。"
    ].join("\n\n");
  }
  function loadSecurity() {
    api("/api/security").then((r) => {
      const security = r.security || {};
      document.getElementById("secInterceptNotify").checked = security.interceptNotify !== false;
      document.getElementById("secInterceptText").value = security.interceptNotifyText || "⚠️ 本条回复因疑似包含敏感信息（路径/凭据/会话令牌）被安全策略拦截，已记录并通知管理员。";
      document.getElementById("secSecurityPolicy").textContent = formatSecurityPolicy(security, r.guardSettings || {});
      const warn = document.getElementById("stateDirWarn");
      const hardened = r.stateDir?.hardened;
      if (hardened === false) {
        document.getElementById("stateDirPath").textContent = r.stateDir?.path || "state/";
        document.getElementById("stateDirCmd").textContent = r.stateDir?.manualCommand || "";
        warn.style.display = "";
      } else {
        warn.style.display = "none";
      }
    }).catch(() => {
    });
  }
  async function saveSecurityPayload(payload, button, msg) {
    button.disabled = true;
    msg.textContent = "保存中…";
    msg.className = "meta";
    try {
      const r = await api("/api/security", "POST", payload);
      if (!r.ok) throw new Error(r.error || "保存失败");
      msg.textContent = "✅ 已保存";
      msg.className = "meta ok";
    } catch (error) {
      msg.textContent = "❌ " + error.message;
      msg.className = "meta err";
    } finally {
      button.disabled = false;
    }
  }
  async function saveSecurityField(field, value2, button, msg) {
    return saveSecurityPayload({ [field]: value2 }, button, msg);
  }
  function initialize9() {
    document.getElementById("secInterceptNotifySave").addEventListener("click", () => saveSecurityField(
      "interceptNotify",
      document.getElementById("secInterceptNotify").checked,
      document.getElementById("secInterceptNotifySave"),
      document.getElementById("secInterceptNotifyMsg")
    ));
    document.getElementById("secInterceptTextSave").addEventListener("click", () => saveSecurityField(
      "interceptNotifyText",
      document.getElementById("secInterceptText").value.trim(),
      document.getElementById("secInterceptTextSave"),
      document.getElementById("secInterceptTextMsg")
    ));
    document.getElementById("stateDirReharden").addEventListener("click", async () => {
      const msg = document.getElementById("stateDirMsg");
      msg.textContent = "检测中…";
      try {
        const r = await api("/api/security");
        const ok = r.stateDir?.hardened === true;
        msg.textContent = ok ? "权限已收紧" : "权限尚未收紧；请按上方命令处理后复检";
        msg.className = ok ? "meta ok" : "meta err";
        await loadSecurity();
      } catch (error) {
        msg.textContent = "检查失败：" + error.message;
        msg.className = "meta err";
      }
    });
  }

  // console/shared/components/service.js
  var componentUI = {};

  // console/layers/V/page.js
  function initialize10() {
    const load2 = () => componentUI.renderLayer("V", "vLayerRoot");
    registerPageLoader("layer-v", load2);
    document.getElementById("vLayerRefresh").addEventListener("click", load2);
  }

  // console/layers/S/page.js
  function initialize11() {
    const load2 = () => componentUI.renderLayer("S", "sLayerRoot");
    registerPageLoader("layer-s", load2);
    document.getElementById("sLayerRefresh").addEventListener("click", load2);
  }

  // console/layers/T/games.js
  var gamesParameterLabels;
  function renderGames(games) {
    const host = document.getElementById("gamesRegistry");
    if (!host) return;
    if (!games?.length) {
      host.innerHTML = '<div class="meta">暂无游戏。</div>';
      return;
    }
    host.innerHTML = games.map((game) => {
      if (game.id === "spark" && !game.parameterSchema?.bodyPart) return '<article class="games-card" data-game-card="spark"><div class="games-card-head"><h3>轻微电流</h3></div><p class="meta" data-game-pending>后端尚未载入新玩法；联合启用并刷新 Games MCP 后即可配置。</p></article>';
      const params = game.custom ? "" : Object.entries(game.parameters || {}).map(([key2, value2]) => {
        const schema2 = game.parameterSchema?.[key2] || {}, [fallbackLabel, min, max] = gamesParameterLabels?.[key2] || [key2, 0, 100], label2 = schema2.title || fallbackLabel;
        const control = schema2.enum ? '<select data-game-param="' + esc(key2) + '">' + schema2.enum.map((option, index) => '<option value="' + esc(option) + '" ' + (option === value2 ? "selected" : "") + ">" + esc(schema2.enumLabels?.[index] || option) + "</option>").join("") + "</select>" : '<input type="number" data-game-param="' + esc(key2) + '" min="' + (schema2.minimum ?? min) + '" max="' + (schema2.maximum ?? max) + '" step="1" value="' + Number(value2) + '">';
        return '<label class="games-param">' + esc(label2) + control + (schema2.example ? '<small class="parameter-example">例：' + esc(schema2.example) + "</small>" : "") + "</label>";
      }).join("");
      return `<article class="games-card" data-game-card="${esc(game.id)}">
      <div class="games-card-head"><div><h3>${esc(game.name)}${game.custom ? ' <span class="meta">自定义</span>' : ""}</h3><div class="meta">${esc(game.id)} · ${esc(game.summary)}</div></div>
      <label class="games-toggle"><input type="checkbox" data-game-enabled ${game.enabled ? "checked" : ""}> 启用</label></div>
      <p class="games-rules"><strong>规则：</strong>${esc(game.rules)}</p>
      ${params ? `<div class="games-params">${params}</div>` : '<div class="meta">参数通过 adapter 的初始状态和合法动作定义。</div>'}
      <div class="row"><button class="small primary" data-game-save data-save-action>保存${esc(game.name)}设置</button>${game.custom ? '<button class="small danger" data-game-delete>删除游戏</button>' : ""}<span class="meta" data-game-message role="status"></span></div>
    </article>`;
    }).join("");
  }
  async function loadGames() {
    const host = document.getElementById("gamesRegistry");
    try {
      const result = await api("/api/games");
      if (!result.ok) throw new Error(result.error || "游戏清单读取失败");
      renderGames(result.games);
    } catch (error) {
      if (host) host.innerHTML = `<div class="meta err">${esc(error.message)}</div>`;
    }
  }
  async function saveGameCard(card2) {
    const id = card2.dataset.gameCard;
    const message2 = card2.querySelector("[data-game-message]");
    const parameters = Object.fromEntries([...card2.querySelectorAll("[data-game-param]")].map((input) => [input.dataset.gameParam, input.tagName === "SELECT" ? input.value : Number(input.value)]));
    try {
      const result = await api("/api/games/config", "POST", { id, enabled: card2.querySelector("[data-game-enabled]").checked, parameters });
      if (!result.ok) throw new Error(result.error || "保存失败");
      message2.textContent = "已保存";
      message2.className = "meta ok";
    } catch (error) {
      message2.textContent = error.message;
      message2.className = "meta err";
    }
  }
  var gamesRegistry;
  function initialize12() {
    gamesParameterLabels = {
      sides: ["骰子面数", 2, 20],
      maxAttempts: ["最大作答次数", 1, 10]
    };
    gamesRegistry = document.getElementById("gamesRegistry");
    gamesRegistry?.addEventListener("click", async (event) => {
      const card2 = event.target.closest("[data-game-card]");
      if (!card2) return;
      if (event.target.closest("[data-game-save]")) {
        await saveGameCard(card2);
        return;
      }
      if (event.target.closest("[data-game-delete]")) {
        if (!confirm(`删除自定义游戏「${card2.dataset.gameCard}」？`)) return;
        const message2 = card2.querySelector("[data-game-message]");
        try {
          const result = await api("/api/games/delete", "POST", { id: card2.dataset.gameCard });
          if (!result.ok) throw new Error(result.error || "删除失败");
          await loadGames();
        } catch (error) {
          message2.textContent = error.message;
          message2.className = "meta err";
        }
      }
    });
    document.getElementById("gamesReload")?.addEventListener("click", loadGames);
    document.getElementById("gamesSaveDefinition")?.addEventListener("click", async () => {
      const message2 = document.getElementById("gamesSaveMessage");
      const button = document.getElementById("gamesSaveDefinition");
      try {
        const definition = JSON.parse(document.getElementById("gamesDefinition").value);
        button.disabled = true;
        message2.textContent = "校验并保存中…";
        message2.className = "meta";
        const result = await api("/api/games/create", "POST", { definition });
        if (!result.ok) throw new Error(result.error || "保存失败");
        message2.textContent = `已保存并启用：${result.game.name}`;
        message2.className = "meta ok";
        await loadGames();
      } catch (error) {
        message2.textContent = error.message;
        message2.className = "meta err";
      } finally {
        button.disabled = false;
      }
    });
    loadGames();
  }

  // console/layers/C/persona.js
  var roleEditorState;
  var roleCache;
  var roleInjectMax;
  function setRoleMsg(text, ok) {
    const el3 = document.getElementById("roleCreateMsg");
    el3.textContent = text;
    el3.className = ok === void 0 ? "meta" : ok ? "meta ok" : "meta err";
  }
  function renderRoleEditor() {
    const editing = roleEditorState.mode === "edit";
    document.getElementById("roleEditorMeta").textContent = editing ? `正在编辑「${roleEditorState.name}」：改完点「保存修改」；改名字会同时重命名文件。` : "当前是「新建」模式：填好名称与内容后点「新建人格」；名称与已有的人格同名则会改为保存修改。";
    document.getElementById("roleCreate").textContent = editing ? "保存修改" : "新建人格";
  }
  function roleEditorWarnings(text) {
    const value2 = String(text ?? "");
    const warns = [];
    if (value2.length > roleInjectMax) warns.push(`超出注入上限：当前 ${value2.length} 字符，只有前 ${roleInjectMax} 字符会进入提示词（多余 ${value2.length - roleInjectMax} 字符不会生效）`);
    if (/\[SILENT\]|空格分隔|按空格|用空格|空格分句|空格代表|自动转发|回复会自动|输出\s*\[SILENT\]/i.test(value2)) {
      warns.push("含一代仿真专用指令（[SILENT] / 空格分句 / 自动转发），二代仿真下这些行会被自动过滤");
    }
    return warns;
  }
  function updateRoleEditorWarnings() {
    const warns = roleEditorWarnings(document.getElementById("newRoleContent").value);
    document.getElementById("roleEditorWarnings").textContent = warns.length ? "⚠️ " + warns.join("；") : "";
  }
  async function openRoleForEdit(name) {
    setRoleMsg("读取中…");
    const res = await api("/api/roles/content?name=" + encodeURIComponent(name));
    if (!res.ok) {
      setRoleMsg(res.error || "读取失败", false);
      return;
    }
    document.getElementById("newRoleName").value = name;
    document.getElementById("newRoleContent").value = res.content;
    roleEditorState = { mode: "edit", name };
    renderRoleEditor();
    updateRoleEditorWarnings();
    setRoleMsg(`已载入「${name}」（${res.chars} 字符）`, true);
  }
  function resetRoleForm() {
    document.getElementById("newRoleName").value = "";
    document.getElementById("newRoleContent").value = "";
    roleEditorState = { mode: "new", name: "" };
    renderRoleEditor();
    updateRoleEditorWarnings();
    setRoleMsg("");
  }
  async function refreshRoles() {
    try {
      const r = await api("/api/roles");
      if (r.limits?.injectMaxChars) {
        roleInjectMax = Number(r.limits.injectMaxChars) || roleInjectMax;
        const input = document.getElementById("roleInjectMax");
        if (input && document.activeElement !== input) input.value = String(roleInjectMax);
      }
      const names2 = Array.isArray(r.roles) ? r.roles : [];
      roleCache = Array.isArray(r.summaries) && r.summaries.length === names2.length ? r.summaries : names2.map((name) => ({ name, chars: 0, bytes: 0, excerpt: "", truncated: false }));
      const box = document.getElementById("roleList");
      box.replaceChildren();
      if (!roleCache.length) {
        const empty = document.createElement("div");
        empty.className = "empty-state";
        empty.innerHTML = "<strong>还没有人格</strong><p>在「编辑人格提示词」里填名称与内容，点「新建人格」创建第一个。</p>";
        box.appendChild(empty);
      }
      for (const role of roleCache) {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "persona-item" + (role.name === r.current ? " active" : "");
        item.setAttribute("aria-pressed", String(role.name === r.current));
        const head = document.createElement("span");
        head.className = "persona-item-head";
        const title = document.createElement("strong");
        title.textContent = role.name;
        head.appendChild(title);
        if (role.name === r.current) {
          const badge2 = document.createElement("span");
          badge2.className = "persona-badge";
          badge2.textContent = "启用中";
          head.appendChild(badge2);
        }
        if (role.truncated) {
          const badge2 = document.createElement("span");
          badge2.className = "persona-badge warn";
          badge2.textContent = `超出上限`;
          badge2.title = `按模式筛选后仍有超出：二代 ${role.charsV2} 字符 / 一代 ${role.charsV1} 字符，上限 ${roleInjectMax}`;
          head.appendChild(badge2);
        }
        if (role.hasModeTags) {
          const badge2 = document.createElement("span");
          badge2.className = "persona-badge";
          badge2.textContent = "分代内容";
          badge2.title = "该人格含 〔一代〕/〔二代〕 专属小节，只在对应仿真模式下注入";
          head.appendChild(badge2);
        }
        const meta = document.createElement("small");
        const split = Number.isFinite(role.charsV1) && role.charsV1 !== role.charsV2;
        const injection = split ? `按模式注入：二代 ${role.injectedV2} / 一代 ${role.injectedV1} 字符` : `注入 ${role.injectedV2 ?? role.chars} 字符`;
        meta.textContent = `共 ${role.chars} 字符 · ${injection}${role.excerpt ? " · " + role.excerpt : ""}`;
        item.append(head, meta);
        item.addEventListener("click", () => openRoleForEdit(role.name));
        box.appendChild(item);
      }
      const hint = document.getElementById("roleListHint");
      if (hint) hint.textContent = roleCache.length ? `共 ${roleCache.length} 个 · 点任意一个载入编辑` : "";
      renderRoleEditor();
    } catch (error) {
      document.getElementById("roleList").textContent = "加载失败：" + (error?.message ?? error);
    }
  }
  function initialize13() {
    roleEditorState = { mode: "new", name: "" };
    roleCache = [];
    roleInjectMax = 6e3;
  }
  function setRoleEditorState(value2) {
    roleEditorState = value2;
  }

  // console/layers/E/sessions.js
  async function refreshSessions() {
    try {
      const s = await api("/api/sessions");
      const box = document.getElementById("sessionList");
      document.getElementById("metricSessions").textContent = s.sessions.length;
      if (!s.sessions.length) {
        box.innerHTML = '<div class="empty-state"><strong>还没有会话</strong><p>白名单中的群或好友发来消息后，会话会显示在这里。</p></div>';
        return;
      }
      let html = "<table><tr><th>QQ 会话</th><th>DSH 会话 ID</th><th>类型</th><th></th></tr>";
      for (const x of s.sessions) {
        const isP = x.key.startsWith("private:");
        const type = isP ? '<span class="pill b">私聊</span>' : '<span class="pill g">群</span>';
        const ownerTag = x.owner ? ' <span class="pill r">管理员</span>' : "";
        html += `<tr><td>${esc(x.key)}${ownerTag}</td><td><code>${esc(x.sessionId)}</code></td><td>${type}</td><td><button class="small" data-reset-key="${esc(x.key)}">清除上下文</button></td></tr>`;
      }
      box.innerHTML = html + "</table>";
      box.querySelectorAll("[data-reset-key]").forEach((btn) => btn.addEventListener("click", async () => {
        if (!confirm("确定清除该会话的上下文？下次消息将开新会话。")) return;
        const r = await api("/api/session/reset", "POST", { key: btn.dataset.resetKey });
        alert(r.ok ? "✅ 已清除上下文" : "❌ " + (r.error || "失败"));
        refreshSessions();
      }));
    } catch {
    }
  }
  async function refreshPending() {
    try {
      const p = await api("/api/pending");
      const box = document.getElementById("pendingList");
      document.getElementById("metricPending").textContent = p.pending.length;
      document.getElementById("pendingCount").textContent = p.pending.length;
      if (!p.pending.length) {
        box.innerHTML = '<div class="empty-state"><strong>暂时没有待处理请求</strong><p>AI 的提问或工具审批会出现在这里，请前往对应 QQ 会话回复。</p></div>';
        return;
      }
      let html = "<table><tr><th>会话</th><th>类型</th><th>详情</th></tr>";
      for (const x of p.pending) {
        const kind = x.kind === "approval" ? '<span class="pill r">审批</span>' : '<span class="pill b">提问</span>';
        let detail = "";
        if (x.kind === "approval") detail = `${esc(x.toolName)}${x.reason ? "：" + esc(x.reason) : ""}`;
        else if (x.questions) detail = x.questions.map((q) => esc(q.question)).join(" / ");
        html += `<tr><td>${esc(x.key)}</td><td>${kind}</td><td>${detail}</td></tr>`;
      }
      box.innerHTML = html + "</table>";
    } catch {
    }
  }
  function initialize14() {
    document.querySelectorAll("#modeRow button").forEach((b) => b.addEventListener("click", async () => {
      if (b.disabled) return;
      await saveMode(b.dataset.mode);
    }));
    document.getElementById("closedPreset").addEventListener("change", async () => {
      const active = document.querySelector("#modeRow button.active");
      const mode = active ? active.dataset.mode : "chat";
      await saveMode(mode);
    });
  }

  // console/layers/E/voice.js
  var voiceEntries;
  var voiceLibraryLoaded;
  async function loadVoiceLibrary(force) {
    if (voiceLibraryLoaded && force !== true) return;
    const box = document.getElementById("voiceList");
    const msg = document.getElementById("voiceMsg");
    try {
      const r = await api("/api/voice/list?probe=1");
      voiceEntries = Array.isArray(r.voices) ? r.voices : [];
      voiceLibraryLoaded = true;
      if (!voiceEntries.length) {
        box.innerHTML = "语音库是空的：把音频文件放进 <code>qq-bridge/audio/</code> 后点「刷新语音库」。";
        return;
      }
      const limits = r.limits || {};
      box.innerHTML = "共 " + voiceEntries.length + " 个（上限：" + (limits.maxSeconds || "?") + " 秒 / " + Math.round((limits.maxBytes ?? 0) / 1024 / 1024) + " MiB）。统一出站上限：" + (limits.maxPerMinute === 0 ? "每分钟无限制" : esc(limits.maxPerMinute ?? "不可用") + " 条/分钟") + "，" + (limits.maxPerHour === 0 ? "每小时无限制" : esc(limits.maxPerHour ?? "不可用") + " 条/小时") + "（与文字共用发送计划）。<br>" + voiceEntries.map((v, i) => {
        const bad = v.ok === false;
        return '<label style="display:block;margin:2px 0"><input type="radio" name="voicePick" value="' + i + '"' + (i === 0 ? " checked" : "") + "> <code>" + esc(v.name) + "</code> " + (bad ? "❌ " + esc(v.error || "不可用") : esc(v.detail || "")) + "</label>";
      }).join("");
    } catch (error) {
      box.textContent = "加载失败：" + (error && error.message ? error.message : error);
    }
    if (msg) msg.textContent = "";
  }
  async function sendVoiceFromConsole() {
    const msg = document.getElementById("voiceMsg");
    const target = document.getElementById("voiceSendTarget").value.trim();
    const dryRun = document.getElementById("voiceSendDryRun").checked;
    const pick = document.querySelector('input[name="voicePick"]:checked');
    if (!target) {
      msg.textContent = "❌ 请填发送目标（如 group:20010）";
      msg.className = "meta err";
      return;
    }
    if (!pick) {
      msg.textContent = "❌ 先刷新语音库并选中一个音频";
      msg.className = "meta err";
      return;
    }
    const entry = voiceEntries[Number(pick.value)];
    msg.textContent = "发送中…";
    msg.className = "meta";
    try {
      const r = await api("/api/voice/send", "POST", { target, file: entry.name, dryRun });
      if (r.dryRun) {
        msg.textContent = "✅ 校验通过（未发送）：" + (r.detail || "");
        msg.className = "meta ok";
      } else if (r.ok) {
        msg.textContent = "✅ 已发出 messageId=" + (r.messageId ?? "?") + (r.detail ? "（" + r.detail + "）" : "") + (r.verified ? "，已回读校验为语音段" : "，未能回读校验");
        msg.className = "meta ok";
      } else {
        msg.textContent = "❌ " + (r.error || "失败");
        msg.className = "meta err";
      }
    } catch (error) {
      msg.textContent = "❌ " + (error && error.message ? error.message : error);
      msg.className = "meta err";
    }
  }
  function initialize15() {
    voiceEntries = [];
    voiceLibraryLoaded = false;
  }

  // console/layers/L/activity.js
  async function refreshV2Activity() {
    try {
      const r = await api("/api/socialV2/activity");
      const el3 = document.getElementById("v2ActivityStatus");
      el3.textContent = r.paused ? "二代 bot：已暂停" : "二代 bot：运行中";
      el3.className = r.paused ? "meta err" : "meta ok";
    } catch {
    }
  }
  function initialize16() {
    document.getElementById("v2PauseBtn").addEventListener("click", async () => {
      await api("/api/socialV2/activity", "POST", { paused: true });
      refreshV2Activity();
    });
    document.getElementById("v2ResumeBtn").addEventListener("click", async () => {
      await api("/api/socialV2/activity", "POST", { paused: false });
      refreshV2Activity();
    });
    document.getElementById("v2ResetBtn").addEventListener("click", async () => {
      if (!confirm("确定重置二代 AI 状态？\n将清空所有二代会话、唤醒配置、未读消息和定时器；工具调用日志会保留。")) return;
      const r = await api("/api/socialV2/reset", "POST", {});
      const msg = document.getElementById("lifecycleActionMessage");
      msg.textContent = r.ok ? "✅ 已重置二代状态" : "❌ " + (r.error || "失败");
      msg.className = r.ok ? "meta ok" : "meta err";
      refreshV2Activity();
    });
  }

  // console/layers/L/social-v1.js
  async function loadSocialForm() {
    try {
      const s = await api("/api/social");
      const c = s.config;
      document.getElementById("sTrigger").value = c.triggerProbability;
      document.getElementById("sCheckMin").value = Math.round((c.activeCheckMinMs || 0) / 1e3);
      document.getElementById("sCheckMax").value = Math.round((c.activeCheckMaxMs || 0) / 1e3);
      document.getElementById("sActiveDelayMin").value = Math.round((c.activeReplyDelayMinMs || 0) / 1e3);
      document.getElementById("sActiveDelayMax").value = Math.round((c.activeReplyDelayMaxMs || 0) / 1e3);
      document.getElementById("sActiveDurationEnabled").checked = c.activeDurationEnabled !== false;
      document.getElementById("sActiveDurationMin").value = Math.round((c.activeDurationMinMs || 0) / 6e4);
      document.getElementById("sActiveDurationMax").value = Math.round((c.activeDurationMaxMs || 0) / 6e4);
      document.getElementById("sIdleWindow").value = Math.round((c.idleWindowMs || 0) / 6e4);
      document.getElementById("sIdleRetry").value = c.idleRetryProbability;
      document.getElementById("sIdleWait").value = Math.round((c.idleRetryWaitMs || 0) / 6e4);
      document.getElementById("sSkipProb").value = c.skipProbability ?? 0.15;
      document.getElementById("sSurrenderProb").value = c.surrenderProbability ?? 0.08;
      document.getElementById("sContextWindow").value = c.contextWindow;
      document.getElementById("sMaxChars").value = c.maxReplyChars ?? 500;
      document.getElementById("sBurstEnabled").checked = c.burstEnabled !== false;
      document.getElementById("sBurstIntervalMin").value = c.burstIntervalMinMs ?? 1e3;
      document.getElementById("sBurstIntervalMax").value = c.burstIntervalMaxMs ?? 3e3;
      document.getElementById("sLongGapProb").value = c.longGapProbability ?? 0.1;
      document.getElementById("sLongGapMin").value = c.longGapMinMs ?? 2500;
      document.getElementById("sLongGapMax").value = c.longGapMaxMs ?? 5e3;
      document.getElementById("sKeywords").value = (c.mustReplyKeywords || []).join(", ");
      document.getElementById("sProactiveEnabled").checked = c.proactiveEnabled !== false;
      document.getElementById("sProactiveIdle").value = Math.round((c.proactiveIdleThresholdMs || 0) / 6e4);
      document.getElementById("sProactiveCheckMin").value = Math.round((c.proactiveCheckMinMs || 0) / 6e4);
      document.getElementById("sProactiveCheckMax").value = Math.round((c.proactiveCheckMaxMs || 0) / 6e4);
      document.getElementById("sProactiveProb").value = c.proactiveProbability;
    } catch {
    }
  }
  async function refreshSocialStatus() {
    try {
      const s = await api("/api/social");
      const buff = Object.entries(s.pendingSummaries || {}).map(([k, n]) => k + ":" + n).join("  ") || "无";
      const phaseLabel = { idle: "观望", active: "活跃", probing: "试探", exiting: "退场中" };
      const phaseClass = { idle: "pill g", active: "pill b", probing: "pill r", exiting: "pill" };
      const stateEntries = Object.entries(s.states || {});
      const sel = document.getElementById("sStateKey");
      const prevSel = sel.value;
      sel.innerHTML = '<option value="">选择会话</option>';
      for (const [k] of stateEntries) {
        const opt = document.createElement("option");
        opt.value = k;
        opt.textContent = k;
        sel.appendChild(opt);
      }
      if (prevSel && [...sel.options].some((o) => o.value === prevSel)) sel.value = prevSel;
      let html = "摘要缓冲: " + esc(buff) + "<br>状态:";
      if (!stateEntries.length) html += " 暂无（发过消息的群会显示状态）";
      for (const [k, v] of stateEntries) {
        html += ` <span class="${phaseClass[v.phase] || "pill"}">${esc(k)} · ${phaseLabel[v.phase] || esc(v.phase)}</span>`;
      }
      document.getElementById("socialStatus").innerHTML = html;
    } catch {
    }
  }
  async function setSocialPhase(phase) {
    const key2 = document.getElementById("sStateKey").value;
    if (!key2) {
      alert("请先选择会话");
      return;
    }
    const r = await api("/api/social/state", "POST", { key: key2, phase });
    document.getElementById("socialMsg").textContent = r.ok ? "✅ 已设为" + (phase === "active" ? "活跃" : "观望") : "❌ " + (r.error || "失败");
    document.getElementById("socialMsg").className = r.ok ? "meta ok" : "meta err";
    refreshSocialStatus();
  }
  function initialize17() {
    document.getElementById("socialSave").addEventListener("click", async () => {
      const n = (id) => Number(document.getElementById(id).value);
      const r = await api("/api/social", "POST", {
        triggerProbability: Math.min(1, Math.max(0, n("sTrigger"))),
        activeCheckMinMs: Math.max(5, n("sCheckMin")) * 1e3,
        activeCheckMaxMs: Math.max(5, n("sCheckMax")) * 1e3,
        activeReplyDelayMinMs: Math.max(0, n("sActiveDelayMin")) * 1e3,
        activeReplyDelayMaxMs: Math.max(0, n("sActiveDelayMax")) * 1e3,
        activeDurationEnabled: document.getElementById("sActiveDurationEnabled").checked,
        activeDurationMinMs: Math.max(1, n("sActiveDurationMin")) * 6e4,
        activeDurationMaxMs: Math.max(1, n("sActiveDurationMax")) * 6e4,
        idleWindowMs: Math.max(1, n("sIdleWindow")) * 6e4,
        idleRetryProbability: Math.min(1, Math.max(0, n("sIdleRetry"))),
        idleRetryWaitMs: Math.max(1, n("sIdleWait")) * 6e4,
        skipProbability: Math.min(1, Math.max(0, n("sSkipProb"))),
        surrenderProbability: Math.min(1, Math.max(0, n("sSurrenderProb"))),
        contextWindow: Math.min(100, Math.max(1, n("sContextWindow"))),
        maxReplyChars: Math.max(1, n("sMaxChars")),
        burstEnabled: document.getElementById("sBurstEnabled").checked,
        burstIntervalMinMs: Math.max(0, n("sBurstIntervalMin")),
        burstIntervalMaxMs: Math.max(0, n("sBurstIntervalMax")),
        longGapProbability: Math.min(1, Math.max(0, n("sLongGapProb"))),
        longGapMinMs: Math.max(0, n("sLongGapMin")),
        longGapMaxMs: Math.max(0, n("sLongGapMax")),
        mustReplyKeywords: document.getElementById("sKeywords").value.split(/[,，]/).map((x) => x.trim()).filter(Boolean),
        proactiveEnabled: document.getElementById("sProactiveEnabled").checked,
        proactiveIdleThresholdMs: Math.max(1, n("sProactiveIdle")) * 6e4,
        proactiveCheckMinMs: Math.max(1, n("sProactiveCheckMin")) * 6e4,
        proactiveCheckMaxMs: Math.max(1, n("sProactiveCheckMax")) * 6e4,
        proactiveProbability: Math.min(1, Math.max(0, n("sProactiveProb")))
      });
      document.getElementById("socialMsg").textContent = r.ok ? "✅ 已保存" : "❌ " + (r.error || "失败");
      document.getElementById("socialMsg").className = r.ok ? "meta ok" : "meta err";
      if (r.ok) {
        loadSocialForm();
        refreshSocialStatus();
      }
    });
    document.getElementById("socialFlush").addEventListener("click", async () => {
      const r = await api("/api/social/flush", "POST", {});
      document.getElementById("socialMsg").textContent = r.ok ? "✅ 已触发摘要投喂" : "❌ " + (r.error || "失败");
      document.getElementById("socialMsg").className = r.ok ? "meta ok" : "meta err";
    });
    document.getElementById("sStateActive").addEventListener("click", () => setSocialPhase("active"));
    document.getElementById("sStateIdle").addEventListener("click", () => setSocialPhase("idle"));
  }

  // console/layers/C/slang-state.js
  var slangEntriesCache = [];
  var slangSelected = /* @__PURE__ */ new Set();
  var slangActiveTab = "candidate";
  var slangModalId = null;
  var slangModalMode = "confirm";
  function setSlangActiveTab(value2) {
    slangActiveTab = value2;
  }
  function setSlangEntriesCache(value2) {
    slangEntriesCache = value2;
  }
  function setSlangModalId(value2) {
    slangModalId = value2;
  }
  function setSlangModalMode(value2) {
    slangModalMode = value2;
  }

  // console/layers/C/slang.js
  function slangStatusLabel(status) {
    return { candidate: "候选", confirmed: "已确认", rejected: "已拒绝" }[status] || esc(status);
  }
  function slangStatusClass(status) {
    return { candidate: "pill b", confirmed: "pill g", rejected: "pill r" }[status] || "pill";
  }
  function slangSourceLabel(e) {
    if (e.source === "manual") return "手动";
    if (Array.isArray(e.evidence) && e.evidence.some((ev) => ev.sender === "AI提交")) return "AI提交";
    return "自动提取";
  }
  function slangEvidenceHtml(e) {
    return Array.isArray(e.evidence) && e.evidence.length ? e.evidence.slice(-2).map((ev) => `<span class="meta">${esc(String(ev.sender || "未知"))}：${esc(String(ev.text || "").slice(0, 30))}</span>`).join("<br>") : '<span class="meta">—</span>';
  }
  function slangSourcesHtml(e) {
    return Array.isArray(e.sources) && e.sources.length ? e.sources.slice(0, 5).map((s) => `<span class="meta">🔗 ${esc(s)}</span>`).join("<br>") : "";
  }
  function slangSearchFields(e) {
    return [e.content, e.meaning, e.usage, e.example, e.risk, Array.isArray(e.sources) ? e.sources.join(" ") : "", Array.isArray(e.evidence) ? e.evidence.map((x) => x.text || "").join(" ") : ""].join(" ").toLowerCase();
  }
  function getSlangLimit() {
    const id = slangActiveTab === "candidate" ? "slangLimitCand" : slangActiveTab === "confirmed" ? "slangLimitConfirmed" : "slangLimitRejected";
    return Math.max(10, Number(document.getElementById(id)?.value) || 100);
  }
  function getSlangSearch() {
    const id = slangActiveTab === "candidate" ? "slangSearchCand" : slangActiveTab === "confirmed" ? "slangSearchConfirmed" : "slangSearchRejected";
    return String(document.getElementById(id)?.value || "").trim().toLowerCase();
  }
  function selectedIdsForStatus(status) {
    return [...slangSelected].filter((id) => slangEntriesCache.some((e) => e.id === id && e.status === status));
  }
  function setSlangMsg(text, ok = true) {
    const msg = document.getElementById("slangMsg");
    if (!msg) return;
    msg.textContent = text;
    msg.className = ok ? "meta ok" : "meta err";
  }
  function setSlangTab(tab) {
    setSlangActiveTab(tab);
    document.querySelectorAll("#section-slang .slang-tab").forEach((btn) => btn.classList.toggle("active", btn.dataset.slangTab === tab));
    document.querySelectorAll("#section-slang .slang-panel").forEach((panel) => panel.classList.toggle("active", panel.id === "slangPanel" + tab[0].toUpperCase() + tab.slice(1)));
    renderSlangPanel();
  }
  function updateSlangSelectAll(status) {
    const id = status === "candidate" ? "slangCandidateSelectAll" : status === "confirmed" ? "slangConfirmedSelectAll" : "slangRejectedSelectAll";
    const el3 = document.getElementById(id);
    if (!el3) return;
    const list = slangEntriesCache.filter((e) => e.status === status);
    const q = getSlangSearch();
    const filtered = q ? list.filter((e) => slangSearchFields(e).includes(q)) : list;
    el3.checked = filtered.length > 0 && filtered.every((e) => slangSelected.has(e.id));
    el3.indeterminate = filtered.some((e) => slangSelected.has(e.id)) && !el3.checked;
  }
  function renderSlangPanel() {
    const status = slangActiveTab;
    const containerId = status === "candidate" ? "slangCandidateList" : status === "confirmed" ? "slangConfirmedList" : "slangRejectedList";
    const box = document.getElementById(containerId);
    if (!box) return;
    const list = slangEntriesCache.filter((e) => e.status === status);
    const q = getSlangSearch();
    const filtered = q ? list.filter((e) => slangSearchFields(e).includes(q)) : list;
    if (!filtered.length) {
      box.innerHTML = '<div class="meta" style="padding:8px">' + (list.length ? "没有符合条件的词条" : status === "candidate" ? "暂无候选黑话，等 DSH 自动提取、AI 提交或手动添加" : status === "confirmed" ? "暂无已确认黑话" : "暂无已拒绝词条") + "</div>";
      updateSlangSelectAll(status);
      return;
    }
    const limit = getSlangLimit();
    const shown = filtered.slice(0, limit);
    let html = `<div class="meta" style="padding:6px 8px">共 ${filtered.length} 条，显示 ${shown.length} 条（可滚动查找）</div>`;
    html += "<table><tr><th>选择</th><th>词条</th><th>次数</th><th>录入 / 适用来源</th><th>含义 / 用法 / 示例</th><th>参考来源</th><th>语境证据</th><th>操作</th></tr>";
    for (const e of shown) {
      const researchLabel = status === "candidate" ? Number(e.lastInferenceCount) > 0 ? Number(e.lastInferenceCount) < Number(e.count) ? "有新语境，待复核" : e.meaning ? "已研究，待审核" : "已研究，仍不确定" : e.meaning ? "已有解释，待审核" : String(e.risk || "").startsWith("研究未确定：") ? "已研究，仍不确定" : "待研究" : "";
      const meaning = e.meaning ? esc(e.meaning) + (status === "candidate" ? '<br><span class="meta">' + researchLabel + "</span>" : "") : status === "candidate" ? '<span class="meta">' + researchLabel + "</span>" : '<span class="meta">无</span>';
      const checked = slangSelected.has(e.id) ? " checked" : "";
      const actions = [];
      if (status === "candidate") {
        actions.push(`<button class="small" data-slang-edit="${esc(e.id)}">查看 / 编辑</button>`);
        actions.push(`<button class="small" data-slang-confirm="${esc(e.id)}">确认</button>`);
        actions.push(`<details class="compact-actions"><summary>更多</summary><div class="compact-actions-menu"><button class="small" data-slang-reject="${esc(e.id)}">拒绝</button><button class="small danger" data-slang-del="${esc(e.id)}">删除</button></div></details>`);
      } else if (status === "confirmed") {
        actions.push(`<button class="small" data-slang-edit="${esc(e.id)}">编辑</button>`);
        actions.push(`<button class="small danger" data-slang-del="${esc(e.id)}">删除</button>`);
      } else {
        actions.push(`<button class="small" data-slang-restore="${esc(e.id)}">恢复候选</button>`);
        actions.push(`<button class="small danger" data-slang-del="${esc(e.id)}">删除</button>`);
      }
      html += `<tr>
      <td><input type="checkbox" data-slang-select="${esc(e.id)}"${checked}></td>
      <td><b>${esc(e.content)}</b><br><span class="${slangStatusClass(status)}">${slangStatusLabel(status)}</span></td>
      <td>${esc(e.count)}</td>
      <td>${esc(slangSourceLabel(e))}<br>${sourceKeysMarkup(e)}</td>
      <td>${meaning}${e.usage ? '<br><span class="meta">用法：' + esc(e.usage) + "</span>" : ""}${e.example ? '<br><span class="meta">例：' + esc(e.example) + "</span>" : ""}${e.risk ? '<br><span class="meta">' + (String(e.risk).startsWith("研究未确定：") ? "研究备注：" + esc(String(e.risk).slice(6)) : "风险：" + esc(e.risk)) + "</span>" : ""}</td>
      <td>${slangSourcesHtml(e) || '<span class="meta">—</span>'}</td>
      <td>${slangEvidenceHtml(e)}</td>
      <td class="row">${actions.join("")}</td>
    </tr>`;
    }
    box.innerHTML = html + "</table>";
    box.querySelectorAll("[data-slang-select]").forEach((cb) => cb.addEventListener("change", () => {
      const id = cb.dataset.slangSelect;
      if (cb.checked) slangSelected.add(id);
      else slangSelected.delete(id);
      updateSlangSelectAll(status);
    }));
    box.querySelectorAll("[data-slang-confirm]").forEach((btn) => btn.addEventListener("click", () => openSlangModal(btn.dataset.slangConfirm, "confirm")));
    box.querySelectorAll("[data-slang-edit]").forEach((btn) => btn.addEventListener("click", () => openSlangModal(btn.dataset.slangEdit, "edit")));
    box.querySelectorAll("[data-slang-reject]").forEach((btn) => btn.addEventListener("click", async () => {
      const r2 = await api("/api/slang/" + btn.dataset.slangReject + "/reject", "POST", {});
      if (!r2.ok) alert(r2.error || "拒绝失败");
      setSlangMsg(r2.ok ? "✅ 已拒绝" : "❌ " + (r2.error || "失败"), r2.ok);
      refreshSlang();
    }));
    box.querySelectorAll("[data-slang-restore]").forEach((btn) => btn.addEventListener("click", async () => {
      const e = slangEntriesCache.find((x) => x.id === btn.dataset.slangRestore);
      if (!e) return;
      const r2 = await api("/api/slang/" + e.id, "PATCH", { status: "candidate" });
      if (!r2.ok) alert(r2.error || "恢复失败");
      setSlangMsg(r2.ok ? "✅ 已恢复为候选" : "❌ " + (r2.error || "失败"), r2.ok);
      refreshSlang();
    }));
    box.querySelectorAll("[data-slang-del]").forEach((btn) => btn.addEventListener("click", async () => {
      if (!confirm("确定删除该黑话？")) return;
      const r2 = await api("/api/slang/" + btn.dataset.slangDel, "DELETE", {});
      if (!r2.ok) alert(r2.error || "删除失败");
      setSlangMsg(r2.ok ? "✅ 已删除" : "❌ " + (r2.error || "失败"), r2.ok);
      slangSelected.delete(btn.dataset.slangDel);
      refreshSlang();
    }));
    updateSlangSelectAll(status);
  }
  async function refreshSlang() {
    try {
      const r = await api("/api/slang");
      setSlangEntriesCache(r.entries || []);
      renderSlangPanel();
    } catch (e) {
      const box = document.getElementById("slangCandidateList");
      if (box) box.innerHTML = '<span class="meta">加载失败</span>';
    }
  }
  function openSlangModal(id, mode) {
    const e = slangEntriesCache.find((x) => x.id === id);
    if (!e) return;
    setSlangModalId(id);
    setSlangModalMode(mode);
    document.getElementById("slangModalTitle").textContent = mode === "confirm" ? `确认黑话：${e.content}` : `编辑黑话：${e.content}`;
    document.getElementById("slangModalContent").textContent = mode === "confirm" ? "你可以直接填写含义/用法并转正，也可以先送 DSH 深度联网研究，研究结果回来后在此处删改再确认。" : "修改后保存；候选不会转正，已确认仍保持已确认。";
    document.getElementById("slangSourceKeys").value = sourceKeysText(e);
    document.getElementById("slangModalMeaning").value = e.meaning || "";
    document.getElementById("slangModalUsage").value = e.usage || "";
    document.getElementById("slangModalExample").value = e.example || "";
    document.getElementById("slangModalRisk").value = e.risk || "";
    document.getElementById("slangModalSources").value = Array.isArray(e.sources) ? e.sources.join("\n") : "";
    document.getElementById("slangModalDirectConfirm").textContent = mode === "confirm" ? "直接确认（转正）" : "保存修改";
    document.getElementById("slangModalSendResearch").style.display = mode === "confirm" && e.status === "candidate" ? "" : "none";
    document.getElementById("slangModalOverlay").classList.add("open");
  }
  function closeSlangModal() {
    document.getElementById("slangModalOverlay").classList.remove("open");
    setSlangModalId(null);
  }
  function readSlangModalPayload() {
    return {
      sourceKeys: readSourceKeys("slangSourceKeys"),
      meaning: document.getElementById("slangModalMeaning").value.trim(),
      usage: document.getElementById("slangModalUsage").value.trim(),
      example: document.getElementById("slangModalExample").value.trim(),
      risk: document.getElementById("slangModalRisk").value.trim(),
      sources: document.getElementById("slangModalSources").value.split(/\n/).map((s) => s.trim()).filter(Boolean)
    };
  }
  async function researchSlangIds(ids, button) {
    if (!ids.length) {
      setSlangMsg("请先勾选要研究的候选词", false);
      return;
    }
    button.disabled = true;
    let researched = 0, uncertain = 0, missing = 0, requested = 0;
    try {
      for (let i = 0; i < ids.length; i += 5) {
        setSlangMsg("正在研究第 " + (Math.floor(i / 5) + 1) + " / " + Math.ceil(ids.length / 5) + " 批；本批完成后会写回词库", true);
        const result = await learningCall("slang_research_batch", { ids: ids.slice(i, i + 5) });
        researched += result.researched || 0;
        uncertain += result.uncertain || 0;
        missing += result.missing || 0;
        requested += result.requested || 0;
        await refreshSlang();
      }
      setSlangMsg("研究已写回：" + researched + " 条得到解释，" + uncertain + " 条仍不确定，" + missing + " 条未返回；请审核候选。", true);
    } catch (error) {
      await refreshSlang();
      setSlangMsg("已处理 " + requested + " / " + ids.length + " 条；研究中断：" + error.message, false);
    } finally {
      button.disabled = false;
    }
  }
  function loadSlangConfig() {
    api("/api/slang").then((r) => {
      const c = r.config || {};
      document.getElementById("slangEnabled").checked = c.enabled !== false;
      document.getElementById("slangExtractMin").value = c.extractMinMessages ?? 10;
      document.getElementById("slangCooldown").value = c.extractCooldownMs ?? 3e5;
      document.getElementById("slangThresholds").value = (c.inferenceThresholds || [2, 4, 8]).join(", ");
      document.getElementById("slangInjectMax").value = c.injectMax ?? 8;
      document.getElementById("slangLearnerPreset").value = c.learnerPreset || "qq-chat";
      document.getElementById("slangWorkspaceTitle").value = c.workspaceTitle || "QQ 黑话学习";
      document.getElementById("slangAutoResearch").checked = c.autoResearch !== false;
    }).catch(() => {
    });
  }
  function initialize18() {
    document.querySelectorAll("#section-slang .slang-tab").forEach((btn) => btn.addEventListener("click", () => setSlangTab(btn.dataset.slangTab)));
    document.getElementById("slangSearchCand").addEventListener("input", renderSlangPanel);
    document.getElementById("slangSearchConfirmed").addEventListener("input", renderSlangPanel);
    document.getElementById("slangSearchRejected").addEventListener("input", renderSlangPanel);
    document.getElementById("slangLimitCand").addEventListener("change", renderSlangPanel);
    document.getElementById("slangLimitConfirmed").addEventListener("change", renderSlangPanel);
    document.getElementById("slangLimitRejected").addEventListener("change", renderSlangPanel);
    document.getElementById("slangCandidateSelectAll").addEventListener("change", (e) => {
      const list = slangEntriesCache.filter((x) => x.status === "candidate");
      const q = getSlangSearch();
      const filtered = q ? list.filter((x) => slangSearchFields(x).includes(q)) : list;
      for (const x of filtered) {
        if (e.target.checked) slangSelected.add(x.id);
        else slangSelected.delete(x.id);
      }
      renderSlangPanel();
    });
    document.getElementById("slangConfirmedSelectAll").addEventListener("change", (e) => {
      const list = slangEntriesCache.filter((x) => x.status === "confirmed");
      const q = getSlangSearch();
      const filtered = q ? list.filter((x) => slangSearchFields(x).includes(q)) : list;
      for (const x of filtered) {
        if (e.target.checked) slangSelected.add(x.id);
        else slangSelected.delete(x.id);
      }
      renderSlangPanel();
    });
    document.getElementById("slangRejectedSelectAll").addEventListener("change", (e) => {
      const list = slangEntriesCache.filter((x) => x.status === "rejected");
      const q = getSlangSearch();
      const filtered = q ? list.filter((x) => slangSearchFields(x).includes(q)) : list;
      for (const x of filtered) {
        if (e.target.checked) slangSelected.add(x.id);
        else slangSelected.delete(x.id);
      }
      renderSlangPanel();
    });
    document.getElementById("slangBatchResearch").addEventListener("click", async (event) => {
      const ids = selectedIdsForStatus("candidate");
      await researchSlangIds(ids, event.currentTarget);
    });
    document.getElementById("slangBatchConfirm").addEventListener("click", async () => {
      const ids = selectedIdsForStatus("candidate");
      if (!ids.length) {
        alert("请先勾选要确认的候选词");
        return;
      }
      if (!confirm(`确定批量确认 ${ids.length} 条候选？缺少含义的会被跳过。`)) return;
      const r = await api("/api/slang/batch-confirm", "POST", { ids });
      setSlangMsg(r.ok ? `✅ 已确认 ${r.confirmedCount} 条，跳过 ${r.skippedCount} 条` : "❌ " + (r.error || "失败"), r.ok);
      if (r.ok) {
        slangSelected.clear();
        refreshSlang();
      }
    });
    document.getElementById("slangBatchReject").addEventListener("click", async () => {
      const ids = selectedIdsForStatus("candidate");
      if (!ids.length) {
        alert("请先勾选要拒绝的候选词");
        return;
      }
      if (!confirm(`确定拒绝 ${ids.length} 条候选？`)) return;
      const r = await api("/api/slang/batch-reject", "POST", { ids });
      setSlangMsg(r.ok ? `✅ 已拒绝 ${r.rejectedCount} 条` : "❌ " + (r.error || "失败"), r.ok);
      if (r.ok) {
        slangSelected.clear();
        refreshSlang();
      }
    });
    document.getElementById("slangBatchDeleteCand").addEventListener("click", async () => {
      const ids = selectedIdsForStatus("candidate");
      if (!ids.length) {
        alert("请先勾选要删除的候选词");
        return;
      }
      if (!confirm(`确定删除 ${ids.length} 条候选？此操作不可恢复！`)) return;
      const r = await api("/api/slang/batch-delete", "POST", { ids });
      setSlangMsg(r.ok ? `✅ 已删除 ${r.removedCount} 条候选` : "❌ " + (r.error || "失败"), r.ok);
      if (r.ok) {
        slangSelected.clear();
        refreshSlang();
      }
    });
    document.getElementById("slangBatchDeleteConfirmed").addEventListener("click", async () => {
      const ids = selectedIdsForStatus("confirmed");
      if (!ids.length) {
        alert("请先勾选要删除的已确认词条");
        return;
      }
      if (!confirm(`确定删除 ${ids.length} 条已确认黑话？此操作不可恢复！`)) return;
      const r = await api("/api/slang/batch-delete", "POST", { ids });
      setSlangMsg(r.ok ? `✅ 已删除 ${r.removedCount} 条已确认` : "❌ " + (r.error || "失败"), r.ok);
      if (r.ok) {
        slangSelected.clear();
        refreshSlang();
      }
    });
    document.getElementById("slangBatchDeleteRejected").addEventListener("click", async () => {
      const ids = selectedIdsForStatus("rejected");
      if (!ids.length) {
        alert("请先勾选要删除的已拒绝词条");
        return;
      }
      if (!confirm(`确定删除 ${ids.length} 条已拒绝词条？此操作不可恢复！`)) return;
      const r = await api("/api/slang/batch-delete", "POST", { ids });
      setSlangMsg(r.ok ? `✅ 已删除 ${r.removedCount} 条已拒绝` : "❌ " + (r.error || "失败"), r.ok);
      if (r.ok) {
        slangSelected.clear();
        refreshSlang();
      }
    });
    document.getElementById("slangBatchRestore").addEventListener("click", async () => {
      const ids = selectedIdsForStatus("rejected");
      if (!ids.length) {
        alert("请先勾选要恢复的已拒绝词条");
        return;
      }
      let okCount = 0;
      for (const id of ids) {
        const r = await api("/api/slang/" + id, "PATCH", { status: "candidate" });
        if (r.ok) okCount++;
      }
      setSlangMsg(`✅ 已恢复 ${okCount}/${ids.length} 条为候选`);
      if (okCount) {
        slangSelected.clear();
        refreshSlang();
      }
    });
    document.getElementById("slangModalDirectConfirm").addEventListener("click", async () => {
      if (!slangModalId) return;
      let payload;
      try {
        await requireLearningScopes();
        payload = readSlangModalPayload();
      } catch (error) {
        setSlangMsg(error.message, false);
        return;
      }
      if (!payload.meaning) {
        alert("请先填写含义，确认后才会注入 AI 上下文");
        return;
      }
      const e = slangEntriesCache.find((x) => x.id === slangModalId);
      if (!e) return;
      const path = slangModalMode === "confirm" ? `/api/slang/${e.id}/confirm` : `/api/slang/${e.id}`;
      const r2 = await api(path, slangModalMode === "confirm" ? "POST" : "PATCH", payload);
      if (!r2.ok) alert(r2.error || "保存失败");
      setSlangMsg(r2.ok ? slangModalMode === "confirm" ? "✅ 已确认转正" : "✅ 已保存" : "❌ " + (r2.error || "失败"), r2.ok);
      closeSlangModal();
      refreshSlang();
    });
    document.getElementById("slangModalSendResearch").addEventListener("click", async (event) => {
      if (!slangModalId) return;
      await researchSlangIds([slangModalId], event.currentTarget);
      closeSlangModal();
    });
    document.getElementById("slangModalCancel").addEventListener("click", closeSlangModal);
    document.getElementById("slangModalOverlay").addEventListener("click", (e) => {
      if (e.target.id === "slangModalOverlay") closeSlangModal();
    });
    document.getElementById("slangAdd").addEventListener("click", async () => {
      const content = document.getElementById("slangContent").value.trim();
      const meaning = document.getElementById("slangMeaning").value.trim();
      const usage = document.getElementById("slangUsage").value.trim();
      const example = document.getElementById("slangExample").value.trim();
      if (!content) {
        alert("词条不能为空");
        return;
      }
      let scope;
      try {
        await requireLearningScopes();
        scope = readSourceKeys("slangManualSourceKeys");
      } catch (error) {
        setSlangMsg(error.message, false);
        return;
      }
      const r = await api("/api/slang", "POST", { content, meaning, usage, example, sourceKeys: scope });
      document.getElementById("slangMsg").textContent = r.ok ? "✅ 已添加" : "❌ " + (r.error || "失败");
      document.getElementById("slangMsg").className = r.ok ? "meta ok" : "meta err";
      if (r.ok) {
        document.getElementById("slangContent").value = "";
        document.getElementById("slangMeaning").value = "";
        document.getElementById("slangUsage").value = "";
        document.getElementById("slangExample").value = "";
        refreshSlang();
      }
    });
    document.getElementById("slangExtract").addEventListener("click", async () => {
      const r = await api("/api/slang/extract", "POST", {});
      setSlangMsg(r.ok ? "✅ 已触发提取" : "❌ " + (r.error || "失败"), r.ok);
    });
    document.getElementById("slangResearch").addEventListener("click", async (event) => {
      await researchSlangIds(slangEntriesCache.filter((e) => e.status === "candidate").map((e) => e.id), event.currentTarget);
    });
    document.getElementById("slangConfigSave").addEventListener("click", async () => {
      try {
        await requireLearningScopes();
      } catch (error) {
        setSlangMsg(error.message, false);
        return;
      }
      const r = await api("/api/slang/config", "POST", {
        enabled: document.getElementById("slangEnabled").checked,
        extractMinMessages: Number(document.getElementById("slangExtractMin").value) || 10,
        extractCooldownMs: Number(document.getElementById("slangCooldown").value) || 3e5,
        inferenceThresholds: document.getElementById("slangThresholds").value.split(/[,，\s]+/).map(Number).filter(Boolean),
        injectMax: Number(document.getElementById("slangInjectMax").value),
        learnerPreset: document.getElementById("slangLearnerPreset").value.trim(),
        workspaceTitle: document.getElementById("slangWorkspaceTitle").value.trim(),
        autoResearch: document.getElementById("slangAutoResearch").checked
      });
      const msg = document.getElementById("slangConfigMsg");
      msg.textContent = r.ok ? "✅ 已保存" : "❌ " + (r.error || "失败");
      msg.className = r.ok ? "meta ok" : "meta err";
      if (r.ok) loadSlangConfig();
    });
  }

  // console/shared/accessibility.js
  var primaryActions;
  var searchInput;
  var searchResults;
  var featureIndex;
  function closeConsoleSearch() {
    searchResults.hidden = true;
    searchInput.setAttribute("aria-expanded", "false");
  }
  var modalPreviousFocus;
  var slangOverlay;
  var tokenToggle;
  function initialize19() {
    document.querySelectorAll("input,select,textarea").forEach((input) => {
      if (input.labels?.length || input.hasAttribute("aria-label")) return;
      let label2 = input.previousElementSibling;
      while (label2 && label2.tagName !== "LABEL") label2 = label2.previousElementSibling;
      if (label2) {
        const siblings = [];
        let next = label2.nextElementSibling;
        while (next && next.tagName !== "LABEL") {
          if (next.matches("input,select,textarea")) siblings.push(next);
          next = next.nextElementSibling;
        }
        input.setAttribute("aria-label", label2.textContent.trim() + (siblings.length > 1 ? siblings.indexOf(input) === 0 ? "（下限）" : "（上限）" : ""));
      } else {
        const names2 = { consoleTokenInput: "新的控制台访问令牌", closedPreset: "封闭 Agent 使用的 DSH 预设", tsKind: "测试消息目标类型", aiNotifyKind: "后台提醒目标类型", sStateKey: "一代仿真会话", slangLimitCand: "候选词显示数量", slangLimitConfirmed: "已确认词显示数量", slangLimitRejected: "已拒绝词显示数量" };
        input.setAttribute("aria-label", names2[input.id] || input.placeholder || input.closest("section")?.querySelector("h2")?.textContent || "设置");
      }
    });
    primaryActions = ["roleSet", "roleCreate", "socialSave", "v2ConfigSaveTop", "wlSave", "secInterceptNotifySave", "secInterceptTextSave", "consoleTokenSave", "tsSend", "aiNotifySend", "slangAdd", "slangConfigSave", "slangModalDirectConfirm"];
    primaryActions.forEach((id) => document.getElementById(id)?.classList.add("primary"));
    document.querySelectorAll('.meta[id$="Msg"], .meta[id$="Msg2"]').forEach((el3) => el3.setAttribute("role", "status"));
    document.getElementById("section-mode").querySelector("h2").dataset.note = "选择后即时生效";
    document.getElementById("section-activity").querySelector("h2").dataset.note = "每 3 秒自动同步";
    searchInput = document.getElementById("consoleSearch");
    searchResults = document.getElementById("searchResults");
    featureIndex = [];
    document.querySelectorAll("section[data-page]").forEach((section2) => {
      const page = section2.dataset.page;
      featureIndex.push({ page, label: section2.querySelector("h2")?.textContent || "", target: section2 });
      section2.querySelectorAll("details.settings-group>summary,input,textarea,select").forEach((el3) => {
        let label2 = el3.tagName === "SUMMARY" ? el3.textContent : el3.getAttribute("aria-label") || el3.labels?.[0]?.textContent || el3.placeholder;
        if (label2) featureIndex.push({ page, label: label2.trim(), target: el3 });
      });
    });
    searchInput.addEventListener("input", () => {
      const query = searchInput.value.trim().toLowerCase();
      searchResults.replaceChildren();
      if (!query) return closeConsoleSearch();
      const matches = featureIndex.filter((entry) => (consolePages[entry.page][0] + entry.label + entry.target.id).toLowerCase().includes(query)).slice(0, 12);
      if (!matches.length) {
        const empty = document.createElement("p");
        empty.textContent = "未找到匹配功能，试试「唤醒」「白名单」或「表情」。";
        searchResults.append(empty);
      }
      matches.forEach((entry) => {
        const button = document.createElement("button");
        const title = document.createElement("span");
        title.textContent = entry.label;
        const caption = document.createElement("small");
        caption.textContent = consolePages[entry.page][0];
        button.append(title, caption);
        button.addEventListener("click", () => {
          setConsolePage(entry.page);
          let ancestor = entry.target.closest("details");
          while (ancestor) {
            ancestor.open = true;
            ancestor = ancestor.parentElement.closest("details");
          }
          if (entry.target.closest("#section-slang .slang-panel")) {
            const panels = { slangPanelCandidate: "candidate", slangPanelConfirmed: "confirmed", slangPanelRejected: "rejected" };
            setSlangTab(panels[entry.target.closest(".slang-panel").id]);
          }
          const aliasPanel = entry.target.closest("#section-alias .alias-panel");
          if (aliasPanel) document.querySelector('#aliasTabs [data-alias-tab="' + aliasPanel.id.replace("aliasPanel", "").toLowerCase() + '"]')?.click();
          const termPanel = entry.target.closest("#section-terms .terms-panel");
          if (termPanel) document.querySelector('#termsTabs [data-term-tab="' + termPanel.id.replace("termsPanel", "").toLowerCase() + '"]')?.click();
          entry.target.scrollIntoView({ block: "center", behavior: "instant" });
          if (!entry.target.hasAttribute("tabindex") && !entry.target.matches("input,textarea,select,button,summary")) entry.target.tabIndex = -1;
          entry.target.focus({ preventScroll: true });
          entry.target.classList.add("search-highlight");
          setTimeout(() => entry.target.classList.remove("search-highlight"), 2e3);
        });
        searchResults.append(button);
      });
      searchResults.hidden = false;
      searchInput.setAttribute("aria-expanded", "true");
    });
    searchInput.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeConsoleSearch();
      if ((event.key === "ArrowDown" || event.key === "Enter") && !searchResults.hidden) {
        event.preventDefault();
        searchResults.querySelector("button")?.focus();
      }
    });
    document.addEventListener("click", (event) => {
      if (!event.target.closest(".search-wrap")) closeConsoleSearch();
    });
    searchResults.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeConsoleSearch();
        searchInput.focus();
      }
    });
    slangOverlay = document.getElementById("slangModalOverlay");
    new MutationObserver(() => {
      if (slangOverlay.classList.contains("open")) {
        modalPreviousFocus = document.activeElement;
        document.getElementById("slangModalMeaning").focus();
      } else modalPreviousFocus?.focus();
    }).observe(slangOverlay, { attributes: true, attributeFilter: ["class"] });
    slangOverlay.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeSlangModal();
      }
      if (event.key === "Tab") {
        const controls = [...slangOverlay.querySelectorAll("button,input,textarea,select")].filter((el3) => !el3.disabled && el3.getClientRects().length);
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    });
    tokenToggle = document.createElement("button");
    tokenToggle.id = "consoleTokenToggle";
    tokenToggle.className = "small";
    tokenToggle.textContent = "显示令牌";
    tokenToggle.type = "button";
    tokenToggle.setAttribute("aria-pressed", "false");
    tokenToggle.addEventListener("click", () => {
      const input = document.getElementById("consoleTokenInput");
      const visible = input.type === "password";
      input.type = visible ? "text" : "password";
      tokenToggle.textContent = visible ? "隐藏令牌" : "显示令牌";
      tokenToggle.setAttribute("aria-pressed", String(visible));
    });
    document.getElementById("consoleTokenInput").after(tokenToggle);
  }

  // console/layers/O/usage-chart.js
  var usageChartHours;
  var usageChartMetric;
  var usageChartData;
  var SVG_NS;
  function svgEl(name, attrs = {}) {
    const node = document.createElementNS(SVG_NS, name);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    return node;
  }
  function usageBucketValue(b, metric2) {
    return metric2 === "tokens" ? Number(b.tokens) || 0 : Number(b.cost) || 0;
  }
  function usageMetricLabel(metric2) {
    return metric2 === "tokens" ? "token" : "花费";
  }
  function usageAxisValue(v, metric2, sym) {
    if (metric2 === "tokens") return usageNum(v);
    if (v === 0) return sym + "0";
    return v < 0.01 ? sym + v.toFixed(4) : sym + v.toFixed(2);
  }
  function usageBucketClock(ms, bucketMs) {
    const d = new Date(ms);
    const p = (n) => String(n).padStart(2, "0");
    if (bucketMs >= 24 * 3600 * 1e3) return `${d.getMonth() + 1}/${d.getDate()}`;
    return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  function renderUsageChart(series) {
    const box = document.getElementById("usageChart");
    const totalEl = document.getElementById("usageChartTotal");
    const hintEl = document.getElementById("usageChartHint");
    const noteEl = document.getElementById("usageChartNote");
    usageChartData = series;
    const sym = series?.symbol || "¥";
    const buckets = Array.isArray(series?.buckets) ? series.buckets : [];
    if (!buckets.length) {
      box.innerHTML = "";
      box.textContent = "暂无数据";
      totalEl.textContent = "—";
      hintEl.textContent = "还没有用量记录";
      noteEl.textContent = "";
      return;
    }
    const metric2 = usageChartMetric;
    const values = buckets.map((b) => usageBucketValue(b, metric2));
    const max = Math.max(...values, 0);
    const scaleMax = max > 0 ? max : 1;
    const W = 960;
    const H = 240;
    const padL = 62;
    const padR = 12;
    const padT = 12;
    const padB = 34;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;
    const step = plotW / buckets.length;
    const barW = Math.max(2, step * 0.72);
    const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": `${usageMetricLabel(metric2)}随时间的走势图` });
    for (let i = 0; i <= 2; i += 1) {
      const y = padT + plotH - plotH * i / 2;
      svg.appendChild(svgEl("line", { class: "usage-grid", x1: padL, y1: y, x2: W - padR, y2: y }));
      const label2 = svgEl("text", { class: "usage-axis", x: padL - 8, y: y + 3, "text-anchor": "end" });
      label2.textContent = usageAxisValue(max > 0 ? scaleMax * i / 2 : 0, metric2, sym);
      svg.appendChild(label2);
    }
    for (let i = 0; i < buckets.length; i += 1) {
      const b = buckets[i];
      const v = values[i];
      const x = padL + i * step + (step - barW) / 2;
      const h = v > 0 ? Math.max(1.5, v / scaleMax * plotH) : 0;
      const tooltip = svgEl("title");
      tooltip.textContent = `${usageBucketClock(b.t, series.bucketMs)}
${usageMetricLabel(metric2)}：${usageAxisValue(v, metric2, sym)}
未命中输入：${usageNum(b.cacheMiss)} ｜ 命中输入：${usageNum(b.cacheHit)} ｜ 输出：${usageNum(b.output)}
步数：${usageNum(b.steps)} ｜ 轮次：${usageNum(b.turns)}
时段：${b.tier === "peak" ? "高峰（单价 ×2）" : b.tier === "mixed" ? "跨时段" : "空闲"}` + (b.keys?.length ? `
会话：${b.keys.join("、")}` : "");
      if (h > 0) {
        const rect = svgEl("rect", { x, y: padT + plotH - h, width: barW, height: h, rx: 2, class: `usage-bar-${b.tier === "peak" ? "peak" : b.tier === "mixed" ? "mixed" : "off"}` });
        rect.appendChild(tooltip);
        svg.appendChild(rect);
      }
      const hit = svgEl("rect", { x: padL + i * step, y: padT, width: step, height: plotH, class: "usage-hit" });
      hit.appendChild(tooltip.cloneNode(true));
      svg.appendChild(hit);
    }
    const tickEvery = Math.max(1, Math.ceil(buckets.length / 6));
    for (let i = 0; i < buckets.length; i += tickEvery) {
      const label2 = svgEl("text", { class: "usage-axis", x: padL + i * step + step / 2, y: H - padB + 16, "text-anchor": "middle" });
      label2.textContent = usageBucketClock(buckets[i].t, series.bucketMs);
      svg.appendChild(label2);
    }
    box.innerHTML = "";
    box.appendChild(svg);
    const windowTotal = buckets.reduce((sum, b) => sum + usageBucketValue(b, metric2), 0);
    totalEl.textContent = metric2 === "tokens" ? `${usageNum(windowTotal)} token` : usageMoney(windowTotal, sym);
    const busiest = series.busiest;
    hintEl.textContent = `窗口内合计 ｜ 每格 ${Math.round(series.bucketMs / 6e4)} 分钟` + (busiest && metric2 === "cost" ? ` ｜ 最贵一格：${usageBucketClock(busiest.t, series.bucketMs)} ${usageMoney(busiest.cost, sym)}` : "") + (series.estimated ? " ｜ ⚠️ 含按兜底价估算的模型" : "");
    const notes = [];
    if (Number(series.offChartCost) > 1e-4) {
      notes.push(`另有 ${usageMoney(series.offChartCost, sym)}（约 ${usageNum(series.offChartTokens)} token）属于更早的历史，只有累计值、没有逐时明细，因此不在上图里；所以本图合计会小于「总花费」。`);
    }
    if (series.countedSamples === 0) {
      notes.push("所选时间窗内没有采样：要么这段时间真的没调用，要么逐轮明细已被容量上限淘汰（累计总量仍然准确）。");
    }
    noteEl.textContent = notes.join(" ");
  }
  async function refreshUsageChart() {
    try {
      const r = await api(`/api/tokens/series?hours=${usageChartHours}`);
      renderUsageChart(r);
    } catch (error) {
      document.getElementById("usageChart").textContent = `走势读取失败：${error?.message || "未知错误"}`;
    }
  }
  function initialize20() {
    usageChartHours = 24;
    usageChartMetric = "cost";
    usageChartData = null;
    SVG_NS = "http://www.w3.org/2000/svg";
    document.getElementById("usageChartControls").addEventListener("click", (ev) => {
      const hoursBtn = ev.target.closest("[data-usage-hours]");
      const metricBtn = ev.target.closest("[data-usage-metric]");
      if (hoursBtn) {
        usageChartHours = Number(hoursBtn.dataset.usageHours) || 24;
        document.querySelectorAll("#usageChartControls [data-usage-hours]").forEach((b) => b.classList.toggle("active", b === hoursBtn));
        refreshUsageChart();
      } else if (metricBtn) {
        usageChartMetric = metricBtn.dataset.usageMetric === "tokens" ? "tokens" : "cost";
        document.querySelectorAll("#usageChartControls [data-usage-metric]").forEach((b) => b.classList.toggle("active", b === metricBtn));
        if (usageChartData) renderUsageChart(usageChartData);
      }
    });
  }

  // console/layers/O/usage.js
  var usageSelectedKey;
  var usageConversationsCache;
  function usageNum(n) {
    const v = Number(n) || 0;
    if (v >= 1e8) return (v / 1e8).toFixed(2) + " 亿";
    if (v >= 1e5) return (v / 1e4).toFixed(0) + " 万";
    if (v >= 1e4) return (v / 1e4).toFixed(1) + " 万";
    return String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }
  function usageMoney(n, sym) {
    const s = sym || "¥";
    const v = Number(n) || 0;
    if (v === 0) return s + "0";
    if (v < 0.01) return s + v.toFixed(4);
    return s + v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }
  function usagePct(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return "—";
    return (v * 100).toFixed(1) + "%";
  }
  function usageRate(buckets) {
    const b = buckets || {};
    const input = (b.cacheMiss || 0) + (b.cacheHit || 0) + (b.cacheWrite || 0);
    return input > 0 ? (b.cacheHit || 0) / input : 0;
  }
  function usageTime(ms) {
    if (!ms) return "—";
    try {
      return new Date(ms).toLocaleString("zh-CN", { hour12: false });
    } catch (error) {
      return "—";
    }
  }
  function usageBar(share) {
    const ratio = Math.max(0, Math.min(1, Number(share) || 0));
    const width = Math.max(2, Math.round(ratio * 100));
    return `<span class="usage-bar-wrap"><span class="usage-bar-track"><span class="usage-bar-fill" style="width:${width}%"></span></span><span class="meta">${(ratio * 100).toFixed(1)}%</span></span>`;
  }
  function usageTierTag(tier) {
    if (tier === "peak") return '<span class="pill r usage-tier">高峰</span>';
    if (tier === "off") return '<span class="pill g usage-tier">空闲</span>';
    if (tier === "mixed") return '<span class="pill b usage-tier">跨时段</span>';
    return '<span class="meta">—</span>';
  }
  function syncUsageKeySelect(keys) {
    const sel = document.getElementById("usageKeySelect");
    if (!sel) return;
    if (!keys.includes(usageSelectedKey)) usageSelectedKey = keys[0] || "";
    const signature = keys.join("\0");
    if (sel.dataset.signature !== signature) {
      sel.dataset.signature = signature;
      sel.innerHTML = keys.length ? keys.map((k) => `<option value="${esc(k)}">${esc(k)}</option>`).join("") : '<option value="">（暂无会话）</option>';
    }
    if (document.activeElement !== sel) sel.value = usageSelectedKey;
  }
  function renderUsageConversations(r) {
    const box = document.getElementById("usageConversations");
    const list = r.conversations || [];
    const sym = r.symbol || "¥";
    usageConversationsCache = list;
    if (!list.length) {
      box.innerHTML = '<div class="empty-state"><strong>还没有用量记录</strong><p>QQ 会话产生一次 LLM 调用后，这里会按群 / 好友列出 token 与花费。新账本从桥接重启后开始记账。</p></div>';
      return;
    }
    const maxCost = Math.max(...list.map((x) => Number(x.cost) || 0), 0);
    let html = '<table><tr><th>会话</th><th>类型</th><th class="num">轮数</th><th class="num">步数</th><th class="num">未命中输入</th><th class="num">命中输入</th><th class="num">命中率</th><th class="num">输出</th><th class="num">花费</th><th>占比</th></tr>';
    for (const c of list) {
      const key2 = String(c.key ?? "");
      const isInternal = key2.startsWith("internal:");
      const type = isInternal ? '<span class="pill b">内部</span>' : key2.startsWith("private:") ? '<span class="pill b">私聊</span>' : '<span class="pill g">群</span>';
      const b = c.buckets || {};
      html += `<tr><td class="usage-key"><button class="usage-key-button" data-usage-key="${esc(key2)}" aria-pressed="${key2 === usageSelectedKey}">${esc(key2)}</button></td><td>${type}</td><td class="num">${usageNum(c.turns)}</td><td class="num">${usageNum(c.steps)}</td><td class="num">${usageNum(b.cacheMiss)}</td><td class="num">${usageNum(b.cacheHit)}</td><td class="num">${usagePct(usageRate(b))}</td><td class="num">${usageNum(b.output)}</td><td class="num">${usageMoney(c.cost, sym)}</td><td>${usageBar(maxCost > 0 ? (Number(c.cost) || 0) / maxCost : 0)}</td></tr>`;
    }
    html += "</table>";
    const totals = r.totals || {};
    if (Number(totals.unattributedCost) > 0) {
      html += `<div class="meta" style="padding:8px 10px">其中 ${usageMoney(totals.unattributedCost, sym)} 来自更早的回合：它们只剩累计值（在逐轮快照窗口之外），无法再拆到具体某一轮。</div>`;
    }
    if (totals.estimated) {
      html += '<div class="meta" style="padding:8px 10px">⚠️ 有模型未登记在价目表里，这部分按 <code>deepseek-flash</code> 兜底价估算，可在 <code>config.json</code> 的 <code>pricing.models</code> 补充。</div>';
    }
    box.innerHTML = html;
    box.querySelectorAll("[data-usage-key]").forEach((btn) => btn.addEventListener("click", () => {
      usageSelectedKey = btn.dataset.usageKey;
      box.querySelectorAll("[data-usage-key]").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.usageKey === usageSelectedKey)));
      const sel = document.getElementById("usageKeySelect");
      if (sel) sel.value = usageSelectedKey;
      refreshUsageTurns();
    }));
  }
  var budgetRefreshRevision = 0;
  async function refreshUsageBudgets() {
    const ticket = ++budgetRefreshRevision;
    const box = document.getElementById("usageBudgets");
    const msg = document.getElementById("usageBudgetMsg");
    if (box.contains(document.activeElement) || box.querySelector("[data-budget-dirty]")) return;
    try {
      const result = await api("/api/tokens/budgets");
      if (ticket !== budgetRefreshRevision || box.contains(document.activeElement) || box.querySelector("[data-budget-dirty]")) return;
      const rows = result.rows || [];
      const ownerEnabled = result.owner?.budgetEnabled !== false;
      const ownerInput = document.getElementById("usageOwnerBudgetEnabled");
      if (document.activeElement !== ownerInput && !ownerInput.dataset.dirty) ownerInput.checked = ownerEnabled;
      const money = (value2) => usageMoney(value2, result.symbol || "¥");
      const global = result.global || {};
      document.getElementById("usageGlobalTurns").textContent = usageNum(global.turns);
      document.getElementById("usageGlobalCost").textContent = money(global.cost);
      const globalInput = document.getElementById("usageGlobalLimit");
      if (document.activeElement !== globalInput) globalInput.value = Number(global.limit) || 0;
      const windows = result.recoveryWindows || {};
      for (const [id, field] of [["usageRecoveryPrivate", "privateMessages"], ["usageRecoveryGroup", "groupMessages"], ["usageRecoveryGroupAt", "groupAtMessages"]]) {
        const input = document.getElementById(id);
        if (input && document.activeElement !== input) input.value = Number(windows[field]) || 5;
      }
      document.getElementById("usageGlobalState").textContent = global.reached ? ownerEnabled ? "已触发：全部会话进入机械回复" : "已触发：受限会话进入机械回复，owner 豁免" : global.remaining == null ? "未设统一上限" : `统一剩余 ${money(global.remaining)}`;
      box.innerHTML = rows.length ? '<table><tr><th>会话</th><th class="num">本周期轮数</th><th class="num">已用</th><th class="num">剩余</th><th>状态</th><th>冷漠阈值（元）</th><th>上限（元）</th><th>冷漠间隔（分钟）</th><th></th></tr>' + rows.map((row) => `<tr data-budget-key="${esc(row.key)}"><td>${esc(row.key)}</td><td class="num">${usageNum(row.turns)}</td><td class="num">${money(row.cost)}${row.partial ? ' <span title="部分历史用量无法按时段归属">*</span>' : ""}</td><td class="num">${row.remainingYuan == null ? "不限" : money(row.remainingYuan)}</td><td>${row.exempt ? "管理员豁免" : row.stage === "silent" ? "机械回复" : row.stage === "weak" ? "低频短回复" : "正常"}${Number(row.recoveryPending) > 0 ? `（待补 ${usageNum(row.recoveryPending)} 条）` : ""}</td><td><input type="number" min="0" step="0.01" value="${Number(row.coldLimitYuan) || 0}" style="width:90px"></td><td><input type="number" min="0" step="0.01" value="${Number(row.hardLimitYuan) || 0}" style="width:90px"></td><td><input type="number" min="1" max="1440" step="1" value="${Number(row.weakMinIntervalMin) || 30}" style="width:75px"></td><td><button class="small primary" data-budget-save data-save-action>保存此会话额度</button></td></tr>`).join("") + "</table>" : '<div class="empty-state">暂无可配置的会话；有 QQ 会话后会自动列出。</div>';
      if (rows.some((row) => row.partial)) {
        msg.textContent = "* 部分旧用量只有累计值，无法准确归入本周期；额度判断基于有时间戳的调用。";
        msg.className = "meta";
      } else if (!msg.classList.contains("ok")) {
        msg.textContent = "";
        msg.className = "meta";
      }
    } catch (error) {
      box.textContent = "阈值读取失败：" + (error?.message || "未知错误");
    }
  }
  var usageMechanicalDirty;
  var mechanicalPrivateBox;
  var mechanicalGroupBox;
  async function refreshUsageMechanicalReplies() {
    if (usageMechanicalDirty) return;
    const msg = document.getElementById("usageMechanicalMsg");
    try {
      const result = await api("/api/tokens/budgets/replies");
      if (usageMechanicalDirty) return;
      mechanicalPrivateBox.value = (result.privateReplies || []).join("\n");
      mechanicalGroupBox.value = (result.groupReplies || []).join("\n");
      if (!msg.classList.contains("ok")) msg.textContent = "";
    } catch (error) {
      msg.textContent = "词条读取失败：" + error.message;
      msg.className = "meta err";
    }
  }
  function renderUsageTurns(r) {
    const box = document.getElementById("usageTurns");
    const scope = document.getElementById("usageTurnScope");
    const rows = r.turns || [];
    const sym = r.symbol || "¥";
    if (scope) {
      scope.textContent = `${esc(r.key || "")} ｜ 共 ${rows.length} 轮可追溯 ｜ 已归属 ${usageMoney(r.attributedCost, sym)}` + (Number(r.unattributedCost) > 0 ? ` ｜ 未逐轮归属 ${usageMoney(r.unattributedCost, sym)}` : "");
    }
    if (!rows.length) {
      box.innerHTML = '<span class="meta">该会话还没有可追溯的逐轮记录（只有累计值）。</span>';
      return;
    }
    let html = '<table><tr><th class="num">轮次</th><th>结束时间</th><th class="num">步数</th><th class="num">未命中输入</th><th class="num">命中输入</th><th class="num">命中率</th><th class="num">输出</th><th class="num">花费</th><th>时段</th></tr>';
    for (const t of rows) {
      const b = t.buckets || {};
      html += `<tr><td class="num">#${esc(t.turn)}</td><td>${esc(usageTime(t.endedAt))}</td><td class="num">${usageNum(t.steps)}</td><td class="num">${usageNum(b.cacheMiss)}</td><td class="num">${usageNum(b.cacheHit)}</td><td class="num">${usagePct(usageRate(b))}</td><td class="num">${usageNum(b.output)}</td><td class="num">${usageMoney(t.cost, sym)}</td><td>${usageTierTag(t.tier)}</td></tr>`;
    }
    box.innerHTML = html + "</table>";
  }
  function renderUsageRecent(r) {
    const box = document.getElementById("usageRecent");
    const list = r.entries || [];
    const sym = r.symbol || "¥";
    if (!list.length) {
      box.innerHTML = '<span class="meta">（空）</span>';
      return;
    }
    let html = '<table><tr><th>时间</th><th>会话</th><th class="num">轮</th><th class="num">步</th><th class="num">未命中</th><th class="num">命中</th><th class="num">输出</th><th class="num">花费</th><th>时段</th></tr>';
    for (const e of list) {
      html += `<tr><td>${esc(usageTime(e.time))}</td><td>${esc(e.key || "未归属")}</td><td class="num">#${esc(e.turn)}</td><td class="num">${esc(e.step)}</td><td class="num">${usageNum(e.cacheMiss)}</td><td class="num">${usageNum(e.cacheHit)}</td><td class="num">${usageNum(e.output)}</td><td class="num">${usageMoney(e.cost, sym)}</td><td>${usageTierTag(e.tier)}</td></tr>`;
    }
    box.innerHTML = html + "</table>";
  }
  function renderUsagePrices(pt) {
    const box = document.getElementById("usagePrices");
    if (!pt || !pt.models) {
      box.textContent = "（价目表不可用）";
      return;
    }
    const sym = pt.symbol || "¥";
    const tier = pt.nowTier;
    let html = `<div style="margin-bottom:6px">价目表版本 <code>${esc(pt.version)}</code> ｜ 高峰时段为北京时间的 2 倍价（周一至周五 9:00-12:00、14:00-18:00，法定节假日除外，已内置 ${esc(pt.holidayCount)} 天假期）</div>`;
    html += '<table><tr><th>模型</th><th class="num">缓存命中</th><th class="num">缓存未命中</th><th class="num">输出</th></tr>';
    for (const [name, m] of Object.entries(pt.models)) {
      const price = (v) => esc(sym + (Number.isFinite(Number(v)) ? Number(v) : v ?? ""));
      html += `<tr><td><code>${esc(name)}</code><div class="meta">${esc(m.label)}</div></td><td class="num">${price(m.off?.cacheHit)}</td><td class="num">${price(m.off?.cacheMiss)}</td><td class="num">${price(m.off?.output)}</td></tr>`;
    }
    html += "</table>";
    html += `<div class="meta" style="padding:8px 10px">上表为<b>空闲时段</b>单价（元 / 百万 token）。当前时刻属于 <b>${tier ? esc(tier.tierLabel) : "—"}</b>${tier?.estimated ? "，且价目表里没有 <code>" + esc(tier.model) + "</code>，按兜底价估算" : ""}。</div>`;
    box.innerHTML = html;
  }
  async function refreshUsage() {
    const msg = document.getElementById("usageMsg");
    try {
      const r = await api("/api/tokens/summary?limit=200");
      const t = r.totals || {};
      const b = t.buckets || {};
      const sym = r.symbol || "¥";
      document.getElementById("metricUsageCost").textContent = usageMoney(t.cost, sym);
      document.getElementById("metricUsageCostHint").textContent = `高峰 ${usageMoney(t.byTier?.peak, sym)} ｜ 空闲 ${usageMoney(t.byTier?.off, sym)}`;
      document.getElementById("metricUsageTokens").textContent = usageNum(t.totalTokens);
      document.getElementById("metricUsageTokensHint").textContent = `输入 ${usageNum(t.inputTokens)} ｜ 输出 ${usageNum(b.output)}`;
      document.getElementById("metricUsageHitRate").textContent = usagePct(t.cacheHitRate);
      document.getElementById("metricUsageHitHint").textContent = `命中 ${usageNum(b.cacheHit)} ｜ 未命中 ${usageNum(b.cacheMiss)}`;
      document.getElementById("metricUsagePerTurn").textContent = usageMoney(t.avgCostPerTurn, sym);
      document.getElementById("metricUsagePerTurnHint").textContent = `${usageNum(t.turns)} 轮 ｜ ${usageNum(t.steps)} 步 ｜ 当前${r.nowTier?.tier === "peak" ? "高峰" : "空闲"}时段`;
      renderUsageConversations(r);
      void refreshUsageBudgets();
      void refreshUsageMechanicalReplies();
      renderUsagePrices(r.priceTable ? { ...r.priceTable, nowTier: r.nowTier } : null);
      syncUsageKeySelect((r.conversations || []).map((c) => String(c.key ?? "")));
      msg.textContent = `✅ 已同步于 ${(/* @__PURE__ */ new Date()).toLocaleTimeString("zh-CN", { hour12: false })}`;
      msg.className = "meta ok";
    } catch (error) {
      msg.textContent = `❌ 读取失败：${error?.message || "未知错误"}`;
      msg.className = "meta err";
    }
  }
  async function refreshUsageTurns() {
    const box = document.getElementById("usageTurns");
    if (!usageSelectedKey) {
      box.innerHTML = '<span class="meta">选择一个会话后加载逐轮明细…</span>';
      box.dataset.loaded = "";
      return;
    }
    try {
      const r = await api("/api/tokens/turns?key=" + encodeURIComponent(usageSelectedKey) + "&limit=200");
      renderUsageTurns(r);
      box.dataset.loaded = "1";
    } catch (error) {
      box.innerHTML = `<span class="meta err">读取失败：${esc(error?.message || "未知错误")}</span>`;
      box.dataset.loaded = "";
    }
  }
  async function refreshUsageRecent() {
    try {
      renderUsageRecent(await api("/api/tokens/recent?limit=40"));
    } catch (error) {
      document.getElementById("usageRecent").innerHTML = '<span class="meta">（读取失败）</span>';
    }
  }
  var usageDashboardRefresh;
  function refreshUsageDashboard() {
    if (usageDashboardRefresh) return usageDashboardRefresh;
    usageDashboardRefresh = (async () => {
      await Promise.all([refreshUsage(), refreshUsageChart(), refreshUsageRecent()]);
      await refreshUsageTurns();
    })().finally(() => {
      usageDashboardRefresh = null;
    });
    return usageDashboardRefresh;
  }
  function initialize21() {
    usageSelectedKey = "";
    usageConversationsCache = [];
    document.getElementById("usageOwnerBudgetEnabled").addEventListener("change", (event) => {
      event.target.dataset.dirty = "true";
    });
    document.getElementById("usageOwnerBudgetSave").addEventListener("click", async (event) => {
      const button = event.currentTarget;
      const input = document.getElementById("usageOwnerBudgetEnabled");
      const msg = document.getElementById("usageBudgetMsg");
      button.disabled = true;
      try {
        await api("/api/tokens/budgets/owner", "POST", { ownerBudgetEnabled: input.checked });
        delete input.dataset.dirty;
        button.blur();
        msg.textContent = "管理员额度设置已保存";
        msg.className = "meta ok";
        await refreshUsageBudgets();
      } catch (error) {
        msg.textContent = "保存失败：" + error.message;
        msg.className = "meta err";
      } finally {
        button.disabled = false;
      }
    });
    document.getElementById("usageBudgets").addEventListener("input", (event) => {
      const row = event.target.closest("[data-budget-key]");
      if (row) {
        row.dataset.budgetDirty = "1";
        budgetRefreshRevision++;
      }
    });
    document.getElementById("usageBudgets").addEventListener("click", async (event) => {
      const button = event.target.closest("[data-budget-save]");
      if (!button) return;
      const row = button.closest("[data-budget-key]");
      const values = [...row.querySelectorAll("input")].map((input) => Number(input.value));
      const msg = document.getElementById("usageBudgetMsg");
      button.disabled = true;
      try {
        await api("/api/tokens/budgets", "POST", { key: row.dataset.budgetKey, coldLimitYuan: values[0], hardLimitYuan: values[1], weakMinIntervalMin: values[2] });
        const unchanged = [...row.querySelectorAll("input")].every((input, index) => Number(input.value) === values[index]);
        if (unchanged) delete row.dataset.budgetDirty;
        msg.textContent = unchanged ? "已保存" : "已保存提交值；之后的修改尚未保存";
        msg.className = "meta ok";
        button.blur();
        await refreshUsageBudgets();
      } catch (error) {
        msg.textContent = "保存失败：" + error.message;
        msg.className = "meta err";
      } finally {
        button.disabled = false;
      }
    });
    document.getElementById("usageRecoverySave").addEventListener("click", async (event) => {
      const button = event.currentTarget;
      const msg = document.getElementById("usageBudgetMsg");
      button.disabled = true;
      try {
        await api("/api/tokens/budgets/recovery-windows", "POST", {
          privateMessages: Number(document.getElementById("usageRecoveryPrivate").value),
          groupMessages: Number(document.getElementById("usageRecoveryGroup").value),
          groupAtMessages: Number(document.getElementById("usageRecoveryGroupAt").value)
        });
        msg.textContent = "全局恢复窗口已保存";
        msg.className = "meta ok";
        button.blur();
        await refreshUsageBudgets();
      } catch (error) {
        msg.textContent = "保存失败：" + error.message;
        msg.className = "meta err";
      } finally {
        button.disabled = false;
      }
    });
    document.getElementById("usageGlobalSave").addEventListener("click", async (event) => {
      const button = event.currentTarget;
      const msg = document.getElementById("usageBudgetMsg");
      button.disabled = true;
      try {
        await api("/api/tokens/budgets/global", "POST", { globalHardLimitYuan: Number(document.getElementById("usageGlobalLimit").value) });
        button.blur();
        msg.textContent = "统一上限已保存";
        msg.className = "meta ok";
        await refreshUsageBudgets();
      } catch (error) {
        msg.textContent = "保存失败：" + error.message;
        msg.className = "meta err";
      } finally {
        button.disabled = false;
      }
    });
    usageMechanicalDirty = false;
    mechanicalPrivateBox = document.getElementById("usageMechanicalPrivate");
    mechanicalGroupBox = document.getElementById("usageMechanicalGroup");
    for (const box of [mechanicalPrivateBox, mechanicalGroupBox]) box.addEventListener("input", () => {
      usageMechanicalDirty = true;
    });
    document.getElementById("usageMechanicalSave").addEventListener("click", async (event) => {
      const button = event.currentTarget;
      const msg = document.getElementById("usageMechanicalMsg");
      const lines = (box) => box.value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      button.disabled = true;
      try {
        const privateReplies = lines(mechanicalPrivateBox);
        const groupReplies = lines(mechanicalGroupBox);
        if (!privateReplies.length || !groupReplies.length) throw Error("私聊和群聊各需至少一条词条");
        await api("/api/tokens/budgets/replies", "POST", { privateReplies, groupReplies });
        usageMechanicalDirty = false;
        button.blur();
        msg.textContent = `已保存：私聊 ${privateReplies.length} 条，群聊 ${groupReplies.length} 条`;
        msg.className = "meta ok";
        await refreshUsageMechanicalReplies();
      } catch (error) {
        msg.textContent = "保存失败：" + error.message;
        msg.className = "meta err";
      } finally {
        button.disabled = false;
      }
    });
    usageDashboardRefresh = null;
    document.getElementById("usageRefresh").addEventListener("click", () => {
      void refreshUsageDashboard();
      showConsoleToast("用量已刷新");
    });
    document.getElementById("usageTurnsLoad").addEventListener("click", () => refreshUsageTurns());
    document.getElementById("usageKeySelect").addEventListener("change", (ev) => {
      usageSelectedKey = ev.target.value;
      refreshUsageTurns();
    });
    document.getElementById("usageClear").addEventListener("click", async () => {
      if (!confirm("确定清空 token 用量账本？累计花费与逐轮明细都会被删除，且不可恢复（下一次同步会从 DSH 重新拉取会话累计值）。")) return;
      const msg = document.getElementById("usageMsg");
      try {
        const r = await api("/api/tokens/reset", "POST", {});
        msg.textContent = r.ok ? "✅ 账本已清空" : "❌ " + (r.error || "失败");
        msg.className = r.ok ? "meta ok" : "meta err";
      } catch (error) {
        msg.textContent = "❌ " + (error?.message || "失败");
        msg.className = "meta err";
      }
      usageSelectedKey = "";
      document.getElementById("usageTurnScope").textContent = "—";
      document.getElementById("usageTurns").dataset.loaded = "";
      refreshUsage();
      refreshUsageRecent();
    });
  }

  // console/shared/navigation.js
  var consolePages;
  var currentConsolePage;
  var toastTimer;
  function showConsoleToast(message2) {
    const toast = document.getElementById("consoleToast");
    toast.textContent = message2;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.hidden = true;
    }, 4200);
  }
  function setConsolePage(page, { updateHash = true, focus = false, target = "" } = {}) {
    if (!Object.hasOwn(consolePages, page)) page = "overview";
    currentConsolePage = page;
    document.querySelectorAll("[data-page]").forEach((el3) => {
      el3.hidden = el3.dataset.page !== page;
    });
    document.querySelectorAll("#mainNav [data-view]").forEach((button) => {
      const selected2 = button.dataset.view === page;
      button.classList.toggle("active", selected2);
      if (selected2) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
    document.getElementById("breadcrumbPage").textContent = consolePages[page][0];
    document.getElementById("pageTitle").textContent = consolePages[page][1];
    document.getElementById("pageDescription").textContent = consolePages[page][2];
    document.title = consolePages[page][0] + " · QQ 桥接控制台";
    if (updateHash && location.hash !== "#" + page) history.pushState({}, "", "#" + page);
    closeConsoleSearch();
    void loadPageData(page);
    if (page === "v2-e" && typeof loadVoiceLibrary === "function") loadVoiceLibrary();
    const messageAckPage = document.getElementById("messageAckComponentRoot")?.closest("section[data-page]")?.dataset.page;
    if (page === messageAckPage && typeof componentUI.loadMessageAck === "function") componentUI.loadMessageAck();
    if (page === "usage" && typeof refreshUsageDashboard === "function") void refreshUsageDashboard();
    if (focus) {
      document.getElementById("mainContent").focus({ preventScroll: true });
      document.getElementById(target || "mainContent")?.scrollIntoView({ block: "start", behavior: "instant" });
    }
  }
  async function readLiveConsoleSource() {
    const url = new URL("/", location.origin);
    url.searchParams.set("__console_refresh_check", String(Date.now()));
    const response = await fetch(url, { cache: "no-store", headers: { "Cache-Control": "no-cache", "x-console-token": localStorage.getItem("consoleToken") || "" } });
    if (!response.ok) throw new Error("console source check failed");
    return response.text();
  }
  var initialConsoleSource;
  var sidebarRefreshCheckInProgress;
  var pendingSidebarNavigation;
  function updateOverview(status, modeLabel) {
    const connection = document.getElementById("statusText");
    connection.textContent = status.dshReady ? "DSH 已连接" : "DSH 未连接";
    connection.className = "status-badge " + (status.dshReady ? "online" : "offline");
    document.getElementById("metricDsh").textContent = status.dshReady ? "已连接" : "未连接";
    document.getElementById("metricDsh").className = status.dshReady ? "ok" : "err";
    document.getElementById("metricDshHint").textContent = status.dshReady ? "桥接状态已同步" : "请检查 DSH 是否运行";
    renderSnowlumaHealth(status.snowluma);
    document.getElementById("metricMode").textContent = modeLabel.replace("模式", "");
    document.getElementById("metricRole").textContent = "角色 · " + (status.role || "默认人格");
    document.getElementById("accessSummary").textContent = "管理员 " + (status.ownerQQ || "未设置") + " · " + (status.allowGroups || []).length + " 个白名单群 · " + (status.allowPrivate || []).length + " 位白名单好友";
    document.getElementById("lastUpdated").textContent = "状态同步于 " + (/* @__PURE__ */ new Date()).toLocaleTimeString("zh-CN", { hour12: false });
    document.getElementById("connectionAlert").hidden = true;
    const silent = status.roleMode === "silent";
    for (const [id, active] of [["silentOn", silent], ["silentOff", !silent]]) {
      const button = document.getElementById(id);
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    }
  }
  function setConnectionError(error) {
    document.getElementById("statusText").className = "status-badge offline";
    document.getElementById("metricDsh").textContent = "连接中断";
    document.getElementById("metricDsh").className = "err";
    document.getElementById("metricDshHint").textContent = "当前状态可能已过期";
    document.getElementById("metricSnowluma").textContent = "未知";
    document.getElementById("metricSnowluma").className = "";
    document.getElementById("metricSnowlumaHint").textContent = "当前状态可能已过期";
    document.getElementById("snowlumaWarn").style.display = "none";
    const alert2 = document.getElementById("connectionAlert");
    alert2.textContent = error.message === "未授权" ? "访问令牌无效或已取消输入。请使用启动日志中的控制台链接重新打开。" : "无法连接桥接服务，当前显示的是上次同步结果。请检查桥接是否运行，再点击右上角刷新。";
    alert2.hidden = false;
  }
  function initialize22() {
    consolePages = {
      "context-visual": ["可视化 context", "可视化 context", "选择发给 AI 的背景信息，调整顺序，并查看上次实际发送的内容。"],
      "setting-c-0": ["心情与表情", "心情与表情", "设置双形态、心情加减规则和欢迎冷却；查看真实结算。"],
      "setting-c-1": ["上下文与记忆", "上下文与记忆", "管理当前事务、轻量记忆和持久记忆的读取范围。"],
      "setting-c-2": ["会话背景", "会话背景", "按 QQ 管理人物档案、专业问答限额与会话背景。"],
      "setting-l-0": ["生命周期组件", "生命周期组件", "设置来信唤醒、思考补话和回合收尾，查看免打扰与实时状态。"],
      "setting-l-1": ["发送与等待", "发送与等待", "设置开口时机、发送间隔与分条回复限制。"],
      "setting-l-2": ["主动行为", "主动行为", "设置定时冒泡、话题跟进、日程提醒与起床问候。"],
      "setting-o-0": ["质量与工具日志", "质量与工具日志", "查看调用记录、反馈与失败原因。"],
      "setting-o-1": ["日记、日报与反馈", "日记、日报与反馈", "分别管理会话日记、运维日报与用户反馈。"],
      "setting-o-2": ["自我更新与摘要", "自我更新与摘要", "设置自查频率、摘要与改进记录。"],
      overview: ["运行总览", "让每一次连接，都自然发生。", "掌握桥接状态，轻松管理你的 QQ 智能伙伴。"],
      sessions: ["会话与审批", "让每一段对话，都有迹可循。", "查看 QQ 与 DSH 的会话映射，以及等待你回复的审批和提问。"],
      persona: ["人格与角色", "给你的伙伴，一点独特个性。", "选择已有角色，或用自己的语言写下新的性格与表达方式。"],
      "v2-t": ["工具开关", "工具开关", "勾选 AI 可以调用的工具。"],
      "games": ["Games", "Games · 独立互动 MCP", "查看 Games T 层工具、玩法与互动边界。"],
      "codex-peer": ["Codex Peer", "Codex Peer · 小鲸鱼与 Codex 专用通道", "管理端专用 Codex 通信工具与组件设置。"],
      "injection-lab": ["提示词注入实验室", "提示词注入实验室 · 免疫 + 嘴炮", "管理注入免疫、对线工具与组件设置。"],
      "v2-e": ["语音", "语音", "管理语音库与发送设置。"],
      "social-v1": ["一代仿真", "为自然对话，设定合适的节奏。", "调整参与概率、活跃周期和分条发送。"],
      slang: ["黑话词库", "读懂群聊里的，言外之意。", "从候选到确认，让 AI 逐渐熟悉大家的表达习惯。"],
      alias: ["成员绰号", "记住每个名字，对应到每个人。", "维护「绰号 → QQ号」映射：手动添加、自动提取候选、确认后注入提示词供 AI 认人/传话。"],
      terms: ["词条学习", "把共同兴趣，变成有来源的知识。", "学习实际玩法、兴趣术语、公开活动与文化；候选由管理员审核，确认后按语境使用。"],
      usage: ["令牌与花费", "每一次思考，都算得清楚。", "实时查看 AI 的 token 消耗与花费，可下钻到每个群、每个好友、每一轮对话。"],
      access: ["访问与安全", "明确边界，安心连接。", "管理允许对话的对象、管理员权限与控制台访问凭证。"],
      operations: ["调试与运维", "让桥接，始终井然有序。", "测试消息、引导 AI，或维护桥接进程与会话工作区。"],
      "environment-chat": ["普通聊天环境", "普通聊天环境", "管理普通聊天可用的会话辅助功能。"],
      "environment-admin": ["管理员环境", "管理员环境", "管理员私聊的开发模式与预设。"],
      "environment-web": ["网站操控", "网站操控", "管理打开网页、点击按钮、填写表单等通用网页操作。"],
      "environment-watch": ["网页监督", "网页监督", "设置监控网址、检查间隔及监控时的浏览器运行方式。"],
      "environment-scripts": ["脚本协同", "脚本协同", "添加脚本地址；执行与搜索约定显示在对应地址下方。"],
      "images": ["图片", "图片", "设置 OpenAI 图片接口、图片额度与本机密钥。"],
      "video": ["视频", "视频", "预留栏目；尚未接入视频生成或处理服务。"],
      "layer-v": ["失败回归", "失败回归", "将失败记录整理为可复查的用例。"],
      "human": ["human", "HUMAN IN THE LOOP", "我也是一个组件。"],
      "layer-s": ["私人资料库", "私人资料库", "挂载个人思想与知识资料包，按目录选择、按需读取原文。"],
      reference: ["工具参考", "每一种能力，都清晰可见。", "查看桥接提供给 DSH 的 MCP 工具与用途。"],
      registry: ["扩展组件", "扩展组件", "查看接入的扩展项目。"]
    };
    currentConsolePage = "overview";
    initialConsoleSource = readLiveConsoleSource().catch(() => "");
    sidebarRefreshCheckInProgress = false;
    pendingSidebarNavigation = null;
    document.addEventListener("click", async (event) => {
      const nav = event.target.closest("#mainNav .nav-item[data-view]");
      if (!nav) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      pendingSidebarNavigation = nav;
      if (sidebarRefreshCheckInProgress) return;
      sidebarRefreshCheckInProgress = true;
      try {
        const [loadedSource, liveSource] = await Promise.all([initialConsoleSource, readLiveConsoleSource()]);
        const targetNav = pendingSidebarNavigation || nav;
        pendingSidebarNavigation = null;
        if (loadedSource && liveSource !== loadedSource) {
          history.replaceState({}, "", location.pathname + location.search + "#" + targetNav.dataset.view);
          location.reload();
          return;
        }
        setConsolePage(targetNav.dataset.view, { focus: true, target: targetNav.dataset.target });
      } catch {
        const targetNav = pendingSidebarNavigation || nav;
        pendingSidebarNavigation = null;
        setConsolePage(targetNav.dataset.view, { focus: true, target: targetNav.dataset.target });
      } finally {
        sidebarRefreshCheckInProgress = false;
      }
    }, true);
    document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => {
      setConsolePage(button.dataset.view, { focus: true, target: button.dataset.target });
    }));
    window.addEventListener("hashchange", () => {
      const page = location.hash.slice(1);
      if (Object.hasOwn(consolePages, page) || !page) setConsolePage(page, { updateHash: false });
    });
    document.querySelector(".skip-link").addEventListener("click", (event) => {
      event.preventDefault();
      document.getElementById("mainContent").focus();
      document.getElementById("mainContent").scrollIntoView({ block: "start", behavior: "instant" });
    });
    document.getElementById("refreshConsole").addEventListener("click", async function() {
      this.disabled = true;
      await Promise.allSettled([refresh2(), refreshSessions(), refreshPending(), refreshSocialStatus(), refreshV2Activity()]);
      this.disabled = false;
      if (document.getElementById("connectionAlert").hidden) showConsoleToast("运行状态已刷新");
    });
  }

  // console/layers/O/preset-catalog.js
  var DEFINITIONS = {
    standard: { label: "通用编程助手", group: "常用", description: "DSH 的通用编程与本地工具配置。例：处理代码和文件任务。" },
    "qq-chat-dev": { label: "小鲸鱼管理员助手", group: "常用", description: "保留小鲸鱼角色并开放本地开发工具，仅供管理员私聊。例：让小鲸鱼检查本机代码。" },
    ptc: { label: "程序化工具调用", group: "DSH 高级", description: "通过代码编排工具调用，适合熟悉 DSH 工具执行机制的使用者。" },
    minimal: { label: "精简编程助手", group: "DSH 高级", description: "精简的人格与工具配置。例：需要更少默认上下文时选用。" },
    cordis: { label: "DSH 插件与配置开发", group: "DSH 高级", description: "提供 Cordis 组合、插件开发相关工具与技能。例：开发 DSH 插件。" },
    "qq-chat": { label: "小鲸鱼一代聊天", group: "按模式自动使用", description: "一代仿真聊天预设，由桥接按运行模式选择。" },
    "qq-chat-v2": { label: "小鲸鱼二代仿真", group: "按模式自动使用", description: "二代仿真专用，自主读消息、用工具发言和等待；由桥接按模式选择。" },
    "qq-task-worker": { label: "独立任务执行", group: "后台专用", description: "小鲸鱼处理委派任务时创建的独立工作会话，不是日常聊天入口。" },
    "qq-learning": { label: "知识学习与核实", group: "后台专用", description: "后台学习、核实公开知识；不接入聊天人格、QQ 发送或本机执行。" },
    "campus-summary": { label: "网页更新整理", group: "后台专用", description: "整理监控网页差异；无工具，不发送消息，不读取聊天历史。" }
  };
  function presetInfo(preset) {
    const p = typeof preset === "string" ? { id: preset } : preset;
    return { ...p, ...DEFINITIONS[p.id] || { label: p.name || "自定义预设", group: "自定义", description: p.description || "用途由此自定义预设声明；请核对其工具与权限。" } };
  }
  function presetChoices(presets, showAll = false, selected2 = "") {
    const unique = new Map(presets.map((p) => [p.id, presetInfo(p)]));
    if (selected2 && !unique.has(selected2)) unique.set(selected2, { id: selected2, label: "当前配置（DSH 未列出）", group: "当前设置", description: "DSH 暂未列出这个预设，请先核对是否已安装。" });
    return [...unique.values()].filter((p) => showAll || p.group === "常用" || p.group === "自定义" || p.id === selected2);
  }

  // console/layers/O/status.js
  var presetRows = [];
  function renderPresetChoices(selected2) {
    const select = document.getElementById("closedPreset");
    if (!select) return;
    select.replaceChildren(new Option("跟随 DSH 默认（推荐）", ""));
    const groups = /* @__PURE__ */ new Map();
    for (const p of presetChoices(presetRows, document.getElementById("showAllPresets")?.checked, selected2)) {
      if (!groups.has(p.group)) {
        const group = document.createElement("optgroup");
        group.label = p.group;
        groups.set(p.group, group);
        select.append(group);
      }
      const option = new Option(p.label + " · " + p.id, p.id);
      option.title = p.description;
      groups.get(p.group).append(option);
    }
    select.value = selected2;
    updatePresetHelp();
  }
  function updatePresetHelp(mode) {
    const select = document.getElementById("closedPreset"), help = document.getElementById("closedPresetHelp");
    if (!select || !help) return;
    const p = presetRows.find((p2) => p2.id === select.value) || { id: select.value };
    help.textContent = select.value ? presetInfo(p).description : "使用 DSH 当前声明的默认预设，通常无需另选。";
    const scope = document.getElementById("closedPresetScope");
    if (scope && mode) scope.textContent = mode === "closed-agent" ? "作用范围：当前管理员封闭 Agent 模式。切换选项后立即保存。" : "作用范围：仅封闭 Agent 模式；当前聊天或仿真模式的预设由桥接自动选择。";
  }
  function fmtAgoMs(ms) {
    if (ms === null || ms === void 0 || ms === "") return "未知";
    const n = Number(ms);
    if (!Number.isFinite(n) || n < 0) return "未知";
    if (n < 1e3) return "刚刚";
    if (n < 6e4) return Math.round(n / 1e3) + " 秒";
    if (n < 36e5) return Math.round(n / 6e4) + " 分钟";
    if (n < 864e5) return Math.round(n / 36e5) + " 小时";
    return Math.round(n / 864e5) + " 天";
  }
  function renderSnowlumaHealth(sl) {
    const el3 = document.getElementById("snowlumaWarn");
    const strong = document.getElementById("metricSnowluma");
    const hint = document.getElementById("metricSnowlumaHint");
    if (!el3 || !strong || !hint) return;
    if (!sl || typeof sl !== "object") {
      el3.style.display = "none";
      strong.textContent = "未知";
      strong.className = "";
      hint.textContent = "桥接未上报上游健康（旧版桥接）";
      return;
    }
    const degraded = sl.degraded === true;
    const connected = sl.connected === true;
    const ago = sl.lastPacketAgoMs;
    const receiving = Number.isFinite(ago);
    const goodText = sl.good === true ? "good=true" : sl.good === false ? "good=false" : "good 未知";
    if (degraded) {
      strong.textContent = "已连接 · 未接收";
      strong.className = "err";
      hint.textContent = "网关连着，但 QQ 侧数据没到";
    } else if (!connected) {
      strong.textContent = "未连接";
      strong.className = "err";
      hint.textContent = "连不上 QQ 网关，请先启动 SnowLuma";
    } else {
      strong.textContent = "正常 · 接收中";
      strong.className = "ok";
      hint.textContent = (receiving ? "最近一份上游事件包在 " + fmtAgoMs(ago) + "前 · " : "") + (sl.good === false ? "good=false" : sl.good === true ? "good=true" : "good 未上报");
    }
    if (!degraded) {
      el3.style.display = "none";
      return;
    }
    document.getElementById("snowlumaWarnHint").textContent = sl.hint || "桥接与 QQ 网关的 WebSocket 连着，但一直收不到 QQ 侧的数据。";
    document.getElementById("snowlumaWarnPkt").textContent = (receiving ? fmtAgoMs(ago) + "前" : "从未收到") + (sl.lastPacketKind ? "（" + sl.lastPacketKind + "）" : "");
    document.getElementById("snowlumaWarnGood").textContent = goodText;
    el3.style.display = "";
  }
  async function refresh2() {
    try {
      const s = await api("/api/status");
      document.querySelectorAll("#modeRow button").forEach((b) => (b.classList.toggle("active", b.dataset.mode === s.mode), b.setAttribute("aria-pressed", String(b.dataset.mode === s.mode))));
      document.getElementById("roleText").textContent = s.role || "无";
      document.getElementById("roleModeText").textContent = s.roleMode === "silent" ? "静默" : "正常";
      const modeLabel = s.mode === "reserved" ? "一代仿真模式" : s.mode === "reserved2" ? "二代仿真模式" : s.mode === "closed-agent" ? "封闭 Agent" : "聊天模式";
      updateOverview(s, modeLabel);
      document.getElementById("activity").textContent = s.activity || "（空）";
      const presetSel = document.getElementById("closedPreset");
      if (presetSel && document.activeElement !== presetSel) renderPresetChoices(s.closedAgentPreset || "");
      updatePresetHelp(s.mode);
    } catch (e) {
      document.getElementById("statusText").textContent = "连接中断 · 请检查桥接服务";
      setConnectionError(e);
    }
  }
  async function refreshPresets() {
    try {
      const r = await api("/api/presets");
      presetRows = r.presets || [];
      renderPresetChoices(document.getElementById("closedPreset").value);
      refresh2();
    } catch {
    }
  }
  async function saveMode(mode) {
    const preset = document.getElementById("closedPreset").value || "";
    const r = await api("/api/mode", "POST", { mode, closedAgentPreset: preset });
    if (r.ok) {
      refresh2();
      if (r.dshSynced === false) {
        alert("模式已写入本地，但未能同步到 DSH 设置（DSH 未运行？）——\n下一次轮询（约 5 秒）会把模式改回去。请检查 DSH 与桥接日志。");
      }
    } else {
      alert(r.error || "切换失败");
    }
    return r;
  }
  function initialize23() {
    document.getElementById("showAllPresets")?.addEventListener("change", () => renderPresetChoices(document.getElementById("closedPreset").value));
    document.getElementById("closedPreset")?.addEventListener("change", () => updatePresetHelp());
  }

  // console/layers/C/preset-prompt.js
  var simPromptOriginal;
  var simPromptPreset;
  function setSimMsg(text, ok) {
    const el3 = document.getElementById("simPromptMsg");
    el3.textContent = text;
    el3.className = ok === void 0 ? "meta" : ok ? "meta ok" : "meta err";
  }
  function setSimEditing(editing) {
    const area = document.getElementById("simPromptText");
    area.readOnly = !editing;
    area.classList.toggle("editing", editing);
    document.getElementById("simPromptEdit").disabled = editing;
    document.getElementById("simPromptSave").disabled = !editing;
    document.getElementById("simPromptCancel").disabled = !editing;
  }
  async function refreshSimPrompt() {
    simPromptPreset = document.getElementById("simPromptPreset").value || "qq-chat-v2";
    setSimMsg("读取中…");
    try {
      const r = await api("/api/preset/sim-prompt?preset=" + encodeURIComponent(simPromptPreset));
      const area = document.getElementById("simPromptText");
      if (!r.ok) {
        area.value = "";
        setSimMsg(r.error || "读取失败", false);
        document.getElementById("simPromptStatus").textContent = "不可用";
        return;
      }
      simPromptOriginal = r.content;
      area.value = r.content;
      setSimEditing(false);
      setSimMsg("");
      const status = r.status || {};
      document.getElementById("simPromptStatus").textContent = `${status.label || simPromptPreset} · ${r.chars} 字符${status.installed ? " · 已同步到 DSH" : " · 尚未同步到 DSH"}`;
      document.getElementById("simPromptWarnings").textContent = (r.warnings || []).length ? "⚠️ " + r.warnings.join("；") : "";
      document.getElementById("simPromptRestart").textContent = "改动写入该代预设的源文件并同步到 DSH 的 preset 目录；preset 由 DSH 在会话创建时装配，因此新会话会自动用新版，正在进行的 QQ 会话需重置该会话或重启 DSH。";
    } catch (error) {
      setSimMsg("读取失败：" + (error?.message ?? error), false);
    }
  }
  function initialize24() {
    simPromptOriginal = "";
    simPromptPreset = "qq-chat-v2";
  }
  function setSimPromptOriginal(value2) {
    simPromptOriginal = value2;
  }

  // console/layers/G/access.js
  async function refreshWhitelist() {
    try {
      const w = await api("/api/whitelist");
      document.getElementById("wlGroups").value = (w.allow.groups || []).join(", ");
      document.getElementById("wlPrivate").value = (w.allow.private || []).join(", ");
      document.getElementById("ownerQQ").value = w.ownerQQ != null ? String(w.ownerQQ) : "";
      document.getElementById("dnGroups").value = (w.deny.groups || []).join(", ");
      document.getElementById("dnPrivate").value = (w.deny.private || []).join(", ");
    } catch {
    }
  }
  function initialize25() {
  }

  // console/layers/C/preset-actions.js
  function initialize26() {
    document.getElementById("simPromptEdit").addEventListener("click", () => {
      setSimEditing(true);
      setSimMsg("编辑中：改完点「保存并同步到 DSH」。保存会先备份，并做 YAML 与安全不变量校验。");
    });
    document.getElementById("simPromptCancel").addEventListener("click", () => {
      document.getElementById("simPromptText").value = simPromptOriginal;
      setSimEditing(false);
      setSimMsg("已放弃修改");
    });
    document.getElementById("simPromptPreset").addEventListener("change", () => {
      refreshSimPrompt();
    });
    document.getElementById("simPromptSave").addEventListener("click", async () => {
      const content = document.getElementById("simPromptText").value;
      if (!confirm("保存会改写该代预设的源文件并同步到 DSH 的 preset 目录（新会话生效，进行中的会话需重置或重启 DSH）。确定继续？")) return;
      setSimMsg("保存中…");
      const r = await api("/api/preset/sim-prompt", "POST", { preset: simPromptPreset, content });
      if (!r.ok) {
        setSimMsg("❌ " + (r.error || "保存失败"), false);
        return;
      }
      if (r.unchanged) {
        setSimPromptOriginal(content);
        setSimEditing(false);
        setSimMsg("内容没有变化，未写入文件（避免无谓地重排预设格式）", true);
        return;
      }
      setSimPromptOriginal(content);
      setSimEditing(false);
      setSimMsg(`✅ 已保存${r.synced ? "并同步到 DSH" : ""}；重启 DSH 后生效`, true);
      document.getElementById("simPromptWarnings").textContent = (r.warnings || []).length ? "⚠️ " + r.warnings.join("；") : "";
      document.getElementById("simPromptStatus").textContent = `${r.status?.label || simPromptPreset} · ${content.length} 字符 · 已保存，待重启 DSH`;
    });
    document.getElementById("simPromptRestore").addEventListener("click", async () => {
      if (!confirm("还原到该代预设上一次保存前的备份？当前改动会丢失（原文件会先自动备份）。")) return;
      const r = await api("/api/preset/sim-prompt/restore", "POST", { preset: simPromptPreset });
      if (!r.ok) {
        setSimMsg("❌ " + (r.error || "还原失败"), false);
        return;
      }
      setSimMsg(`✅ 已还原（${r.restoredFrom}）；重启 DSH 后生效`, true);
      refreshSimPrompt();
    });
  }

  // console/layers/C/persona-actions.js
  function initialize27() {
    document.getElementById("roleInjectMaxSave").addEventListener("click", async () => {
      const msg = document.getElementById("roleInjectMaxMsg");
      const value2 = Number(document.getElementById("roleInjectMax").value);
      if (!Number.isFinite(value2) || value2 < 1e3 || value2 > 2e4) {
        msg.textContent = "请输入 1000~20000 之间的整数";
        msg.className = "meta err";
        return;
      }
      const r = await api("/api/roles/limit", "POST", { maxInjectChars: value2 });
      msg.textContent = r.ok ? `✅ 已设为 ${r.maxInjectChars} 字符，下一条消息生效` : "❌ " + (r.error || "保存失败");
      msg.className = r.ok ? "meta ok" : "meta err";
      if (r.ok) refreshRoles();
    });
    document.getElementById("roleSet").addEventListener("click", async () => {
      const r = await api("/api/role", "POST", { role: document.getElementById("roleInput").value.trim() });
      if (r.ok) refreshRoles();
      else alert(r.error || "设置失败");
    });
    document.getElementById("roleClear").addEventListener("click", async () => {
      await api("/api/role", "POST", { role: null });
      refreshRoles();
      refresh2();
    });
    document.getElementById("roleCreate").addEventListener("click", async () => {
      const name = document.getElementById("newRoleName").value.trim();
      const content = document.getElementById("newRoleContent").value.trim();
      if (!name) {
        setRoleMsg("请先填人格名", false);
        return;
      }
      const editing = roleEditorState.mode === "edit";
      const exists = roleCache.some((role) => role.name === name);
      if (editing && roleEditorState.name !== name) {
        const renamed = await api("/api/roles/rename", "POST", { from: roleEditorState.name, to: name });
        if (!renamed.ok) {
          setRoleMsg("❌ " + (renamed.error || "重命名失败"), false);
          return;
        }
      }
      const endpoint = editing || exists ? "/api/roles/update" : "/api/roles/create";
      const r = await api(endpoint, "POST", { name, content });
      setRoleMsg(r.ok ? `✅ 已保存「${name}」` : "❌ " + (r.error || "失败"), r.ok);
      if (r.ok) {
        setRoleEditorState({ mode: "edit", name });
        document.getElementById("roleEditorWarnings").textContent = (r.warnings || []).length ? "⚠️ " + r.warnings.join("；") : "";
        await refreshRoles();
      }
    });
    document.getElementById("roleDuplicate").addEventListener("click", async () => {
      const source = document.getElementById("newRoleName").value.trim();
      const content = document.getElementById("newRoleContent").value.trim();
      const target = (prompt("把当前内容另存为新的人格，名称：", source ? source + "-副本" : "") || "").trim();
      if (!target) return;
      const r = await api("/api/roles/create", "POST", { name: target, content });
      if (!r.ok) {
        setRoleMsg("❌ " + (r.error || "另存失败"), false);
        return;
      }
      document.getElementById("newRoleName").value = target;
      setRoleEditorState({ mode: "edit", name: target });
      renderRoleEditor();
      setRoleMsg(`✅ 已另存为「${target}」`, true);
      refreshRoles();
    });
    document.getElementById("roleDelete").addEventListener("click", async () => {
      const name = document.getElementById("newRoleName").value.trim();
      if (!name) {
        setRoleMsg("请先选择或填写要删除的人格名", false);
        return;
      }
      if (!confirm(`确定删除人格「${name}」？该操作不可撤销（roles/${name}.md）。`)) return;
      const r = await api("/api/roles/delete", "POST", { name });
      if (!r.ok) {
        setRoleMsg("❌ " + (r.error || "删除失败"), false);
        return;
      }
      resetRoleForm();
      setRoleMsg(r.clearedCurrent ? `已删除「${name}」，并清除了当前启用的人格` : `已删除「${name}」`, true);
      refreshRoles();
      refresh2();
    });
    document.getElementById("roleFormReset").addEventListener("click", () => resetRoleForm());
    document.getElementById("newRoleContent").addEventListener("input", updateRoleEditorWarnings);
  }

  // console/layers/O/control-actions.js
  function initialize28() {
    document.getElementById("silentOn").addEventListener("click", async () => {
      await api("/api/role-mode", "POST", { mode: "silent" });
      refresh2();
    });
    document.getElementById("silentOff").addEventListener("click", async () => {
      await api("/api/role-mode", "POST", { mode: "active" });
      refresh2();
    });
    document.getElementById("wlSave").addEventListener("click", async () => {
      const parse = (s) => s.split(/[,，\s]+/).map((x) => x.trim()).filter(Boolean).map(Number).filter(Number.isFinite);
      const r = await api("/api/whitelist", "POST", {
        allow: { private: parse(document.getElementById("wlPrivate").value), groups: parse(document.getElementById("wlGroups").value) },
        deny: { private: parse(document.getElementById("dnPrivate").value), groups: parse(document.getElementById("dnGroups").value) },
        ownerQQ: document.getElementById("ownerQQ").value.trim()
      });
      if (r.ok) {
        refreshWhitelist();
        refresh2();
        alert("白名单已保存并生效");
      } else alert(r.error || "保存失败");
    });
    document.getElementById("tsSend").addEventListener("click", async () => {
      const r = await api("/api/test-send", "POST", {
        kind: document.getElementById("tsKind").value,
        id: document.getElementById("tsId").value.trim(),
        message: document.getElementById("tsMsg").value
      });
      document.getElementById("tsMsg2").textContent = r.ok ? "✅ 已发送 message_id=" + r.message_id : "❌ " + (r.error || "失败");
      document.getElementById("tsMsg2").className = r.ok ? "meta ok" : "meta err";
    });
    document.getElementById("restartBtn").addEventListener("click", async () => {
      if (!confirm("确定重启桥接？")) return;
      const r = await api("/api/restart", "POST", {});
      document.getElementById("restartMsg").textContent = r.message || "正在重启…";
    });
    document.getElementById("clearWsBtn").addEventListener("click", async () => {
      if (!confirm("确定清空整个「QQ 聊天」工作区？\n将归档全部 QQ 会话、清除所有上下文映射、清空活动日志。\n此操作不可撤销。")) return;
      const r = await api("/api/workspace/reset", "POST", {});
      document.getElementById("clearWsMsg").textContent = r.ok ? `✅ 已归档 ${r.archivedCount} 个会话，工作区已清空` : "❌ " + (r.error || "失败");
      document.getElementById("clearWsMsg").className = r.ok ? "meta ok" : "meta err";
      refreshSessions();
      refresh2();
    });
    document.getElementById("aiNotifySend").addEventListener("click", async () => {
      const kind = document.getElementById("aiNotifyKind").value;
      const id = document.getElementById("aiNotifyId").value.trim();
      const message2 = document.getElementById("aiNotifyMessage").value.trim();
      if (!id || !message2) {
        alert("请填写群号/QQ 号和提醒内容");
        return;
      }
      const r = await api("/api/console/notify-ai", "POST", { key: kind + ":" + id, message: message2 });
      const msg = document.getElementById("aiNotifyMsg");
      msg.textContent = r.ok ? "✅ 已投递到 DSH：" + r.sessionId : "❌ " + (r.error || "失败");
      msg.className = r.ok ? "meta ok" : "meta err";
    });
  }

  // console/layers/L/schedule.js
  async function refreshV2Schedule() {
    const msg = document.getElementById("v2ScheduleMsg");
    const listEl = document.getElementById("v2ScheduleList");
    const sel = document.getElementById("v2ReminderKey");
    if (!msg || !listEl || !sel) return;
    try {
      const [r, sch] = await Promise.all([
        api("/api/socialV2/states"),
        api("/api/socialV2/schedules", "POST", { action: "list" })
      ]);
      const convs = r.conversations || [];
      const schMap = /* @__PURE__ */ new Map();
      for (const c of sch && sch.conversations || []) schMap.set(c.key, c);
      const fillKeys = (el3) => {
        if (!el3) return;
        const prev = el3.value;
        el3.innerHTML = convs.length ? convs.map((c) => '<option value="' + esc(c.key) + '">' + esc(c.key) + "</option>").join("") : '<option value="">（暂无会话）</option>';
        if (prev && convs.some((c) => c.key === prev)) el3.value = prev;
      };
      fillKeys(document.getElementById("v2TbKey"));
      fillKeys(document.getElementById("v2PmKey"));
      const followupKey = document.getElementById("v2FollowupSessionKey");
      if (followupKey) {
        const previous = followupKey.value;
        const privateConvs = convs.filter((c) => String(c.key || "").startsWith("private:"));
        followupKey.innerHTML = privateConvs.length ? privateConvs.map((c) => '<option value="' + esc(c.key) + '">' + esc(c.key) + "</option>").join("") : '<option value="">（暂无私聊会话）</option>';
        if (previous && privateConvs.some((c) => c.key === previous)) followupKey.value = previous;
        if (followupKey.value) await loadV2FollowupSessionLimits(followupKey.value);
        else await loadV2FollowupSessionLimits("");
      }
      const cur = sel.value;
      sel.innerHTML = convs.length ? convs.map((c) => '<option value="' + esc(c.key) + '">' + esc(c.key) + "</option>").join("") : '<option value="">（暂无会话）</option>';
      if (cur && convs.some((c) => c.key === cur)) sel.value = cur;
      const repeatLabel = (rep) => rep === "daily" ? "每天重复" : rep === "weekly" ? "每周重复" : "一次性";
      const scheduleSessions = (sch && sch.conversations || []).filter((c) => Array.isArray(c.items) && c.items.length);
      const rows = [];
      let scheduleCount = 0;
      const remainingLabel = (dueAt) => {
        const delta = Number(dueAt) - Date.now();
        if (delta <= 0) return "待提醒";
        if (delta < 60 * 60 * 1e3) return "1 小时内";
        if (delta < 24 * 60 * 60 * 1e3) return "今天";
        return Math.ceil(delta / (24 * 60 * 60 * 1e3)) + " 天后";
      };
      for (const c of scheduleSessions) {
        const items2 = [...c.items].sort((a, b) => Number(a.dueAt) - Number(b.dueAt));
        scheduleCount += items2.length;
        const isGroup = String(c.key || "").startsWith("group:");
        rows.push('<section class="schedule-session"><header class="schedule-session-head"><span class="schedule-session-kind">' + (isGroup ? "群聊" : "私聊") + '</span><strong class="schedule-session-key">' + esc(c.key) + '</strong><span class="schedule-session-count">' + items2.length + " 条待办</span></header>");
        for (const it of items2) {
          const dueAt = Number(it.dueAt) || 0;
          const dueDate = dueAt ? new Date(dueAt) : /* @__PURE__ */ new Date(NaN);
          const dateText = Number.isFinite(dueDate.getTime()) ? new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", weekday: "short" }).format(dueDate) : String(it.when || "时间未设置");
          const timeText = Number.isFinite(dueDate.getTime()) ? dueDate.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }) : "";
          const extra = [it.place ? "地点：" + it.place : "", it.detail ? "备注：" + it.detail : ""].filter(Boolean).join("　·　");
          const rawLead = Number(it.leadMinutes);
          const leadMinutes = Number.isFinite(rawLead) ? Math.min(1440, Math.max(0, Math.round(rawLead))) : 30;
          const leadIsDefault = it.leadIsDefault === true;
          const remindAt = Number(it.remindAt) || (dueAt ? dueAt - leadMinutes * 60 * 1e3 : 0);
          const remindText = remindAt && Number.isFinite(new Date(remindAt).getTime()) ? new Date(remindAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }) : "";
          const leadEncKey = esc(encodeURIComponent(c.key));
          const intervalMinutes = Number.isInteger(Number(it.intervalMinutes)) ? Math.min(1440, Math.max(1, Number(it.intervalMinutes))) : 30;
          const nextReminderAt = Number(it.nextReminderAt) || remindAt;
          const nextReminderText = nextReminderAt && Number.isFinite(new Date(nextReminderAt).getTime()) ? new Date(nextReminderAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }) : "";
          const nextReminderLabel = Number(it.lastRemindedAt) > 0 ? "下次 " : nextReminderAt <= Date.now() ? "待首次补发 " : "首次 ";
          rows.push('<article class="schedule-card"><div class="schedule-card-date"><span>' + esc(dateText) + "</span><strong>" + esc(timeText) + "</strong><small>" + esc(remainingLabel(dueAt)) + '</small></div><div class="schedule-card-body"><div class="schedule-card-title">' + esc(it.title || "未命名日程") + '</div><div class="schedule-card-meta">' + esc(repeatLabel(it.repeat)) + "</div>" + (extra ? '<div class="schedule-card-extra">' + esc(extra) + "</div>" : "") + '<div class="schedule-card-lead">开始前 <input type="number" min="0" max="1440" step="1" value="' + leadMinutes + '" data-lead-key="' + leadEncKey + '" data-lead-id="' + esc(it.id) + '" aria-label="提醒开始提前分钟数"> 分钟；之后每 <input type="number" min="1" max="1440" step="1" value="' + intervalMinutes + '" data-interval-id="' + esc(it.id) + '" aria-label="提醒间歇分钟数"> 分钟提醒 <button type="button" class="small" data-lead-save="1" data-lead-key="' + leadEncKey + '" data-lead-id="' + esc(it.id) + '">保存提醒设置</button> <button type="button" class="small" data-sch-complete="1" data-sch-key="' + leadEncKey + '" data-sch-id="' + esc(it.id) + '" data-sch-title="' + esc(encodeURIComponent(String(it.title || ""))) + '">确认已去做</button> <span class="meta">' + (leadIsDefault ? "提前量跟随全局默认" : "提前量单独设置") + (remindText ? " · 开始 " + esc(remindText) : "") + (nextReminderText ? " · " + nextReminderLabel + esc(nextReminderText) : "") + '</span></div></div><button type="button" class="small danger schedule-card-delete" aria-label="删除日程 ' + esc(it.title || "") + '" data-sch-delete="1" data-sch-key="' + esc(encodeURIComponent(c.key)) + '" data-sch-id="' + esc(it.id) + '" data-sch-title="' + esc(encodeURIComponent(String(it.title || ""))) + '">删除</button></article>');
        }
        rows.push("</section>");
      }
      listEl.innerHTML = rows.join("") || '<div class="schedule-empty">暂无待办日程。选择会话并填写时间与内容即可添加。</div>';
      listEl.querySelectorAll("[data-sch-delete]").forEach((btn) => btn.addEventListener("click", async () => {
        if (!confirm("删除日程「" + decodeURIComponent(btn.dataset.schTitle || "") + "」？")) return;
        const res = await api("/api/socialV2/schedules", "POST", { action: "cancel", key: decodeURIComponent(btn.dataset.schKey), id: btn.dataset.schId });
        if (res && res.ok === false) alert("删除失败：" + (res.error || "未知错误"));
        await refreshV2Schedule();
      }));
      listEl.querySelectorAll("[data-sch-complete]").forEach((btn) => btn.addEventListener("click", async () => {
        if (!confirm("确认「" + decodeURIComponent(btn.dataset.schTitle || "") + "」已经去做了吗？")) return;
        const res = await api("/api/socialV2/schedules", "POST", { action: "complete", key: decodeURIComponent(btn.dataset.schKey || ""), id: btn.dataset.schId });
        if (res && res.ok === false) alert("确认失败：" + (res.error || "未知错误"));
        await refreshV2Schedule();
      }));
      listEl.querySelectorAll("[data-lead-save]").forEach((btn) => btn.addEventListener("click", async () => {
        const row = btn.closest(".schedule-card-lead");
        const leadInput = row ? row.querySelector("input[data-lead-id]") : null;
        const intervalInput = row ? row.querySelector("input[data-interval-id]") : null;
        const raw = leadInput ? String(leadInput.value || "").trim() : "";
        const rawInterval = intervalInput ? String(intervalInput.value || "").trim() : "";
        const minutes = Number(raw), interval = Number(rawInterval);
        if (raw === "" || !Number.isInteger(minutes) || minutes < 0 || minutes > 1440 || !Number.isInteger(interval) || interval < 1 || interval > 1440) {
          alert("提醒开始提前量需为 0–1440 的整数，间歇周期需为 1–1440 的整数（分钟）");
          return;
        }
        btn.disabled = true;
        const res = await api("/api/socialV2/schedules", "POST", {
          action: "update",
          key: decodeURIComponent(btn.dataset.leadKey || ""),
          id: btn.dataset.leadId,
          leadMinutes: minutes,
          intervalMinutes: interval
        });
        btn.disabled = false;
        if (res && res.ok === false) alert("修改提醒设置失败：" + (res.error || "未知错误"));
        await refreshV2Schedule();
      }));
      msg.textContent = sch && sch.ok === false ? "日程读取失败：" + (sch.error || "组件未启用") : "已刷新，共 " + scheduleCount + " 条待办";
    } catch (e) {
      msg.textContent = "读取失败：" + (e && e.message ? e.message : e);
    }
  }
  function initialize29() {
    document.getElementById("v2ScheduleRefresh").addEventListener("click", refreshV2Schedule);
    document.getElementById("v2ReminderAdd").addEventListener("click", async () => {
      const key2 = document.getElementById("v2ReminderKey").value;
      const date = document.getElementById("v2ReminderDate").value;
      const time3 = document.getElementById("v2ReminderTime").value || "09:00";
      const text = document.getElementById("v2ReminderText").value.trim();
      const repeatMap = { "无": "none", "每天": "daily", "每周": "weekly" };
      const repeat = repeatMap[document.getElementById("v2ReminderRepeat").value] || "none";
      const msg = document.getElementById("v2ScheduleMsg");
      if (!key2 || !date || !text) {
        msg.textContent = "请先选择会话、填日期和内容";
        return;
      }
      const leadEl = document.getElementById("v2ReminderLead");
      const intervalEl = document.getElementById("v2ReminderInterval");
      const leadRaw = leadEl ? String(leadEl.value || "").trim() : "";
      const intervalRaw = intervalEl ? String(intervalEl.value || "").trim() : "";
      const payload = { action: "add", key: key2, title: text, when: date + " " + time3, repeat };
      if (leadRaw !== "") {
        const leadMinutes = Number(leadRaw);
        if (!Number.isFinite(leadMinutes) || Math.round(leadMinutes) < 0 || Math.round(leadMinutes) > 1440) {
          msg.textContent = "提前量要是 0–1440 的整数（分钟）";
          return;
        }
        payload.leadMinutes = Math.round(leadMinutes);
      }
      if (intervalRaw !== "") {
        const intervalMinutes = Number(intervalRaw);
        if (!Number.isInteger(intervalMinutes) || intervalMinutes < 1 || intervalMinutes > 1440) {
          msg.textContent = "间歇周期要是 1–1440 的整数（分钟）";
          return;
        }
        payload.intervalMinutes = intervalMinutes;
      }
      const r = await api("/api/socialV2/schedules", "POST", payload);
      if (r && r.ok !== false) {
        msg.textContent = "✅ 已添加日程：" + (r.item ? r.item.when + " · " + r.item.title + " · 提前 " + r.item.leadMinutes + " 分钟开始，每 " + r.item.intervalMinutes + " 分钟提醒" + (r.leadClamped ? "（已夹取）" : "") : text);
        document.getElementById("v2ReminderText").value = "";
      } else {
        msg.textContent = "❌ " + (r && r.error || "添加失败");
      }
      refreshV2Schedule();
    });
  }

  // console/layers/L/time-bubbles.js
  function buildV2TimeBubbleRow(slot) {
    const div = document.createElement("div");
    div.className = "row";
    div.dataset.tbRow = "1";
    div.dataset.tbId = String(slot.id || "");
    div.innerHTML = '<label style="flex:0 0 auto"><input type="checkbox" data-tb="enabled"> 启用</label><label style="flex:0 0 auto"><input type="checkbox" data-tb="locked"> 锁定</label><input type="number" data-tb="hour" min="0" max="23" style="width:64px"><span>:</span><input type="number" data-tb="minute" min="0" max="59" style="width:64px"><input type="text" data-tb="label" placeholder="时段名（午饭点）" style="width:130px"><input type="text" data-tb="hint" placeholder="参考说法：咚咚咚 白饭端来了" style="flex:1"><button class="small danger" data-tb-del>删除</button>';
    div.querySelector('[data-tb="enabled"]').checked = slot.enabled !== false;
    div.querySelector('[data-tb="locked"]').checked = slot.locked === true;
    div.querySelector('[data-tb="hour"]').value = slot.hour ?? 12;
    div.querySelector('[data-tb="minute"]').value = slot.minute ?? 0;
    div.querySelector('[data-tb="label"]').value = slot.label || "";
    div.querySelector('[data-tb="hint"]').value = slot.hint || "";
    div.querySelector("[data-tb-del]").addEventListener("click", () => {
      div.remove();
      applyV2TimeBubbleLocks();
    });
    div.querySelector('[data-tb="locked"]').addEventListener("change", () => applyV2TimeBubbleLocks());
    return div;
  }
  function applyV2TimeBubbleLocks() {
    const allLocked = document.getElementById("v2TbAllLocked")?.checked === true;
    document.querySelectorAll("#v2TimeBubbleRows [data-tb-row]").forEach((row) => {
      const rowLocked = row.querySelector('[data-tb="locked"]')?.checked === true;
      row.querySelectorAll('[data-tb]:not([data-tb="locked"]),[data-tb-del]').forEach((el3) => {
        el3.disabled = allLocked || rowLocked;
      });
      row.querySelector('[data-tb="locked"]').disabled = allLocked;
    });
    syncV2TimeBubbleCapacity();
  }
  function syncV2TimeBubbleCapacity() {
    const box = document.getElementById("v2TimeBubbleRows");
    const add = document.getElementById("v2TimeBubbleAdd");
    const msg = document.getElementById("v2TbCapacityMsg");
    const capacityInput = add?.closest(".settings-content")?.querySelector(".inline-component-settings .comp-form-num");
    const count = box?.querySelectorAll("[data-tb-row]").length || 0;
    const allLocked = document.getElementById("v2TbAllLocked")?.checked === true;
    const rawLimit = capacityInput?.value;
    const limit = rawLimit !== "" && Number.isFinite(Number(rawLimit)) ? Math.max(0, Math.floor(Number(rawLimit))) : Infinity;
    const overLimit = count > limit;
    if (add) add.disabled = allLocked || count >= limit;
    if (capacityInput) {
      capacityInput.disabled = overLimit;
      if (!overLimit) capacityInput.dataset.lastValidValue = capacityInput.value;
    }
    if (msg) {
      if (overLimit) msg.textContent = `当前已配置 ${count} 个时段，超过每日上限 ${limit}；请先删除多余时段，再调整上限。`;
      else if (allLocked) msg.textContent = `当前已配置 ${count}${Number.isFinite(limit) ? " / " + limit : ""} 个时段；冒泡栏已锁定。`;
      else if (count >= limit) msg.textContent = `当前已配置 ${count} / ${limit} 个时段，已达到上限，不能继续添加。`;
      else if (Number.isFinite(limit)) msg.textContent = `当前已配置 ${count} / ${limit} 个时段，还可添加 ${limit - count} 个。`;
      else msg.textContent = `当前已配置 ${count} 个时段。`;
    }
  }
  function renderV2TimeBubbles(list, allLocked = false) {
    const box = document.getElementById("v2TimeBubbleRows");
    if (!box) return;
    const lock = document.getElementById("v2TbAllLocked");
    if (lock) lock.checked = allLocked === true;
    box.innerHTML = "";
    (Array.isArray(list) ? list : []).forEach((s) => box.appendChild(buildV2TimeBubbleRow(s)));
    applyV2TimeBubbleLocks();
  }
  function collectV2TimeBubbles() {
    return [...document.querySelectorAll("#v2TimeBubbleRows [data-tb-row]")].map((row) => ({
      ...row.dataset.tbId ? { id: row.dataset.tbId } : {},
      enabled: row.querySelector('[data-tb="enabled"]').checked,
      locked: row.querySelector('[data-tb="locked"]').checked,
      hour: Math.min(23, Math.max(0, Math.round(Number(row.querySelector('[data-tb="hour"]').value) || 0))),
      minute: Math.min(59, Math.max(0, Math.round(Number(row.querySelector('[data-tb="minute"]').value) || 0))),
      label: row.querySelector('[data-tb="label"]').value.trim().slice(0, 20),
      hint: row.querySelector('[data-tb="hint"]').value.trim().slice(0, 120)
    }));
  }
  function setV2TbMsg(text) {
    const el3 = document.getElementById("v2TbMsg");
    if (el3) el3.textContent = text || "";
  }
  async function loadV2TimeBubblesFor(key2) {
    if (!key2) {
      renderV2TimeBubbles([]);
      setV2TbMsg("请选择会话");
      return;
    }
    try {
      const r = await api("/api/socialV2/time-bubbles?key=" + encodeURIComponent(key2));
      if (!r.ok) throw new Error(r.error || "读取失败");
      const all = r.all || r.slots || [];
      renderV2TimeBubbles(all, r.allLocked === true);
      setV2TbMsg((all.length ? "该会话已配置时间冒泡。" : "当前没有时间冒泡。") + " 共 " + all.length + " 个时段。");
    } catch (e) {
      setV2TbMsg("读取失败：" + (e && e.message ? e.message : e));
    }
  }
  async function saveV2TimeBubblesFor(key2) {
    if (!key2) {
      setV2TbMsg("请选择会话");
      return;
    }
    try {
      const r = await api("/api/socialV2/time-bubbles", "POST", { key: key2, slots: collectV2TimeBubbles(), allLocked: document.getElementById("v2TbAllLocked")?.checked === true });
      setV2TbMsg(r.ok ? r.conflicts?.length ? "⚠️ 已保存未锁时段；锁定时段 " + r.conflicts.join("、") + " 保持原样。" : "✅ 已保存，共 " + (r.all || []).length + " 个时段" : "❌ " + (r.error || "失败"));
      if (r.ok) loadV2TimeBubblesFor(key2);
      else if (r.error === "LOCKED_SCHEDULE") {
        setV2TbMsg("该冒泡栏或时段已锁定；先解锁，再保存。");
        loadV2TimeBubblesFor(key2);
      }
    } catch (e) {
      setV2TbMsg("保存失败：" + (e && e.message ? e.message : e));
    }
  }
  async function resetV2TimeBubblesFor(key2) {
    if (!key2) return;
    if (!confirm("清空此会话的所有时间冒泡时段？")) return;
    try {
      const r = await api("/api/socialV2/time-bubbles", "POST", { key: key2, reset: true });
      setV2TbMsg(r.ok ? "✅ 已清空；此会话不会再发送时间冒泡" : "❌ " + (r.error || "失败"));
      if (r.ok) loadV2TimeBubblesFor(key2);
    } catch (e) {
      setV2TbMsg("恢复失败：" + (e && e.message ? e.message : e));
    }
  }
  async function loadV2FollowupSessionLimits(key2) {
    const interval = document.getElementById("v2TbFollowupInterval");
    const daily = document.getElementById("v2TbFollowupDaily");
    const msg = document.getElementById("v2TbFollowupMsg");
    if (!interval || !daily) return;
    if (!key2) {
      interval.value = "";
      daily.value = "";
      if (msg) msg.textContent = "";
      return;
    }
    if (!key2.startsWith("private:")) {
      interval.value = "";
      daily.value = "";
      if (msg) msg.textContent = "请选择 private: 私聊会话。";
      return;
    }
    try {
      const response = await api("/api/plugins/detail?id=ctx-chat-topic-drive");
      const plugin = response.plugin || response;
      const limit = plugin.config?.sessionLimits?.[key2] || {};
      interval.value = limit.minIntervalMinutes ?? "";
      daily.value = limit.dailyLimit ?? "";
      if (msg) msg.textContent = "空白项继承全局限制。";
    } catch (error) {
      if (msg) msg.textContent = "读取失败：" + error.message;
    }
  }
  async function saveV2FollowupSessionLimits() {
    const key2 = document.getElementById("v2FollowupSessionKey")?.value || "";
    const intervalEl = document.getElementById("v2TbFollowupInterval");
    const dailyEl = document.getElementById("v2TbFollowupDaily");
    const msg = document.getElementById("v2TbFollowupMsg");
    if (!key2) {
      if (msg) msg.textContent = "请先选择 session。";
      return;
    }
    if (!key2.startsWith("private:")) {
      if (msg) msg.textContent = "跟进限制需选择 private:QQ号 会话。";
      return;
    }
    try {
      const detail = await api("/api/plugins/detail?id=ctx-chat-topic-drive");
      const plugin = detail.plugin || detail;
      const config = plugin.config || {};
      const overrides = { ...config.sessionLimits || {} };
      const limit = {};
      if (intervalEl.value !== "") limit.minIntervalMinutes = Math.max(0, Math.min(10080, Math.round(Number(intervalEl.value) || 0)));
      if (dailyEl.value !== "") limit.dailyLimit = Math.max(0, Math.min(30, Math.round(Number(dailyEl.value) || 0)));
      if (Object.keys(limit).length) overrides[key2] = limit;
      else delete overrides[key2];
      const result = await api("/api/plugins/config", "POST", { id: "ctx-chat-topic-drive", config: { ...config, sessionLimits: overrides } });
      if (result.ok === false) throw Error(result.error || "保存失败");
      if (msg) msg.textContent = "已保存；生效值取全局与该 session 的较小值。";
    } catch (error) {
      if (msg) msg.textContent = "保存失败：" + error.message;
    }
  }
  function initialize30() {
    document.getElementById("v2TimeBubbleAdd").addEventListener("click", () => {
      const box = document.getElementById("v2TimeBubbleRows");
      if (box) {
        const capacity = document.getElementById("v2TimeBubbleAdd")?.closest(".settings-content")?.querySelector(".inline-component-settings .comp-form-num");
        const limit = capacity && capacity.value !== "" ? Math.max(0, Math.floor(Number(capacity.value) || 0)) : Infinity;
        if (box.querySelectorAll("[data-tb-row]").length >= limit) {
          syncV2TimeBubbleCapacity();
          return;
        }
        box.appendChild(buildV2TimeBubbleRow({ hour: 12, minute: 0, label: "", hint: "", enabled: true }));
        applyV2TimeBubbleLocks();
      }
    });
    document.getElementById("v2TbAllLocked").addEventListener("change", applyV2TimeBubbleLocks);
    document.addEventListener("change", (event) => {
      const input = event.target;
      if (!input.matches?.(".inline-component-settings .comp-form-num") || !input.closest(".settings-content")?.querySelector("#v2TimeBubbleAdd")) return;
      const count = document.querySelectorAll("#v2TimeBubbleRows [data-tb-row]").length;
      const attempted = input.value === "" ? Infinity : Math.max(0, Math.floor(Number(input.value) || 0));
      if (count > attempted) {
        input.value = input.dataset.lastValidValue ?? "";
        syncV2TimeBubbleCapacity();
        return;
      }
      input.dataset.lastValidValue = input.value;
      syncV2TimeBubbleCapacity();
    });
    document.getElementById("v2TbFollowupSave").addEventListener("click", saveV2FollowupSessionLimits);
    document.getElementById("v2FollowupSessionKey").addEventListener("change", (event) => loadV2FollowupSessionLimits(event.target.value));
    document.getElementById("v2FollowupSessionRefresh").addEventListener("click", async () => {
      await refreshV2Schedule();
      await loadV2FollowupSessionLimits(document.getElementById("v2FollowupSessionKey").value);
    });
    document.getElementById("v2TbLoad").addEventListener("click", () => loadV2TimeBubblesFor(document.getElementById("v2TbKey").value));
    document.getElementById("v2TbSave").addEventListener("click", () => saveV2TimeBubblesFor(document.getElementById("v2TbKey").value));
    document.getElementById("v2TbReset").addEventListener("click", () => resetV2TimeBubblesFor(document.getElementById("v2TbKey").value));
  }

  // console/layers/C/persistent-memory.js
  function setV2PmMsg(text) {
    const el3 = document.getElementById("v2PmMsg");
    if (el3) el3.textContent = text || "";
  }
  async function loadV2PersistentMemory(key2) {
    const ta = document.getElementById("v2PmContent");
    if (!key2) {
      if (ta) ta.value = "";
      setV2PmMsg("请选择会话");
      return;
    }
    try {
      const r = await api("/api/socialV2/persistent-memory?key=" + encodeURIComponent(key2));
      if (!r.ok) throw new Error(r.error || "读取失败");
      if (ta) ta.value = r.content || "";
      const when = r.updatedAt ? new Date(r.updatedAt).toLocaleString("zh-CN", { hour12: false }) : "未更新";
      setV2PmMsg("已保存 " + (r.chars || 0) + " 字符；本轮注入预算 " + (r.maxChars || 4e3) + "（事实/画像，非存储容量）；最后更新：" + when);
    } catch (e) {
      setV2PmMsg("读取失败：" + (e && e.message ? e.message : e));
    }
  }
  async function saveV2PersistentMemory(key2) {
    if (!key2) {
      setV2PmMsg("请选择会话");
      return;
    }
    const ta = document.getElementById("v2PmContent");
    try {
      const r = await api("/api/socialV2/persistent-memory", "POST", { key: key2, content: ta ? ta.value : "" });
      setV2PmMsg(r.ok ? "✅ 已保存（" + (r.chars || 0) + " 字）" : "❌ " + (r.error || "失败"));
    } catch (e) {
      setV2PmMsg("保存失败：" + (e && e.message ? e.message : e));
    }
  }
  async function triggerV2PersistentMemory(key2) {
    if (!key2) {
      setV2PmMsg("请选择会话");
      return;
    }
    try {
      const r = await api("/api/socialV2/persistent-memory", "POST", { key: key2, action: "updateNow" });
      setV2PmMsg(r.ok ? "✅ 已触发 AI 更新（稍等片刻后点“加载记忆”查看）" : "❌ " + (r.error || "失败"));
    } catch (e) {
      setV2PmMsg("触发失败：" + (e && e.message ? e.message : e));
    }
  }
  async function clearV2PersistentMemory(key2) {
    if (!key2) return;
    if (!confirm("清空该会话的持久化记忆？")) return;
    try {
      const r = await api("/api/socialV2/persistent-memory", "POST", { key: key2, action: "clear" });
      setV2PmMsg(r.ok ? "✅ 已清空" : "❌ " + (r.error || "失败"));
      if (r.ok) loadV2PersistentMemory(key2);
    } catch (e) {
      setV2PmMsg("清空失败：" + (e && e.message ? e.message : e));
    }
  }
  function initialize31() {
    document.getElementById("v2PmLoad").addEventListener("click", () => loadV2PersistentMemory(document.getElementById("v2PmKey").value));
    document.getElementById("v2PmSave").addEventListener("click", () => saveV2PersistentMemory(document.getElementById("v2PmKey").value));
    document.getElementById("v2PmUpdate").addEventListener("click", () => triggerV2PersistentMemory(document.getElementById("v2PmKey").value));
    document.getElementById("v2PmClear").addEventListener("click", () => clearV2PersistentMemory(document.getElementById("v2PmKey").value));
  }

  // console/layers/O/diary.js
  function diaryWindowForDay(day) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ""));
    if (!match) return "时间窗未知";
    const start = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0, 0);
    start.setDate(start.getDate() - 1);
    const key2 = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    return key2(start) + " 22:00 — " + String(day) + " 22:00";
  }
  async function refreshV2Diary() {
    const listEl = document.getElementById("v2DdList");
    const msg = document.getElementById("v2DdMsg");
    const catchUpButton = document.getElementById("v2DdCatchUp");
    if (!listEl) return;
    try {
      const r = await api("/api/socialV2/daily-diary");
      const convs = r.conversations || [];
      const catchUpKeys = /* @__PURE__ */ new Set();
      let historyAvailable = false;
      try {
        const historyRes = await api("/api/plugins/call", "POST", { tool: "diary_history", input: { limit: 200 } });
        const dates = historyRes?.result?.dates;
        if (historyRes?.result?.ok === true && Array.isArray(dates)) {
          historyAvailable = true;
          for (const entry of dates) {
            const day = String(entry?.date || "");
            if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
            for (const delivery of Array.isArray(entry.deliveries) ? entry.deliveries : []) {
              if (["absent", "archive_only"].includes(delivery.status)) catchUpKeys.add(String(delivery.key || "") + "|" + day);
            }
          }
        }
      } catch {
      }
      const hasCatchUpFor = (key2, targetDate) => historyAvailable && [...catchUpKeys].some((item) => item.startsWith(String(key2) + "|") && item.slice(String(key2).length + 1) < String(targetDate || ""));
      const rows = convs.map((c) => {
        const last = c.lastDiaryDate || "未发过";
        const state = c.hasDiary ? "目标日记 " + c.diaryChars + " 字（" + (c.diarySource === "archive" ? "归档" : "当前记忆") + "）" : "没有 " + (c.targetDate || "目标日期") + " 的日记内容";
        const delivery = { sent: "目标日已确认发送", claimed: "发送处理中", uncertain: "发送结果未确认", absent: "目标日尚无发送凭据", archive_only: "仅有归档，未确认发送", unavailable: "凭据状态不可用" }[c.deliveryStatus] || "状态未知";
        const alreadySent = c.targetSent === true;
        const unresolved = ["claimed", "uncertain", "unavailable"].includes(c.deliveryStatus);
        const blocked = c.diaryPending;
        const blockReason = !c.hasDiary ? "目标日期没有日记内容" : unresolved ? "发送凭据尚未确认，请先检查 QQ 会话和记录" : "";
        const statusLabel = c.diaryPending ? "刷新或发送处理中" : alreadySent ? delivery : unresolved ? delivery : c.hasDiary ? "待发送" : "暂无内容";
        const statusClass = c.diaryPending || unresolved ? "pending" : alreadySent ? "sent" : "muted";
        const title = "发送对象：" + c.key + (blockReason ? "；" + blockReason : "");
        const catchUpAvailable = hasCatchUpFor(c.key, c.targetDate);
        const sendDateLabel = alreadySent && c.sentAt ? "最近确认发送：" + new Date(c.sentAt).toLocaleString() : "上次发送日期：" + last;
        return '<article class="diary-session-card" title="' + esc(title) + '"><div class="diary-session-head"><b class="diary-session-key">' + esc(c.key) + '</b><span class="diary-session-state ' + statusClass + '">' + esc(statusLabel) + '</span></div><div class="diary-session-window">' + esc(c.targetDate || "目标日期") + " 日记时间窗 · " + esc(diaryWindowForDay(c.targetDate)) + '</div><div class="diary-session-detail">' + esc(state) + " · " + esc(sendDateLabel) + '</div><div class="diary-session-actions"><button class="small" title="每次点击都会重新总结当前记忆并发送今天的日记" ' + (blocked ? "disabled" : "") + ' data-dd-key="' + encodeURIComponent(c.key) + '" data-dd-day="' + esc(c.targetDate || "") + '" data-dd-action="sendNow">刷新并发送今日日记</button><button class="small" title="只补发今天以前、尚未确认发送的归档日记" ' + (c.diaryPending || !catchUpAvailable ? "disabled" : "") + ' data-dd-key="' + encodeURIComponent(c.key) + '" data-dd-action="catchUpAll">补发未发送日记</button></div></article>';
      });
      if (catchUpButton) catchUpButton.disabled = !historyAvailable || !convs.some((c) => !c.diaryPending && hasCatchUpFor(c.key, c.targetDate));
      listEl.innerHTML = rows.join("") || "（暂无会话）";
      listEl.querySelectorAll("[data-dd-key]").forEach((btn) => btn.addEventListener("click", async () => {
        const key2 = decodeURIComponent(btn.dataset.ddKey);
        const action = btn.dataset.ddAction;
        if (action === "catchUpAll" && !window.confirm("将按日期逐条补发 " + key2 + " 所有未确认发送的日记。请先核对 QQ 历史；发送凭据不明的日期会自动跳过。继续吗？")) return;
        const row = btn.closest(".diary-session-card");
        row?.querySelectorAll("button").forEach((item) => {
          item.disabled = true;
        });
        let finalMessage = action === "sendNow" ? "正在重新总结 " + key2 + " 当前最新记忆；完成后发送今天的日记…" : "正在逐日补发 " + key2 + " 的历史日记…";
        if (msg) msg.textContent = finalMessage;
        try {
          const rr = await api("/api/socialV2/daily-diary", "POST", { action, key: key2, day: btn.dataset.ddDay });
          finalMessage = rr.pending === true ? "⏳ " + (rr.message || "已请求刷新今天的记忆，发送完成后状态会更新。") : action === "catchUpAll" ? "补发完成：成功 " + (rr.sentCount || 0) + " 篇；" + (rr.results || []).filter((x) => !x.ok && x.reason !== "already_sent").length + " 篇跳过/失败。" + (rr.results || []).map((x) => x.day + " " + (x.ok ? "✅" : "· " + (x.reason || "未确认"))).join("；") : rr.sent === true ? "✅ 已发送 " + (rr.day || btn.dataset.ddDay) + " 日记：" + key2 : "❌ " + (rr.error || "发送未获确认");
        } catch (e) {
          finalMessage = "发送请求失败：" + (e && e.message ? e.message : e);
        } finally {
          await refreshV2Diary();
          if (msg) msg.textContent = finalMessage;
        }
      }));
      if (msg) msg.textContent = "已刷新";
    } catch (e) {
      if (catchUpButton) catchUpButton.disabled = true;
      if (msg) msg.textContent = "读取失败：" + (e && e.message ? e.message : e);
    }
  }
  function initialize32() {
    document.getElementById("v2DdRefresh").addEventListener("click", refreshV2Diary);
    document.getElementById("v2DdCatchUp").addEventListener("click", async () => {
      const msg = document.getElementById("v2DdMsg");
      const button = document.getElementById("v2DdCatchUp");
      button.disabled = true;
      let finalMessage = "";
      try {
        const r = await api("/api/socialV2/daily-diary");
        const convs = r.conversations || [];
        const successes = [], failures = [];
        for (const c of convs) {
          if (c.diaryPending) {
            failures.push({ key: c.key, reason: "今日刷新/发送处理中" });
            continue;
          }
          const result = await api("/api/socialV2/daily-diary", "POST", { action: "catchUpAll", key: c.key });
          const sentDays = (result.results || []).filter((x) => x.ok).map((x) => x.day);
          if (sentDays.length) successes.push(...sentDays.map((day) => c.key + " " + day));
          const skipped = (result.results || []).filter((x) => !x.ok && x.reason !== "already_sent");
          if (skipped.length) failures.push({ key: c.key, reason: skipped.map((x) => x.day + " " + (x.reason || "未确认")).join("、") });
        }
        if (msg) {
          if (!successes.length && !failures.length) finalMessage = "没有需要补发的会话";
          else finalMessage = `补发完成：成功 ${successes.length} 篇，未确认 ${failures.length} 个会话` + (successes.length ? "；" + successes.join("、") : "") + (failures.length ? "；" + failures.map((x) => x.key + "：" + x.reason).join("；") : "");
        }
        await refreshV2Diary();
      } catch (e) {
        finalMessage = "补发失败：" + (e && e.message ? e.message : e);
      } finally {
        await refreshV2Diary();
        if (msg) msg.textContent = finalMessage;
      }
    });
  }

  // console/layers/O/diary-history.js
  var v2DiaryHistorySection;
  var V2_DA_EMPTY;
  function setV2DaMsg(text) {
    const el3 = document.getElementById("v2DaMsg");
    if (el3) el3.textContent = text || "";
  }
  async function loadV2DiaryArchive(date) {
    const pre = document.getElementById("v2DaContent");
    if (!pre || !date) return;
    document.querySelectorAll("#v2DaList [data-da-date]").forEach((btn) => btn.classList.toggle("active", btn.dataset.daDate === date));
    pre.textContent = "读取中…";
    try {
      const res = await api("/api/plugins/call", "POST", { tool: "diary_read", input: { date } });
      const result = res && res.result || {};
      if (result.ok !== true) {
        pre.textContent = result.error || V2_DA_EMPTY;
        return;
      }
      pre.textContent = result.text || "（这一天没有内容）";
      setV2DaMsg("已读取 " + date + " 日日记 · " + diaryWindowForDay(date));
    } catch (e) {
      pre.textContent = "读取失败：" + (e && e.message ? e.message : e);
    }
  }
  async function refreshV2DiaryHistory() {
    const listEl = document.getElementById("v2DaList");
    const pre = document.getElementById("v2DaContent");
    if (!listEl) return;
    listEl.classList.add("is-loading");
    setV2DaMsg("读取中…");
    try {
      const res = await api("/api/plugins/call", "POST", { tool: "diary_history", input: { limit: 60 } });
      const result = res && res.result || {};
      const dates = Array.isArray(result.dates) ? result.dates : [];
      if (result.ok !== true || !dates.length) {
        listEl.innerHTML = '<div class="meta">' + V2_DA_EMPTY + "</div>";
        if (pre) pre.textContent = "（还没有归档）";
        setV2DaMsg(V2_DA_EMPTY);
        return;
      }
      listEl.innerHTML = dates.map((d) => {
        const date = String(d && d.date || "");
        const sentCount = (Array.isArray(d.deliveries) ? d.deliveries : []).filter((item) => item.status === "sent").length;
        return '<button class="diary-history-date" type="button" data-da-date="' + esc(date) + '"><b>' + esc(date) + " 日记</b><small>" + esc(diaryWindowForDay(date)) + "</small><small>" + esc(String(d && d.count || 0)) + " 个会话 · " + esc(String(d && d.chars || 0)) + " 字 · 已确认发送 " + sentCount + "</small></button>";
      }).join("");
      listEl.querySelectorAll("[data-da-date]").forEach((btn) => btn.addEventListener("click", () => loadV2DiaryArchive(btn.dataset.daDate)));
      setV2DaMsg("共 " + dates.length + " 天归档");
      await loadV2DiaryArchive(dates[0].date);
    } catch (e) {
      listEl.innerHTML = '<div class="meta">' + V2_DA_EMPTY + "</div>";
      if (pre) pre.textContent = "（还没有归档）";
      setV2DaMsg("读取失败：" + (e && e.message ? e.message : e));
    } finally {
      listEl.classList.remove("is-loading");
    }
  }
  function initialize33() {
    V2_DA_EMPTY = "日记归档插件未启用，或还没有归档";
    document.getElementById("v2DaRefresh").addEventListener("click", refreshV2DiaryHistory);
    v2DiaryHistorySection = document.getElementById("v2DaRefresh")?.closest("details.settings-group");
    if (v2DiaryHistorySection) {
      v2DiaryHistorySection.addEventListener("toggle", () => {
        if (v2DiaryHistorySection.open) refreshV2DiaryHistory();
      });
      if (v2DiaryHistorySection.open) refreshV2DiaryHistory();
    }
  }

  // console/layers/C/mood.js
  var time2 = (value2) => value2 ? new Date(value2).toLocaleString("zh-CN", { hour12: false }) : "—";
  function historyItem(item) {
    const corrected = item.voided === true;
    return '<li class="mood-history-item' + (corrected ? " is-corrected" : "") + '"><div><b>' + esc(corrected ? "已核实回应，原未答判定已更正" : { "daily-recovery": "每日04:00保底恢复", "daily-first": "历史首次发言恢复", "model-adjustment": "AI加减分", "unanswered": "主动未回应扣分" }[item.source] || item.source || "未知来源") + "</b><time>" + esc(time2(item.effectiveAt ?? item.at)) + "</time></div><p>" + esc(item.reason || "未提供原因") + "</p><span>" + esc(item.before ?? "—") + " → " + esc(item.after ?? "—") + "（变化 " + esc(item.delta ?? "—") + "）</span>" + (corrected ? "<small>原记录：" + esc(item.source) + "；原扣分 " + esc(item.originalPenalty ?? "—") + "；记录于 " + esc(time2(item.recordedAt)) + "<br>更正依据：" + esc(typeof item.correction === "string" ? item.correction : JSON.stringify(item.correction || {})) + "</small>" : "") + "</li>";
  }
  async function refreshV2Mood() {
    const el3 = document.getElementById("v2MoodCurrent");
    if (!el3) return;
    const stamp = document.getElementById("v2MoodUpdated");
    el3.classList.add("is-loading");
    try {
      const response = await api("/api/socialV2/states");
      if (response.ok === false) throw Error(response.error || "读取失败");
      el3.innerHTML = (response.conversations || []).map((conversation) => {
        const state = conversation.moodState;
        if (!state) return '<div class="mood-card"><b>' + esc(conversation.key) + "</b><p>心情组件未启用或状态不可用</p></div>";
        const history2 = conversation.moodHistory || [];
        return '<div class="mood-card" data-state="' + (state.mode === "critical" ? "low" : "normal") + '"><div class="mood-card-head"><b>' + esc(conversation.key) + "</b><span>" + esc(state.modeName ?? "—") + " · " + (state.mode === "critical" ? "临界形态" : "普通形态") + '</span></div><div class="mood-card-body"><span class="mood-value">' + esc(state.score ?? "—") + "</span><span>连续未答 " + esc(state.unansweredStreak ?? "—") + ' 回合</span></div><dl class="runtime-facts"><dt>被叫回后的热情回应</dt><dd>' + (state.welcomeBurstActive ? "生效中，至 " + esc(time2(state.welcomeBurstUntil)) : "未激活") + "</dd><dt>冷却截止</dt><dd>" + esc(time2(state.cooldownUntil)) + '</dd></dl><details class="mood-history"><summary>实际变动历史（最近 ' + history2.length + " 条）</summary>" + (history2.length ? "<ol>" + history2.map(historyItem).join("") + "</ol>" : '<p class="meta">暂无实际变动记录</p>') + "</details></div>";
      }).join("") || '<div class="mood-empty">暂无会话</div>';
      if (stamp) stamp.textContent = "更新于 " + (/* @__PURE__ */ new Date()).toLocaleTimeString("zh-CN", { hour12: false });
    } catch (error) {
      el3.innerHTML = '<div class="mood-empty err">读取失败：' + esc(error.message) + "</div>";
    } finally {
      el3.classList.remove("is-loading");
    }
  }
  function initialize34() {
  }

  // console/layers/C/config-load.js
  function applyCConfig(c) {
    const stk = c.sticker || {};
    document.getElementById("v2StickerEnabled").checked = stk.enabled !== false;
    document.getElementById("v2StickerSyncTtlSec").value = Math.round((stk.syncTtlMs || 6e4) / 1e3);
    document.getElementById("v2StickerMaxList").value = stk.maxListCount ?? 100;
    document.getElementById("v2StickerPromptMax").value = stk.promptMaxStickers ?? 8;
    document.getElementById("v2StickerIncludePrompt").checked = stk.includeInPrompt !== false;
    document.getElementById("v2StickerRecentCooldown").value = stk.recentCooldownMinutes ?? 30;
    const stkCollect = stk.collect || {};
    document.getElementById("v2StickerCollectEnabled").checked = stkCollect.enabled !== false;
    document.getElementById("v2StickerCollectPerMin").value = stkCollect.maxPerMinute ?? 2;
    document.getElementById("v2StickerCollectPerHour").value = stkCollect.maxPerHour ?? 10;
    document.getElementById("v2StickerCollectRemarkMax").value = stkCollect.maxRemarkChars ?? 20;
    const pmCfg = c.persistentMemory || {};
    document.getElementById("v2PmEnabled").checked = pmCfg.enabled !== false;
    document.getElementById("v2PmInterval").value = pmCfg.updateIntervalMin ?? 60;
    document.getElementById("v2PmMaxChars").value = pmCfg.maxChars ?? 4e3;
    const ctx = c.context || {};
    document.getElementById("v2ContextRecentLimit").value = ctx.recentLimit ?? 100;
    document.getElementById("v2ContextUnreadLimit").value = ctx.unreadLimit ?? 30;
    document.getElementById("v2ContextWindow").value = ctx.contextWindow ?? 20;
  }

  // console/layers/T/config-load.js
  function applyTConfig(c) {
    document.querySelectorAll("[data-v2-tool]").forEach((el3) => {
      el3.checked = c.tools && c.tools[el3.dataset.v2Tool] !== false;
    });
  }

  // console/layers/E/config-load.js
  function applyEConfig(c) {
    const ad = c.adminDev || {};
    document.getElementById("v2AdminDevEnabled").checked = ad.enabled !== false;
    document.getElementById("v2AdminDevPreset").value = ad.preset || "qq-chat-dev";
  }

  // console/layers/L/config-load.js
  function applyLConfig(c) {
    const w = c.wake || {};
    document.getElementById("v2WakeHint").value = w.recommendedHint || "";
    document.getElementById("v2MaxWakeMin").value = w.maxWakePerMinute ?? 1;
    document.getElementById("v2MaxWakeHour").value = w.maxWakePerHour ?? 12;
    const wt = c.wait || {};
    document.getElementById("v2WaitDefaultMs").value = wt.defaultMs ?? 3e4;
    document.getElementById("v2WaitMinMs").value = wt.minMs ?? 5e3;
    document.getElementById("v2WaitMaxMs").value = wt.maxMs ?? 6e5;
    document.getElementById("v2WaitDefaultQuietMs").value = wt.defaultQuietMs ?? 8e3;
    document.getElementById("v2MinQuietAfterNewMs").value = wt.minQuietAfterNewMs ?? 1e4;
    document.getElementById("v2AutoReplyCheckSec").value = Math.round((c.autoReplyCheckMs || 3e4) / 1e3);
    const nw = c.dailyNews || {};
    document.getElementById("v2NewsEnabled").checked = nw.enabled !== false;
    document.getElementById("v2NewsHour").value = nw.hour ?? 9;
    document.getElementById("v2NewsMinute").value = nw.minute ?? 0;
    document.getElementById("v2NewsMax").value = nw.maxItems ?? 2;
    const defaultNewsTopics = ["鲸鱼", "海洋", "少年感", "海洋 纪录片", "大海 治愈", "少年 成长"];
    document.getElementById("v2NewsKeywords").value = (Array.isArray(nw.keywords) && nw.keywords.length ? nw.keywords : defaultNewsTopics).join("\n");
    const defaultNewsUploaders = [{ topic: "鲸鱼", uploader: "正太肥鱼与龙少的日常", weight: 2 }];
    const topicUploaders = Array.isArray(nw.topicUploaders) ? nw.topicUploaders : defaultNewsUploaders;
    document.getElementById("v2NewsUploaders").value = topicUploaders.map((x) => `${x.topic} | ${x.uploader} | ${x.weight ?? 1}`).join("\n");
    document.getElementById("v2NewsSessions").value = (Array.isArray(nw.sessionWhitelist) ? nw.sessionWhitelist : []).join("\n");
    const ds = c.doubleStamp || {};
    document.getElementById("v2DoubleStampEnabled").checked = ds.enabled !== false;
    document.getElementById("v2DoubleStampWindowCount").value = Math.min(100, Math.max(1, Math.round(Number(ds.windowCount) || 8)));
  }

  // console/layers/O/config-load.js
  function applyOConfig(c) {
    const sr = c.selfReview || {};
    document.getElementById("v2SelfReviewEnabled").checked = sr.enabled !== false;
    document.getElementById("v2SelfReviewHours").value = sr.intervalHours ?? 6;
    document.getElementById("v2SelfReviewAuto").checked = sr.autoOptimize !== false;
    document.getElementById("v2SelfReviewCooldown").value = sr.optimizeCooldownHours ?? 2;
    document.getElementById("v2SelfReviewFeedbackMax").value = sr.maxFeedbackFixesPerRound ?? 3;
    document.getElementById("v2SelfReviewSelfMax").value = sr.maxSelfFixesPerRound ?? 3;
    const ddCfg = c.dailyDiary || {};
    document.getElementById("v2DdEnabled").checked = ddCfg.enabled !== false;
    document.getElementById("v2DdHour").value = ddCfg.hour ?? 22;
    document.getElementById("v2DdMinute").value = ddCfg.minute ?? 0;
    document.getElementById("v2DdMaxChars").value = ddCfg.maxChars ?? 500;
    const fb = c.feedback || {};
    document.getElementById("v2FeedbackMaxLength").value = fb.maxLength ?? 500;
    document.getElementById("v2FeedbackNotifyOwner").checked = fb.notifyOwnerOnError === true;
  }

  // console/shared/config-load.js
  async function loadV2Config() {
    try {
      const r = await api("/api/socialV2/config");
      const c = r.config || {};
      applyCConfig(c);
      applyTConfig(c);
      applyEConfig(c);
      applyLConfig(c);
      applyOConfig(c);
      refreshV2Mood();
      refreshV2Diary();
      refreshV2Schedule();
    } catch (error) {
      const alert2 = document.getElementById("connectionAlert");
      alert2.hidden = false;
      alert2.textContent = "参数读取失败：" + error.message;
      console.error("Console configuration failed", error);
    }
  }
  function initialize35() {
  }

  // console/layers/O/self-review.js
  async function saveV2SelfReviewConfig(button) {
    const msg = button?.closest(".settings-content")?.querySelector(".self-review-save-msg");
    const boundedInt = (id, min, max, fallback) => Math.min(max, Math.max(min, Math.round(Number(document.getElementById(id)?.value) || fallback)));
    if (button) button.disabled = true;
    if (msg) {
      msg.textContent = "正在保存…";
      msg.className = "meta";
    }
    try {
      const result = await api("/api/socialV2/config", "POST", { selfReview: {
        enabled: document.getElementById("v2SelfReviewEnabled").checked,
        intervalHours: boundedInt("v2SelfReviewHours", 1, 168, 6),
        autoOptimize: document.getElementById("v2SelfReviewAuto").checked,
        optimizeCooldownHours: boundedInt("v2SelfReviewCooldown", 1, 168, 2),
        maxFeedbackFixesPerRound: boundedInt("v2SelfReviewFeedbackMax", 1, 20, 3),
        maxSelfFixesPerRound: boundedInt("v2SelfReviewSelfMax", 1, 20, 3)
      } });
      if (result?.ok !== true) throw Error(result?.error || "保存失败");
      if (msg) {
        msg.textContent = "自我更新参数已保存";
        msg.className = "meta ok";
      }
    } catch (error) {
      if (msg) {
        msg.textContent = "保存失败：" + (error?.message || error);
        msg.className = "meta err";
      }
    } finally {
      if (button) button.disabled = false;
    }
  }
  function initialize36() {
    document.getElementById("v2SelfReviewSave")?.addEventListener("click", (event) => saveV2SelfReviewConfig(event.currentTarget));
    document.getElementById("v2SelfReviewRun").addEventListener("click", async () => {
      const msg = document.getElementById("v2SelfReviewMsg");
      try {
        const r = await api("/api/socialV2/self-review", "POST", { action: "runNow" });
        if (msg) msg.textContent = r.ok ? r.updateTriggered ? "✅ 已完成问题汇总并启动会话分析与自我改进，稍后查看记录/私聊汇报" : "✅ 问题汇总完成；未启动改进回合（请检查功能开关和运行模式）" : "❌ " + (r.error || "失败");
      } catch (e) {
        if (msg) msg.textContent = "触发失败：" + (e && e.message ? e.message : e);
      }
    });
  }

  // console/shared/config-scope.js
  var PAGE_KEYS = {
    "setting-c-0": ["sticker"],
    "setting-c-1": ["persistentMemory", "context"],
    "v2-t": ["tools"],
    "environment-admin": ["adminDev"],
    "setting-l-0": ["wake", "doubleStamp"],
    "setting-l-1": ["wait", "autoReplyCheckMs"],
    "setting-l-2": ["dailyNews"],
    "setting-o-1": ["dailyDiary", "feedback"],
    "setting-o-2": ["selfReview"]
  };
  function selectPageConfig(config, page) {
    if (!PAGE_KEYS[page]) throw Error("该页面没有全局参数保存入口：" + page);
    return Object.fromEntries(PAGE_KEYS[page].filter((key2) => Object.hasOwn(config, key2)).map((key2) => [key2, config[key2]]));
  }

  // console/layers/C/config-save.js
  function collectCConfig() {
    return {
      sticker: {
        enabled: document.getElementById("v2StickerEnabled").checked,
        syncTtlMs: Math.max(1e3, Math.round(Number(document.getElementById("v2StickerSyncTtlSec").value) || 60) * 1e3),
        maxListCount: Math.min(500, Math.max(1, Math.round(Number(document.getElementById("v2StickerMaxList").value) || 100))),
        includeInPrompt: document.getElementById("v2StickerIncludePrompt").checked,
        recentCooldownMinutes: Math.min(1440, Math.max(0, Math.round(Number(document.getElementById("v2StickerRecentCooldown").value) || 0))),
        promptMaxStickers: Math.min(30, Math.max(1, Math.round(Number(document.getElementById("v2StickerPromptMax").value) || 8))),
        collect: {
          enabled: document.getElementById("v2StickerCollectEnabled").checked,
          maxPerMinute: Math.max(0, Math.round(Number(document.getElementById("v2StickerCollectPerMin").value) || 0)),
          maxPerHour: Math.max(0, Math.round(Number(document.getElementById("v2StickerCollectPerHour").value) || 0)),
          maxRemarkChars: Math.min(50, Math.max(1, Math.round(Number(document.getElementById("v2StickerCollectRemarkMax").value) || 20)))
        }
      },
      persistentMemory: {
        enabled: document.getElementById("v2PmEnabled").checked,
        updateIntervalMin: Math.min(1440, Math.max(1, Math.round(Number(document.getElementById("v2PmInterval").value) || 60))),
        maxChars: Math.min(2e4, Math.max(500, Math.round(Number(document.getElementById("v2PmMaxChars").value) || 4e3)))
      },
      context: {
        recentLimit: Math.round(Number(document.getElementById("v2ContextRecentLimit").value) || 100),
        unreadLimit: Math.round(Number(document.getElementById("v2ContextUnreadLimit").value) || 30),
        contextWindow: Math.round(Number(document.getElementById("v2ContextWindow").value) || 20)
      }
    };
  }

  // console/layers/T/config-save.js
  function collectTConfig() {
    return {
      tools: Object.fromEntries([...document.querySelectorAll("[data-v2-tool]")].map((el3) => [el3.dataset.v2Tool, el3.checked]))
    };
  }

  // console/layers/E/config-save.js
  function collectEConfig() {
    return {
      adminDev: {
        enabled: document.getElementById("v2AdminDevEnabled").checked,
        preset: String(document.getElementById("v2AdminDevPreset").value || "standard").trim().slice(0, 64) || "standard"
      }
    };
  }

  // console/layers/L/config-save.js
  function collectLConfig() {
    return {
      autoReplyCheckMs: Math.round(Number(document.getElementById("v2AutoReplyCheckSec").value) || 30) * 1e3,
      wake: {
        recommendedHint: document.getElementById("v2WakeHint").value,
        maxWakePerMinute: Math.round(Number(document.getElementById("v2MaxWakeMin").value) || 0),
        maxWakePerHour: Math.round(Number(document.getElementById("v2MaxWakeHour").value) || 0)
      },
      wait: {
        defaultMs: Math.round(Number(document.getElementById("v2WaitDefaultMs").value) || 5e3),
        minMs: Math.round(Number(document.getElementById("v2WaitMinMs").value) || 1e3),
        maxMs: Math.round(Number(document.getElementById("v2WaitMaxMs").value) || 1e4),
        defaultQuietMs: Number.isFinite(Number(document.getElementById("v2WaitDefaultQuietMs").value)) ? Math.max(0, Math.round(Number(document.getElementById("v2WaitDefaultQuietMs").value))) : 8e3,
        minQuietAfterNewMs: Number.isFinite(Number(document.getElementById("v2MinQuietAfterNewMs").value)) ? Math.max(0, Math.round(Number(document.getElementById("v2MinQuietAfterNewMs").value))) : 1e4
      },
      dailyNews: {
        enabled: document.getElementById("v2NewsEnabled").checked,
        hour: Math.min(23, Math.max(0, Math.round(Number(document.getElementById("v2NewsHour").value) || 9))),
        minute: Math.min(59, Math.max(0, Math.round(Number(document.getElementById("v2NewsMinute").value) || 0))),
        maxItems: Math.min(5, Math.max(1, Math.round(Number(document.getElementById("v2NewsMax").value) || 2))),
        keywords: document.getElementById("v2NewsKeywords").value.split(/[，,\r\n]+/).map((s) => s.trim()).filter(Boolean),
        topicUploaders: document.getElementById("v2NewsUploaders").value.split(/[\r\n]+/).map((line) => {
          const [topic = "", uploader = "", weight = "1"] = line.split("|").map((s) => s.trim());
          return { topic, uploader, weight: weight ? Number(weight) : 1 };
        }).filter((x) => x.topic && x.uploader),
        sessionWhitelist: document.getElementById("v2NewsSessions").value.split(/[，,\r\n]+/).map((s) => s.trim()).filter(Boolean)
      },
      doubleStamp: {
        enabled: document.getElementById("v2DoubleStampEnabled").checked,
        windowCount: Math.min(100, Math.max(1, Math.round(Number(document.getElementById("v2DoubleStampWindowCount").value) || 8)))
      }
    };
  }

  // console/layers/O/config-save.js
  function collectOConfig() {
    return {
      selfReview: {
        enabled: document.getElementById("v2SelfReviewEnabled").checked,
        intervalHours: Math.min(168, Math.max(1, Math.round(Number(document.getElementById("v2SelfReviewHours").value) || 6))),
        autoOptimize: document.getElementById("v2SelfReviewAuto").checked,
        optimizeCooldownHours: Math.min(168, Math.max(1, Math.round(Number(document.getElementById("v2SelfReviewCooldown").value) || 2))),
        maxFeedbackFixesPerRound: Math.min(20, Math.max(1, Math.round(Number(document.getElementById("v2SelfReviewFeedbackMax").value) || 3))),
        maxSelfFixesPerRound: Math.min(20, Math.max(1, Math.round(Number(document.getElementById("v2SelfReviewSelfMax").value) || 3)))
      },
      dailyDiary: {
        enabled: document.getElementById("v2DdEnabled").checked,
        hour: Math.min(23, Math.max(0, Math.round(Number(document.getElementById("v2DdHour").value) || 22))),
        minute: Math.min(59, Math.max(0, Math.round(Number(document.getElementById("v2DdMinute").value) || 0))),
        maxChars: Math.min(2e3, Math.max(50, Math.round(Number(document.getElementById("v2DdMaxChars").value) || 500)))
      },
      feedback: {
        maxLength: Math.round(Number(document.getElementById("v2FeedbackMaxLength").value) || 500),
        notifyOwnerOnError: document.getElementById("v2FeedbackNotifyOwner").checked
      }
    };
  }

  // console/shared/config-save.js
  async function persistPageConfig(btn) {
    const page = btn?.closest("section")?.dataset.page || btn?.dataset.page;
    const body = selectPageConfig({ ...collectCConfig(), ...collectTConfig(), ...collectEConfig(), ...collectLConfig(), ...collectOConfig() }, page);
    const r = await api("/api/socialV2/config", "POST", body);
    const msg = btn && btn.closest && btn.closest("section")?.querySelector(".v2-save-msg") || document.getElementById("lifecycleActionMessage");
    msg.textContent = r.ok ? "✅ 已保存" : "❌ " + (r.error || "失败");
    msg.classList.remove("ok", "err");
    msg.classList.add("meta", r.ok ? "ok" : "err");
    if (r.ok) {
      const slots = [...btn?.closest("section")?.querySelectorAll('.inline-component-settings[data-defer-save="1"]') || []];
      try {
        await Promise.all(slots.map((slot) => slot.__saveComponent?.()));
        if (btn?.closest("section")?.dataset.page === "setting-c-1") {
          const detail = await api("/api/plugins/detail?id=ctx-memory-update");
          const plugin = detail.plugin || detail;
          const sync = await api("/api/plugins/config", "POST", { id: "ctx-memory-update", config: { ...plugin.config || {}, maxChars: Number(document.getElementById("v2PmMaxChars").value) || 4e3 } });
          if (sync.ok === false) throw Error(sync.error || "记忆写入上限同步失败");
        }
        if (slots.length) msg.textContent = "✅ 页面设置与补充参数已保存";
      } catch (error) {
        msg.textContent = "部分参数未保存：" + error.message;
        msg.className = "meta err";
      }
    }
  }
  async function saveV2Config(button) {
    if (button?.disabled) return;
    if (button) {
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
    }
    try {
      await persistPageConfig(button);
    } catch (error) {
      const msg = button?.closest("section")?.querySelector(".v2-save-msg");
      if (msg) {
        msg.textContent = "保存失败：" + error.message;
        msg.classList.remove("ok");
        msg.classList.add("meta", "err");
      }
    } finally {
      if (button) {
        button.disabled = false;
        button.removeAttribute("aria-busy");
      }
    }
  }
  function initialize37() {
  }

  // console/layers/O/tool-log.js
  function v2ToolLogStatus(entry) {
    if (entry.type === "result") {
      const ok = entry.ok !== false;
      return `<span class="pill ${ok ? "g" : "r"}">${ok ? "成功" : "失败"}</span>`;
    }
    return '<span class="pill b">调用</span>';
  }
  function summarizeToolArgs(tool, args) {
    let obj = args;
    if (typeof args === "string") {
      try {
        obj = JSON.parse(args);
      } catch {
        return args || "";
      }
    }
    if (!obj || typeof obj !== "object") return String(obj ?? "");
    const parts = [];
    const push = (k, v) => {
      if (v === void 0 || v === null || v === "") return;
      parts.push(`${k}=${v}`);
    };
    const t = String(tool || "");
    if (t.includes("qq_set_wake_config")) {
      const cfg = obj.config && typeof obj.config === "object" ? obj.config : obj;
      push("mode", cfg.mode);
      push("infinite", cfg.infinite);
      const sleepUntil = cfg.sleepUntil || obj.sleepUntil;
      const sleepMs = cfg.sleepMs !== void 0 ? cfg.sleepMs : obj.sleepMs;
      if (sleepUntil) push("sleepUntil", sleepUntil);
      else if (sleepMs !== void 0) push("sleepMs", sleepMs + "ms");
      else push("sleep", "未设置时间");
      const tr = cfg.triggers && typeof cfg.triggers === "object" ? cfg.triggers : {};
      const trigs = [];
      if (tr.atMention) trigs.push("@");
      if (tr.nameMention) trigs.push("名字");
      if (tr.question) trigs.push("提问");
      if (tr.poke) trigs.push("拍一拍");
      if (Array.isArray(tr.keywords) && tr.keywords.length) trigs.push("关键词:" + tr.keywords.join(","));
      if (Array.isArray(tr.speakerIds) && tr.speakerIds.length) trigs.push("指定成员:" + tr.speakerIds.join(","));
      if (tr.anyMessage) trigs.push("anyMessage");
      if (Number(tr.probability) > 0) trigs.push("概率:" + tr.probability);
      if (trigs.length) push("triggers", trigs.join("|"));
    } else if (t.includes("qq_wait_for_messages")) {
      push("timeoutMs", obj.timeoutMs != null ? obj.timeoutMs : "默认30000");
      push("minNewMessages", obj.minNewMessages != null ? obj.minNewMessages : 1);
      push("quietMs", obj.quietMs != null ? obj.quietMs : "默认8000");
    } else if (t.includes("qq_send_message")) {
      const msgs = Array.isArray(obj.messages) ? obj.messages : obj.messages != null ? [obj.messages] : [];
      push("条数", msgs.length);
      if (msgs.length) push("首条", String(msgs[0]).slice(0, 30));
      push("gapMode", obj.gapMode || "auto");
      if (obj.gapMs != null) push("gapMs", obj.gapMs);
      if (Array.isArray(obj.gaps) && obj.gaps.length) push("gaps", obj.gaps.join(","));
      if (obj.replyToMessageId != null && obj.replyToMessageId !== "") push("引用id", obj.replyToMessageId);
    } else if (t.includes("qq_send_burst")) {
      const msgs = Array.isArray(obj.messages) ? obj.messages : [];
      push("条数", msgs.length);
      if (msgs.length) push("首条", String(msgs[0]).slice(0, 30));
    } else if (t.includes("qq_send_poke")) {
      push("key", obj.key);
      if (obj.targetUserId != null && obj.targetUserId !== "") push("target", obj.targetUserId);
    } else if (t.includes("qq_get_forward_msg")) {
      push("key", obj.key);
      if (obj.id != null && obj.id !== "") push("id", String(obj.id).slice(0, 40));
    } else if (t.includes("qq_mark_read")) {
      push("key", obj.key);
    } else if (t.includes("qq_get_prompt") || t.includes("qq_get_unread_messages") || t.includes("qq_get_recent_messages") || t.includes("qq_social_state") || t.includes("qq_get_my_recent_messages") || t.includes("qq_get_message_detail") || t.includes("qq_get_active_members")) {
      push("key", obj.key);
      if (obj.messageId != null) push("messageId", obj.messageId);
      if (obj.limit != null) push("limit", obj.limit);
    } else {
      push("key", obj.key);
    }
    return parts.join(" | ") || JSON.stringify(obj);
  }
  function v2ToolLogCell(value2, tool) {
    const text = value2 == null ? "" : String(value2);
    if (!text) return '<span class="meta">-</span>';
    const summary = tool ? summarizeToolArgs(tool, text) : text;
    const short = summary.length > 100 ? summary.slice(0, 100) + "…" : summary;
    return `<span class="tool-log-cell" data-full="${esc(text)}" data-short="${esc(short)}" title="点击查看完整 JSON">${esc(short)}</span>`;
  }
  function renderV2ToolLog(entries) {
    const box = document.getElementById("v2ToolLogOutput");
    const list = entries || [];
    if (!list.length) {
      box.innerHTML = '<span class="meta">（空）</span>';
      return;
    }
    let html = "<table><tr><th>时间</th><th>会话 key</th><th>工具名</th><th>状态</th><th>参数</th><th>错误信息</th></tr>";
    for (const e of list) {
      const time3 = e.time ? new Date(e.time).toLocaleString() : "-";
      const key2 = esc(e.key || "");
      const tool = esc(e.tool || "-");
      const status = v2ToolLogStatus(e);
      const params = e.type === "call" ? v2ToolLogCell(e.args, e.tool) : '<span class="meta">-</span>';
      const error = e.type === "result" ? v2ToolLogCell(e.error) : '<span class="meta">-</span>';
      html += `<tr><td>${esc(time3)}</td><td>${key2}</td><td>${tool}</td><td>${status}</td><td>${params}</td><td>${error}</td></tr>`;
    }
    html += "</table>";
    box.innerHTML = html;
  }
  function loadV2ToolLog() {
    return api("/api/socialV2/tool-log?limit=200").then((r) => {
      renderV2ToolLog(r.entries || []);
    }).catch(() => {
      renderV2ToolLog([]);
    });
  }
  function initialize38() {
    document.getElementById("v2ToolLogOutput").addEventListener("click", (ev) => {
      const cell = ev.target.closest(".tool-log-cell");
      if (!cell) return;
      const full = cell.dataset.full;
      const short = cell.dataset.short;
      if (cell.classList.contains("expanded")) {
        cell.classList.remove("expanded");
        cell.textContent = short;
      } else {
        cell.classList.add("expanded");
        cell.textContent = full;
      }
    });
  }

  // console/layers/C/light-memory.js
  function renderV2Memory(data2) {
    const box = document.getElementById("v2MemoryOutput");
    if (!data2 || !data2.ok) {
      box.innerHTML = '<span class="meta">加载失败</span>';
      return;
    }
    const raw = data2.raw || {};
    const topics = Array.isArray(raw.activeTopics) ? raw.activeTopics : [];
    const thoughts = Array.isArray(raw.pendingThoughts) ? raw.pendingThoughts : [];
    const impressions = raw.memberImpressions && typeof raw.memberImpressions === "object" ? raw.memberImpressions : {};
    let html = '<div style="padding:8px">';
    html += '<div class="memory-section"><b>进行中的话题</b> <button class="small" data-action="clear" data-cat="activeTopic">清空</button>';
    if (!topics.length) html += '<div class="meta">（空）</div>';
    for (const t of topics) {
      const text = esc(String(t?.text || ""));
      const extra = t?.pendingQuestion ? `；待追问：${esc(String(t.pendingQuestion))}` : "";
      html += `<div style="margin:4px 0">📌 ${text}${extra} <button class="small" data-action="edit" data-cat="activeTopic" data-content="${esc(String(t?.text || ""))}">编辑</button> <button class="small" data-action="remove" data-cat="activeTopic" data-content="${esc(String(t?.text || ""))}">删除</button></div>`;
    }
    html += "</div>";
    html += '<div class="memory-section"><b>你想说但还没说的</b> <button class="small" data-action="clear" data-cat="pendingThought">清空</button>';
    if (!thoughts.length) html += '<div class="meta">（空）</div>';
    for (const t of thoughts) {
      html += `<div style="margin:4px 0">💭 ${esc(String(t?.text || ""))}${t?.motivation ? `（${esc(String(t.motivation))}）` : ""} <button class="small" data-action="edit" data-cat="pendingThought" data-content="${esc(String(t?.text || ""))}">编辑</button> <button class="small" data-action="remove" data-cat="pendingThought" data-content="${esc(String(t?.text || ""))}">删除</button></div>`;
    }
    html += "</div>";
    html += '<div class="memory-section"><b>当前小上下文窗口内对用户的行为印象</b> <button class="small" data-action="clear" data-cat="memberImpression">清空</button>';
    const names2 = Object.keys(impressions);
    if (!names2.length) html += '<div class="meta">（空）</div>';
    for (const name of names2) {
      const im = impressions[name] || {};
      const traits = Array.isArray(im.traits) ? im.traits : [];
      html += `<div style="margin:4px 0">👤 ${esc(name)}：${traits.length ? esc(traits.join("、")) : "暂无记录"}（互动 ${Number(im.interactionCount) || 0} 次） <button class="small" data-action="edit" data-cat="memberImpression" data-target="${esc(name)}" data-traits="${esc(traits.join(", "))}">编辑</button> <button class="small" data-action="remove" data-cat="memberImpression" data-target="${esc(name)}">删除</button></div>`;
    }
    html += "</div></div>";
    box.innerHTML = html;
  }
  function loadV2Memory() {
    const key2 = document.getElementById("v2MemoryKey").value.trim();
    const msg = document.getElementById("v2MemoryMsg");
    if (!key2) {
      msg.textContent = "请输入会话 key";
      msg.className = "meta err";
      return;
    }
    msg.textContent = "加载中…";
    msg.className = "meta";
    return api("/api/socialV2/memory?key=" + encodeURIComponent(key2)).then((r) => {
      renderV2Memory(r);
      msg.textContent = r.ok ? "✅ 已加载" : "❌ " + (r.error || "失败");
      msg.className = r.ok ? "meta ok" : "meta err";
    }).catch((e) => {
      msg.textContent = "❌ " + (e.message || e);
      msg.className = "meta err";
    });
  }
  function initialize39() {
    document.getElementById("v2MemoryLoad").addEventListener("click", loadV2Memory);
    document.getElementById("v2MemoryClearAll").addEventListener("click", async () => {
      const key2 = document.getElementById("v2MemoryKey").value.trim();
      const msg = document.getElementById("v2MemoryMsg");
      if (!key2) {
        msg.textContent = "请输入会话 key";
        msg.className = "meta err";
        return;
      }
      if (!confirm("确定清空该会话全部轻量记忆？")) return;
      const r = await api("/api/socialV2/memory-clear", "POST", { key: key2, category: "" });
      msg.textContent = r.ok ? "✅ 已清空此会话轻量记忆" : "❌ " + (r.error || "失败");
      msg.className = r.ok ? "meta ok" : "meta err";
      if (r.ok) loadV2Memory();
    });
    document.getElementById("v2MemoryOutput").addEventListener("click", async (ev) => {
      const btn = ev.target.closest("button[data-action]");
      if (!btn) return;
      const key2 = document.getElementById("v2MemoryKey").value.trim();
      const msg = document.getElementById("v2MemoryMsg");
      if (!key2) {
        msg.textContent = "请输入会话 key";
        msg.className = "meta err";
        return;
      }
      const cat = btn.dataset.cat;
      const action = btn.dataset.action;
      let r;
      if (action === "clear") {
        r = await api("/api/socialV2/memory-clear", "POST", { key: key2, category: cat });
      } else if (action === "edit") {
        let newContent;
        let newExtra = {};
        if (cat === "memberImpression") {
          const input = prompt(`编辑对 ${btn.dataset.target} 的印象特质（逗号分隔）：`, btn.dataset.traits || "");
          if (input === null) return;
          newContent = input;
        } else {
          const input = prompt(`编辑${cat === "activeTopic" ? "话题" : "想法"}内容：`, btn.dataset.content || "");
          if (input === null) return;
          newContent = input;
        }
        r = await api("/api/socialV2/memory-update", "POST", { key: key2, category: cat, oldContent: btn.dataset.content || "", target: btn.dataset.target || "", newContent, newExtra });
      } else {
        r = await api("/api/socialV2/memory-remove", "POST", { key: key2, category: cat, content: btn.dataset.content || "", target: btn.dataset.target || "" });
      }
      msg.textContent = r.ok ? "✅ 已更新" : "❌ " + (r.error || "失败");
      msg.className = r.ok ? "meta ok" : "meta err";
      if (r.ok) loadV2Memory();
    });
  }

  // console/layers/C/initial-prompt-sessions.js
  var manualSession = "__manual__";
  var validSessionKey = (key2) => /^(group|private):\d+$/.test(key2);
  var picker = () => document.getElementById("v2InitPromptKey");
  function initialPromptKey() {
    return picker().value === manualSession ? document.getElementById("v2InitPromptManualKey").value.trim() : picker().value;
  }
  function selectInitialPromptKey(key2) {
    const select = picker();
    if (key2 && ![...select.options].some((option) => option.value === key2)) select.add(new Option(key2, key2), select.options.length - 1);
    select.value = key2;
    document.getElementById("v2InitPromptManualKey").hidden = true;
  }
  async function refreshInitialPromptSessions() {
    const results = await Promise.allSettled([api("/api/socialV2/states"), api("/api/sessions"), api("/api/socialV2/initial-prompt")]);
    const keys = /* @__PURE__ */ new Set();
    const fields = ["conversations", "sessions", "entries"];
    let available = 0;
    results.forEach((result, index) => {
      if (result.status !== "fulfilled" || result.value.ok === false) return;
      available++;
      for (const item of result.value[fields[index]] || []) if (validSessionKey(item.key)) keys.add(item.key);
    });
    if (!available) throw Error("无法读取会话列表，可选择手动填写会话 key");
    const select = picker(), previous = select.value;
    if (validSessionKey(previous)) keys.add(previous);
    select.replaceChildren(
      new Option("选择群聊或私聊…", ""),
      ...[...keys].sort().map((key2) => new Option((key2.startsWith("group:") ? "群聊 · " : "私聊 · ") + key2, key2)),
      new Option("手动填写新会话…", manualSession)
    );
    select.value = previous;
  }

  // console/layers/C/initial-prompt.js
  var v2InitPromptTextEl;
  var requestSequence = 0;
  var loadedKey = "";
  var dirty2 = false;
  var loading2 = false;
  var writing = false;
  var writable = true;
  function v2InitPromptKeyValue() {
    return initialPromptKey();
  }
  function updateInitialPromptActions() {
    const ready = !!loadedKey && loadedKey === v2InitPromptKeyValue() && !loading2 && !writing;
    v2InitPromptTextEl.disabled = !ready;
    document.getElementById("v2InitPromptSave").disabled = !ready || !writable;
    document.getElementById("v2InitPromptClear").disabled = !ready || !writable;
  }
  function setV2InitPromptMsg(text, kind) {
    const msg = document.getElementById("v2InitPromptMsg");
    msg.textContent = text;
    msg.className = "meta" + (kind ? " " + kind : "");
  }
  function updateV2InitPromptCount() {
    document.getElementById("v2InitPromptCount").textContent = String(v2InitPromptTextEl.value.length);
  }
  function applyV2InitPromptMax(maxChars) {
    const max = Math.round(Number(maxChars));
    if (!Number.isFinite(max) || max <= 0) return;
    document.getElementById("v2InitPromptMax").textContent = String(max);
    v2InitPromptTextEl.maxLength = max;
  }
  function renderV2InitPromptEntries(entries) {
    const box = document.getElementById("v2InitPromptList");
    if (!Array.isArray(entries) || !entries.length) {
      box.textContent = "（还没有任何会话设置初始提示词）";
      return;
    }
    box.innerHTML = entries.map((e) => {
      const when = Number(e.updatedAt) > 0 ? new Date(Number(e.updatedAt)).toLocaleString() : "未知时间";
      return `<div style="margin:3px 0"><code>${esc(e.key)}</code> · ${Number(e.chars) || 0} 字符 · ${esc(when)} <button class="small" data-init-prompt-key="${esc(e.key)}">编辑</button></div>`;
    }).join("");
  }
  async function loadV2InitialPrompt() {
    const key2 = v2InitPromptKeyValue();
    if (key2 && !validSessionKey(key2)) {
      setV2InitPromptMsg("会话格式应为 group:群号 或 private:QQ号", "err");
      return;
    }
    if (dirty2 && !confirm("重新加载将放弃尚未保存的会话背景，是否继续？")) return;
    const sequence2 = ++requestSequence;
    loadedKey = "";
    dirty2 = false;
    loading2 = true;
    v2InitPromptTextEl.value = "";
    updateV2InitPromptCount();
    updateInitialPromptActions();
    setV2InitPromptMsg("加载中…");
    try {
      const r = await api("/api/socialV2/initial-prompt" + (key2 ? "?key=" + encodeURIComponent(key2) : ""));
      if (sequence2 !== requestSequence || key2 !== v2InitPromptKeyValue()) return;
      if (!r.ok) {
        setV2InitPromptMsg("❌ " + (r.error || "失败"), "err");
        return;
      }
      applyV2InitPromptMax(r.maxChars);
      const readOnly = r.writable === false;
      if (!key2) {
        renderV2InitPromptEntries(r.entries);
        setV2InitPromptMsg(readOnly ? "⚠️ 文件不可写（只读降级），只显示已有内容" : `✅ 共 ${(r.entries || []).length} 条`, readOnly ? "err" : "ok");
        return;
      }
      v2InitPromptTextEl.value = r.text || "";
      loadedKey = key2;
      writable = !readOnly;
      updateV2InitPromptCount();
      document.getElementById("v2InitPromptList").textContent = r.exists ? "该会话已设置初始提示词；再点「保存」会覆盖。" : "该会话还没有设置初始提示词；填写后点「保存」新建。";
      if (readOnly) setV2InitPromptMsg("⚠️ 文件不可写（只读降级）：能看不能存", "err");
      else setV2InitPromptMsg(r.exists ? "✅ 已加载" : "（空）", r.exists ? "ok" : "");
    } catch (e) {
      if (sequence2 === requestSequence) setV2InitPromptMsg("❌ " + (e.message || e), "err");
    } finally {
      if (sequence2 === requestSequence) {
        loading2 = false;
        updateInitialPromptActions();
      }
    }
  }
  async function saveV2InitialPrompt() {
    const key2 = v2InitPromptKeyValue();
    if (!key2) {
      setV2InitPromptMsg("请输入会话 key（group:群号 或 private:QQ号）", "err");
      return;
    }
    if (key2 !== loadedKey || loading2 || writing) {
      setV2InitPromptMsg("请先加载此会话背景", "err");
      return;
    }
    const sequence2 = requestSequence, text = v2InitPromptTextEl.value;
    writing = true;
    updateInitialPromptActions();
    setV2InitPromptMsg("保存中…");
    try {
      const r = await api("/api/socialV2/initial-prompt", "POST", { key: key2, text });
      if (sequence2 !== requestSequence || key2 !== v2InitPromptKeyValue()) return;
      if (!r.ok) {
        setV2InitPromptMsg("❌ " + (r.error || "失败"), "err");
        return;
      }
      applyV2InitPromptMax(r.maxChars);
      dirty2 = false;
      if (r.deleted) {
        v2InitPromptTextEl.value = "";
        updateV2InitPromptCount();
        setV2InitPromptMsg("✅ 内容为空，已删除该会话的初始提示词", "ok");
      } else {
        setV2InitPromptMsg(`✅ 已保存（${r.chars} 字符），该会话下一次首次唤醒时注入`, "ok");
      }
    } catch (e) {
      if (sequence2 === requestSequence) setV2InitPromptMsg("❌ " + (e.message || e), "err");
    } finally {
      writing = false;
      updateInitialPromptActions();
    }
  }
  function initialize40() {
    v2InitPromptTextEl = document.getElementById("v2InitPromptText");
    updateInitialPromptActions();
    document.getElementById("v2InitPromptKey").addEventListener("change", () => {
      if (dirty2 && !confirm("切换会话将放弃尚未保存的背景，是否继续？")) {
        selectInitialPromptKey(loadedKey);
        return;
      }
      ++requestSequence;
      dirty2 = false;
      loadedKey = "";
      loading2 = false;
      v2InitPromptTextEl.value = "";
      updateV2InitPromptCount();
      updateInitialPromptActions();
      const manual = document.getElementById("v2InitPromptKey").value === manualSession;
      const input = document.getElementById("v2InitPromptManualKey");
      input.hidden = !manual;
      if (manual) {
        input.value = "";
        input.focus();
        setV2InitPromptMsg("填写会话 key 后点“加载”");
      } else void loadV2InitialPrompt();
    });
    document.getElementById("v2InitPromptManualKey").addEventListener("input", () => {
      ++requestSequence;
      loadedKey = "";
      loading2 = false;
      updateInitialPromptActions();
    });
    registerPageLoader("setting-c-2", () => refreshInitialPromptSessions().catch((error) => setV2InitPromptMsg(error.message, "err")));
    document.getElementById("v2InitPromptLoad").addEventListener("click", loadV2InitialPrompt);
    document.getElementById("v2InitPromptSave").addEventListener("click", saveV2InitialPrompt);
    document.getElementById("v2InitPromptClear").addEventListener("click", async () => {
      const key2 = v2InitPromptKeyValue();
      if (!key2) {
        setV2InitPromptMsg("请输入会话 key", "err");
        return;
      }
      if (key2 !== loadedKey || loading2 || writing) return;
      if (!confirm(`确定删除 ${key2} 的初始提示词？`)) return;
      const sequence2 = requestSequence;
      writing = true;
      updateInitialPromptActions();
      try {
        const r = await api("/api/socialV2/initial-prompt", "POST", { key: key2, delete: true });
        if (sequence2 !== requestSequence || key2 !== v2InitPromptKeyValue()) return;
        if (!r.ok) {
          setV2InitPromptMsg("❌ " + (r.error || "失败"), "err");
          return;
        }
        v2InitPromptTextEl.value = "";
        dirty2 = false;
        updateV2InitPromptCount();
        setV2InitPromptMsg("✅ 已删除", "ok");
      } catch (e) {
        if (sequence2 === requestSequence) setV2InitPromptMsg("❌ " + (e.message || e), "err");
      } finally {
        writing = false;
        updateInitialPromptActions();
      }
    });
    v2InitPromptTextEl.addEventListener("input", () => {
      dirty2 = true;
      updateV2InitPromptCount();
    });
    document.getElementById("v2InitPromptList").addEventListener("click", (ev) => {
      const btn = ev.target.closest("button[data-init-prompt-key]");
      if (!btn) return;
      if (dirty2 && !confirm("切换会话将放弃尚未保存的背景，是否继续？")) return;
      dirty2 = false;
      selectInitialPromptKey(btn.dataset.initPromptKey || "");
      loadV2InitialPrompt();
    });
    document.getElementById("v2MoodRefresh").addEventListener("click", refreshV2Mood);
    document.getElementById("voiceRefreshBtn").addEventListener("click", () => loadVoiceLibrary(true));
    document.getElementById("voiceSendBtn").addEventListener("click", sendVoiceFromConsole);
  }

  // console/layers/L/receipts.js
  function loadV2Receipts() {
    const key2 = document.getElementById("v2ReceiptKey").value.trim();
    const msg = document.getElementById("v2ReceiptMsg");
    const out = document.getElementById("v2ReceiptOutput");
    if (!key2) {
      msg.textContent = "请输入会话 key";
      msg.className = "meta err";
      return;
    }
    msg.textContent = "加载中…";
    msg.className = "meta";
    return api("/api/socialV2/state?key=" + encodeURIComponent(key2)).then((r) => {
      if (!r || r.ok !== true) throw new Error(r && r.error || "失败");
      const rows = Array.isArray(r.pendingMessages) ? r.pendingMessages : [];
      const fmt = (t) => t ? new Date(Number(t)).toLocaleTimeString() : "—";
      const lines = [
        `会话：${r.key || key2}`,
        `待回复：${Number(r.pendingReplyCount) || 0} 条｜已接收未回复：${Number(r.awaitingReplyCount) || 0} 条｜首条未完成 seq：${r.firstPendingSeq == null ? "—" : r.firstPendingSeq}｜已读水位：${r.lastReadThroughSeq == null ? "—" : r.lastReadThroughSeq}`
      ];
      const audit = r.doubleStampCheck;
      if (audit) lines.push(`最近入站回查：${audit.enabled ? "启用" : "关闭"}｜向前 ${Number(audit.windowCount) || 0} 条｜触发 seq ${audit.triggerSeq || "—"}｜${audit.checkedAt ? new Date(Number(audit.checkedAt)).toLocaleTimeString() : "尚未检查"}｜窗口未完成 ${Number(audit.pendingCount) || 0} 条｜异常 ${Array.isArray(audit.anomalies) ? audit.anomalies.length : 0} 条｜上次 JSON 回执 ${audit.lastReportAt ? new Date(Number(audit.lastReportAt)).toLocaleTimeString() : "尚未上报"}｜${audit.lastReportError || ""}`);
      if (Array.isArray(audit?.anomalies) && audit.anomalies.length) lines.push("异常详情：" + audit.anomalies.map((item) => `seq ${item.seq} ${item.state || ""} ${item.note || item.source || ""}`).join("；"));
      if (!rows.length) lines.push("（窗口内没有未完成的消息：都拿到了 seenAt + repliedAt）");
      for (const m of rows) {
        lines.push(`seq ${m.seq} · ${m.sender || "未知"} · ${m.receiptState || ""} · seenAt=${fmt(m.seenAt)} · repliedAt=${fmt(m.repliedAt)}${m.awaitingReply ? " · 已接收未回复" : ""}`);
      }
      out.textContent = lines.join("\n");
      msg.textContent = "✅ 已加载";
      msg.className = "meta ok";
    }).catch((e) => {
      msg.textContent = "❌ " + (e && e.message ? e.message : e || "失败");
      msg.className = "meta err";
    });
  }
  function initialize41() {
    document.getElementById("v2ReceiptLoad").addEventListener("click", loadV2Receipts);
  }

  // console/layers/O/feedback.js
  async function loadV2FeedbackState() {
    const loadButton = document.getElementById("v2FeedbackLoad");
    const msg = document.getElementById("v2FeedbackMsg");
    if (loadButton) loadButton.disabled = true;
    if (msg) {
      msg.textContent = "正在加载…";
      msg.className = "meta";
    }
    try {
      const [r, q] = await Promise.all([api("/api/socialV2/feedback"), api("/api/socialV2/self-review-feedback")]);
      const entries = r.entries || [];
      const counts = q.counts || {};
      const summary = document.getElementById("v2FeedbackStatusSummary");
      if (summary) summary.textContent = `历史记录-${q.historyCount ?? r.historyCount ?? entries.length}　·　待修复 ${counts.pending || 0}（用户反馈 ${counts.userPending || 0} · Bot自我发现/工具 ${counts.selfPending || 0} · 管理员反馈 ${counts.adminPending || 0}）　·　困难问题 ${counts.difficulty || 0}　·　已修复 ${counts.completed || 0}　·　已删除 ${counts.deleted || 0}　·　今日新增 ${counts.todayTotal || 0}`;
      const host = document.getElementById("v2FeedbackQueueOutput");
      const historyHost = document.getElementById("v2FeedbackHistoryOutput");
      const escText = (value2) => String(value2 ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
      const queueName = { user: "待修复 · 用户反馈 · 2 小时 / 每轮最多 3 条", self: "待修复 · Bot自我发现/工具 · 6 小时 / 每轮最多 3 条", admin: "待修复 · 管理员反馈 · 即时" };
      const itemCard = (item) => {
        const kind = item.kind || ({ user: "用户反馈", self: "自我发现/工具反馈", admin: "管理员即时反馈" }[item.origin] || "反馈");
        const source = item.source || item.reporter || "未知来源";
        const description = item.text || item.message || item.description || item.issue || item.detail || "（原记录未包含描述）";
        const result = item.result ? `<div class="feedback-result"><span class="feedback-result-label">处理记录</span><p>${escText(item.result)}</p></div>` : "";
        const processing = !!(item.processingTaskId || item.processingClaimId);
        const processingLabel = item.researchStatus === "waiting_input" ? "DSH 研究等待输入" : item.researchStatus === "starting" ? "DSH 研究启动中" : "DSH 研究处理中";
        return `<article class="feedback-item"><div class="feedback-item-main">${processing ? `<span class="feedback-processing">${processingLabel}</span>` : ""}<div class="feedback-description">${escText(description)}${processing ? " —处理中" : ""}</div><small class="feedback-item-meta"><span>编号 ${escText(item.id)}</span><span>类别 ${escText(kind)}</span><span>来源 ${escText(source)}</span><span>${escText(item.createdAt || "")}</span><span>失败尝试 ${Number(item.attempts) || 0}</span>${item.processingTaskId ? `<span>DSH 任务 ${escText(item.processingTaskId)}</span>` : ""}</small>${result}</div><div class="feedback-actions"><button class="small" data-feedback-action="research" data-id="${escText(item.id)}" ${processing ? "disabled" : ""}>${processing ? "DSH 研究中" : "转移到 DSH 研究"}</button><button class="small" data-feedback-action="difficulty" data-id="${escText(item.id)}" ${processing ? "disabled" : ""}>移入困难问题</button><button class="small" data-feedback-action="resolve" data-id="${escText(item.id)}" ${processing ? "disabled" : ""}>已修复</button><button class="small danger" data-feedback-action="delete" data-id="${escText(item.id)}" ${processing ? "disabled" : ""}>删除</button></div></article>`;
      };
      const queues = q.queues || {};
      const metrics = document.getElementById("v2FeedbackQueueMetrics");
      if (metrics) metrics.innerHTML = `<div class="feedback-metric"><span>用户反馈</span><b>${(queues.user || []).length}</b><small>每 2 小时 · 每轮最多 3 条</small></div><div class="feedback-metric"><span>自我发现 / 工具</span><b>${(queues.self || []).length}</b><small>每 6 小时 · 每轮最多 3 条</small></div><div class="feedback-metric"><span>管理员即时</span><b>${(queues.admin || []).length}</b><small>收到后即时处理</small></div><div class="feedback-metric is-difficult"><span>困难问题</span><b>${(q.difficulties || []).length}</b><small>三次未解决或手动移入</small></div>`;
      const section2 = (key2, items2) => `<section class="feedback-queue"><h4><strong class="feedback-status feedback-status-pending">${queueName[key2]}</strong><span>${items2.length}</span></h4>${items2.length ? items2.map(itemCard).join("") : '<div class="feedback-empty">当前队列为空</div>'}</section>`;
      const hard = (q.difficulties || []).map((item) => {
        const result = item.result ? `<div class="feedback-result"><span class="feedback-result-label">处理记录</span><p>${escText(item.result)}</p></div>` : "";
        return `<article class="feedback-item"><div class="feedback-item-main"><div class="feedback-description">${escText(item.text || item.message || item.description || item.issue || item.detail || "（原记录未包含描述）")}</div><small class="feedback-item-meta"><span>编号 ${escText(item.id)}</span><span>类别 ${escText(item.kind || item.origin || "反馈")}</span><span>来源 ${escText(item.source || item.reporter || "未知来源")}</span><span>${escText(item.createdAt || "")}</span><span>累计尝试 ${Number(item.attempts) || 0}</span></small>${result}</div><div class="feedback-actions"><label class="feedback-transfer-label" for="restore-${escText(item.id)}">移回哪个队列</label><select id="restore-${escText(item.id)}" aria-label="移回目标队列" data-restore-select="${escText(item.id)}"><option value="user" ${item.queue === "user" ? "selected" : ""}>用户反馈队列</option><option value="self" ${item.queue === "self" ? "selected" : ""}>自我发现/工具队列</option><option value="admin" ${item.queue === "admin" ? "selected" : ""}>管理员反馈队列</option></select><button class="small" data-feedback-action="restore" data-id="${escText(item.id)}">移回队列末尾</button><button class="small" data-feedback-action="resolve" data-id="${escText(item.id)}">已修复</button><button class="small danger" data-feedback-action="delete" data-id="${escText(item.id)}">删除</button></div></article>`;
      }).join("");
      const historyStatus = (item) => (item.status === "待修复" ? `待修复 · ${{ user: "用户反馈", self: "Bot自我发现/工具", admin: "管理员反馈" }[item.queue] || item.kind || "其他来源"}` : item.status || "待修复") + (item.processingTaskId || item.processingClaimId ? " · DSH研究处理中" : "");
      const historyStateClass = (status) => ({ "待修复": "pending", "困难问题": "difficulty", "已修复": "completed", "已删除": "deleted" })[status] || "pending";
      const history2 = entries.slice().sort((a, b) => Date.parse(b.createdAt || b.time || 0) - Date.parse(a.createdAt || a.time || 0)).slice(0, 100).map((item) => `<div class="feedback-history-row"><b class="feedback-status feedback-status-${historyStateClass(item.status)}">${escText(historyStatus(item))}</b><span>${escText(item.createdAt || item.time || "")}</span><p>${escText(item.text || item.message || item.description || item.issue || item.detail || "（原记录未包含描述）")}</p></div>`).join("");
      historyHost.innerHTML = `<div class="feedback-history-list"><div class="meta">最近显示 ${Math.min(entries.length, 100)} 条 / 历史共 ${q.historyCount ?? entries.length} 条</div>${history2 || '<div class="feedback-empty">暂无历史反馈</div>'}</div>`;
      host.innerHTML = `<div class="feedback-manager"><p class="meta">状态共四种：待修复、困难问题、已修复、已删除。待修复按用户反馈、Bot自我发现/工具、管理员反馈分队列；删除后仍保留在历史中，连续三次未解决自动转入困难问题。</p>${section2("user", queues.user || [])}${section2("self", queues.self || [])}${section2("admin", queues.admin || [])}<section class="feedback-queue"><h4><strong class="feedback-status feedback-status-difficulty">困难问题列表</strong><span>${(q.difficulties || []).length}</span></h4>${hard || '<div class="feedback-empty">暂无困难问题</div>'}</section></div>`;
      host.querySelectorAll("[data-feedback-action]").forEach((button) => button.addEventListener("click", async () => {
        const action = button.dataset.feedbackAction, id = button.dataset.id;
        if (action === "research") {
          button.disabled = true;
          button.textContent = "正在启动 DSH 研究…";
          try {
            const result2 = await api("/api/socialV2/self-review-feedback/research", "POST", { id });
            if (!result2.ok) alert(result2.error || "启动 DSH 研究失败");
            else {
              await loadV2FeedbackState();
              const feedbackMsg = document.getElementById("v2FeedbackMsg");
              if (feedbackMsg) feedbackMsg.textContent = `已启动 DSH 研究任务 ${result2.taskId}；任务状态会回写到此卡片。`;
            }
          } catch (error) {
            alert(error?.message || "启动 DSH 研究失败");
            button.disabled = false;
            button.textContent = "转移到 DSH 研究";
          }
          return;
        }
        if (action === "delete" && !confirm("确定删除这条反馈？删除后会移出待修复队列、保留在历史记录中，并计入“已删除”。")) return;
        let detail = "";
        if (action === "restore") detail = host.querySelector(`[data-restore-select="${CSS.escape(id)}"]`)?.value || "user";
        if (action === "resolve") detail = prompt("可补充已修复依据；留空将记录为人工确认。") || "管理员在 Console 手动确认已修复";
        const result = await api("/api/socialV2/self-review-feedback/action", "POST", { id, action, detail });
        if (!result.ok) alert(result.error || "操作失败");
        else {
          await loadV2FeedbackState();
          const feedbackMsg = document.getElementById("v2FeedbackMsg");
          if (feedbackMsg) feedbackMsg.textContent = action === "delete" ? "已删除：记录保留在历史中，已删除计数已更新。" : action === "difficulty" ? "已移入困难问题。" : action === "resolve" ? "已标记为已修复。" : "已移回所选队列末尾。";
        }
      }));
      if (msg) {
        msg.textContent = "已更新";
        msg.className = "meta";
      }
    } catch (e) {
      const errorText = `加载失败：${e && e.message ? e.message : e || "请求失败"}`;
      const metrics = document.getElementById("v2FeedbackQueueMetrics");
      const queue = document.getElementById("v2FeedbackQueueOutput");
      const history2 = document.getElementById("v2FeedbackHistoryOutput");
      if (metrics) metrics.innerHTML = `<span class="feedback-empty">${String(errorText).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c])}</span>`;
      if (queue) queue.textContent = errorText;
      if (history2) history2.textContent = errorText;
      if (msg) {
        msg.textContent = `❌ ${errorText}`;
        msg.className = "meta err";
      }
    } finally {
      if (loadButton) loadButton.disabled = false;
    }
  }
  function initialize42() {
    document.getElementById("v2FeedbackLoad").addEventListener("click", loadV2FeedbackState);
    loadV2FeedbackState();
  }

  // console/layers/O/optimization-summary.js
  async function loadV2OptimizationSummary() {
    const button = document.getElementById("v2OptimizationSummaryLoad");
    const meta = document.getElementById("v2OptimizationSummaryMeta");
    const output = document.getElementById("v2OptimizationSummaryContent");
    if (button) button.disabled = true;
    if (meta) meta.textContent = "正在读取摘要文件…";
    try {
      const result = await api("/api/socialV2/optimization-memory");
      if (result?.ok !== true) throw new Error(result?.error || "读取失败");
      if (output) output.textContent = result.content || "摘要文件目前为空。";
      if (meta) meta.textContent = result.exists ? `共 ${Number(result.chars) || 0} 字 · 更新于 ${result.updatedAt ? new Date(result.updatedAt).toLocaleString() : "时间未知"}` : "摘要文件尚未生成；主动扫描或修复处理后会在此显示。";
    } catch (error) {
      if (output) output.textContent = `读取失败：${error?.message || error || "请求失败"}`;
      if (meta) meta.textContent = "无法读取摘要文件";
    } finally {
      if (button) button.disabled = false;
    }
  }
  function initialize43() {
    document.getElementById("v2OptimizationSummaryLoad")?.addEventListener("click", loadV2OptimizationSummary);
    loadV2OptimizationSummary();
    document.getElementById("v2ToolLogLoad").addEventListener("click", async () => {
      const msg = document.getElementById("v2ToolLogMsg");
      msg.textContent = "";
      await loadV2ToolLog();
    });
    document.getElementById("v2ToolLogClear").addEventListener("click", async () => {
      if (!confirm("确定清空全部工具调用日志？")) return;
      const r = await api("/api/socialV2/tool-log/clear", "POST", {});
      const msg = document.getElementById("v2ToolLogMsg");
      msg.textContent = r.ok ? "✅ 已清空" : "❌ " + (r.error || "失败");
      msg.className = r.ok ? "meta ok" : "meta err";
      renderV2ToolLog([]);
    });
  }

  // console/shared/icons.js
  var NAV_ICON_PATHS;
  function renderNavIcon(view) {
    return '<span class="nav-icon" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false">' + (NAV_ICON_PATHS[view] || NAV_ICON_PATHS.registry) + "</svg></span>";
  }
  function initialize44() {
    NAV_ICON_PATHS = {
      "context-visual": '<path d="m12 2 10 5-10 5L2 7Zm-10 10 10 5 10-5M2 17l10 5 10-5"/><path d="M12 12v10"/>',
      "setting-o-2": '<path d="M14 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h9M8 7h5M8 11h3M8 15h2"/><path d="M17 10a5 5 0 1 1-4 8m0-4v4h4m3-11v3h-3"/>',
      "terms": '<path d="m12 3-10 5 10 5 10-5ZM6 11v5c3 3 9 3 12 0v-5M22 8v8"/>',
      "persona": '<circle cx="12" cy="8" r="3.5"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/>',
      "slang": '<path d="M4 5a2 2 0 0 1 2-2h14v18H6a2 2 0 0 1 0-4h14M4 5v14M8 7h8M8 11h6"/>',
      "alias": '<path d="M3 4h8l10 10-7 7L3 10Z"/><circle cx="7.5" cy="7.5" r="1"/>',
      "reference": '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
      "v2-t": '<path d="M4 7h7m4 0h5M4 17h3m4 0h9"/><circle cx="13" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
      "games": '<path d="M6 8h12a4 4 0 0 1 3.8 5.2l-1 3A2 2 0 0 1 17 17l-2-2H9l-2 2a2 2 0 0 1-3.8-.8l-1-3A4 4 0 0 1 6 8Z"/><path d="M7 10v4m-2-2h4m7-1h.01M18 13h.01"/>',
      "codex-peer": '<rect x="2" y="4" width="8" height="7" rx="1.5"/><rect x="14" y="13" width="8" height="7" rx="1.5"/><path d="M14 6h5v4m-3-3 3 3M10 18H5v-4m3 3-3-3"/>',
      "injection-lab": '<path d="M9 3h6M10 3v6L4 19a1.3 1.3 0 0 0 1 2h14a1.3 1.3 0 0 0 1-2L14 9V3M7 15h10M10 18h.01M14 12h.01"/>',
      "environment-chat": '<path d="M21 11a8 8 0 0 1-8 8H7l-4 2V9a7 7 0 0 1 7-7h4a7 7 0 0 1 7 7Z"/>',
      "environment-admin": '<path d="m12 3-8 3v6c0 5 8 9 8 9s8-4 8-9V6Z"/><path d="m9 12 2 2 4-4"/>',
      "environment-web": '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 8h18m-8 4 5 2-3 1-1 3Z"/>',
      "environment-watch": '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
      "environment-scripts": '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3m6 0h4"/>',
      "images": '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="2"/><path d="m3 17 5-5 4 4 3-3 6 6"/>',
      "video": '<rect x="3" y="5" width="13" height="14" rx="2"/><path d="m16 10 5-3v10l-5-3"/>',
      "sessions": '<path d="M21 12a8 8 0 0 1-8 8H7l-4 2V10a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8Z"/><path d="m8 11 3 3 5-5"/>',
      "v2-e": '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v1a7 7 0 0 0 14 0v-1M12 18v4M8 22h8"/>',
      "v2-l": '<path d="m13 2-9 12h7l-1 8 10-12h-7Z"/>',
      "social-v1": '<path d="M3 10a9 9 0 1 1 2 8M3 4v6h6M12 7v5l3 2"/>',
      "overview": '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="11" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="18" width="7" height="3" rx="1"/>',
      "usage": '<path d="M4 20V10m6 10V4m6 16v-7M2 22h20"/><circle cx="19" cy="6" r="3"/>',
      "operations": '<path d="M14 6a6 6 0 0 0-7 7L3 17a2.8 2.8 0 0 0 4 4l5-5a6 6 0 0 0 7-8l-4 4-3-3 4-4Z"/>',
      "layer-v": '<path d="m12 3-8 3v6c0 5 8 9 8 9s8-4 8-9V6Z"/><path d="m8 12 3 3 5-6"/>',
      "human": '<circle cx="12" cy="7" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2Z"/>',
      "access": '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 15v2"/>',
      "layer-s": '<path d="M3 3h7a3 3 0 0 1 3 3v15a4 4 0 0 0-4-2H3Zm18 0h-5a3 3 0 0 0-3 3v15a4 4 0 0 1 4-2h4Z"/>',
      "registry": '<path d="M9 3v5H4v5h5v8h5v-5h6v-5h-6V3Z"/>',
      "setting-c-0": '<circle cx="12" cy="12" r="9"/><path d="M8 9h.01M16 9h.01M8 14a4.5 4.5 0 0 0 8 0"/>',
      "setting-c-1": '<path d="M12 5a3 3 0 0 0-6-1 4 4 0 0 0-3 6 4 4 0 0 0 1 7 4 4 0 0 0 8 2m0-14a3 3 0 0 1 6-1 4 4 0 0 1 3 6 4 4 0 0 1-1 7 4 4 0 0 1-8 2V5ZM8 8l-2 2m12-2 2 2M7 14l2 2m8-2-2 2"/>',
      "setting-c-2": '<path d="M21 11a8 8 0 0 1-8 8H8l-5 3V11a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8Z"/><path d="M7 8h10M7 12h8M7 16h4"/>',
      "setting-l-0": '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4M12 2V1"/>',
      "setting-l-1": '<path d="m22 2-7 20-4-9L2 9Zm0 0L11 13"/>',
      "setting-l-2": '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M7 2v4M17 2v4M3 10h18M7 14h3M7 17h3"/><circle cx="16" cy="16" r="3"/><path d="M16 14v2l1 1"/>',
      "setting-o-0": '<path d="M2 12h5l3-8 4 16 3-8h5"/>',
      "setting-o-1": '<path d="M14 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-8M7 8h4M7 12h2m4-1 7-7 2 2-7 7-3 1Z"/>'
    };
    for (const nav of document.querySelectorAll("#mainNav .nav-item[data-view]")) {
      const icon = nav.querySelector(".nav-icon");
      if (icon) icon.outerHTML = renderNavIcon(nav.dataset.view);
    }
  }

  // console/shared/config-actions.js
  function initialize45() {
    document.querySelectorAll(".v2-save").forEach((button) => button.addEventListener("click", () => saveV2Config(button)));
  }

  // console/shared/startup.js
  function initialize46() {
    setTimeout(() => setConsolePage(location.hash.slice(1), { updateHash: false }), 0);
    refresh2();
    refreshRoles();
    refreshWhitelist();
    refreshSessions();
    refreshPending();
    refreshPresets();
    loadSocialForm();
    loadV2Config();
    refreshV2Activity();
    loadV2ToolLog();
    refreshSocialStatus();
    refreshSlang();
    loadSlangConfig();
    loadSecurity();
    refreshSimPrompt();
    setInterval(() => {
      refresh2();
      refreshSessions();
      refreshPending();
      refreshSocialStatus();
      refreshSlang();
    }, 3e3);
    setInterval(() => {
      if (currentConsolePage !== "usage") return;
      void refreshUsageDashboard();
    }, 3e3);
  }

  // console/shared/theme.js
  function initialize47() {
    (function() {
      var root = document.documentElement;
      var button = document.getElementById("themeToggle");
      var media = window.matchMedia("(prefers-color-scheme: dark)");
      function stored() {
        try {
          return localStorage.getItem("qq-console-theme");
        } catch (error) {
          return null;
        }
      }
      function apply(theme, persist) {
        root.dataset.theme = theme;
        if (persist) {
          try {
            localStorage.setItem("qq-console-theme", theme);
          } catch (error) {
          }
        }
        var dark = theme === "dark";
        button.textContent = dark ? "☀" : "☾";
        button.setAttribute("aria-pressed", String(dark));
        button.setAttribute("aria-label", dark ? "切换浅色模式" : "切换深色模式");
        button.title = dark ? "切换到浅色主题" : "切换到深色主题";
      }
      apply(root.dataset.theme === "dark" ? "dark" : "light", false);
      button.addEventListener("click", function() {
        apply(root.dataset.theme === "dark" ? "light" : "dark", true);
      });
      media.addEventListener("change", function(event) {
        if (!stored()) apply(event.matches ? "dark" : "light", false);
      });
    })();
  }

  // console/layers/C/ownership.js
  var ownership_default = {
    "ctx-chat-reply-shape": {
      "page": "setting-l-1",
      "selector": '[data-component-slot="ctx-chat-reply-shape"]'
    },
    "ctx-chat-slang": {
      "page": "slang"
    },
    "ctx-chat-style": {
      "page": "setting-c-0"
    },
    "ctx-chat-topic-drive": {
      "page": "setting-l-2"
    },
    "ctx-context-dynamics": {
      "page": "setting-c-0"
    },
    "ctx-context-lifecycle": {
      "page": "setting-l-0"
    },
    "ctx-context-runtime": {
      "page": "setting-l-0"
    },
    "ctx-context-session": {
      "page": "setting-c-1"
    },
    "ctx-interest-terms": {
      "page": "terms",
      "selector": "#section-terms"
    },
    "ctx-knowledge-quota": {
      "page": "setting-c-2",
      "selector": '[data-component-slot="ctx-knowledge-quota"]'
    },
    "ctx-media-sticker-pick": {
      "page": "setting-c-0"
    },
    "ctx-member-alias": {
      "page": "alias",
      "selector": "#section-alias"
    },
    "ctx-member-card": {
      "page": "setting-c-1"
    },
    "ctx-memory-context": {
      "page": "setting-c-1"
    },
    "ctx-memory-profile-facts": {
      "page": "setting-c-1"
    },
    "ctx-memory-profile-store": {
      "page": "setting-c-2",
      "selector": '[data-component-slot="ctx-memory-profile-store"]'
    },
    "ctx-memory-store": {
      "page": "setting-c-1"
    },
    "ctx-memory-update": {
      "page": "setting-c-1",
      "selector": "#v2PmMaxChars"
    },
    "ctx-role-card": {
      "page": "setting-c-1",
      "selector": "#section-persona"
    },
    "ctx-user-mood": {
      "page": "setting-c-0",
      "selector": '[data-component-slot="ctx-user-mood"]'
    },
    "tool-user-checking": {
      "page": "operations",
      "selector": '[data-component-slot="tool-user-checking"]'
    }
  };

  // console/layers/E/ownership.js
  var ownership_default2 = {
    "env-bridge": {
      "page": "environment-chat",
      "presentation": "internal"
    },
    "exec-browser-manager": {
      "page": "environment-web"
    },
    "exec-image-generation": {
      "page": "images"
    },
    "exec-sandbox": {
      "page": "environment-admin",
      "presentation": "internal"
    },
    "gov-admin-dev-mode": {
      "page": "environment-admin",
      "presentation": "internal"
    }
  };

  // console/layers/V/ownership.js
  var ownership_default3 = {
    "eval-regression": {
      "page": "layer-v"
    },
    "human": {
      "page": "human",
      "selector": "#section-human"
    }
  };

  // console/layers/G/ownership.js
  var ownership_default4 = {
    "gov-policy": {
      "page": "access"
    }
  };

  // console/layers/R/ownership.js
  var ownership_default5 = {
    "integration-registry": {
      "presentation": "internal",
      "page": "registry"
    }
  };

  // console/layers/L/ownership.js
  var ownership_default6 = {
    "life-conversation-wait": { "page": "setting-l-1", "selector": '[data-component-slot="life-conversation-wait"]' },
    "life-campus-watch": {
      "page": "environment-watch"
    },
    "life-daily-worklog": {
      "page": "setting-o-1"
    },
    "life-message-ack": {
      "page": "setting-l-0",
      "selector": "#messageAckComponentRoot"
    },
    "life-proactive-startup-greeting": {
      "page": "setting-l-2",
      "selector": '[data-component-slot="life-proactive-startup-greeting"]'
    },
    "life-proactive-time-bubble": {
      "page": "setting-l-2"
    },
    "life-relay-message": {
      "page": "environment-chat"
    },
    "life-schedule-reminder": {
      "page": "setting-l-2"
    },
    "life-scheduler": {
      "page": "setting-l-0",
      "selector": '[data-component-slot="life-scheduler"]'
    },
    "life-task-session": {
      "page": "setting-l-0",
      "selector": '[data-component-slot="life-task-session"]'
    },
    "life-user-availability": {
      "page": "setting-l-0",
      "selector": "#availabilityRoot"
    },
    "life-wake-reasons": {
      "page": "setting-l-1",
      "selector": '[data-component-slot="life-wake-reasons"]'
    }
  };

  // console/layers/O/ownership.js
  var ownership_default7 = {
    "obs-context-assembly": { "presentation": "internal", "page": "context-visual" },
    "life-token-budget": {
      "page": "usage",
      "selector": "#section-usage"
    },
    "obs-bridge-health": {
      "presentation": "internal",
      "page": "operations"
    },
    "obs-cost-policy": {
      "page": "usage",
      "selector": '[data-component-slot="obs-cost-policy"]'
    },
    "obs-health-monitor": {
      "page": "operations",
      "selector": '[data-component-slot="obs-health-monitor"]'
    },
    "obs-self-review": {
      "page": "setting-o-2",
      "selector": "#v2SelfReviewEnabled"
    }
  };

  // console/layers/S/ownership.js
  var ownership_default8 = { "personal-core": { page: "layer-s" } };

  // console/layers/T/ownership.js
  var ownership_default9 = {
    "tool-deepseek-balance": {
      "page": "v2-t",
      "selector": "#balanceToolControl"
    },
    "tool-bilibili": {
      "page": "v2-t",
      "selector": '[data-component-slot="tool-bilibili"]'
    },
    "tool-codex-chat": {
      "page": "codex-peer",
      "selector": "#section-codex-peer"
    },
    "tool-injection-lab": {
      "page": "injection-lab",
      "selector": '[data-component-slot="tool-injection-lab"]'
    },
    "tool-registry": {
      "presentation": "internal",
      "page": "v2-t"
    }
  };

  // console/shared/components/ownership.js
  var COMPONENT_OWNERS = Object.assign({}, ownership_default, ownership_default2, ownership_default3, ownership_default4, ownership_default5, ownership_default6, ownership_default7, ownership_default8, ownership_default9);
  var DEFAULT_LAYER_PAGES = { "C": "setting-c-1", "T": "v2-t", "E": "environment-admin", "L": "setting-l-0", "O": "overview", "V": "layer-v", "G": "access", "S": "layer-s", "R": "registry" };
  function componentPage(plugin) {
    return COMPONENT_OWNERS[plugin.id]?.page || DEFAULT_LAYER_PAGES[plugin.layer || "R"];
  }

  // console/shared/components/presentation.js
  function isInternalPromptComponent(plugin) {
    if (COMPONENT_OWNERS[plugin.id]?.presentation === "internal") return true;
    const keys = plugin.configKeys ?? Object.keys(plugin.config || {});
    return Array.isArray(plugin.hooks) && plugin.hooks.includes("beforePrompt") && !(plugin.tools || []).length && keys.every((key2) => key2 === "disabledBlocks");
  }

  // console/layers/S/library-manager.js
  function markup(plugin) {
    const info = plugin.state?.mountInspection || {}, disabled = plugin.enabled === false, when = info.validatedAt ? new Date(info.validatedAt).toLocaleString("zh-CN", { hour12: false }) : "暂无记录";
    const title = disabled ? "组件已停用" : !plugin.config?.libraryDir ? "尚未挂载资料包" : info.ok ? "当前挂载：" + info.title : "资料包未就绪";
    return '<div class="core-mount-heading"><b>' + esc(title) + '</b><button class="small" type="button" data-core-recheck' + (disabled ? " disabled" : "") + ">重新校验当前目录</button></div>" + (info.ok ? '<dl class="core-mount-facts"><div><dt>作者</dt><dd>' + esc(info.author) + "</dd></div><div><dt>版本</dt><dd>" + esc(info.version) + "</dd></div><div><dt>主题</dt><dd>" + esc(info.topicCount) + "</dd></div><div><dt>原稿</dt><dd>" + esc(info.sourceCount) + "</dd></div></dl>" : '<p class="meta">' + esc(info.error || "填写目录并保存后开始使用。") + "</p>") + '<p class="meta core-mount-path">已保存目录：<code>' + esc(plugin.config?.libraryDir || "未设置") + '</code></p><p class="meta">最近校验：' + esc(when) + '。未保存的输入不替换当前挂载；文件变化后可重新校验。</p><p class="core-mount-message meta" role="status"></p>';
  }
  function mountPersonalCore({ id, body, p }) {
    const panel = document.createElement("section");
    panel.className = "core-mount-status";
    panel.setAttribute("aria-label", "当前资料包挂载状态");
    const fields = body.querySelector(".component-fields");
    fields.before(panel);
    if (p.enabled === false) {
      const save2 = body.querySelector(".comp-save");
      if (save2) save2.disabled = true;
      panel.insertAdjacentHTML("afterend", '<p class="meta">请先启用此组件，再保存并校验挂载目录。</p>');
    }
    const render2 = (plugin) => {
      panel.innerHTML = markup(plugin);
      panel.querySelector("[data-core-recheck]").addEventListener("click", async (event) => {
        const button = event.currentTarget, msg = panel.querySelector("[role=status]");
        button.disabled = true;
        msg.textContent = "正在校验已保存的目录…";
        try {
          const out = await api("/api/plugins/config", "POST", { id, config: {} });
          if (out.ok !== true) throw Error(out.error || "校验失败");
          const latest = await api("/api/plugins/detail?id=" + encodeURIComponent(id));
          render2(latest.plugin || latest);
          panel.querySelector("[role=status]").textContent = "已重新校验；未更改表单中尚未保存的输入。";
        } catch (error) {
          panel.querySelector(".core-mount-heading b").textContent = "当前校验失败；以下为最近一次挂载记录";
          msg.textContent = error.message;
          msg.classList.add("err");
        } finally {
          button.disabled = false;
        }
      });
    };
    render2(p);
  }

  // console/layers/E/editors/image-generation.js
  async function mountImageGeneration({ id, body, p, el: el3, form }) {
    body.insertAdjacentHTML("beforeend", '<div class="quota-console image-generation-console"><div class="quota-console-head"><div><b>本地 API 密钥</b><div class="meta">密钥不会写入组件配置，状态查询也不会返回密钥内容。</div></div><span class="meta image-secret-state" role="status">正在读取保存状态…</span></div><div class="row" style="gap:8px;margin-top:10px"><input type="password" class="image-secret-input comp-form-text" autocomplete="new-password" aria-label="图片生成 API 密钥" placeholder="输入新密钥" style="flex:1;min-width:180px;max-width:420px"><button type="button" class="small primary image-secret-set" data-save-action>保存本机 API 密钥</button><button type="button" class="small danger image-secret-clear">清除密钥</button></div><div class="meta image-secret-message" aria-live="polite"></div><div class="quota-console-head" style="margin-top:18px"><div><b>今日图片生成用量</b><div class="meta">按上海时间统计请求次数。</div></div><button type="button" class="small image-usage-refresh">刷新用量</button></div><div class="meta image-usage-result" aria-live="polite">正在读取…</div></div>');
    const panel = body.querySelector(".image-generation-console");
    panel.querySelector(".quota-console-head b").textContent = "OpenAI API 密钥";
    const secretInput = panel.querySelector(".image-secret-input");
    secretInput.setAttribute("aria-label", "OpenAI API 密钥");
    secretInput.placeholder = "输入用于图片生成的 OpenAI API 密钥";
    panel.querySelector(".image-secret-set").textContent = "保存本机 OpenAI 密钥";
    const secretState = panel.querySelector(".image-secret-state");
    const secretMessage = panel.querySelector(".image-secret-message");
    const usageResult = panel.querySelector(".image-usage-result");
    const secretCall = async (input) => {
      const response = await api("/api/plugins/call", "POST", { tool: "image_generation_secret", input });
      const result = response?.result || response || {};
      if (result.ok !== true) throw Error("密钥操作失败");
      return result;
    };
    const showSecretState = (configured) => {
      const ready = p.config?.apiBase && p.config?.model;
      secretState.textContent = configured ? ready ? "OpenAI 密钥已保存" : "密钥已保存；请配置 OpenAI 接口地址和模型" : "未配置 OpenAI 密钥";
    };
    const refreshSecret = async () => {
      try {
        showSecretState((await secretCall({ op: "status" })).configured === true);
      } catch {
        secretState.textContent = "状态读取失败";
      }
    };
    const refreshUsage2 = async () => {
      usageResult.textContent = "正在读取…";
      try {
        const response = await api("/api/plugins/call", "POST", { tool: "image_generation_status", input: {} });
        const result = response?.result || response || {};
        if (response?.ok !== true || result.ok !== true) throw Error(result.error || response?.error || "接口返回了无效用量");
        usageResult.textContent = "日期 " + (result.day || "—") + " · 全局已用 " + (result.globalUsed ?? "—") + " / " + (result.globalLimit ?? "—") + " · 会话上限 " + (result.sessionLimit ?? "—") + " · 模式 " + (result.quotaMode || "—");
      } catch (error) {
        usageResult.textContent = "用量读取失败：" + (error?.message || "未知错误");
      }
    };
    panel.querySelector(".image-secret-set").addEventListener("click", async () => {
      const apiKey = secretInput.value.trim();
      if (!apiKey) {
        secretMessage.textContent = "请先输入新密钥。";
        secretInput.focus();
        return;
      }
      secretInput.value = "";
      secretMessage.textContent = "正在保存…";
      try {
        showSecretState((await secretCall({ op: "set", apiKey })).configured === true);
        secretMessage.textContent = "密钥已保存。";
      } catch {
        secretMessage.textContent = "密钥保存失败。";
      }
    });
    panel.querySelector(".image-secret-clear").addEventListener("click", async () => {
      secretInput.value = "";
      secretMessage.textContent = "正在清除…";
      try {
        showSecretState((await secretCall({ op: "clear" })).configured === true);
        secretMessage.textContent = "密钥已清除。";
      } catch {
        secretMessage.textContent = "密钥清除失败。";
      }
    });
    panel.querySelector(".image-usage-refresh").addEventListener("click", refreshUsage2);
    void refreshSecret();
    void refreshUsage2();
  }

  // console/layers/C/editors/knowledge-quota.js
  var validKey = (key2) => /^(group|private):\d+(?:#\d+)?$/.test(key2);
  async function mountKnowledgeQuota({ body, p }) {
    body.insertAdjacentHTML("beforeend", '<div class="quota-console"><div class="quota-console-head"><div><b>今日用量</b><div class="meta">选择全部或某个会话；切换后自动查询，最新计数可点“刷新用量”。</div></div><div class="quota-console-actions"><select class="quota-key member-key" aria-label="配额查询会话"><option value="">全部会话</option><option value="__manual__">手动填写会话…</option></select><input class="quota-manual-key" placeholder="group:群号 或 private:QQ号" aria-label="手动填写配额查询会话 key" data-session-picker="owned" hidden><button class="small quota-query">刷新用量</button><button class="small danger quota-reset">清空今日用量</button></div></div><div class="quota-result" aria-live="polite">正在读取…</div></div>');
    const panel = body.querySelector(".quota-console"), select = panel.querySelector(".quota-key"), manual = panel.querySelector(".quota-manual-key"), result = panel.querySelector(".quota-result");
    let sequence2 = 0;
    const keys = /* @__PURE__ */ new Set();
    const keyValue = () => {
      const key2 = select.value === "__manual__" ? manual.value.trim() : select.value;
      if ((select.value === "__manual__" || key2) && !validKey(key2)) throw Error("请填写 group:群号 或 private:QQ号；按群成员查询可加 #QQ号");
      return key2;
    };
    const fillOptions = () => {
      const previous = select.value;
      select.replaceChildren(new Option("全部会话", ""), ...[...keys].sort().map((key2) => new Option(key2, key2)), new Option("手动填写会话…", "__manual__"));
      select.value = previous;
    };
    const call = async (action, key2) => {
      const response = await api("/api/plugins/call", "POST", { tool: "knowledge_quota", input: { action, ...key2 ? { key: key2 } : {} } });
      if (response.ok === false) throw Error(response.error || "请求失败");
      const data2 = response.result || response;
      if (data2.ok !== true) throw Error(data2.error || "请求失败");
      return data2;
    };
    const query = async () => {
      const request = ++sequence2;
      try {
        const key2 = keyValue();
        result.textContent = "正在读取…";
        const data2 = await call("query", key2);
        if (request !== sequence2 || !panel.isConnected) return;
        const rows = Array.isArray(data2.entries) ? data2.entries : data2.key ? [{ key: data2.key, used: data2.used, remaining: data2.remaining }] : [];
        for (const row of rows) if (validKey(row.key)) keys.add(row.key);
        fillOptions();
        const categories = { professional: "专业求助", casual: "日常交流", uncertain: "待澄清" };
        const records = Array.isArray(data2.recentClassifications) ? data2.recentClassifications : [];
        result.innerHTML = '<div class="quota-summary"><span>日期 <b>' + esc(data2.day || "—") + "</b></span><span>每日上限 <b>" + esc(data2.limit ?? "—") + "</b></span><span>计数方式 <b>" + esc(data2.countBy === "user" ? "按发言人" : "按会话") + "</b></span><span>识别方式 <b>" + ((data2.semanticEnabled ?? p.config?.semanticEnabled) !== false ? "AI语义优先" : "关键词规则") + "</b></span>" + ((data2.exemptOwner ?? p.config?.exemptOwner) !== false ? "<span>管理员提问不计数</span>" : "<span>管理员提问也计数</span>") + (data2.enabled === false ? '<span class="quota-off">功能已停用</span>' : "") + "</div>" + (rows.length ? '<div class="quota-rows">' + rows.map((row) => '<div class="quota-row"><code>' + esc(row.key) + "</code><span>已用 <b>" + esc(row.used) + "</b></span><span>剩余 <b>" + esc(row.remaining) + "</b></span></div>").join("") + "</div>" : '<div class="quota-empty">今天还没有专业问答用量。</div>');
        if (records.length) result.insertAdjacentHTML("beforeend", '<details class="parameter-block"><summary>最近识别记录</summary>' + records.map((item) => '<p class="meta"><code>' + esc(item.bucketKey || item.key) + "</code> · " + esc(categories[item.category] || item.category) + " · " + (item.source === "ai" ? "AI判定" : item.source === "nontext" ? "媒体交回正常会话" : "规则兜底") + "<br>" + esc(item.reason) + "</p>").join("") + "</details>");
      } catch (error) {
        if (request === sequence2) result.textContent = "读取失败：" + error.message;
      }
    };
    select.addEventListener("change", () => {
      ++sequence2;
      manual.hidden = select.value !== "__manual__";
      if (manual.hidden) void query();
      else {
        manual.focus();
        result.textContent = "填写会话 key 后点“刷新用量”。";
      }
    });
    manual.addEventListener("input", () => {
      ++sequence2;
      result.textContent = "填写完成后点“刷新用量”。";
    });
    panel.querySelector(".quota-query").addEventListener("click", query);
    panel.querySelector(".quota-reset").addEventListener("click", async () => {
      let key2;
      try {
        key2 = keyValue();
      } catch (error) {
        result.textContent = error.message;
        return;
      }
      if (!confirm(key2 ? `清空 ${key2} 今天的专业问答用量？` : "清空所有会话今天的专业问答用量？")) return;
      const request = ++sequence2;
      result.textContent = "正在清空…";
      try {
        await call("reset", key2);
        if (request === sequence2) await query();
      } catch (error) {
        if (request === sequence2) result.textContent = "清空失败：" + error.message;
      }
    });
    const sources2 = await Promise.allSettled([api("/api/socialV2/states"), api("/api/sessions")]);
    for (const source of sources2) if (source.status === "fulfilled") {
      for (const item of source.value.conversations || source.value.sessions || []) if (validKey(item.key)) keys.add(item.key);
    }
    fillOptions();
    await query();
  }

  // console/layers/C/editors/person-profile.js
  async function mountPersonProfile({ id, body, p, el: el3, form }) {
    body.insertAdjacentHTML("beforeend", '<section class="member-card-preview"><div class="quota-console-head"><div><b>按 QQ 管理人物档案</b><div class="meta">此 QQ 档案：按 QQ 号保存，同一人的资料可用于其相关会话。私聊自动注入本人档案；群聊不自动注入成员资料。可选择已有档案，也可输入尚未成为好友的 QQ 号。</div></div></div><div class="quota-console-actions"><select class="member-key" aria-label="选择 QQ 档案"><option value="">正在读取档案…</option></select><input class="profile-qq" inputmode="numeric" placeholder="或输入 QQ 号" aria-label="手动输入 QQ 号"><button class="small member-preview">读取档案</button></div><div class="profile-fields"></div><div class="quota-console-actions"><input class="profile-new-key" placeholder="新增 JSON 字段名" aria-label="新增档案字段名"><button class="small profile-add-key">增加字段</button><button class="small primary profile-save" data-save-action>保存此 QQ 档案</button><button class="small danger profile-delete-person">删除该 QQ 档案</button><span class="profile-status meta" aria-live="polite">固定字段可留空；新增字段会保留。</span></div></section>');
    const panel = body.querySelector(".member-card-preview"), select = panel.querySelector(".member-key"), qqInput = panel.querySelector(".profile-qq"), fieldsBox = panel.querySelector(".profile-fields"), status = panel.querySelector(".profile-status");
    const labels2 = { routine_food: "作息与饮食", hobbies: "兴趣与爱好", relationships: "人际关系", catchphrases: "口头禅" };
    let current = {}, loadedId = "", originalKeys = /* @__PURE__ */ new Set(), readVersion = 0, reading = false, writing2 = false;
    const chosenId = () => (qqInput.value.trim() || select.value.trim()).replace(/^private:/, "");
    const syncEditor = () => {
      const ready = !!loadedId && loadedId === chosenId() && !reading && !writing2;
      fieldsBox.querySelectorAll("textarea,button").forEach((el4) => {
        el4.disabled = !ready;
      });
      panel.querySelectorAll(".profile-save,.profile-add-key,.profile-new-key,.profile-delete-person").forEach((el4) => {
        el4.disabled = !ready;
      });
    };
    const render2 = (profile) => {
      current = profile && typeof profile === "object" ? profile : {};
      const keys = [.../* @__PURE__ */ new Set([...Object.keys(labels2), ...Object.keys(current)])];
      fieldsBox.innerHTML = keys.map((key2) => '<div class="profile-json-field"><label><span>' + esc(labels2[key2] || key2) + (labels2[key2] ? "" : " · 扩展字段") + '</span><textarea data-profile-key="' + esc(key2) + '" rows="3" placeholder="填写一段长句或短句">' + esc(current[key2] || "") + '</textarea></label><button type="button" class="small danger profile-delete-key" data-remove-key="' + esc(key2) + '">' + (labels2[key2] ? "清空" : "删除字段") + "</button></div>").join("");
      fieldsBox.querySelectorAll("textarea[data-profile-key]").forEach((el4) => el4.addEventListener("input", () => {
        current[el4.dataset.profileKey] = el4.value;
      }));
      fieldsBox.querySelectorAll("[data-remove-key]").forEach((btn) => btn.addEventListener("click", () => {
        const key2 = btn.dataset.removeKey;
        if (labels2[key2]) current[key2] = "";
        else delete current[key2];
        render2(current);
      }));
      syncEditor();
    };
    const readProfile = async () => {
      const id2 = chosenId();
      if (!/^\d{1,20}$/.test(id2)) {
        status.textContent = "请输入有效 QQ 号。";
        return;
      }
      const version = ++readVersion;
      reading = true;
      writing2 = false;
      loadedId = "";
      originalKeys = /* @__PURE__ */ new Set();
      render2({});
      status.textContent = "正在读取…";
      try {
        const r = await api("/api/plugins/call", "POST", { tool: "profile_snapshot", input: { userId: id2 } });
        const d = r?.result || r || {};
        if (version !== readVersion || chosenId() !== id2) return;
        if (r?.ok !== true || d.ok === false) throw Error(d.error || r?.error || "读取失败");
        qqInput.value = id2;
        loadedId = id2;
        originalKeys = new Set(Object.keys(d.profiles?.[id2] || {}));
        render2(d.profiles?.[id2] || {});
        status.textContent = "档案已读取；空档案也可直接填写创建。";
      } catch (e) {
        if (version === readVersion && chosenId() === id2) status.textContent = "读取失败：" + e.message;
      } finally {
        if (version === readVersion) {
          reading = false;
          syncEditor();
        }
      }
    };
    const loadProfiles = async () => {
      try {
        const r = await api("/api/plugins/call", "POST", { tool: "profile_snapshot", input: {} });
        const d = r?.result || r || {};
        if (r?.ok !== true && d.ok !== true) throw Error(d.error || r?.error || "读取失败");
        const ids = new Set(Object.keys(d.profiles || {}));
        const options = [...ids].sort().map((id2) => {
          const name = d.people?.[id2]?.name;
          return '<option value="' + esc(id2) + '">' + esc(name ? name + " · " : "") + esc(id2) + "</option>";
        });
        select.innerHTML = '<option value="">选择已有档案</option>' + options.join("");
      } catch (e) {
        select.innerHTML = '<option value="">档案列表读取失败</option>';
        status.textContent = "档案列表读取失败：" + e.message;
      }
    };
    select.addEventListener("change", () => {
      if (select.value) {
        qqInput.value = select.value;
        void readProfile();
      }
    });
    qqInput.addEventListener("input", () => {
      const id2 = chosenId();
      if (id2 !== loadedId) {
        readVersion++;
        reading = false;
        writing2 = false;
        originalKeys = /* @__PURE__ */ new Set();
        loadedId = "";
        render2({});
        status.textContent = "请先读取这个 QQ 的档案，再填写或创建。";
      }
    });
    panel.querySelector(".member-preview").addEventListener("click", () => void readProfile());
    panel.querySelector(".profile-delete-person").addEventListener("click", async () => {
      const id2 = chosenId();
      if (!/^\d{1,20}$/.test(id2)) {
        status.textContent = "请输入有效 QQ 号。";
        return;
      }
      if (reading || writing2 || loadedId !== id2) {
        status.textContent = "请先读取目标档案。";
        return;
      }
      if (!confirm("确定删除 QQ " + id2 + " 的整份人物档案？此操作会移除所有字段和档案元数据。")) return;
      const version = readVersion;
      writing2 = true;
      syncEditor();
      status.textContent = "正在删除…";
      try {
        const r = await api("/api/plugins/call", "POST", { tool: "profile_delete", input: { userId: id2, key: "private:" + id2, adminCrossSession: true } });
        const d = r?.result || r || {};
        if (version !== readVersion || chosenId() !== id2) return;
        if (r?.ok !== true || d.ok === false) throw Error(d.error || r?.error || "删除失败");
        originalKeys = /* @__PURE__ */ new Set();
        loadedId = "";
        qqInput.value = "";
        select.value = "";
        render2({});
        await loadProfiles();
        status.textContent = d.deleted ? "该 QQ 档案已删除。" : "该 QQ 档案原本不存在。";
      } catch (e) {
        if (version === readVersion) status.textContent = "删除失败：" + e.message;
      } finally {
        if (version === readVersion) {
          writing2 = false;
          syncEditor();
        }
      }
    });
    render2({});
    panel.querySelector(".profile-add-key").addEventListener("click", () => {
      const input = panel.querySelector(".profile-new-key"), key2 = input.value.trim();
      if (!/^[a-z][a-z0-9_]{0,63}$/i.test(key2)) {
        status.textContent = "字段名需以字母开头，只能包含字母、数字和下划线。";
        return;
      }
      if (key2 in current) {
        status.textContent = "该字段已经存在。";
        return;
      }
      current[key2] = "";
      input.value = "";
      render2(current);
      status.textContent = "已添加字段，填写后保存。";
    });
    panel.querySelector(".profile-save").addEventListener("click", async () => {
      const id2 = chosenId();
      if (!/^\d{1,20}$/.test(id2)) {
        status.textContent = "请输入有效 QQ 号。";
        return;
      }
      if (reading || writing2 || loadedId !== id2) {
        status.textContent = "请先读取目标档案。";
        return;
      }
      const version = readVersion;
      writing2 = true;
      syncEditor();
      const patch = {};
      fieldsBox.querySelectorAll("textarea[data-profile-key]").forEach((el4) => {
        patch[el4.dataset.profileKey] = el4.value;
      });
      status.textContent = "正在保存…";
      try {
        const deleteKeys = [...originalKeys].filter((key2) => !labels2[key2] && !Object.prototype.hasOwnProperty.call(patch, key2));
        const r = await api("/api/plugins/call", "POST", { tool: "profile_update", input: { userId: id2, key: "private:" + id2, adminCrossSession: true, profile: patch, deleteKeys } });
        const d = r?.result || r || {};
        if (version !== readVersion || chosenId() !== id2) return;
        if (r?.ok !== true || d.ok === false) throw Error(d.error || r?.error || "保存失败");
        render2(d.profile || patch);
        originalKeys = new Set(Object.keys(d.profile || patch));
        qqInput.value = id2;
        loadedId = id2;
        await loadProfiles();
        if (version === readVersion && chosenId() === id2) {
          select.value = id2;
          status.textContent = "已保存；未改字段均保留。";
        }
      } catch (e) {
        if (version === readVersion) status.textContent = "保存失败：" + e.message;
      } finally {
        if (version === readVersion) {
          writing2 = false;
          syncEditor();
        }
      }
    });
    void loadProfiles();
  }

  // console/layers/O/editors/worklog.js
  async function mountWorklog({ id, body, p, el: el3, form }) {
    body.insertAdjacentHTML("beforeend", '<section class="worklog-console" aria-label="运维日报与日报归档"><div class="worklog-console-head"><div><h3>日报归档与预览</h3><p class="meta">每天保留最新版；手动生成会立即私聊管理员。</p><div class="worklog-send-setting"></div></div><div class="row"><button class="small worklog-generate-send" type="button">立即生成与发送</button><button class="small worklog-refresh" type="button">刷新列表</button></div></div><details class="worklog-sources"><summary class="worklog-sources-title">日报扫描来源</summary><ul class="worklog-sources-list"><li class="worklog-source"><code>state/memory/tasks-*.md</code><span>提取当天的中期任务进度记录。</span></li><li class="worklog-source"><code>state/tasks.json</code><span>汇总当天创建或更新的独立任务及状态。</span></li><li class="worklog-source"><code>state/tool-calls.jsonl</code><span>统计当天的工具调用次数与失败次数。</span></li><li class="worklog-source"><code>state/tool-calls.jsonl.1</code><span>读取轮转的工具调用历史，补齐当天统计。</span></li><li class="worklog-source"><code>state/token-usage.jsonl</code><span>统计当天模型调用步数与输入、输出 token。</span></li><li class="worklog-source"><code>state/token-usage.jsonl.1</code><span>读取轮转的 token 历史，补齐当天统计。</span></li><li class="worklog-source"><code>state/plugins/obs-self-review.json</code><span>统计反馈队列当天的状态变更；不复制反馈正文。</span></li><li class="worklog-source"><code>state/memory/_optimization.md</code><span>提取当天的自我更新发现与统一修复摘要。</span></li></ul></details><div class="worklog-status" aria-live="polite"></div><div class="meta worklog-action-message" aria-live="polite"></div><div class="worklog-layout"><nav class="worklog-list" aria-label="日报日期列表"><div class="worklog-empty">读取日报列表中…</div></nav><article class="worklog-preview"><div class="worklog-preview-head"><b>内容预览</b><span class="meta worklog-preview-meta">选择一份日报</span></div><pre class="worklog-preview-text">日报内容会显示在这里。</pre></article></div></section>');
    const panel = body.querySelector(".worklog-console");
    const sendOption = body.querySelector('[data-config-key="sendToOwner"]');
    if (sendOption) panel.querySelector(".worklog-send-setting").append(sendOption);
    const list = panel.querySelector(".worklog-list");
    const preview = panel.querySelector(".worklog-preview-text");
    const previewMeta = panel.querySelector(".worklog-preview-meta");
    const status = panel.querySelector(".worklog-status");
    const actionMessage = panel.querySelector(".worklog-action-message");
    const read = async (input = {}) => {
      const response = await api("/api/plugins/call", "POST", { tool: "worklog_history", input });
      const result = response?.result || response || {};
      if (result.ok !== true) throw Error(result.error || "读取失败");
      return result;
    };
    const loadReport = async (date) => {
      panel.querySelectorAll(".worklog-date").forEach((button) => button.classList.toggle("active", button.dataset.date === date));
      preview.textContent = "正在读取日报…";
      try {
        const report = await read({ date });
        preview.textContent = report.text || "（日报内容为空）";
        previewMeta.textContent = report.date + " · " + report.chars + " 字 · 更新于 " + new Date(report.updatedAt).toLocaleString();
      } catch (error) {
        preview.textContent = "读取失败：" + error.message;
        previewMeta.textContent = date;
      }
    };
    const refresh3 = async () => {
      const config = p.config || {};
      const generated = p.state?.lastGeneratedDate || "尚无生成记录";
      const hh = String(Number(config.hour ?? 23)).padStart(2, "0");
      const mm = String(Number(config.minute ?? 0)).padStart(2, "0");
      status.innerHTML = '<span class="worklog-chip">每日生成 · ' + hh + ":" + mm + '</span><span class="worklog-chip">最近生成 · ' + esc(generated) + "</span>";
      list.innerHTML = '<div class="worklog-empty">正在读取…</div>';
      preview.textContent = "选择一份日报查看内容。";
      previewMeta.textContent = "只读预览";
      try {
        const history2 = await read({ limit: 30 });
        const reports = Array.isArray(history2.reports) ? history2.reports : [];
        if (!reports.length) {
          list.innerHTML = '<div class="worklog-empty">还没有生成日报。到达设定时间且当天有可汇总数据后会自动生成。</div>';
          return;
        }
        list.innerHTML = reports.map((report) => '<button class="worklog-date" type="button" data-date="' + esc(report.date) + '"><span>' + esc(report.date) + "<small>" + new Date(report.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) + " 更新</small></span><small>" + esc(report.chars) + " 字</small></button>").join("");
        list.querySelectorAll(".worklog-date").forEach((button) => button.addEventListener("click", () => loadReport(button.dataset.date)));
        await loadReport(reports[0].date);
      } catch (error) {
        list.innerHTML = '<div class="worklog-empty">读取失败：' + esc(error.message) + "</div>";
      }
    };
    panel.querySelector(".worklog-generate-send").addEventListener("click", async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      actionMessage.textContent = "正在生成并发送今天的日报…";
      try {
        const result = await api("/api/socialV2/worklog/generate-send", "POST", {});
        await refresh3();
        actionMessage.textContent = result.ok ? `已生成并发送 ${result.dateKey} 的日报摘要；当天归档已更新为最新版（${result.chars} 字）。` : result.generated ? `日报已更新并覆盖当天归档，但发送失败：${result.error || "未获发送确认"}` : result.error || "日报生成失败";
      } catch (error) {
        actionMessage.textContent = "生成或发送失败：" + (error.message || error);
      } finally {
        button.disabled = false;
      }
    });
    panel.querySelector(".worklog-refresh").addEventListener("click", refresh3);
    void refresh3();
  }

  // console/layers/C/parameter-examples.js
  var parameter_examples_default = {
    "ctx-chat-topic-drive": {
      "privateFollowupEnabled": "开启后，群聊里值得继续的话题可以转到已有私聊关系中跟进；不会自动给陌生人发私聊。",
      "minIntervalMinutes": "设为60：两次私聊跟进至少间隔1小时；会话局部间隔更长时按更长的执行。",
      "dailyLimit": "设为2：同一人一天最多收到2次这类私聊跟进；局部上限更低时按更低的执行。",
      "sessionLimits": "给某个会话设更长间隔或更低上限，只收紧该会话，不放宽全局限制。",
      "followUpCooldownMinutes": "设为30：刚跟进过同一话题时，接下来30分钟阻止对同一话题追加可选追问。",
      "newTopicCooldownMinutes": "设为60：刚开新话题后，1小时内优先延续现有话题，而非不断另起话头。",
      "newTopicMaxPerHour": "设为2：一小时内最多成功发起2个新话题；普通聊天和主动聊天共用额度。"
    },
    "ctx-interest-terms": {
      "autoExtract": "开启后，达到消息门槛时自动提取兴趣候选；候选仍需审核确认后入库。",
      "autoResearch": "开启后，重复出现的候选可触发研究；关闭不会删除已确认的知识。",
      "minMessages": "设为12：同群累计到12条可用消息才尝试一批提取，不会每条消息都调用模型。",
      "cooldownMs": "设为1800000：同群两次自动提取至少隔30分钟。",
      "maxCallsPerHour": "设为4：自动候选提取每小时最多调用4次。",
      "injectMax": "设为3：一轮最多把3条相关的已确认词条提供给模型，不代表必须输出3条。"
    },
    "ctx-knowledge-quota": {
      "enabled": "开启后，在模型派发前检查专业问答额度；普通闲聊不应因此扣额。",
      "dailyLimit": "设为3：当天前三个符合识别规则的专业请求可进入模型，超出后用固定短句带过。",
      "resetHour": "设为22：每日22点开始新的专业问答计数周期。",
      "exemptOwner": "开启后管理员不受本组件的专业问答次数限制；总花费上限仍独立生效。",
      "countBy": "选user按人计数；选session按会话范围计数，不等于全站共用一个次数。",
      "deflectText": "填“今天先到这里，明天再聊这个吧”：超额时直接发这句，不再调用模型生成拒答。",
      "keywords": "添加“量子力学”：将其作为领域识别线索，还需符合专业请求规则，不能只凭闲聊提到词语就扣额。"
    },
    "ctx-media-sticker-pick": {
      "limit": "设为8：每轮最多给模型8个表情候选，由模型按当前语境选择，不是连续发8张。"
    },
    "ctx-member-alias": {
      "autoExtract": "开启后，从聊天中收集绰号候选；不会把猜测直接当作已确认姓名。",
      "autoSemantic": "开启后，允许语义分析疑似绰号；关闭后不自动调用这条分析路径。",
      "minMessages": "设为12：累计12条群消息后才尝试分析，减少零散消息重复调用。",
      "cooldownMs": "设为1800000：同群自动分析至少间隔30分钟。",
      "maxCallsPerHour": "设为4：每小时最多触发4次自动绰号分析。"
    },
    "ctx-memory-context": {
      "maxChars": "设为4000：本轮轻量记忆按4000字符预算组织；不是删除原始记忆。",
      "affairsMaxChars": "设为2000：本轮事务上下文最多占约2000字符，事务档案本身不会因此被截断。"
    },
    "ctx-memory-profile-facts": {
      "cooldownMs": "设为60000：同一会话的自动事实提取至少间隔1分钟。",
      "maxSnippets": "设为8：最多保留8条提取片段进入该组件的处理范围。",
      "maxCharsPerSnippet": "设为300：单条事实片段最多保留300字符，防止长文本挤占上下文。"
    },
    "ctx-memory-store": {
      "diaryArchive": "开启后保留日记归档；日记归档不等于每轮都注入聊天提示词。"
    },
    "ctx-memory-update": {
      "maxChars": "设为6000：给记忆维护回合组织材料时使用6000字符预算，不代表清空更长的持久记录。"
    }
  };

  // console/layers/E/parameter-examples.js
  var parameter_examples_default2 = {
    "exec-browser-manager": {
      "headlessFor": "保留 monitor|automate|scrape-readonly：这些用途不显示窗口；用 | 分隔多个用途，登录时仍可切换到可见窗口。",
      "visibleFor": "保留 login|auth|captcha：登录和验证码等用途显示窗口，让你完成验证；多个用途用 | 分隔。",
      "allowUrls": "填https://example.invalid：把此地址纳入允许范围；不要把账号或密钥写进网址。",
      "blockUrls": "加入某个地址后，浏览器访问规则会检查该阻止项；允许项不应被当作绕过阻止项的凭据。",
      "rules": "写“提交表单前先确认”：作为浏览器操作提示提供给模型，不替代服务端权限检查。"
    },
    "exec-image-generation": {
      "apiBase": "填https://images.example.invalid/v1：请求发往你自己的兼容图片接口，不会改变聊天模型地址。",
      "proxyUrl": "填http://127.0.0.1:7897：仅图片供应商请求经这个代理；留空使用现有代理环境。",
      "model": "填供应商提供的模型ID：生图请求使用该ID，不会切换平时聊天模型。",
      "size": "填1024x1024：请求正方形图片，实际尺寸支持范围由所选服务决定。",
      "quality": "填服务支持的画质档位：用于生图请求；不支持的值会由服务返回错误。",
      "quotaMode": "选both：全局额度和每会话额度都必须有余量，满足一个不能绕过另一个。",
      "dailyGlobalLimit": "设为20：所选额度模式启用全局限制时，所有会话合计受每日20次约束。",
      "dailySessionLimit": "设为3：启用会话限制时，同一会话每日最多使用3次额度。",
      "maxPromptChars": "设为2000：过长的生图描述不能无限制传给供应商。",
      "maxReferenceImages": "设为2：一次生图最多附带2张参考图片。",
      "maxReferenceBytes": "设为5242880：单张参考文件按5MiB的输入大小门槛检查。",
      "maxOutputBytes": "设为10485760：生成图片下载超过10MiB时会被拒绝继续作为正常结果处理。",
      "timeoutSeconds": "设为120：单次请求最多等待约2分钟，不会无限挂起。",
      "cooldownSeconds": "设为60：同一会话两次生图至少间隔1分钟。",
      "allowAutomatic": "关闭后，模型不能仅因随口聊天就自动发起生图；仍需符合明确请求等调用条件。",
      "allowedSessions": "只填private:10001：仅该会话在此允许列表范围内；其他权限与额度仍需满足。",
      "assetRetentionDays": "设为7：本地生图资产按7天保留策略清理，不等于删除已经发到QQ的消息。"
    },
    "life-campus-watch": {
      "fastCheckMinutes": "设为1：每分钟检查任务是否到期，不代表每分钟导航全部网页。",
      "fullCheckMinutes": "设为5：普通网页完整抓取约每5分钟进行一次。",
      "webWatchEnabled": "关闭后停止普通网址检查，保留已填写网址以便恢复。",
      "watchUrls": "填“公告 | https://example.invalid/notices”：监控该页变化；取消该行勾选则暂停这一个网址。",
      "scriptCollabEnabled": "开启后可以展示协同脚本心跳；只填路径不等于自动执行脚本。",
      "scriptPaths": "填scripts/example.mjs：只有脚本按约定回传心跳后才显示运行状态，路径本身不是执行授权。",
      "bbCourses": "登记课程和页面标识后，按页面读取规则检查内容；删除条目会停止该页面的监控配置。",
      "enabledScripts": "填已支持的脚本标识才会参与调度，不会将任意字符串作为系统命令执行。",
      "lecturesEnabled": "开启后，讲座任务按独立周期检查；普通网页开关和周期不代替它。",
      "lecturesLocation": "填“高新”：按该地点关键词筛选符合要求的讲座。",
      "lecturesIntervalMinutes": "设为10：讲座实际查询周期约10分钟，不跟随每分钟到期轮询重复全查。",
      "lecturesPortalUrl": "填你的讲座门户地址：登录与查询在这一服务对应的会话内进行。",
      "lecturesApi": "配置该服务的查询入口后供讲座流程使用，不会把普通网页监控当成抢课接口。"
    }
  };

  // console/layers/L/parameter-examples.js
  var parameter_examples_default3 = {
    "life-daily-worklog": {
      "hour": "小时23、分钟0：到23:00生成日报；启用发送时再按投递规则发出。",
      "minute": "小时23、分钟30：触发时间是23:30，而不是每30分钟一次。",
      "sendToOwner": "开启后可向管理员发送短报；关闭后仍可保留和查看本地完整归档。",
      "maxChars": "设为2000：约束面向聊天的摘要预算，完整归档不会因此只剩2000字。"
    },
    "life-message-ack": {
      "privateWait": "设为8秒：私聊最新来信后仍未正式回复，才触发等待提示；新来信会重置本轮。",
      "privateApology": "设为30秒：私聊思考继续超过延迟后可发这组补话，正式回复实际发送前取消计时。",
      "groupWait": "开启后，群内符合回应条件的未答消息使用这组等待话术；不是对所有群消息都提示。",
      "groupApology": "填写多条话术：群内超时补话从本组选择，不与静默后预算机械回复共用词表。"
    },
    "life-proactive-startup-greeting": {
      "hint": "填“先看看对方现在是否方便”：开机问候生成时参考，不会原样当固定群发消息。",
      "cooldownMinutes": "设为360：同一会话6小时内再次开机时，不重复触发这类起床问候。"
    },
    "life-proactive-time-bubble": {
      "maxBubblesPerDay": "设为4：同一会话一天最多配置4个时间冒泡时段；空时段列表不发送。"
    },
    "life-relay-message": {
      "minIntervalMin": "设为10：同一传话目标的自动转达至少间隔10分钟，避免重复刷屏。"
    },
    "life-schedule-reminder": {
      "enabled": "关闭后停止本组件的日程提醒；不会把原有日程记录直接删掉。",
      "advanceMinutes": "设为10：允许从日程开始前10分钟进入提醒阶段。",
      "intervalMinutes": "设为15：未完成日程可按15分钟间隔重复提醒，直到明确完成或不再满足时效。",
      "lateMinutes": "设为60：过期后1小时作为逾期处理边界，不把很久以前的提醒无限重放。",
      "horizonDays": "设为7：排程查询优先覆盖未来7天。",
      "maxItems": "设为100：日程列表的管理容量受100项门槛约束。",
      "maxPromptItems": "设为5：一次提醒回合最多给模型5项，避免把整个日历塞进提示词。"
    },
    "life-scheduler": {
      "maxJobs": "1000 表示所有会话合计最多登记1000项。满后拒绝新增，已有任务保留。"
    },
    "life-task-session": {
      "maxConcurrentTasks": "设为3时，执行中和等待补充信息的任务合计最多3个。",
      "maxTasks": "设为20时，新建任务优先清理最旧的已结束记录，进行中的任务保留。"
    },
    "life-token-budget": {
      "sessions": "为某个private或group会话设置单独花费阈值，只影响该会话预算。",
      "ownerBudgetEnabled": "开启后管理员会话也检查所设置的预算，不默认豁免。",
      "globalHardLimitYuan": "设为2.5：本周期全局计费达到2.5元后，模型调用按硬上限阻断；不等于删除通知排程。",
      "recoveryWindows": "私聊、群聊、管理员都设为5：恢复后只处理对应最近5条窗口，不把全部历史重新交给模型。",
      "mechanicalPrivateReplies": "每行写一条私聊超额短句，硬上限后从这里选择，不调用LLM生成。",
      "mechanicalGroupReplies": "每行写一条群聊超额短句；与模型思考期间四组补话分开维护。"
    }
  };

  // console/layers/O/parameter-examples.js
  var parameter_examples_default4 = {
    "obs-cost-policy": {
      "defaultModel": "选deepseek-flash：普通任务默认使用Flash，不影响供应商密钥。",
      "defaultEffort": "选low：普通任务以low思考档位请求；不是改变回复速度的固定秒数。",
      "upgradeModel": "选deepseek-v4-pro：满足升级条件时才使用该模型。",
      "upgradeEffort": "选high：升级任务以high档位请求，不改普通任务的默认档位。",
      "autoUpgradeComplexTasks": "关闭后不凭复杂度自动升级；明确指定升级的请求仍按允许范围处理。"
    },
    "obs-health-monitor": {
      "staleAlertCooldownMs": "设为1800000：同一轮心跳异常告警至少间隔30分钟，不会每次巡检都刷屏。"
    }
  };

  // console/layers/T/parameter-examples.js
  var parameter_examples_default5 = {
    "tool-bilibili": {
      "ffmpegPath": "填写FFmpeg可执行文件路径后，抽帧使用这一程序；留空按现有发现流程寻找。",
      "ffmpegUseSystemProxy": "开启后，FFmpeg相关网络请求允许使用系统代理配置；不修改系统代理本身。",
      "defaultFrameCount": "设为9：未指定帧数时默认抽取9帧供分析，不直接生成9条QQ消息。",
      "maxVideoSeconds": "设为3600：超过1小时的视频不能按整段无界处理。",
      "maxSegmentSeconds": "设为600：一次视频片段最多10分钟。",
      "cacheDir": "填bilibili：抽帧缓存归入本地对应缓存目录，不是远程上传目录。",
      "maxConcurrentJobs": "设为2：最多同时执行2个视频处理任务。",
      "maxFrameWidth": "设为720：抽取图像按不超过720像素宽度处理，减少视觉输入体积。",
      "cacheTtlMs": "设为300000：缓存按5分钟有效期复用，过期后按流程重新获取。",
      "requestTimeoutMs": "设为12000：视频信息网络请求最多等待约12秒。",
      "ffmpegTimeoutMs": "设为180000：一次FFmpeg任务最多等待约3分钟。"
    },
    "tool-injection-lab": {
      "detect": "开启后记录实验发现的注入迹象，不代表对每条消息都额外调用模型。",
      "alertWindowMs": "设为60000：最近一次命中后，后续聊天回合会在1分钟内继续收到上下文警报；到期后停止沿用旧警报，新的命中会重新计时。此参数不控制 QQ 消息发送频率。",
      "sparPerHour": "设为2：对线实验一小时最多触发2次。"
    },
    "tool-registry": {
      "injectPrompt": "关闭后不额外注入组件索引提示，不会删除实际注册的工具。"
    },
    "tool-user-checking": {
      "noteFileName": "填notes.md：桌面便签相关能力使用该文件名，不修改QQ会话名称。",
      "maxNoteChars": "设为2000：桌面便签最多写入2000字符，避免整段长对话塞进便签。"
    }
  };

  // console/layers/S/parameter-examples.js
  var parameter_examples_default6 = {};

  // console/layers/V/parameter-examples.js
  var parameter_examples_default7 = {
    "eval-regression": {
      "maxCases": "设为50：回归样例最多保留50条，防止失败记录无限增长。"
    }
  };

  // console/layers/G/parameter-examples.js
  var parameter_examples_default8 = {
    "gov-policy": {
      "rules": "写“修改系统配置前先说明影响”：作为治理指引注入；代码权限检查仍独立生效。"
    }
  };

  // console/shared/components/examples.js
  var PARAMETER_EXAMPLES = Object.assign({}, parameter_examples_default, parameter_examples_default2, parameter_examples_default3, parameter_examples_default4, parameter_examples_default5, parameter_examples_default6, parameter_examples_default7, parameter_examples_default8);

  // console/layers/C/components/ctx-memory-store.js
  var ctx_memory_store_default = {
    "title": "日记归档",
    "fields": [
      {
        "key": "diaryArchive",
        "label": "保留日记归档",
        "type": "boolean"
      }
    ]
  };

  // console/layers/L/components/life-scheduler.js
  var life_scheduler_default = {
    saveLabel: "保存定时任务上限",
    "title": "后台定时任务",
    "fields": [
      {
        "key": "maxJobs",
        "label": "定时任务总上限（项）",
        "type": "number"
      }
    ]
  };

  // console/layers/T/components/tool-bilibili.js
  var tool_bilibili_default = {
    saveLabel: "保存 bilibili 视频处理设置",
    "title": "bilibili 视频处理工具",
    "fields": [
      {
        "key": "ffmpegPath",
        "label": "FFmpeg 程序路径",
        "type": "text",
        "group": "程序与网络"
      },
      {
        "key": "ffmpegUseSystemProxy",
        "label": "FFmpeg 使用系统代理",
        "type": "boolean"
      },
      {
        "key": "maxVideoSeconds",
        "label": "视频总时长上限（秒）",
        "type": "number",
        "group": "任务边界"
      },
      {
        "key": "maxSegmentSeconds",
        "label": "单次片段上限（秒）",
        "type": "number"
      },
      {
        "key": "maxConcurrentJobs",
        "label": "同时处理任务数",
        "type": "number"
      },
      {
        "key": "defaultFrameCount",
        "label": "默认抽帧数量（张）",
        "type": "number",
        "group": "帧图与缓存"
      },
      {
        "key": "maxFrameWidth",
        "label": "帧图最大宽度（像素）",
        "type": "number"
      },
      {
        "key": "cacheDir",
        "label": "缓存子目录",
        "type": "text"
      },
      {
        "key": "cacheTtlMs",
        "label": "缓存有效期（毫秒）",
        "type": "number"
      },
      {
        "key": "requestTimeoutMs",
        "label": "信息请求超时（毫秒）",
        "type": "number",
        "group": "超时"
      },
      {
        "key": "ffmpegTimeoutMs",
        "label": "抽帧任务超时（毫秒）",
        "type": "number"
      }
    ]
  };

  // console/layers/C/components/tool-user-checking.js
  var tool_user_checking_default = { saveLabel: "保存桌面便签设置", title: "桌面便签", fields: [
    { key: "noteFileName", label: "便签文件名", help: "固定写入桌面；这里只能设置文件名，不能选择其他目录。便签始终自动添加时间戳。", type: "text" },
    { key: "maxNoteChars", label: "单条便签最大字数", help: "限制每次追加的便签长度。", type: "number", min: 20, max: 2e3 }
  ] };

  // console/layers/C/components/ctx-memory-profile-store.js
  var ctx_memory_profile_store_default = { title: "按 QQ 管理 JSON 人物档案", fields: [] };

  // console/layers/C/components/ctx-knowledge-quota.js
  var ctx_knowledge_quota_default = { saveLabel: "保存专业问答配额", title: "专业问答配额规则", fields: [
    { key: "enabled", label: "启用配额规则", help: "关闭后专业问题不再计数，也不会因达到上限而被拦截；配额查询工具仍可查看已有记录。", type: "boolean" },
    { key: "semanticEnabled", label: "AI语义识别专业求助", help: "按实际意图区分专业求助、日常交流和待澄清；不要求命中关键词。关闭后只用规则识别。", example: "开启后，“矩阵的秩是什么”也可识别；“写代码好累”可作为倾诉处理。", type: "boolean" },
    { key: "classificationTimeoutSeconds", label: "AI识别最长等待（秒）", help: "包括后台工作队列等待；超时、模型不可用或结果无效时使用兜底关键词规则，不阻塞后续聊天。", example: "设为12：最多等待12秒，迟到结果不会补扣用量。", type: "number", min: 1, max: 30 },
    { key: "dailyLimit", label: "每个计数对象每日可回答次数", help: "达到此次数后，后续命中的专业问题会改为使用下方的自然带过提示。设为 0 表示不允许额度内回答。", type: "number", min: 0, max: 1e3 },
    { key: "resetHour", label: "每日重置时间（小时）", help: "按桥接所在时区重置每日计数。填 0 表示午夜重置；填 4 表示每天凌晨 4 点重置。", type: "number", min: 0, max: 23 },
    { key: "exemptOwner", label: "主人不受配额限制", help: "开启后，主人发起的专业问题不计入配额，也不会被配额拦截。", type: "boolean" },
    { key: "countBy", label: "配额计数方式", help: "session：同一群或私聊共用额度；user：群内每位发言者各自计算，私聊仍按会话计算。", type: "select", options: ["session", "user"] },
    { key: "deflectText", label: "超额时实际发送的短句", help: "超额后直接发送这句话，停止本条请求的模型调度。最多 120 字；空白使用默认短句。", type: "textarea" },
    { key: "keywords", label: "规则兜底关键词（逗号分隔）", help: "AI识别关闭或失败时，才结合明确提问/任务表达判定；AI正常工作时无需命中这些词。匹配不区分英文大小写。", type: "comma-list" }
  ] };

  // console/layers/L/components/ctx-chat-reply-shape.js
  var ctx_chat_reply_shape_default = { saveLabel: "保存发送数量与间隔", title: "唯一发送计划", fields: [
    { key: "maxMessagesNormal", label: "普通聊天每轮上限（条）", type: "number", group: "单轮数量", help: "只表示上限，不要求发满。" },
    { key: "maxMessagesCasual", label: "轻松闲聊每轮上限（条）", type: "number" },
    { key: "maxMessagesSerious", label: "严肃话题每轮上限（条）", type: "number" },
    { key: "longIncomingChars", label: "长来信判定（字符）", type: "number" },
    { key: "intervalMinMs", label: "普通间隔下限（毫秒）", type: "number", group: "逐条间隔" },
    { key: "intervalMaxMs", label: "普通间隔上限（毫秒）", type: "number" },
    { key: "longGapProbability", label: "长间隔概率（0–1）", type: "number" },
    { key: "longGapMinMs", label: "长间隔下限（毫秒）", type: "number" },
    { key: "longGapMaxMs", label: "长间隔上限（毫秒）", type: "number" },
    { key: "maxSendPerMinute", label: "每分钟上限（条）", type: "number", group: "统一出站上限", help: "0 = 此时间窗口不限制。" },
    { key: "maxSendPerHour", label: "每小时上限（条）", type: "number", help: "0 = 此时间窗口不限制。" },
    { key: "maxMessageChars", label: "单条最大长度（字符）", type: "number" }
  ] };

  // console/layers/L/components/ctx-chat-topic-drive.js
  var ctx_chat_topic_drive_default = { saveLabel: "保存话题发起与跟进", title: "话题发起与跟进", fields: [
    { key: "privateFollowupEnabled", label: "允许群聊转私聊跟进", help: "根据群内话题私聊追问，只联系已有私聊关系的人。", type: "boolean", group: "群聊转私聊" },
    { key: "minIntervalMinutes", label: "全局私聊跟进最小间隔（分钟）", help: "同一人两次跨私聊跟进的冷却；与会话限制取较大值。", type: "number", min: 0, max: 10080 },
    { key: "dailyLimit", label: "全局每日私聊跟进上限", help: "同一人每天的跨私聊跟进次数；与会话限制取较小值。", type: "number", min: 0, max: 30 },
    { key: "followUpCooldownMinutes", label: "同一话题跟进冷却（分钟）", help: "私聊、群聊共用规则；“还在吗”等催回复也算追问。", type: "number", min: 0, group: "当前会话的话题（私聊、群聊）" },
    { key: "newTopicCooldownMinutes", label: "新话题冷却（分钟）", help: "两次主动换题至少间隔多久，正常聊天也受限。", type: "number", min: 0 },
    { key: "newTopicMaxPerHour", label: "每小时最多新话题数", help: "按实际成功发送的话题波次计数，0 表示不主动起新话题。", type: "number", min: 0, max: 60 },
    { key: "followupWeight", label: "旧话题追问权重 a", help: "等待超时且不结束本轮时抽取；受冷却限制则继续等待。", type: "number", min: 0, max: 1, step: 0.01, group: "超时后怎么继续" },
    { key: "newTopicWeight", label: "新话题权重 b", help: "a+b ≤ 1；剩余 1−a−b 用于继续等待。发起、跟进成功均重置主动会话状态。", type: "number", min: 0, max: 1, step: 0.01 }
  ] };

  // console/layers/E/components/exec-browser-manager.js
  var exec_browser_manager_default = {
    saveLabel: "保存浏览器操作规则",
    title: "浏览器设置",
    fields: [
      { key: "allowUrls", label: "允许访问的网址（每行一个）", help: "留空表示不限定。当前用于告知 AI 访问范围。", type: "lines" },
      { key: "blockUrls", label: "禁止访问的网址（每行一个）", help: "优先于允许列表；当前用于告知 AI 避开这些地址。", type: "lines" },
      { key: "headlessFor", label: "无头运行的场景", help: "匹配这些任务用途时不显示浏览器窗口；多个用途用 | 分隔。", type: "text" },
      { key: "visibleFor", label: "显示窗口的场景", help: "匹配登录、验证码等需要人工操作的用途时显示窗口；多个用途用 | 分隔。", type: "text" },
      { key: "rules", label: "浏览器操作与监控规则（每行一条）", help: "供浏览器任务和监控共同参考，不只影响某一个网址；不替代实际权限检查。", type: "lines" }
    ]
  };

  // console/layers/E/components/exec-image-generation.js
  var exec_image_generation_default = {
    saveLabel: "保存生图服务与额度",
    title: "图片生成设置",
    fields: [
      { key: "apiBase", label: "OpenAI API 地址", help: "兼容 OpenAI 图片接口的服务地址。", type: "text" },
      { key: "proxyUrl", label: "网络代理（可选）", help: "例如 http://127.0.0.1:7897；留空则读取系统代理环境变量。只用于生图供应商请求。", type: "text" },
      { key: "model", label: "OpenAI 模型", type: "text" },
      { key: "size", label: "OpenAI 图片尺寸", help: "例如 1024x1024，以服务商支持的尺寸为准。", type: "text" },
      { key: "quality", label: "OpenAI 画质档位", help: "以服务商支持的值为准。", type: "text" },
      { key: "quotaMode", label: "每日额度模式", help: "global 全局；session 每个会话；both 同时限制。按上海时间每天重置。", type: "select", options: ["global", "session", "both"] },
      { key: "dailyGlobalLimit", label: "全局每日请求上限", type: "number", min: 0, max: 1e4 },
      { key: "dailySessionLimit", label: "每个会话每日请求上限", type: "number", min: 0, max: 1e4 },
      { key: "maxPromptChars", label: "提示词最大字符数", type: "number", min: 1, max: 1e4 },
      { key: "maxReferenceImages", label: "最多引用图片数", type: "number", min: 0, max: 5 },
      { key: "maxReferenceBytes", label: "单张引用图片最大字节数", type: "number", min: 1, max: 3e7 },
      { key: "maxOutputBytes", label: "生成图片最大字节数", type: "number", min: 1, max: 3e7 },
      { key: "timeoutSeconds", label: "请求超时（秒）", type: "number", min: 1, max: 600 },
      { key: "cooldownSeconds", label: "同一会话冷却（秒）", type: "number", min: 0, max: 3600 },
      { key: "allowAutomatic", label: "允许按聊天语境自动生成图片", help: "开启后仍受会话权限、额度和冷却限制。", type: "boolean" },
      { key: "allowedSessions", label: "允许使用的会话（每行一个）", help: "例如 private:12345 或 group:67890。", type: "lines" },
      { key: "assetRetentionDays", label: "生成图片保留天数", type: "number", min: 1, max: 365 }
    ]
  };

  // console/layers/L/components/life-campus-watch.js
  var life_campus_watch_default = {
    title: "监控设置",
    fields: [
      { key: "webWatchEnabled", label: "启用网页监控", help: "必须填写至少一个网址；页面变化时发送新增内容的 diff。", type: "boolean" },
      { key: "fastCheckMinutes", label: "到期轮询间隔（分钟）", help: "只检查哪些网址到期，不表示每次都重新读取全部网页。", type: "number", min: 1, max: 1440 },
      { key: "fullCheckMinutes", label: "网页完整检查间隔（分钟）", help: "按此间隔重新读取已启用的网址，并与上次内容比较。", type: "number", min: 1, max: 10080 },
      { key: "watchUrls", label: "监控网址（勾选=启用）", help: "所有网页都按普通网址监控处理，含 Blackboard 页面。可直接写 https://网址，也可写“名称 | https://网址”；取消勾选 = 暂停检测但保留。", type: "items", placeholder: "名称 | https://网址", addLabel: "添加网址" },
      { key: "scriptCollabEnabled", label: "启用脚本协同", help: "添加脚本后，AI 可以按约定查询其状态并参与任务流程。", type: "boolean" },
      { key: "scriptPaths", label: "协同脚本（勾选=启用）", help: "勾选参与协同，取消勾选暂停。登记地址不会自动执行脚本。", type: "items", placeholder: "scripts/campus-watch.mjs", addLabel: "添加脚本" },
      { key: "enabledScripts", label: "内置协同任务标识（高级）", type: "text", group: "高级接口" },
      { key: "lecturesApi", label: "讲座查询接口（高级）", type: "json" },
      { key: "lecturesEnabled", label: "启用抢讲座", type: "boolean" },
      { key: "lecturesLocation", label: "讲座地点关键词", help: "例如「高新」。", type: "text" },
      { key: "lecturesIntervalMinutes", label: "讲座实际检查周期（分钟）", type: "number", min: 1, max: 120 },
      { key: "lecturesPortalUrl", label: "讲座门户 URL", type: "text" }
    ]
  };

  // console/layers/C/components/ctx-media-sticker-pick.js
  var ctx_media_sticker_pick_default = { title: "表情候选", fields: [{ key: "limit", label: "按语境评分后最多提供的候选数", type: "number", min: 1, max: 30 }] };

  // console/layers/C/components/ctx-memory-update.js
  var ctx_memory_update_default = { title: "记忆更新", fields: [{ key: "maxChars", label: "每次自动整理的输出目标上限（字符）", type: "number", min: 800, max: 2e4 }] };

  // console/layers/C/components/ctx-memory-profile-facts.js
  var ctx_memory_profile_facts_default = { saveLabel: "保存事实提取规则", title: "用户画像事实", fields: [
    { key: "cooldownMs", label: "聊天中人物资料提取冷却（分钟）", help: "设为 0 时，每轮新消息都可及时整理稳定人物事实；只有值得长期使用的信息才写入档案。", type: "minutes", min: 0 },
    { key: "maxSnippets", label: "每轮最多候选事实", help: "一轮最多挑出多少条值得记住的用户事实。", type: "number", min: 1, max: 30 },
    { key: "maxCharsPerSnippet", label: "单条事实最大字数", help: "防止把整段聊天记录当作一条画像事实。", type: "number", min: 10, max: 1e3 }
  ] };

  // console/layers/C/components/ctx-memory-context.js
  var ctx_memory_context_default = { saveLabel: "保存记忆注入预算", title: "记忆注入", fields: [
    { key: "maxChars", label: "会话事实与今日画像注入预算（字符）", type: "number", min: 500, max: 2e4 },
    { key: "affairsMaxChars", label: "当前事务注入预算（字符，按完整条目选择）", type: "number", min: 200, max: 1e4 }
  ] };

  // console/layers/O/components/obs-cost-policy.js
  var obs_cost_policy_default = {
    saveLabel: "保存模型调用档位",
    title: "成本策略（调用档位）",
    fields: [
      { key: "autoUpgradeComplexTasks", label: "复杂任务自动升级 Pro（关闭后仅明确指定升级）", type: "boolean" },
      { key: "defaultModel", label: "默认模型", type: "select", options: ["deepseek-flash", "deepseek-v4-pro"] },
      { key: "defaultEffort", label: "默认思考强度", type: "select", options: ["low", "medium", "high", "max"] },
      { key: "upgradeModel", label: "升级模型（复杂任务/明确指定）", type: "select", options: ["deepseek-flash", "deepseek-v4-pro"] },
      { key: "upgradeEffort", label: "升级思考强度", type: "select", options: ["low", "medium", "high", "max"] }
    ]
  };

  // console/layers/L/components/life-relay-message.js
  var life_relay_message_default = {
    saveLabel: "保存传话间隔",
    title: "传话组件",
    fields: [{ key: "minIntervalMin", label: "每次传话最短间隔（分钟）", help: "按发起会话计算；管理员不受限制。", type: "number", min: 1, max: 1440 }]
  };

  // console/layers/L/components/life-task-session.js
  var life_task_session_default = {
    saveLabel: "保存独立任务设置",
    title: "独立 AI 任务",
    fields: [
      { key: "maxConcurrentTasks", label: "同时进行的任务（个）", type: "number", min: 1, max: 20 },
      { key: "maxTasks", label: "任务记录保留数（条）", type: "number", min: 3, max: 200 }
    ]
  };

  // console/layers/L/components/life-proactive-time-bubble.js
  var life_proactive_time_bubble_default = {
    saveLabel: "保存冒泡数量上限",
    title: "定时主动消息",
    fields: [{ key: "maxBubblesPerDay", label: "每天最多主动冒泡次数", help: "填 0 表示当天不主动冒泡；仍可正常回复收到的消息。", type: "number", min: 0, max: 60 }]
  };

  // console/layers/L/components/life-proactive-startup-greeting.js
  var life_proactive_startup_greeting_default = { saveLabel: "保存开机问候规则", title: "开机问候", fields: [{ key: "hint", label: "开机问候语气提示", help: "只提供语气线索，不是固定发送文案。", type: "text" }] };

  // console/layers/L/components/life-schedule-reminder.js
  var life_schedule_reminder_default = { saveLabel: "保存全局日程规则", title: "日程提醒设置", fields: [
    { key: "enabled", label: "启用日程提醒", help: "只控制日程到点提醒与日程上下文注入；不会影响定时主动消息。", type: "boolean" },
    { key: "advanceMinutes", label: "全局默认提醒开始提前量（分钟）", help: "日程未单独设置 leadMinutes 时使用；0 表示到日程时间才开始提醒。", type: "number", min: 0, max: 1440 },
    { key: "intervalMinutes", label: "全局默认提醒间歇周期（分钟）", help: "日程未单独设置 intervalMinutes 时使用；从提醒开始后持续间歇提醒，直到用户明确确认已经去做。", type: "number", min: 1, max: 1440 },
    { key: "horizonDays", label: "总览与上下文范围（天）", type: "number", min: 1, max: 90 },
    { key: "maxItems", label: "最多保存的日程数", help: "达到上限后不再接受新的日程；不会删除现有日程。", type: "number", min: 10, max: 1e3 },
    { key: "maxPromptItems", label: "每轮最多注入日程数", type: "number", min: 1, max: 20 }
  ] };

  // console/layers/L/components/life-user-availability.js
  var life_user_availability_default = { title: "语义约定与免打扰", fields: [] };

  // console/layers/L/components/life-message-ack.js
  var life_message_ack_default = { saveLabel: "保存思考补话规则", title: "四组独立启用、延迟和话术；从最新完整用户消息起算。新消息取消旧轮，正式回复实际发送前取消两个计时器。", fields: [
    { key: "privateWait", label: "私聊 · 等待中", type: "ackGroup" },
    { key: "privateApology", label: "私聊 · 抱歉", type: "ackGroup" },
    { key: "groupWait", label: "群聊 · 等待中", type: "ackGroup" },
    { key: "groupApology", label: "群聊 · 抱歉", type: "ackGroup" }
  ] };

  // console/layers/O/components/obs-health-monitor.js
  var obs_health_monitor_default = { saveLabel: "保存心跳告警设置", title: "运行异常提醒", fields: [{ key: "staleAlertCooldownMs", label: "重复提醒冷却（毫秒）", help: "同一类异常两次提醒的最短间隔。", type: "number", min: 6e4 }] };

  // console/layers/V/components/eval-regression.js
  var eval_regression_default = { title: "失败回归", fields: [{ key: "maxCases", label: "最多保留的回归用例", help: "用于限制回归记录数量，避免无限增长。", type: "number", min: 5, max: 1e3 }] };

  // console/layers/G/components/gov-policy.js
  var gov_policy_default = { title: "治理策略", fields: [{ key: "rules", label: "行为规则（每行一条）", help: "这些规则将作为治理提示提供给 AI。请写清允许范围、禁止事项及需要询问用户的动作。", type: "lines" }] };

  // console/layers/T/components/tool-injection-lab.js
  var tool_injection_lab_default = { saveLabel: "保存注入实验设置", title: "提示词注入实验室", fields: [
    { key: "detect", label: "启用检测", help: "记录实验中观察到的注入迹象。", type: "boolean" },
    { key: "alertWindowMs", label: "注入警报保留时长（毫秒）", help: "最近一次检测到疑似注入后，在此时长内继续向 bot 的后续上下文注入警报；再次命中会重新计时。最低 60000 毫秒（1 分钟），默认 600000 毫秒（10 分钟）。", type: "number", min: 6e4 },
    { key: "sparPerHour", label: "每小时最多对线次数", help: "限制实验工具的触发频率。", type: "number", min: 0, max: 60 }
  ] };

  // console/layers/L/components/life-wake-reasons.js
  var life_wake_reasons_default = { saveLabel: "保存静默主动规则", title: "来信与静默主动", fields: [
    { key: "proactiveEnabled", label: "启用静默主动", type: "boolean", group: "静默与概率" },
    { key: "silenceMinutes", label: "静默阈值（分钟）", type: "number" },
    { key: "initialProbability", label: "初始概率（0–1）", type: "number" },
    { key: "probabilityStep", label: "每阶段概率增长（0–1）", type: "number" },
    { key: "probabilityMax", label: "概率上限（0–1）", type: "number" },
    { key: "checkMinMinutes", label: "检验间隔下限（分钟）", type: "number", group: "检验间隔" },
    { key: "checkMaxMinutes", label: "检验间隔上限（分钟）", type: "number" },
    { key: "intervalStepMinutes", label: "每阶段间隔变化（分钟）", type: "number", help: "可为负数，负数让后续检验更频繁。" },
    { key: "checkFloorMinutes", label: "间隔硬下限（分钟）", type: "number" },
    { key: "minActiveGapMinutes", label: "主动最小间距（分钟）", type: "number" },
    { key: "maxSilenceMinutes", label: "最大静默兜底（分钟）", type: "number" },
    { key: "initialWillingness", label: "默认聊天意愿：用户忙闲（0–100）", type: "number", group: "聊天意愿" },
    { key: "curfewEnabled", label: "启用宵禁", type: "boolean", group: "宵禁（上海时间）" },
    { key: "curfewStartHour", label: "开始（小时）", type: "number" },
    { key: "curfewEndHour", label: "结束（小时）", type: "number" }
  ] };

  // console/layers/L/components/life-daily-worklog.js
  var life_daily_worklog_default = {
    title: "运维日报",
    fields: [
      { key: "hour", label: "生成时间（时）", type: "number", min: 0, max: 23 },
      { key: "minute", label: "生成时间（分）", type: "number", min: 0, max: 59 },
      { key: "maxChars", label: "日报最大字数", type: "number", min: 1e3, max: 2e4 },
      { key: "sendToOwner", label: "生成后私聊发送摘要", type: "boolean" }
    ]
  };

  // console/layers/S/components/personal-core.js
  var personal_core_default = {
    "title": "目录挂载与按需阅读",
    "saveLabel": "保存并校验资料包挂载",
    "fields": [
      {
        "key": "libraryDir",
        "label": "资料包目录（本机路径）",
        "type": "text",
        "maxLength": 4096,
        "group": "目录挂载",
        "help": "支持项目相对路径或本机绝对路径。填写标准资料包的根目录；保存时校验并挂载。留空表示卸载。"
      },
      {
        "key": "referenceSessionKeys",
        "label": "自动导读适用会话（留空为全部）",
        "type": "lines",
        "group": "会话适用范围"
      },
      {
        "key": "careSessionKeys",
        "label": "优先关怀会话（可选）",
        "type": "lines"
      },
      {
        "key": "catalogPageSize",
        "label": "目录默认分页条数",
        "type": "number",
        "group": "按需阅读预算"
      },
      {
        "key": "maxReadChars",
        "label": "单次正文读取上限（字符）",
        "type": "number"
      }
    ]
  };

  // console/layers/C/components/ctx-user-mood.js
  var ctx_user_mood_default = { ownsEnabled: true, saveLabel: "保存心情与双形态", title: "心情与双形态", fields: [
    { key: "enabled", label: "启用心情系统", help: "心情表示 bot 主观上是否喜欢与对方聊天，并决定风格；用户忙闲由聊天意愿单独评估。", type: "boolean", group: "结算规则" },
    { key: "noReplyAfterMinutes", label: "主动后等待回应（分钟）", type: "number" },
    { key: "modeThreshold", label: "普通与临界形态阈值（0–100）", type: "number", group: "双形态", help: "达到阈值采用普通形态；低于阈值采用临界形态。" },
    { key: "normalName", label: "普通形态名称", type: "text", maxLength: 40 },
    { key: "normalStyle", label: "普通形态：语言风格与对话示例", type: "textarea", maxLength: 2400, help: "全局规则，仅普通形态注入。写清说话习惯、聊天倾向和几组对话示例；人设卡只保留整体身份与气质。" },
    { key: "criticalName", label: "临界形态名称", type: "text", maxLength: 40 },
    { key: "criticalStyle", label: "临界形态：语言风格与对话示例", type: "textarea", maxLength: 2400, help: "全局规则，仅低于阈值时注入。定义语气如何变化、如何延续话题；示例只校准风格，不要求照抄。" },
    { key: "positiveRules", label: "升分行为规则", type: "moodRules", direction: 1, group: "AI判断与加减分" },
    { key: "negativeRules", label: "降分行为规则", type: "moodRules", direction: -1 },
    { key: "maxAdjustment", label: "AI单次加减分上限", type: "number" },
    { key: "burstEnabled", label: "启用被叫回后的热情回应", type: "boolean", group: "重新开始聊天时" },
    { key: "recoverMinutes", label: "欢迎冷却（分钟）", type: "number", help: "0 = 无冷却；不自动恢复心情分。" }
  ] };

  // console/layers/L/components/life-conversation-wait.js
  var life_conversation_wait_default = { title: "无人回复时结束本轮", saveLabel: "保存无人回复收尾概率", fields: [
    { key: "endProbabilityPercent", label: "初始结束概率 p（%）", type: "number", min: 0, max: 100 },
    { key: "probabilityStepPercent", label: "每次增加 q（百分点）", type: "number", min: 1, max: 100 }
  ] };

  // console/shared/components/forms.js
  var COMPONENT_FORMS = {
    "ctx-memory-store": ctx_memory_store_default,
    "life-scheduler": life_scheduler_default,
    "tool-bilibili": tool_bilibili_default,
    "tool-user-checking": tool_user_checking_default,
    "ctx-memory-profile-store": ctx_memory_profile_store_default,
    "ctx-knowledge-quota": ctx_knowledge_quota_default,
    "ctx-chat-reply-shape": ctx_chat_reply_shape_default,
    "ctx-chat-topic-drive": ctx_chat_topic_drive_default,
    "exec-browser-manager": exec_browser_manager_default,
    "exec-image-generation": exec_image_generation_default,
    "life-campus-watch": life_campus_watch_default,
    "ctx-media-sticker-pick": ctx_media_sticker_pick_default,
    "ctx-memory-update": ctx_memory_update_default,
    "ctx-memory-profile-facts": ctx_memory_profile_facts_default,
    "ctx-memory-context": ctx_memory_context_default,
    "obs-cost-policy": obs_cost_policy_default,
    "life-relay-message": life_relay_message_default,
    "life-task-session": life_task_session_default,
    "life-proactive-time-bubble": life_proactive_time_bubble_default,
    "life-proactive-startup-greeting": life_proactive_startup_greeting_default,
    "life-schedule-reminder": life_schedule_reminder_default,
    "life-user-availability": life_user_availability_default,
    "life-message-ack": life_message_ack_default,
    "obs-health-monitor": obs_health_monitor_default,
    "eval-regression": eval_regression_default,
    "gov-policy": gov_policy_default,
    "tool-injection-lab": tool_injection_lab_default,
    "life-wake-reasons": life_wake_reasons_default,
    "life-daily-worklog": life_daily_worklog_default,
    "personal-core": personal_core_default
  };
  COMPONENT_FORMS["ctx-user-mood"] = ctx_user_mood_default;
  COMPONENT_FORMS["life-conversation-wait"] = life_conversation_wait_default;

  // console/shared/components/field-contract.js
  var PRIVATE_FIELDS = /(?:api.?key|secret|token|password|credential)/i;
  var INTERNAL_FIELDS = /* @__PURE__ */ new Set(["mcpProfileConfigured", "watchUrlsConfigured", "bbCoursesConfigured", "bbCourses", "disabledReasons", "lateMinutes"]);
  function resolveComponentFields(plugin, specification, selectedKeys) {
    const declaredKeys = plugin.configKeys || [];
    const overrides = new Map((specification?.fields || []).map((field) => [field.key, field]));
    const order = new Map([...overrides.keys()].map((key2, index) => [key2, index]));
    const keys = [...declaredKeys].sort((a, b) => (order.get(a) ?? Infinity) - (order.get(b) ?? Infinity));
    return keys.filter((key2) => !PRIVATE_FIELDS.test(key2) && !INTERNAL_FIELDS.has(key2) && plugin.configSchema?.[key2]?.editable !== false && plugin.configSchema?.[key2]?.readOnly !== true && (!selectedKeys || selectedKeys.includes(key2))).map((key2) => {
      const value2 = plugin.config?.[key2];
      const rule = plugin.configSchema?.[key2] || {};
      const type = rule.enum ? "select" : Array.isArray(value2) ? value2.some((x) => typeof x === "object") ? "json" : "lines" : value2 !== null && typeof value2 === "object" ? "json" : typeof value2 === "boolean" ? "boolean" : typeof value2 === "number" ? "number" : "text";
      return { key: key2, label: rule.label || key2, help: rule.description || "", example: rule.example || "", type, ...overrides.get(key2), ...rule.min == null ? {} : { min: rule.min }, ...rule.max == null ? {} : { max: rule.max }, ...rule.maxLength == null ? {} : { maxLength: rule.maxLength }, ...rule.enum ? { options: rule.enum } : {} };
    });
  }

  // console/shared/components/fields.js
  function moodRuleRow(rule, direction) {
    return '<div class="mood-rule-row" data-rule-id="' + esc(rule.id) + '"><label>行为<input class="mood-rule-label" type="text" maxlength="80" value="' + esc(rule.label) + '"></label><label>分值<input class="mood-rule-delta" type="number" min="' + (direction > 0 ? "0.01" : "-100") + '" max="' + (direction > 0 ? "100" : "-0.01") + '" step="any" value="' + esc(rule.delta) + '"></label><label>判断说明<textarea class="mood-rule-description" rows="2" maxlength="500">' + esc(rule.description) + '</textarea></label><button class="small mood-rule-delete" type="button" aria-label="删除行为规则">删除</button></div>';
  }
  function compFieldHtml(field, value2) {
    const hint = (field.help ? '<small class="meta comp-help">' + esc(field.help) + "</small>" : "") + (field.example ? '<small class="parameter-example">例：' + esc(field.example) + "</small>" : "");
    if (field.type === "moodRules") return '<div class="comp-field mood-rules" data-rule-direction="' + field.direction + '"><b>' + esc(field.label) + '</b><div class="mood-rule-list">' + (Array.isArray(value2) ? value2 : []).map((rule) => moodRuleRow(rule, field.direction)).join("") + '</div><button class="small mood-rule-add" type="button">+ 添加行为规则</button><small class="meta comp-help">AI 结合语境选用规则；分值是该行为单次调整的上限。</small>' + hint + "</div>";
    if (field.type === "json") return '<div class="comp-field"><label class="meta">' + esc(field.label) + '</label><textarea class="comp-form-json" rows="6">' + esc(JSON.stringify(value2 ?? null, null, 2)) + "</textarea>" + hint + "</div>";
    if (field.type === "ackGroup") {
      const group = value2 && typeof value2 === "object" && !Array.isArray(value2) ? value2 : {};
      const lines = Array.isArray(group.lines) ? group.lines : [];
      return '<fieldset class="comp-field comp-ack-group" style="border:1px solid var(--border-subtle);border-radius:12px;padding:12px 14px;margin:10px 0;background:var(--surface)"><legend style="padding:0 6px;font-weight:650">' + esc(field.label) + '</legend><div class="row" style="gap:14px;align-items:center"><label><input type="checkbox" class="comp-ack-enabled"' + (group.enabled !== false ? " checked" : "") + '> 启用这组</label><label>激活延迟（秒） <input type="number" class="comp-ack-delay" value="' + esc(String(Number(group.delayMs ?? 0) / 1e3)) + '" min="0" max="600" step="0.1" style="width:110px"></label></div><label class="meta" style="display:block;margin-top:8px">固定话术表（每行一条，激活时随机选一条）</label><textarea class="comp-ack-lines" rows="' + Math.max(4, Math.min(8, lines.length)) + '" style="width:100%;min-height:100px">' + esc(lines.join("\n")) + '</textarea><small class="meta comp-help">清空话术表会让此组不发送；延迟上限为 600 秒。</small>' + hint + "</fieldset>";
    }
    if (field.type === "flags") {
      const set = new Set(String(value2 || "").split("|").filter(Boolean));
      const opts = (field.options || []).map(([v, label2]) => '<label class="comp-flag"><input type="checkbox" data-flag="' + esc(v) + '"' + (set.has(v) ? " checked" : "") + "> " + esc(label2) + "</label>").join("");
      return '<div class="comp-field"><div class="meta">' + esc(field.label) + '</div><div class="row" style="gap:10px;flex-wrap:wrap;margin-top:4px">' + opts + "</div>" + hint + "</div>";
    }
    if (field.type === "comma-list") {
      const arr = Array.isArray(value2) ? value2 : [];
      return '<div class="comp-field"><div class="meta">' + esc(field.label) + '</div><input type="text" class="comp-form-text" style="width:100%;max-width:520px" placeholder="例如：论文，作业，报告" value="' + esc(arr.join("， ")) + '">' + hint + "</div>";
    }
    if (field.type === "lines") {
      const arr = Array.isArray(value2) ? value2 : [];
      return '<div class="comp-field"><div class="meta">' + esc(field.label) + '</div><textarea class="comp-form-lines" style="width:100%;min-height:70px" rows="' + Math.max(3, arr.length + 1) + '">' + esc(arr.join("\n")) + "</textarea>" + hint + "</div>";
    }
    if (field.type === "number") {
      return '<div class="comp-field"><div class="meta">' + esc(field.label) + '</div><input type="number" class="comp-form-num" value="' + esc(String(value2 ?? "")) + '" min="' + (field.min ?? "") + '" max="' + (field.max ?? "") + '" step="any" style="width:120px">' + hint + "</div>";
    }
    if (field.type === "minutes") {
      return '<div class="comp-field"><div class="meta">' + esc(field.label) + '</div><input type="number" class="comp-form-minutes" value="' + esc(String(Math.round((Number(value2) || 0) / 6e4))) + '" min="' + (field.min ?? 0) + '" step="1" style="width:120px">' + hint + "</div>";
    }
    if (field.type === "select") {
      const opts = (field.options || []).map((o) => "<option" + (String(value2) === o ? " selected" : "") + ">" + esc(o) + "</option>").join("");
      return '<div class="comp-field"><div class="meta">' + esc(field.label) + '</div><select class="comp-form-select" style="max-width:220px">' + opts + "</select>" + hint + "</div>";
    }
    if (field.type === "boolean") {
      return '<div class="comp-field"><label><input type="checkbox" class="comp-form-bool"' + (value2 === true ? " checked" : "") + "> " + esc(field.label) + "</label>" + hint + "</div>";
    }
    if (field.type === "text") {
      return '<div class="comp-field"><div class="meta">' + esc(field.label) + '</div><input type="text" class="comp-form-text" maxlength="' + (field.maxLength ?? 1e4) + '" value="' + esc(String(value2 ?? "")) + '" style="width:100%;max-width:320px">' + hint + "</div>";
    }
    if (field.type === "textarea") {
      return '<div class="comp-field"><div class="meta">' + esc(field.label) + '</div><textarea class="comp-form-textarea" rows="4" maxlength="' + (field.maxLength ?? 300) + '" style="width:100%;max-width:720px">' + esc(String(value2 ?? "")) + "</textarea>" + hint + "</div>";
    }
    if (field.type === "items") {
      const arr = Array.isArray(value2) ? value2.map((e) => typeof e === "string" ? { value: e, enabled: true } : e) : [];
      const ph = esc(field.placeholder || "");
      const rows = arr.map((e) => '<div class="comp-item' + (e.enabled === false ? " is-off" : "") + '"><input type="checkbox" class="comp-item-on" title="勾选=启用" aria-label="启用此项"' + (e.enabled !== false ? " checked" : "") + '><input type="text" class="comp-item-val" value="' + esc(e.value || "") + '" placeholder="' + ph + '" style="flex:1"><button type="button" class="small comp-item-del" aria-label="删除此项">删除</button></div>').join("");
      return '<div class="comp-field"><div class="meta">' + esc(field.label) + "</div>" + rows + '<div class="row" style="gap:6px;margin-top:6px"><input type="text" class="comp-item-new" placeholder="' + ph + '" style="flex:1"><button type="button" class="small comp-item-add">' + esc(field.addLabel || "添加") + "</button></div>" + hint + "</div>";
    }
    return "";
  }
  function compFieldValue(field, el3) {
    if (field.type === "moodRules") {
      const rules = [...el3.querySelectorAll(".mood-rule-row")].map((row) => ({
        id: row.dataset.ruleId,
        label: row.querySelector(".mood-rule-label").value.trim(),
        delta: Number(row.querySelector(".mood-rule-delta").value),
        description: row.querySelector(".mood-rule-description").value.trim()
      }));
      const ids = /* @__PURE__ */ new Set();
      for (const rule of rules) {
        if (!/^[a-zA-Z0-9_-]{1,64}$/.test(rule.id) || ids.has(rule.id)) throw Error("行为规则 ID 无效或重复");
        if (!Number.isFinite(rule.delta) || rule.delta * field.direction <= 0 || Math.abs(rule.delta) > 100) throw Error("行为规则分值方向或范围错误");
        if (!rule.label) throw Error("行为规则名称不能为空");
        ids.add(rule.id);
      }
      return rules;
    }
    if (field.type === "json") return JSON.parse(el3.querySelector(".comp-form-json").value);
    if (field.type === "ackGroup") {
      const seconds = Number(el3.querySelector(".comp-ack-delay").value);
      return {
        enabled: el3.querySelector(".comp-ack-enabled").checked,
        delayMs: Number.isFinite(seconds) ? Math.round(Math.max(0, Math.min(600, seconds)) * 1e3) : 0,
        lines: el3.querySelector(".comp-ack-lines").value.split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 100)
      };
    }
    if (field.type === "flags") {
      const vals = [];
      el3.querySelectorAll("input[data-flag]").forEach((c) => {
        if (c.checked) vals.push(c.dataset.flag);
      });
      return vals.join("|");
    }
    if (field.type === "comma-list") return el3.querySelector(".comp-form-text").value.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
    if (field.type === "lines") return el3.querySelector(".comp-form-lines").value.split("\n").map((s) => s.trim()).filter(Boolean);
    if (field.type === "number") {
      const n = Number(el3.querySelector(".comp-form-num").value);
      if (!Number.isFinite(n) || field.min != null && n < field.min || field.max != null && n > field.max) throw new Error(field.label + "超出有效范围");
      return n;
    }
    if (field.type === "minutes") {
      const n = Number(el3.querySelector(".comp-form-minutes").value);
      return Number.isFinite(n) ? Math.round(n) * 6e4 : void 0;
    }
    if (field.type === "select") return el3.querySelector(".comp-form-select").value;
    if (field.type === "boolean") return el3.querySelector(".comp-form-bool").checked;
    if (field.type === "text") return el3.querySelector(".comp-form-text").value.trim();
    if (field.type === "textarea") return el3.querySelector(".comp-form-textarea").value.trim();
    if (field.type === "items") {
      const items2 = [];
      el3.querySelectorAll(".comp-item").forEach((row) => {
        const val = row.querySelector(".comp-item-val").value.trim();
        if (val) items2.push({ value: val, enabled: row.querySelector(".comp-item-on").checked });
      });
      const add = el3.querySelector(".comp-item-new");
      if (add) {
        const nv = add.value.trim();
        if (nv) items2.push({ value: nv, enabled: true });
      }
      return items2;
    }
    return void 0;
  }
  function wireItems(body) {
    body.querySelectorAll(".mood-rules").forEach((table) => {
      table.addEventListener("click", (event) => {
        if (event.target.closest(".mood-rule-delete")) event.target.closest(".mood-rule-row").remove();
        if (event.target.closest(".mood-rule-add")) {
          const direction = Number(table.dataset.ruleDirection);
          table.querySelector(".mood-rule-list").insertAdjacentHTML("beforeend", moodRuleRow({ id: "rule-" + crypto.randomUUID(), label: "", delta: direction, description: "" }, direction));
        }
      });
    });
    body.querySelectorAll(".comp-item-del").forEach((btn) => btn.addEventListener("click", () => btn.closest(".comp-item").remove()));
    const wireToggle = (input) => input.addEventListener("change", () => input.closest(".comp-item").classList.toggle("is-off", !input.checked));
    body.querySelectorAll(".comp-item-on").forEach(wireToggle);
    body.querySelectorAll(".comp-item-add").forEach((btn) => {
      btn.addEventListener("click", () => {
        const row = document.createElement("div");
        row.className = "comp-item";
        const ph = btn.closest(".comp-field")?.querySelector(".comp-item-new")?.getAttribute("placeholder") || "";
        row.innerHTML = '<input type="checkbox" class="comp-item-on" title="勾选=启用" aria-label="启用此项" checked><input type="text" class="comp-item-val" placeholder="' + esc(ph) + '" style="flex:1"><button type="button" class="small comp-item-del" aria-label="删除此项">删除</button>';
        btn.closest(".row").insertAdjacentElement("beforebegin", row);
        row.querySelector(".comp-item-del").addEventListener("click", () => row.remove());
        wireToggle(row.querySelector(".comp-item-on"));
        const input = btn.closest(".row")?.querySelector(".comp-item-new");
        if (input) input.value = "";
        row.querySelector(".comp-item-val").focus();
      });
    });
  }

  // console/shared/components/form.js
  function renderComponentForm(p, selectedKeys, showTitle = true, expandGroups = false) {
    const cfg = { ...p.config || {} };
    if (p.id === "exec-image-generation") delete cfg.apiKey;
    const componentForm = COMPONENT_FORMS[p.id];
    const ownsEnabled = componentForm?.ownsEnabled === true;
    if (ownsEnabled) cfg.enabled = p.enabled !== false && cfg.enabled !== false;
    const form = { title: componentForm?.title || p.name || "功能设置", fields: resolveComponentFields(p, componentForm, selectedKeys) };
    if (!form.fields.length) return { html: '<p class="meta">此功能没有需要填写的参数。</p>', collect: () => ({ ...cfg }), empty: true };
    let grouped = false, groupCount = 0;
    const fields = form.fields.map((f) => {
      const id = "cfg-" + p.id + "-" + f.key;
      let html = compFieldHtml({ ...f, example: f.example || PARAMETER_EXAMPLES[p.id]?.[f.key] }, f.key === "watchUrls" && !(cfg.watchUrls || []).length ? p.state?.watchUrls || [] : cfg[f.key]);
      html = html.replace('class="comp-field', 'data-config-key="' + esc(f.key) + '" class="comp-field');
      if (!["moodRules", "ackGroup", "items", "flags"].includes(f.type)) {
        html = html.replace(/<(input|select|textarea) /, '<$1 id="' + id + '" aria-label="' + esc(f.label) + '" ');
        html = html.replace('<div class="meta">' + esc(f.label) + "</div>", '<label class="meta" for="' + id + '">' + esc(f.label) + "</label>");
      }
      let heading = "";
      if (f.group) {
        heading = (grouped ? "</div></details>" : "") + '<details class="parameter-group"' + (groupCount++ === 0 || expandGroups ? " open" : "") + "><summary>" + esc(f.group) + '</summary><div class="component-fields">';
        grouped = true;
      }
      return heading + html;
    }).join("") + (grouped ? "</div></details>" : "");
    return { ownsEnabled, saveLabel: componentForm?.saveLabel || "保存" + form.title, html: (showTitle ? '<div class="meta" style="margin:6px 0">' + esc(form.title) + "</div>" : "") + '<div class="component-fields">' + fields + "</div>", collect: (el3) => {
      const out = {};
      const fields2 = el3.querySelectorAll(".comp-field[data-config-key]");
      form.fields.forEach((f, index) => {
        const v = compFieldValue(f, fields2[index]);
        if (v === void 0) delete out[f.key];
        else out[f.key] = v;
      });
      const ruleIds = [...out.positiveRules || [], ...out.negativeRules || []].map((rule) => rule.id);
      if (new Set(ruleIds).size !== ruleIds.length) throw Error("升分和降分规则 ID 不能重复");
      return out;
    } };
  }

  // console/shared/components/scope.js
  var LOCAL = /* @__PURE__ */ new Set(["exec-browser-manager", "exec-image-generation", "life-campus-watch", "tool-user-checking", "tool-codex-chat"]);
  var NOTES = {
    "ctx-user-mood": "心情分数、每日恢复和回应等待按会话分别记录。",
    "ctx-memory-profile-store": "下方档案正文按 QQ 号单独保存。",
    "ctx-knowledge-quota": "实际用量按设定的会话或发言人分别累计。",
    "life-proactive-time-bubble": "上方具体时段按选中的会话单独保存。",
    "ctx-chat-topic-drive": "下方可为某个私聊设置更严格的限制。",
    "life-schedule-reminder": "单条日程的收件会话和覆盖值单独保存。",
    "life-campus-watch": "本机监控与脚本配置；消息只投递到配置中的目标会话。",
    "exec-image-generation": "本机 API 服务、额度与密钥；密钥单独保存，普通参数按钮不修改密钥。",
    "obs-cost-policy": "小鲸鱼全局调用规则；不改写 DSH 的全局默认模型设置。"
  };
  function componentScope(id, label2) {
    const prefix = LOCAL.has(id) ? "本机" : "全局";
    const action = label2 || "保存功能设置";
    return {
      label: prefix === "本机" ? "本机配置" : "全局规则",
      description: id === "life-campus-watch" && action.includes("脚本") ? "本机脚本地址与逐项启停；执行和搜索细节按开发者与 AI 的约定处理。" : id === "life-campus-watch" ? "本机网页监控配置；通知发送到配置的目标会话。" : NOTES[id] || (prefix === "本机" ? "配置保存在本机，供此 bot 的相关功能使用。" : "适用于此 bot 符合条件的会话；不修改下方单个会话或人物的内容。"),
      saveLabel: action.includes(prefix) ? action : action.replace(/^保存/, "保存" + prefix)
    };
  }

  // console/shared/components/detail.js
  async function loadComponentDetail(id, el3) {
    const body = el3.querySelector(".comp-body");
    if (!body || body.dataset.loaded === "1") return;
    try {
      const resp = await api("/api/plugins/detail?id=" + encodeURIComponent(id));
      const p = resp && resp.plugin ? resp.plugin : resp;
      if (id === "human") {
        body.innerHTML = '<div class="human-loop-banner" role="img" aria-label="Human in the loop；Version 1.0；我也是一个组件"><div class="human-loop-kicker">V · HUMAN</div><div class="human-loop-title">HUMAN IN THE LOOP</div><div class="human-loop-version">Version 1.0</div><div class="human-loop-caption">我也是一个组件。</div></div>';
        body.dataset.loaded = "1";
        return;
      }
      const form = renderComponentForm(p, el3.dataset.inlineFields ? el3.dataset.inlineFields.split(",") : null, el3.dataset.hideTitle !== "1" && !!el3.dataset.inlineFields && id !== "life-daily-worklog" && !el3.closest(".env-comp-root"), !!el3.closest(".environment-page"));
      const toggleLabel = id === "tool-user-checking" ? "启用自查与桌面便签" : el3.dataset.toggleLabel || "启用此功能";
      const enabled = el3.dataset.hideToggle === "1" || id === "exec-image-generation" || form?.ownsEnabled ? "" : '<label class="comp-toggle"><input type="checkbox" class="comp-enabled"' + (p.enabled ? " checked" : "") + "> <span>" + esc(toggleLabel) + '</span></label><span class="meta comp-toggle-msg"></span>';
      if (form) {
        const saveLabel = el3.dataset.saveLabel || (id === "life-campus-watch" ? el3.closest("#envCompScript") ? "保存脚本协同参数" : "保存网页监控参数" : form.saveLabel || "保存" + p.name);
        const scope = componentScope(id, saveLabel);
        body.innerHTML = (form.empty || el3.dataset.hideScope === "1" ? "" : '<p class="parameter-scope" data-config-scope="' + esc(scope.label) + '"><b>' + esc(scope.label) + "</b> · " + esc(scope.description) + "</p>") + enabled + form.html + (form.empty || el3.dataset.deferSave === "1" ? "" : '<div class="row" style="gap:8px;margin-top:8px"><button class="small primary comp-save" data-save-action>' + esc(scope.saveLabel) + '</button><span class="meta comp-msg"></span></div>');
        if (id === "life-proactive-time-bubble") {
          const capacityInput = body.querySelector(".comp-form-num");
          if (capacityInput) {
            capacityInput.dataset.lastValidValue = capacityInput.value;
            syncV2TimeBubbleCapacity();
          }
        }
        if (id === "exec-image-generation") await mountImageGeneration({ id, body, p, el: el3, form });
        if (id === "ctx-knowledge-quota") await mountKnowledgeQuota({ id, body, p, el: el3, form });
        if (id === "ctx-memory-profile-store") await mountPersonProfile({ id, body, p, el: el3, form });
        if (id === "life-daily-worklog") await mountWorklog({ id, body, p, el: el3, form });
        if (id === "personal-core") mountPersonalCore({ id, body, p });
        wireItems(body);
        body.dataset.loaded = "1";
        body.querySelector(".comp-enabled")?.addEventListener("change", async (event) => {
          const msg = body.querySelector(".comp-toggle-msg");
          const previous = !event.target.checked;
          msg.textContent = "更新中…";
          try {
            const out = await api("/api/plugins/toggle", "POST", { id, enabled: event.target.checked });
            if (out.ok !== true) throw Error(out.error || "更新失败");
            msg.textContent = event.target.checked ? "已启用" : "已停用";
            if (id === "personal-core") {
              body.dataset.loaded = "";
              await loadComponentDetail(id, el3);
            }
          } catch (error) {
            event.target.checked = previous;
            msg.textContent = "更新失败：" + error.message;
          }
        });
        el3.__saveComponent = async () => {
          const cfg2 = form.collect(body);
          const msg = body.querySelector(".comp-msg");
          if (msg) msg.textContent = "保存中…";
          let next = cfg2;
          if (el3.dataset.inlineFields) {
            const latest = await api("/api/plugins/detail?id=" + encodeURIComponent(id));
            next = { ...(latest.plugin || latest).config || {}, ...cfg2 };
          }
          if (id === "life-campus-watch" && el3.closest("#envCompBrowserWatch")) {
            next.watchUrlsConfigured = true;
            next.bbCoursesConfigured = true;
            next.bbCourses = [];
            next.enabledScripts = String(next.enabledScripts || "").split("|").filter((script) => script && script !== "blackboard").join("|");
            const activeUrls = (next.watchUrls || []).filter((e) => typeof e === "string" ? true : e.enabled !== false);
            if (next.webWatchEnabled && !activeUrls.length) throw Error("请先勾选并填写至少一个监控网址");
          }
          if (id === "life-campus-watch" && el3.closest("#envCompScript")) {
            const activeScripts = (next.scriptPaths || []).filter((e) => typeof e === "string" ? true : e.enabled !== false);
            next.scriptCollabEnabled = activeScripts.length > 0;
          }
          const out = await api("/api/plugins/config", "POST", { id, config: next });
          if (out.ok === false) throw Error(out.error || "保存失败");
          if (form.ownsEnabled && next.enabled === true) {
            try {
              const active = await api("/api/plugins/toggle", "POST", { id, enabled: true });
              if (active.ok !== true) throw Error(active.error || "启用失败");
            } catch (error) {
              const control = body.querySelector('[data-config-key="enabled"] input');
              if (control) control.checked = false;
              throw Error("参数已保存，但组件启用失败：" + error.message);
            }
          }
          if (msg) msg.textContent = "已保存并重载";
          body.dataset.loaded = "";
          await loadComponentDetail(id, el3);
          const readbackMsg = body.querySelector(".comp-msg");
          if (readbackMsg) readbackMsg.textContent = "已保存并重载，已重新读取";
          el3.dispatchEvent(new CustomEvent("component-config-saved", { bubbles: true, detail: { id } }));
        };
        body.querySelector(".comp-save")?.addEventListener("click", async (event) => {
          const button = event.currentTarget;
          button.disabled = true;
          button.setAttribute("aria-busy", "true");
          try {
            await el3.__saveComponent();
          } catch (error) {
            const msg = body.querySelector(".comp-msg");
            if (msg) msg.textContent = "保存失败：" + error.message;
          } finally {
            button.disabled = false;
            button.removeAttribute("aria-busy");
          }
        });
      }
    } catch (error) {
      body.textContent = "读取详情失败：" + error.message;
    }
  }

  // console/layers/T/tool-presentation.js
  var TOOL_PRESENTATION = {
    learningSources: { group: "记忆、心情与排程", label: "调整知识适用来源", example: "例：高频用到某条确认资料时，把当前会话加入默认注入名单；不确认候选。" },
    aliasQuery: { group: "知识与反馈", label: "查询成员绰号", example: "例：按完整QQ号查询已确认称呼；跨来源不返回原始聊天证据。" },
    aliasSubmit: { group: "知识与反馈", label: "提交绰号候选", example: "例：发现新称呼后提交候选，仍由管理员确认。" },
    "status": {
      "group": "读取与状态",
      "label": "连接状态",
      "example": "例：开启并保存后，可读取QQ连接与账号状态；仍受会话权限与额度约束。"
    },
    "getPrompt": {
      "group": "读取与状态",
      "label": "当前角色与规则",
      "example": "例：开启并保存后，可查看本轮角色、参数指引和允许工具；仍受会话权限与额度约束。"
    },
    "getUnread": {
      "group": "读取与状态",
      "label": "未处理来信",
      "example": "例：开启并保存后，可读取尚未完成处理的消息；仍受会话权限与额度约束。"
    },
    "getRecent": {
      "group": "读取与状态",
      "label": "最近聊天",
      "example": "例：开启并保存后，可读取当前会话的近期消息；仍受会话权限与额度约束。"
    },
    "socialState": {
      "group": "读取与状态",
      "label": "会话状态",
      "example": "例：开启并保存后，可查看当前会话状态与唤醒条件；仍受会话权限与额度约束。"
    },
    "getMyRecent": {
      "group": "读取与状态",
      "label": "bot 最近发言",
      "example": "例：开启并保存后，可核对bot刚才实际发过的内容；仍受会话权限与额度约束。"
    },
    "getMessageDetail": {
      "group": "读取与状态",
      "label": "消息与引用详情",
      "example": "例：开启并保存后，可按真实消息ID查看单条及引用关系；仍受会话权限与额度约束。"
    },
    "getActiveMembers": {
      "group": "读取与状态",
      "label": "近期活跃成员",
      "example": "例：开启并保存后，可查看当前会话近期参与者；仍受会话权限与额度约束。"
    },
    "getGroupMembers": {
      "group": "读取与状态",
      "label": "群成员列表",
      "example": "例：开启并保存后，可读取当前群成员信息；仍受会话权限与额度约束。"
    },
    "sendBurst": {
      "group": "回复、等待与收尾",
      "label": "分条发送",
      "example": "例：开启并保存后，可按当前发送计划分成多条发出；仍受会话权限与额度约束。"
    },
    "sendMessage": {
      "group": "回复、等待与收尾",
      "label": "发送聊天消息",
      "example": "例：开启并保存后，可在当前权限和发送计划内发言；仍受会话权限与额度约束。"
    },
    "waitMessages": {
      "group": "回复、等待与收尾",
      "label": "等待新消息与确认说完",
      "example": "例：开启并保存后，可分别使用等新消息、等对方说完两个工具；仍受会话权限与额度约束。"
    },
    "markRead": {
      "group": "回复、等待与收尾",
      "label": "标记已读与收尾",
      "example": "例：开启并保存后，可声明看过消息并完成相应回合收尾；仍受会话权限与额度约束。"
    },
    "reportReceipts": {
      "group": "回复、等待与收尾",
      "label": "逐条处理回报",
      "example": "例：开启并保存后，可按真实消息ID回报处理结果；仍受会话权限与额度约束。"
    },
    "setWakeConfig": {
      "group": "回复、等待与收尾",
      "label": "设置唤醒与意愿",
      "example": "例：开启并保存后，可设置下一次唤醒条件或评估聊天意愿；仍受会话权限与额度约束。"
    },
    "mood": {
      "group": "记忆、心情与排程",
      "label": "调整心情",
      "example": "例：开启并保存后，可按add或dec提交有依据的心情调整；仍受会话权限与额度约束。"
    },
    "taskNote": {
      "group": "记忆、心情与排程",
      "label": "当前事务",
      "example": "例：开启并保存后，可查看或更新任务、承诺和安排的状态；仍受会话权限与额度约束。"
    },
    "memory": {
      "group": "记忆、心情与排程",
      "label": "窗口轻量记忆",
      "example": "例：开启并保存后，可维护当前话题、待说想法与临时印象；仍受会话权限与额度约束。"
    },
    "schedule": {
      "group": "记忆、心情与排程",
      "label": "日程提醒",
      "example": "例：开启并保存后，可登记和管理属于当前会话的日程；仍受会话权限与额度约束。"
    },
    "timeBubbleManage": {
      "group": "记忆、心情与排程",
      "label": "定时冒泡",
      "example": "例：开启并保存后，可管理允许修改的定时主动时段；仍受会话权限与额度约束。"
    },
    "availability": {
      "group": "记忆、心情与排程",
      "label": "免打扰与稍后联系",
      "example": "例：开启并保存后，可登记或调整用户明确表达的时间意愿；仍受会话权限与额度约束。"
    },
    "slangQuery": {
      "group": "知识与反馈",
      "label": "查询黑话",
      "example": "例：开启并保存后，可查询已确认的黑话含义；仍受会话权限与额度约束。"
    },
    "slangSubmit": {
      "group": "知识与反馈",
      "label": "提交黑话候选",
      "example": "例：开启并保存后，可把陌生表达提交为待审核候选；仍受会话权限与额度约束。"
    },
    "termQuery": {
      "group": "知识与反馈",
      "label": "查询兴趣知识",
      "example": "例：开启并保存后，可查找已确认的兴趣词条与来源；仍受会话权限与额度约束。"
    },
    "termSubmit": {
      "group": "知识与反馈",
      "label": "提交兴趣候选",
      "example": "例：开启并保存后，可把待核实的知识提交为候选；仍受会话权限与额度约束。"
    },
    "feedback": {
      "group": "知识与反馈",
      "label": "报告问题",
      "example": "例：开启并保存后，可记录失败、异常或需要修复的问题；仍受会话权限与额度约束。"
    },
    "sendVoice": {
      "group": "图片、语音与文件",
      "label": "语音库与语音发送",
      "example": "例：开启并保存后，可查询语音素材并按权限发送；仍受会话权限与额度约束。"
    },
    "sendFile": {
      "group": "图片、语音与文件",
      "label": "发送文件",
      "example": "例：开启并保存后，可在管理员权限内发送允许的本地文件；仍受会话权限与额度约束。"
    },
    "sendPoke": {
      "group": "图片、语音与文件",
      "label": "拍一拍",
      "example": "例：开启并保存后，可向允许的对象发送拍一拍；仍受会话权限与额度约束。"
    },
    "getImages": {
      "group": "图片、语音与文件",
      "label": "读取消息图片",
      "example": "例：开启并保存后，可取得真实消息所附的图片；仍受会话权限与额度约束。"
    },
    "imageGeneration": {
      "group": "图片、语音与文件",
      "label": "图片生成",
      "example": "例：开启并保存后，可按生图服务设置和额度发起生成；仍受会话权限与额度约束。"
    },
    "imageTransfer": {
      "group": "图片、语音与文件",
      "label": "图片取回与转发",
      "example": "例：开启并保存后，可在当前范围内处理已生成或暂存图片；仍受会话权限与额度约束。"
    },
    "getForwardMsg": {
      "group": "图片、语音与文件",
      "label": "合并转发内容",
      "example": "例：开启并保存后，可读取真实合并转发消息；仍受会话权限与额度约束。"
    },
    "listStickers": {
      "group": "图片、语音与文件",
      "label": "收藏表情列表",
      "example": "例：开启并保存后，可查询可用的收藏表情；仍受会话权限与额度约束。"
    },
    "getStickerImage": {
      "group": "图片、语音与文件",
      "label": "查看收藏表情",
      "example": "例：开启并保存后，可读取选定表情的图像；仍受会话权限与额度约束。"
    },
    "sendSticker": {
      "group": "图片、语音与文件",
      "label": "发送收藏表情",
      "example": "例：开启并保存后，可按发送计划发出一个表情；仍受会话权限与额度约束。"
    },
    "collectSticker": {
      "group": "图片、语音与文件",
      "label": "收藏表情",
      "example": "例：开启并保存后，可按收藏频率限制收录表情；仍受会话权限与额度约束。"
    },
    "getSelfImage": {
      "group": "图片、语音与文件",
      "label": "角色自身形象",
      "example": "例：开启并保存后，可取得允许使用的角色图像；仍受会话权限与额度约束。"
    },
    "stickerNote": {
      "group": "图片、语音与文件",
      "label": "表情含义与标签",
      "example": "例：开启并保存后，可维护表情的语境含义；仍受会话权限与额度约束。"
    },
    "setStickerRemark": {
      "group": "图片、语音与文件",
      "label": "修改表情备注",
      "example": "例：开启并保存后，可在有权限时修改收藏备注；仍受会话权限与额度约束。"
    }
  };

  // src/tools/flags.js
  var TOOL_CONFIG_FLAGS = {
    qq_status: "status",
    qq_get_prompt: "getPrompt",
    qq_get_unread_messages: "getUnread",
    qq_get_recent_messages: "getRecent",
    qq_social_state: "socialState",
    qq_mark_read: "markRead",
    qq_report_message_receipts: "reportReceipts",
    qq_set_wake_config: "setWakeConfig",
    qq_mood: "mood",
    qq_send_burst: "sendBurst",
    qq_send_message: "sendMessage",
    qq_wait_for_messages: "waitMessages",
    qq_wait_for_quiet: "waitMessages",
    qq_report_feedback: "feedback",
    qq_get_my_recent_messages: "getMyRecent",
    qq_get_message_detail: "getMessageDetail",
    qq_get_active_members: "getActiveMembers",
    qq_get_group_members: "getGroupMembers",
    qq_task_note: "taskNote",
    qq_memory_append: "memory",
    qq_memory_query: "memory",
    qq_memory_remove: "memory",
    qq_memory_clear: "memory",
    qq_schedule: "schedule",
    time_bubble_manage: "timeBubbleManage",
    qq_availability: "availability",
    qq_slang_query: "slangQuery",
    qq_slang_submit: "slangSubmit",
    qq_alias_query: "aliasQuery",
    qq_alias_submit: "aliasSubmit",
    qq_knowledge_sources: "learningSources",
    qq_term_query: "termQuery",
    qq_term_submit: "termSubmit",
    qq_send_voice: "sendVoice",
    qq_send_file: "sendFile",
    qq_list_voices: "sendVoice",
    // 下面这些曾经漏登记。漏一个不是"多注册一个工具"那么轻：桥接那边按 `v2ToolEnabled(flag)`
    // 在**调用期**一律 403，而这里不登记就等于"控制台显示已关闭、模型每次请求仍收到它的完整
    // 描述与参数 schema，然后调用它、再拿到 403"——既白烧 token（本文件开头 176 行起就是为省这份
    // token 才改注册期过滤的），又诱导模型误调。`qq_set_sticker_remark` 默认就是 `false`
    // （见 bridge.js 的 socialV2.tools 默认表），所以此前它一直是"默认关闭却仍然可见"。
    qq_send_poke: "sendPoke",
    qq_get_message_images: "getImages",
    qq_make_meme: "imageGeneration",
    qq_get_meme_job: "imageGeneration",
    qq_send_image: "imageTransfer",
    qq_list_staged_images: "imageTransfer",
    qq_import_image: "imageTransfer",
    qq_relay_image: "imageTransfer",
    qq_get_forward_msg: "getForwardMsg",
    qq_list_stickers: "listStickers",
    qq_get_sticker_image: "getStickerImage",
    qq_send_sticker: "sendSticker",
    qq_collect_sticker: "collectSticker",
    qq_get_self_image: "getSelfImage",
    qq_sticker_note: "stickerNote",
    qq_set_sticker_remark: "setStickerRemark"
  };

  // console/layers/T/tool-inventory.js
  function toolRows(tools) {
    const name = (tool) => tool.name || String(tool.qualifiedName || "").split("__").slice(2).join("__");
    return [...tools].sort((a, b) => name(a).localeCompare(name(b), "en", { sensitivity: "base", numeric: true }) || String(a.server).localeCompare(String(b.server))).map((tool) => '<div class="tool-reference-item"><code title="' + esc(tool.qualifiedName) + '">' + esc(name(tool)) + "</code><span>" + esc(tool.description) + "<br><small>" + esc(tool.server) + " · " + (tool.botInjectedSessions || 0) + " 个聊天会话有注入记录</small></span></div>").join("");
  }
  async function loadToolCatalog() {
    const root = document.getElementById("toolReferenceRoot");
    const status = document.getElementById("toolsCatalogStatus");
    try {
      const catalog = await api("/api/tools/catalog");
      if (!catalog.ok) throw Error(catalog.error || "注册表读取失败");
      const visible = catalog.tools.filter((tool) => tool.audience === "qq" && tool.registered && tool.botInjectedSessions > 0);
      const pending = catalog.tools.filter((tool) => tool.audience === "qq" && (!tool.registered || !tool.botInjectedSessions));
      const admin = catalog.tools.filter((tool) => tool.audience === "admin");
      root.innerHTML = toolRows(visible) || '<p class="meta">尚无真实请求的注入证据。</p>';
      document.getElementById("toolPendingRoot").innerHTML = toolRows(pending) || '<p class="meta">无待注入工具。</p>';
      document.getElementById("toolAdminRoot").innerHTML = toolRows(admin);
      const unexpected = admin.filter((tool) => tool.botInjectedSessions > 0);
      status.textContent = visible.length + " 个聊天工具有实际注入记录；依据会话最新 request/header。" + (catalog.stale ? " 注册定义有变化，需重新运行 audit:tools 核验。" : "") + (unexpected.length ? " 当前历史工具面仍含 " + unexpected.length + " 个管理工具；过滤修复需刷新对应 preset 后在下一轮请求核验。" : "") + (catalog.evidenceError ? " " + catalog.evidenceError : "");
      status.className = "meta" + (catalog.stale || unexpected.length ? " err" : " ok");
      return catalog;
    } catch (error) {
      root.innerHTML = '<div class="err">工具注册读取失败：' + esc(error.message) + "</div>";
      status.textContent = "未取得工具注入证据";
      return null;
    }
  }
  async function renderToolInventory(pluginsReady) {
    const groups = /* @__PURE__ */ new Map();
    for (const [name, flag] of Object.entries(TOOL_CONFIG_FLAGS)) {
      if (!groups.has(flag)) groups.set(flag, []);
      groups.get(flag).push(name);
    }
    const root = document.getElementById("v2Tools");
    const sections = /* @__PURE__ */ new Map();
    for (const [flag, names2] of groups) {
      const view = TOOL_PRESENTATION[flag] || { group: "其他能力", label: names2.join(" / "), example: "调整后需保存，并刷新对应MCP工具清单。" };
      if (!sections.has(view.group)) sections.set(view.group, []);
      sections.get(view.group).push({ flag, names: names2, ...view });
    }
    root.dataset.loaded = "0";
    root.innerHTML = [...sections].map(([title, items2]) => '<details class="tool-parameter-group tool-switch-group" data-tool-group="' + esc(title) + '"><summary><span>' + esc(title) + '</span><small class="meta" data-tool-group-count></small></summary><div class="tool-parameter-options">' + items2.map(({ flag, names: names2, label: label2, example }) => '<label class="v2-tool-item"><input type="checkbox" disabled data-v2-tool="' + esc(flag) + '"><span><b>' + esc(label2) + '</b><small class="meta tool-call-names">' + esc(names2.join(" / ")) + '</small><small class="parameter-example">' + esc(example) + "</small></span></label>").join("") + "</div></details>").join("");
    const save2 = document.querySelector("#section-v2-t .v2-save"), status = document.getElementById("toolSwitchStatus"), retry = document.getElementById("toolSwitchRetry");
    save2.disabled = true;
    const updateCounts = () => root.querySelectorAll(".tool-parameter-group").forEach((group) => {
      const all = group.querySelectorAll('.v2-tool-item input[type="checkbox"]');
      group.querySelector("[data-tool-group-count]").textContent = root.dataset.loaded === "1" ? "已启用 " + [...all].filter((x) => x.checked).length + " / " + all.length : all.length + " 项 · 读取中";
    });
    updateCounts();
    root.onchange = updateCounts;
    const loadConfig = async () => {
      status.textContent = "读取开关状态…";
      retry.hidden = true;
      try {
        const out = await api("/api/socialV2/config");
        if (out.ok !== true || !out.config || typeof out.config !== "object") throw Error(out.error || "未取得当前配置");
        root.querySelectorAll("[data-v2-tool]").forEach((input) => {
          input.checked = out.config.tools?.[input.dataset.v2Tool] !== false;
          input.disabled = false;
        });
        root.dataset.loaded = "1";
        save2.disabled = false;
        status.textContent = "";
        updateCounts();
      } catch (error) {
        status.textContent = "开关读取失败：" + error.message;
        retry.hidden = false;
      }
    };
    retry.onclick = loadConfig;
    document.getElementById("toolsCatalogRefresh").onclick = loadToolCatalog;
    registerPageLoader("reference", loadToolCatalog);
    const configReady = loadConfig();
    const balanceReady = Promise.resolve(pluginsReady || api("/api/plugins")).then((data2) => {
      const balance = data2.plugins?.find((p) => p.id === "tool-deepseek-balance");
      if (!balance) return;
      const row = document.createElement("div");
      row.id = "balanceToolControl";
      row.dataset.componentId = balance.id;
      row.innerHTML = '<label class="v2-tool-item"><input type="checkbox" id="balanceToolEnabled"' + (balance.enabled ? " checked" : "") + '><span><b>DeepSeek 余额查询</b><small class="meta">管理员私聊只读查询；开关即时生效。</small></span></label><span class="meta" role="status"></span>';
      root.querySelector('[data-tool-group="读取与状态"] .tool-parameter-options').append(row);
      updateCounts();
      row.querySelector("input").addEventListener("change", async (event) => {
        const input = event.target, previous = !input.checked, msg = row.querySelector("[role=status]");
        input.disabled = true;
        try {
          const out = await api("/api/plugins/toggle", "POST", { id: balance.id, enabled: input.checked });
          if (out.ok !== true) throw Error(out.error || "更新失败");
          msg.textContent = input.checked ? "已启用" : "已停用";
        } catch (error) {
          input.checked = previous;
          msg.textContent = "更新失败：" + error.message;
        } finally {
          input.disabled = false;
          updateCounts();
        }
      });
    }).catch((error) => {
      status.textContent = "组件工具状态读取失败：" + error.message;
    });
    await Promise.all([configReady, balanceReady]);
  }

  // console/shared/component-renderer.js
  function initialize48() {
    const pluginsReady = api("/api/plugins");
    void renderToolInventory(pluginsReady).catch((error) => {
      document.getElementById("toolSwitchStatus").textContent = "工具开关加载失败：" + error.message;
    });
    (() => {
      const COMP_LAYERS = [
        { id: "C", name: "上下文与记忆" },
        { id: "T", name: "工具接口与协议" },
        { id: "E", name: "环境与执行" },
        { id: "L", name: "生命周期与编排" },
        { id: "O", name: "可观测与运维" },
        { id: "V", name: "验证与评估" },
        { id: "G", name: "治理与安全" },
        { id: "S", name: "个人思想与知识" },
        { id: "", name: "组件注册中心" }
      ];
      let compCache = [];
      componentUI.renderLayer = async (layerId, rootOrId) => {
        if (!compCache.length) {
          const d = await api("/api/plugins");
          compCache = d.plugins || [];
        }
        const root = typeof rootOrId === "string" ? document.getElementById(rootOrId) : rootOrId;
        if (!root) return;
        const items2 = compCache.filter((p) => !isInternalPromptComponent(p) && (p.layer || "") === layerId && !(layerId === "V" && p.id === "human"));
        root.innerHTML = items2.length ? items2.map((p) => `<details class="comp-card" open data-id="${esc(p.id)}"><summary><b>${esc(p.name)}</b><span class="meta">${esc(p.id)} v${esc(p.version || "0")}</span></summary><div class="meta">${esc(p.description)}</div><div class="comp-body">加载详情…</div></details>`).join("") : '<p class="meta">当前没有可配置功能。</p>';
        root.querySelectorAll("details.comp-card").forEach((d) => {
          loadComponentDetail(d.dataset.id, d);
          d.addEventListener("toggle", () => {
            if (d.open) loadComponentDetail(d.dataset.id, d);
          });
        });
      };
      componentUI.renderIds = async (ids, rootOrId) => {
        if (!compCache.length) {
          const d = await api("/api/plugins");
          compCache = d.plugins || [];
        }
        const root = typeof rootOrId === "string" ? document.getElementById(rootOrId) : rootOrId;
        if (!root) return;
        const items2 = compCache.filter((p) => !isInternalPromptComponent(p) && (ids || []).includes(p.id));
        root.innerHTML = items2.length ? items2.map((p) => `<div class="comp-card" data-id="${esc(p.id)}" data-hide-toggle="${root.dataset.hideToggle === "1" || ["ctx-memory-profile-store", "life-campus-watch", "exec-image-generation"].includes(p.id) ? "1" : "0"}" data-save-label="${esc(root.dataset.saveLabel || "")}" data-toggle-label="${p.id === "exec-browser-manager" ? "启用 DOM 操作" : esc(p.name)}" data-inline-fields="${esc(root.dataset.fields || "")}"><div class="comp-body">加载设置…</div></div>`).join("") : "";
        await Promise.all([...root.querySelectorAll(".comp-card")].map((d) => loadComponentDetail(d.dataset.id, d)));
      };
      componentUI.loadMessageAck = async () => {
        const root = document.getElementById("messageAckComponentRoot");
        if (!root || root.dataset.loaded === "1" || root.dataset.loading === "1") return;
        root.dataset.loading = "1";
        try {
          compCache = (await api("/api/plugins")).plugins || [];
          await componentUI.renderIds(["life-message-ack"], root);
          if (!root.children.length) throw Error("未找到 life-message-ack 组件，请确认桥接已加载该组件");
          if (root.querySelector(".comp-body")?.dataset.loaded !== "1") throw Error("组件参数读取失败");
          root.dataset.loaded = "1";
        } catch (error) {
          root.innerHTML = '<div class="meta">读取组件失败：' + esc(error.message) + ' <button class="small" type="button" data-retry-message-ack>重试</button></div>';
          root.querySelector("[data-retry-message-ack]")?.addEventListener("click", () => {
            root.dataset.loaded = "";
            void componentUI.loadMessageAck();
          });
        } finally {
          root.dataset.loading = "";
        }
      };
      componentUI.mount = async () => {
        const data2 = await pluginsReady;
        compCache = data2.plugins || [];
        const inlineSettings = [
          ["life-proactive-time-bubble", "v2TimeBubbleAdd", "maxBubblesPerDay"],
          ["life-schedule-reminder", "v2ScheduleRefresh", "enabled,advanceMinutes,intervalMinutes,lateMinutes,horizonDays,maxItems,maxPromptItems"],
          ["ctx-media-sticker-pick", "v2StickerEnabled"],
          ["ctx-memory-profile-facts", "v2PmEnabled"],
          ["ctx-memory-context", "v2ContextRecentLimit", "maxChars"],
          ["ctx-chat-topic-drive", "v2FollowupGlobalAnchor", "privateFollowupEnabled,minIntervalMinutes,dailyLimit,followUpCooldownMinutes,newTopicCooldownMinutes,newTopicMaxPerHour,followupWeight,newTopicWeight"]
        ];
        const mergedIds = /* @__PURE__ */ new Set();
        for (const [id, anchorId, fields] of inlineSettings) {
          const anchor = document.getElementById(anchorId);
          const target = anchor?.closest(".settings-content") || anchor?.closest(".card");
          if (!target || !compCache.some((p) => p.id === id)) continue;
          const slot = document.createElement("div");
          slot.className = "inline-component-settings";
          slot.dataset.componentId = id;
          mergedIds.add(id);
          slot.dataset.hideToggle = "1";
          if (target.closest('section[data-page^="setting-"]') && target.closest("section").dataset.page !== "setting-l-2") slot.dataset.deferSave = "1";
          if (fields) slot.dataset.inlineFields = fields;
          slot.innerHTML = '<div class="comp-body">读取设置中…</div>';
          const sessionEditor = id === "ctx-chat-topic-drive" ? document.getElementById("v2FollowupSessionEditor") : null;
          if (sessionEditor && sessionEditor.parentElement === target) target.insertBefore(slot, sessionEditor);
          else target.append(slot);
          loadComponentDetail(id, slot);
        }
        const main = document.getElementById("mainContent");
        const grid = main.querySelector(":scope > .grid");
        for (const slot of main.querySelectorAll("[data-component-slot]")) {
          const id = slot.dataset.componentSlot;
          if (!compCache.some((p) => p.id === id)) continue;
          slot.dataset.componentId = id;
          slot.classList.add("owned-component");
          slot.innerHTML = '<div class="comp-body">读取设置中…</div>';
          mergedIds.add(id);
          await loadComponentDetail(id, slot);
        }
        for (const p of compCache) {
          if (isInternalPromptComponent(p)) continue;
          if ([...document.querySelectorAll(".env-comp-root[data-ids]")].some((root) => (root.dataset.ids || "").split(",").includes(p.id))) continue;
          if (mergedIds.has(p.id)) continue;
          const dedicated = COMPONENT_OWNERS[p.id]?.selector;
          const dedicatedRoot = dedicated && document.querySelector(dedicated);
          if (dedicatedRoot) {
            dedicatedRoot.dataset.componentId = p.id;
            continue;
          }
          if (p.layer === "V" || p.layer === "S") continue;
          const page = componentPage(p);
          if (!page) continue;
          const section2 = document.createElement("section");
          section2.className = "card span-all commercial-component";
          section2.dataset.page = page;
          section2.dataset.componentId = p.id;
          section2.hidden = currentConsolePage !== page;
          section2.innerHTML = '<div class="component-heading"><div><h2>' + esc(p.name) + '</h2><p class="meta">' + esc(p.description || "此功能没有额外说明。") + "</p></div></div>" + ((p.tools || []).length && p.id !== "ctx-memory-profile-store" ? '<div class="tool-reference-list">' + p.tools.map((t) => '<div class="tool-reference-item"><code>' + esc(t.name) + "</code><span>" + esc(t.description || "由 AI 按需使用") + "</span></div>").join("") + "</div>" : "") + '<div class="comp-body">读取设置中…</div>';
          const pageAnchor = page === "setting-c-2" ? grid.querySelector('section[data-page="setting-c-2"]') : null;
          if (pageAnchor) pageAnchor.before(section2);
          else grid.append(section2);
          featureIndex.push({ page, label: p.name, target: section2 });
          loadComponentDetail(p.id, section2);
        }
      };
      componentUI.mount().catch((error) => {
        document.getElementById("statusText").title = "功能导航读取失败：" + error.message;
      });
    })();
  }

  // console/layers/R/registry.js
  function initialize49() {
    (() => {
      async function loadRegistry() {
        const root = document.getElementById("registryRoot");
        const status = document.getElementById("registryStatus");
        if (!root) return;
        root.innerHTML = '<div class="meta">读取中…</div>';
        try {
          const data2 = await api("/api/plugins");
          const userPlugins = (data2.plugins || []).filter((p) => p.builtin === false);
          if (!userPlugins.length) {
            root.innerHTML = '<div class="meta">（空）没有第三方项目。把项目放进 <code>plugins/qq-components-user/&lt;id&gt;/</code>（至少带 plugin.json），刷新后就会出现在这里。</div>';
            if (status) status.textContent = "0 个待管理化";
            return;
          }
          const html = userPlugins.map((p) => {
            const harnessed = !!p.layer;
            return '<div class="comp-card"><div class="comp-layer-head"><b>' + esc(p.name) + '</b><span class="meta">' + esc(p.id) + " v" + esc(p.version || "0") + '</span><span class="pill ' + (harnessed ? "on" : "off") + '">' + (harnessed ? "已管理化 · " + esc(p.layer) : "未管理化") + '</span></div><div class="meta">' + esc(p.description) + '</div><div class="row" style="gap:8px;margin-top:6px"><button class="small harnessify" data-id="' + esc(p.id) + '">接入控制台</button><span class="meta harness-msg"></span></div></div>';
          }).join("");
          root.innerHTML = html;
          if (status) status.textContent = userPlugins.length + " 个第三方项目";
          root.querySelectorAll(".harnessify").forEach((b) => b.addEventListener("click", async () => {
            const msg = b.parentElement.querySelector(".harness-msg");
            msg.textContent = "正在接入控制台…";
            try {
              const r = await api("/api/plugins/harnessify", "POST", { id: b.dataset.id });
              msg.textContent = "完成：" + (r.message || "已归入对应层");
              loadRegistry();
            } catch (e) {
              msg.textContent = "后端待接入（桥接重启后可用）：" + e.message;
            }
          }));
        } catch (e) {
          root.innerHTML = '<div class="err">读取失败：' + esc(e.message) + "</div>";
          if (status) status.textContent = "读取失败";
        }
      }
      registerPageLoader("registry", loadRegistry);
      document.getElementById("registryRefresh").addEventListener("click", loadRegistry);
    })();
  }

  // console/layers/C/aliases.js
  function initialize50() {
    (() => {
      const message2 = document.getElementById("aliasMsg");
      let rows = [], active = "candidate", selected2 = /* @__PURE__ */ new Set();
      const statusLabel = { candidate: "待判断", confirmed: "已确认", rejected: "已拒绝" };
      function search() {
        const suffix = active === "candidate" ? "Cand" : active[0].toUpperCase() + active.slice(1);
        return document.getElementById("aliasSearch" + suffix).value.trim().toLowerCase();
      }
      function openEditor(entry) {
        document.getElementById("aliasSourceKeys").value = sourceKeysText(entry);
        document.getElementById("aliasEditId").value = entry.id;
        document.getElementById("aliasModalName").value = entry.alias || "";
        document.getElementById("aliasModalQq").value = entry.qq || "";
        document.getElementById("aliasModalNote").value = entry.note || entry.reason || "";
        document.getElementById("aliasModalTitle").textContent = entry.status === "candidate" ? "审核绰号：" + entry.alias : "编辑绰号：" + entry.alias;
        document.getElementById("aliasModalContent").textContent = (entry.targetName ? "被称呼者线索：" + entry.targetName + " · " : "") + ("最初采集：" + (entry.originKey || "手动录入"));
        document.getElementById("aliasModalEvidence").innerHTML = learningEvidence(entry.evidence);
        document.getElementById("aliasModalConfirm").textContent = entry.status === "candidate" ? "确认映射" : "保存修改";
        document.getElementById("aliasModalReject").style.display = entry.status === "candidate" ? "" : "none";
        document.getElementById("aliasModalOverlay").classList.add("open");
      }
      function render2() {
        const suffix = active === "candidate" ? "Cand" : active[0].toUpperCase() + active.slice(1), target = document.getElementById("alias" + active[0].toUpperCase() + active.slice(1) + "List"), q = search(), limit = Number(document.getElementById("aliasLimit" + suffix).value) || 100;
        const list = rows.filter((x) => x.status === active), filtered = list.filter((x) => !q || [x.alias, x.qq, x.note, x.reason, x.targetName, (x.sourceKeys || []).join(" "), ...(x.evidence || []).map((y) => y.text)].join(" ").toLowerCase().includes(q)), shown = filtered.slice(0, limit);
        if (!shown.length) {
          target.innerHTML = '<div class="meta" style="padding:8px">' + (list.length ? "没有符合条件的绰号" : active === "candidate" ? "暂无候选；可刷新近期群消息或手动添加" : "暂无" + statusLabel[active] + "绰号") + "</div>";
          return;
        }
        let html = '<div class="meta" style="padding:6px 8px">共 ' + filtered.length + " 条，显示 " + shown.length + " 条</div><table><tr><th>选择</th><th>绰号</th><th>被称呼者</th><th>对应 QQ</th><th>适用会话 / 语境证据</th><th>备注</th><th>操作</th></tr>";
        for (const e of shown) {
          const actions = active === "candidate" ? '<button class="small" data-alias-edit="' + esc(e.id) + '">查看 / 编辑</button><button class="small primary" data-alias-confirm="' + esc(e.id) + '">确认</button><details class="compact-actions"><summary>更多</summary><div class="compact-actions-menu"><button class="small" data-alias-reject="' + esc(e.id) + '">拒绝</button></div></details>' : active === "confirmed" ? '<button class="small" data-alias-edit="' + esc(e.id) + '">编辑</button><button class="small danger" data-alias-delete="' + esc(e.id) + '">删除</button>' : '<span class="meta">已记入拒绝记录</span>';
          html += '<tr data-alias-id="' + esc(e.id) + '"><td>' + (active !== "rejected" ? '<input type="checkbox" data-alias-select="' + esc(e.id) + '" ' + (selected2.has(e.id) ? "checked" : "") + ">" : "—") + "</td><td><b>" + esc(e.alias) + '</b><br><span class="' + (active === "candidate" ? "pill b" : active === "confirmed" ? "pill g" : "pill r") + '">' + statusLabel[active] + "</span></td><td>" + esc(e.targetName || "—") + "</td><td>" + esc(e.qq || "未绑定") + "</td><td>" + sourceKeysMarkup(e) + (e.evidence?.length ? "<br>" + learningEvidence(e.evidence) : "") + "</td><td>" + esc(e.note || e.reason || "—") + '</td><td class="row">' + actions + "</td></tr>";
        }
        target.innerHTML = html + "</table>";
        target.querySelectorAll("[data-alias-select]").forEach((cb) => cb.addEventListener("change", () => {
          cb.checked ? selected2.add(cb.dataset.aliasSelect) : selected2.delete(cb.dataset.aliasSelect);
        }));
        target.querySelectorAll("[data-alias-edit],[data-alias-confirm]").forEach((button) => button.addEventListener("click", () => openEditor(rows.find((x) => x.id === (button.dataset.aliasEdit || button.dataset.aliasConfirm)))));
        target.querySelectorAll("[data-alias-reject],[data-alias-delete]").forEach((button) => button.addEventListener("click", async () => {
          try {
            await learningCall("alias_reject", { id: button.dataset.aliasReject || button.dataset.aliasDelete });
            message2.textContent = "已处理此条绰号";
            await loadAliases();
          } catch (e) {
            message2.textContent = e.message;
          }
        }));
      }
      const loadAliases = async () => {
        if (!document.getElementById("aliasCandidateList")) return;
        try {
          const [data2, detail] = await Promise.all([learningCall("alias_list"), api("/api/plugins/detail?id=ctx-member-alias")]);
          const config = (detail.plugin || detail).config || {};
          document.getElementById("aliasAutoExtract").checked = config.autoExtract !== false;
          document.getElementById("aliasAutoSemantic").checked = config.autoSemantic !== false;
          document.getElementById("aliasMinMessages").value = config.minMessages ?? 15;
          document.getElementById("aliasCooldown").value = Number(config.cooldownMs ?? 18e5) / 6e4;
          document.getElementById("aliasMaxCalls").value = config.maxCallsPerHour ?? 4;
          document.getElementById("aliasInjectMax").value = config.injectMax ?? 40;
          rows = [...data2.entries || [], ...data2.rejected || []];
          render2();
        } catch (e) {
          document.getElementById("aliasCandidateList").innerHTML = '<span class="err">读取失败：' + esc(e.message) + "</span>";
        }
      };
      document.querySelectorAll("#aliasTabs [data-alias-tab]").forEach((button) => button.addEventListener("click", () => {
        active = button.dataset.aliasTab;
        document.querySelectorAll("#aliasTabs [data-alias-tab]").forEach((x) => x.classList.toggle("active", x === button));
        document.querySelectorAll("#section-alias .alias-panel").forEach((panel) => panel.classList.toggle("active", panel.id === "aliasPanel" + active[0].toUpperCase() + active.slice(1)));
        render2();
      }));
      for (const status of ["candidate", "confirmed", "rejected"]) {
        const suffix = status === "candidate" ? "Cand" : status[0].toUpperCase() + status.slice(1);
        document.getElementById("aliasSearch" + suffix).addEventListener("input", render2);
        document.getElementById("aliasLimit" + suffix).addEventListener("change", render2);
      }
      for (const status of ["candidate", "confirmed"]) document.getElementById("alias" + status[0].toUpperCase() + status.slice(1) + "SelectAll").addEventListener("change", (event) => {
        for (const e of rows.filter((x) => x.status === status)) {
          if (event.target.checked) selected2.add(e.id);
          else selected2.delete(e.id);
        }
        render2();
      });
      document.getElementById("aliasRejectSelected").addEventListener("click", async () => {
        for (const id of selected2) {
          const e = rows.find((x) => x.id === id);
          if (e?.status === "candidate") try {
            await learningCall("alias_reject", { id });
          } catch (error) {
            message2.textContent = error.message;
          }
        }
        selected2.clear();
        await loadAliases();
      });
      document.getElementById("aliasConfirmSelected").addEventListener("click", async () => {
        let confirmed = 0, skipped = 0;
        for (const id of selected2) {
          const e = rows.find((x) => x.id === id);
          if (e?.status !== "candidate") continue;
          if (!/^\d{5,12}$/.test(String(e.qq || ""))) {
            skipped++;
            continue;
          }
          try {
            await requireLearningScopes();
            await learningCall("alias_confirm", { id: e.id, alias: e.alias, qq: e.qq, note: e.note || "" });
            confirmed++;
          } catch {
            skipped++;
          }
        }
        selected2.clear();
        message2.textContent = "批量确认 " + confirmed + " 条；" + skipped + " 条缺少有效 QQ 或确认失败，请单独编辑。";
        await loadAliases();
      });
      document.getElementById("aliasDeleteSelected").addEventListener("click", async () => {
        for (const id of selected2) {
          const e = rows.find((x) => x.id === id);
          if (e?.status === "confirmed") try {
            await learningCall("alias_reject", { id });
          } catch (error) {
            message2.textContent = error.message;
          }
        }
        selected2.clear();
        await loadAliases();
      });
      document.getElementById("aliasAutoExtract").addEventListener("change", async (event) => {
        const input = event.currentTarget, previous = !input.checked, msg = document.getElementById("aliasAutoExtractMsg");
        try {
          const out = await api("/api/plugins/detail?id=ctx-member-alias");
          await api("/api/plugins/config", "POST", { id: "ctx-member-alias", config: { ...(out.plugin || out).config, autoExtract: input.checked } });
          msg.textContent = input.checked ? "已启用候选收集" : "已停止自动收集；确认的绰号仍可查询";
        } catch (e) {
          input.checked = previous;
          msg.textContent = "保存失败：" + e.message;
        }
      });
      document.getElementById("aliasConfigSave").addEventListener("click", async (event) => {
        const button = event.currentTarget, msg = document.getElementById("aliasConfigMsg");
        const minMessages = Number(document.getElementById("aliasMinMessages").value), cooldownMinutes = Number(document.getElementById("aliasCooldown").value), maxCallsPerHour = Number(document.getElementById("aliasMaxCalls").value);
        if (!Number.isSafeInteger(minMessages) || minMessages < 1 || !Number.isSafeInteger(cooldownMinutes) || cooldownMinutes < 1 || !Number.isSafeInteger(maxCallsPerHour) || maxCallsPerHour < 1 || maxCallsPerHour > 12) {
          msg.textContent = "消息数、冷却分钟需为正整数；每小时次数需为 1–12。";
          msg.className = "meta err";
          return;
        }
        button.disabled = true;
        msg.textContent = "正在保存…";
        try {
          await requireLearningScopes();
          const latest = await api("/api/plugins/detail?id=ctx-member-alias");
          const config = { ...(latest.plugin || latest).config || {}, autoExtract: document.getElementById("aliasAutoExtract").checked, autoSemantic: document.getElementById("aliasAutoSemantic").checked, minMessages, cooldownMs: cooldownMinutes * 6e4, maxCallsPerHour, injectMax: Number(document.getElementById("aliasInjectMax").value) };
          const result = await api("/api/plugins/config", "POST", { id: "ctx-member-alias", config });
          if (result.ok !== true) throw Error(result.error || "保存失败");
          msg.textContent = "已保存学习设置";
          msg.className = "meta ok";
        } catch (error) {
          msg.textContent = "保存失败：" + error.message;
          msg.className = "meta err";
        } finally {
          button.disabled = false;
        }
      });
      document.getElementById("aliasAdd").addEventListener("click", async () => {
        try {
          await requireLearningScopes();
          const result = await learningCall("alias_add", { alias: document.getElementById("aliasName").value, qq: document.getElementById("aliasQq").value, note: document.getElementById("aliasNote").value, sourceKeys: readSourceKeys("aliasManualSourceKeys") });
          message2.textContent = result.ok ? "已添加；不会覆盖该用户其他绰号" : "保存失败";
          await loadAliases();
        } catch (e) {
          message2.textContent = e.message;
        }
      });
      document.getElementById("aliasRefreshCandidates").addEventListener("click", async (event) => {
        const button = event.currentTarget;
        button.disabled = true;
        message2.textContent = "正在补扫近期群消息并筛选一个高置信度绰号候选……";
        try {
          const r = await learningCall("alias_refresh");
          message2.textContent = "刷新完成：扫描 " + (r.scanned || 0) + " 条消息，新增 " + (r.processed || 0) + " 条候选证据；结果仍需管理员审核。";
          await loadAliases();
        } catch (e) {
          message2.textContent = e.message;
        } finally {
          button.disabled = false;
        }
      });
      document.getElementById("aliasModalConfirm").addEventListener("click", async () => {
        const id = document.getElementById("aliasEditId").value, entry = rows.find((x) => x.id === id);
        if (!entry) return;
        try {
          await learningCall("alias_confirm", { id, alias: document.getElementById("aliasModalName").value, qq: document.getElementById("aliasModalQq").value, note: document.getElementById("aliasModalNote").value, sourceKeys: readSourceKeys("aliasSourceKeys") });
          message2.textContent = "已确认并保存；同一用户的其他绰号保留";
          document.getElementById("aliasModalOverlay").classList.remove("open");
          await loadAliases();
        } catch (e) {
          document.getElementById("aliasModalContent").textContent = e.message;
        }
      });
      document.getElementById("aliasModalReject").addEventListener("click", async () => {
        const id = document.getElementById("aliasEditId").value;
        try {
          await learningCall("alias_reject", { id });
          document.getElementById("aliasModalOverlay").classList.remove("open");
          message2.textContent = "已拒绝此条绰号";
          await loadAliases();
        } catch (e) {
          document.getElementById("aliasModalContent").textContent = e.message;
        }
      });
      document.getElementById("aliasModalCancel").addEventListener("click", () => document.getElementById("aliasModalOverlay").classList.remove("open"));
      document.getElementById("aliasModalOverlay").addEventListener("click", (event) => {
        if (event.target.id === "aliasModalOverlay") event.currentTarget.classList.remove("open");
      });
      registerPageLoader("alias", loadAliases);
    })();
  }

  // console/layers/E/monitor-status.js
  var states = /* @__PURE__ */ new Set(["green", "red", "stable", "changed", "baseline", "pending", "none", "unknown", "sent"]);
  var names = { fetch: { green: "读取正常", red: "读取失败", unknown: "待检查" }, auth: { green: "访问正常", red: "需要登录", unknown: "待确认" }, diff: { green: "暂无变化", stable: "暂无变化", changed: "发现更新", baseline: "已记录初始内容", red: "对比失败", unknown: "待对比" }, delivery: { green: "已发送", sent: "已发送", red: "发送失败", pending: "等待发送", none: "暂无待发送", unknown: "尚无发送记录" } };
  var oneLine = (value2) => String(value2 || "").replace(/\s+/g, " ").trim();
  function siteStatusMarkup(sites = []) {
    if (!sites.length) return '<p class="meta">尚未添加监控网址，可在上方填写。</p>';
    return sites.map((site) => {
      const health = site.health || {}, raw = String(site.url || "");
      let url = "";
      try {
        const parsed = new URL(raw);
        if (["http:", "https:"].includes(parsed.protocol) && !parsed.username && !parsed.password) url = parsed.href;
      } catch {
      }
      const at = Number(health.checkedAt), date = at > 0 ? new Date(at) : null;
      const time3 = date && !Number.isNaN(date.getTime()) ? new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(date) : "尚未检查";
      const rows = [["fetch", "读取"], ["auth", "访问／登录"], ["diff", "内容变化"], ["delivery", "通知发送"]].map(([key2, label2]) => {
        const state = states.has(health[key2]) ? health[key2] : "unknown";
        return '<div class="watch-state"><dt>' + label2 + '</dt><dd class="watch-value ' + state + '">' + esc(names[key2][state] || names[key2].unknown) + "</dd></div>";
      }).join("");
      const hint = oneLine(health.hint), showHint = hint && !/^(页面可读取|页面读取正常|访问正常|无变化)$/.test(hint);
      return '<article class="watch-site"><div class="watch-site-heading"><h4>' + esc(site.name || "未命名网页") + '</h4><span class="watch-check-time">' + esc(time3) + "</span></div>" + (url ? '<a class="watch-site-url" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(raw) + "</a>" : '<span class="watch-site-url">' + esc(raw) + "</span>") + '<dl class="watch-state-grid">' + rows + "</dl>" + (showHint ? '<p class="watch-note">' + esc(hint) + "</p>" : "") + "</article>";
    }).join("");
  }
  function fillScriptDescriptions(root, scripts = []) {
    if (!root) return;
    const normalize = (value2) => String(value2 || "").trim().replace(/\\/g, "/"), byPath = new Map(scripts.map((s) => [normalize(s.path), s]));
    for (const row of root.querySelectorAll(".comp-item")) {
      const input = row.querySelector(".comp-item-val");
      if (!input) continue;
      const script = byPath.get(normalize(input.value)), state = script?.health || "unknown";
      const status = { green: "运行正常", red: "运行失败", paused: "已暂停", stale: "心跳过期", fallback: "备用流程正常", unknown: "暂无心跳" }[state] || "暂无心跳";
      const description = oneLine(script?.description) || "执行与搜索约定尚未记录，由开发者与 AI 确定";
      const text = status + " · " + description;
      let line = row.querySelector(".script-brief");
      if (!line) {
        line = document.createElement("small");
        line.className = "script-brief";
        row.append(line);
      }
      line.textContent = text;
      line.title = text;
      line.setAttribute("aria-label", text);
    }
  }

  // console/layers/E/environment-components.js
  function initialize51() {
    (() => {
      let lastScripts = [];
      const loadEnvironmentPage = async (page) => {
        if (!componentUI.renderIds) return;
        await Promise.all([...document.querySelectorAll('section[data-page="' + page + '"] .env-comp-root')].map((root) => {
          const ids = (root.dataset.ids || "").split(",").map((s) => s.trim()).filter(Boolean);
          return componentUI.renderIds(ids, root.id);
        }));
        if (["environment-watch", "environment-scripts"].includes(page)) void loadStatus();
      };
      const loadStatus = () => {
        const status = document.getElementById("envMonitorStatus");
        const scriptStatus = document.getElementById("envScriptStatus");
        if (!status) return;
        api("/api/plugins/call", "POST", { tool: "campus_watch_status", input: {} }).then((response) => {
          const result = response.result || {};
          if (response.ok !== true || result.ok !== true) throw Error(result.error || "状态读取失败");
          status.innerHTML = siteStatusMarkup(result.sites || []);
          lastScripts = result.scripts || [];
          fillScriptDescriptions(document.getElementById("envCompScript"), lastScripts);
          if (scriptStatus) scriptStatus.textContent = lastScripts.length ? "" : "尚未登记协同脚本，可在上方添加地址。";
        }).catch((error) => {
          status.textContent = "读取监控状态失败：" + error.message;
          if (scriptStatus) scriptStatus.textContent = "读取脚本状态失败：" + error.message;
        });
      };
      for (const page of ["environment-chat", "environment-admin", "environment-web", "environment-watch", "environment-scripts", "images"]) registerPageLoader(page, () => loadEnvironmentPage(page));
      document.getElementById("envStatusRefresh").addEventListener("click", loadStatus);
      document.getElementById("envMonitorRefresh").addEventListener("click", loadStatus);
      document.getElementById("envCompScript").addEventListener("input", () => fillScriptDescriptions(document.getElementById("envCompScript"), lastScripts));
      document.getElementById("envCompScript").addEventListener("component-config-saved", loadStatus);
      setInterval(() => {
        if (document.visibilityState === "visible" && ["section-environment-watch", "section-environment-scripts"].some((id) => !document.getElementById(id).hidden)) loadStatus();
      }, 3e4);
    })();
  }

  // console/layers/L/availability.js
  function initialize52() {
    (() => {
      const fmtMin = (mins) => {
        const m = Math.max(0, Math.min(1439, Math.round(Number(mins) || 0)));
        return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
      };
      const fmtIso = (ms) => {
        const n = Number(ms);
        if (!Number.isFinite(n) || n <= 0) return "—";
        return new Date(n).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
      };
      const KIND = { daily: "每天固定", quiet: "一次性免打扰", later: "稍后联系", indefinite: "无限期免打扰" };
      const DONE = { expired: "已过期", cancelled: "已取消", dispatched: "已派发", triggered: "已触发" };
      const typeLabel = (p) => p.kind === "quiet" && p.indefinite ? "无限期免打扰" : KIND[p.kind] || p.kind || "—";
      const section2 = document.getElementById("availabilityRefresh")?.closest("details.settings-group");
      const windowLabel = (p) => {
        if (p.kind === "daily") {
          const ws = Array.isArray(p.windows) ? p.windows : Number.isFinite(p.start) ? [{ start: p.start, end: p.end }] : [];
          return ws.map((w) => fmtMin(w.start) + " – " + fmtMin(w.end)).join("、") || "—";
        }
        if (p.indefinite) return "直到用户再次直接找来";
        if (p.kind === "later") return "至 " + fmtIso(p.end);
        return fmtIso(p.start) + " ~ " + (p.end ? fmtIso(p.end) : "∞");
      };
      const loadAvailability = async () => {
        const root = document.getElementById("availabilityRoot");
        const status = document.getElementById("availabilityStatus");
        if (!root) return;
        root.innerHTML = '<div class="meta">加载中…</div>';
        try {
          const d = await api("/api/plugins/detail?id=life-user-availability");
          const plans = d.plugin && d.plugin.state && d.plugin.state.plans || {};
          const keys = Object.keys(plans);
          if (status) status.textContent = keys.length + " 条计划";
          if (!keys.length) {
            root.innerHTML = '<div class="meta">（空）当前没有登记任何免打扰 / 稍后联系时段。</div>';
            return;
          }
          const rows = keys.map((k) => {
            const p = plans[k] || {};
            const st = p.finished ? DONE[p.finished] || p.finished : "生效中";
            return "<tr><td>" + esc(k) + "</td><td>" + esc(typeLabel(p)) + "</td><td>" + esc(windowLabel(p)) + "</td><td>" + esc(st) + "</td></tr>";
          }).join("");
          root.innerHTML = "<table><tr><th>会话</th><th>类型</th><th>时段</th><th>状态</th></tr>" + rows + "</table>";
        } catch (e) {
          root.innerHTML = '<div class="err">读取失败：' + esc(e.message) + "</div>";
          if (status) status.textContent = "读取失败";
        }
      };
      document.getElementById("availabilityRefresh").addEventListener("click", () => loadAvailability());
      if (section2) section2.addEventListener("toggle", () => {
        if (section2.open) loadAvailability();
      });
      if (section2?.open) loadAvailability();
      registerPageLoader("setting-l-0", loadAvailability);
    })();
  }

  // console/app.js
  initialize();
  initialize3();
  initialize4();
  initialize12();
  initialize23();
  initialize13();
  initialize24();
  initialize25();
  initialize14();
  initialize26();
  initialize27();
  initialize28();
  initialize15();
  initialize30();
  initialize31();
  initialize7();
  initialize32();
  initialize33();
  initialize29();
  initialize34();
  initialize35();
  initialize36();
  initialize37();
  initialize38();
  initialize39();
  initialize40();
  initialize16();
  initialize41();
  initialize42();
  initialize43();
  initialize17();
  initialize18();
  initialize22();
  initialize19();
  initialize20();
  initialize21();
  initialize44();
  initialize45();
  initialize46();
  initialize47();
  initialize48();
  initialize49();
  initialize5();
  initialize50();
  initialize51();
  initialize52();
  initialize10();
  initialize11();
  initialize9();
  initialize8();
  initialize6();
  initialize2();
})();
