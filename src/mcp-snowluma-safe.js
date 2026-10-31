import { TOOL_CONFIG_FLAGS } from './tools/flags.js';
// 安全版 QQ MCP server（stdio）。由 DSH 的 MCP 客户端 spawn。
//
// 安全设计：
// - 只暴露聊天所需的**安全动作子集**（查状态/查群/查消息/发消息），
//   不暴露任何管理类动作（禁言、踢人、改群设置、文件上传下载等）。
// - 发送类工具强制校验白名单：目标群/私聊必须命中 config.json 的
//   allow.groups / allow.private，否则拒绝 —— agent 只能往被允许的地方发消息。
// - 所有调用走 OneBot HTTP API（httpUrl + accessToken）。
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { registerBilibiliTools } from './mcp-bilibili-tools.mjs';
// 出站文本的敏感信息拦截**统一由桥接负责**（bridge.js 的 auditAndSend / 各发送端点的
// SENSITIVE_RE 校验）：所有 QQ 发送都经由桥接 HTTP API，因此 MCP 侧不再重复实现一遍。
// 这里 import 只用于「出站审计口径一致」的说明，不在 MCP 内做拦截——
// 在 MCP 里拦会连「安全拒绝理由」都拿不到，反而让模型无法把话说清楚。
import { SENSITIVE_RE } from './sensitive.js';
import { serializeModelData } from './qq-model-view.js';
import { describeSendRejection } from '../plugins/qq-components/ctx-chat-reply-shape/send-rejection.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function loadConfig() {
  try {
    let text = fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8');
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    return JSON.parse(text);
  } catch {
    return {};
  }
}

const cfg = loadConfig();

function getConfig() {
  return loadConfig();
}

function getAccess() {
  const c = getConfig();
  return {
    allowGroups: (c.allow?.groups ?? []).map(String),
    allowPrivate: (c.allow?.private ?? []).map(String),
    denyGroups: (c.deny?.groups ?? []).map(String),
    denyPrivate: (c.deny?.private ?? []).map(String),
    allowAllWhenEmpty: c.allowAllWhenEmpty === true
  };
}

function getOneBotConfig() {
  const c = getConfig();
  return {
    httpUrl: (c.snowluma?.httpUrl ?? 'http://127.0.0.1:3000').replace(/\/+$/, ''),
    token: c.snowluma?.accessToken ?? ''
  };
}

// 与 bridge.allowed 保持一致：allow 列表为空时按 allowAllWhenEmpty 放行
function isAllowed(allowList, denyList, id, allowAllWhenEmpty) {
  const s = String(id);
  if (denyList.includes(s)) return false;
  if (allowList.length > 0) return allowList.includes(s);
  return allowAllWhenEmpty;
}

// 兼容模型把单条消息序列化成 JSON 字符串的情况，例如 "\"你好\"" → "你好"。
function unquoteJsonString(value) {
  if (typeof value !== 'string') return value;
  const t = value.trim();
  if (t.startsWith('"')) {
    try {
      const parsed = JSON.parse(t);
      if (typeof parsed === 'string') return parsed;
    } catch {}
  }
  return value;
}

// 说明：本文件曾经有一对 escapeCqText() / messageSegments()，用于在 MCP 侧构造消息段。
// 它们从来没有被任何工具调用（发送一律走桥接的 /api/send/*，由桥接统一构造文本段并做
// CQ 转义，见 bridge.js 的 onebotSend），属于"看起来在防护、实际是死代码"的假安全。
// 这里直接删除，避免以后有人以为 MCP 侧还有一道 CQ 转义而放松桥接那一层。

async function onebot(action, params = {}) {
  const { httpUrl, token } = getOneBotConfig();
  const res = await fetch(`${httpUrl}/${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(15000)
  });
  if (!res.ok) {
    const hint = res.status === 426 ? '；HTTP 426 通常表示 httpUrl 指向了 WebSocket 端口，请检查 config.json 的 snowluma.httpUrl 是否为 OneBot HTTP API 地址' : '';
    throw new Error(`HTTP ${res.status}${hint}`);
  }
  const body = await res.json();
  if (body.status !== 'ok' || body.retcode !== 0) {
    throw new Error(`OneBot ${action} 失败: retcode=${body.retcode} ${body.wording ?? ''}`);
  }
  return body.data;
}

// 桥接控制台/内部 Agent API 访问：二代仿真模式的状态工具都通过这里读写桥接内存态。
function agentApiBase() {
  const port = Number(getConfig().consolePort) || 3100;
  return `http://127.0.0.1:${port}`;
}
function readConsoleToken() {
  // 每次请求都重新读取，优先 config.json 里的 consoleToken，其次 state/console-token，
  // 避免 token 变化后 MCP 仍使用启动时缓存的旧值导致一直 401。
  //
  // 必须与桥接的校验口径**完全一致**（bridge.js 的 startConsoleServer：长度 16~128、
  // 只允许 [A-Za-z0-9_-]，不合法就忽略并回退 state/console-token）。否则用户手填一个
  // 短令牌时桥接会正常运行，而 MCP 拿着这个桥接根本不认的值去请求 —— 每个工具都 401，
  // 且错误信息里看不出原因是"config.json 里的令牌格式不合法"。
  try {
    const c = getConfig();
    const configured = String(c.consoleToken ?? '').trim();
    if (/^[A-Za-z0-9_-]{16,128}$/.test(configured)) return configured;
  } catch {}
  try {
    const tokenFile = path.join(ROOT, 'state', 'console-token');
    return fs.readFileSync(tokenFile, 'utf8').trim();
  } catch {
    return '';
  }
}

/**
 * 把桥接返回的 `error` 变成可读文本。
 *
 * 为什么必须有：桥接个别分支会回一个**对象**（例如 `{code, message}`），直接
 * `new Error(obj)` 会把它 String 成 "[object Object]" —— 模型和运维都读不到任何信息。
 * r3 的已知未修项里就记着 `qq_wait_for_messages` 出现过 `error: "\"Error: [object Object]\""`。
 */
function errorText(value, fallback) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (value && typeof value === 'object') {
    try {
      const text = JSON.stringify(value);
      if (text && text !== '{}') return text.slice(0, 500);
    } catch {}
    const message = value.message ?? value.msg ?? value.error;
    if (typeof message === 'string' && message.trim()) return message.trim().slice(0, 500);
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}

async function agentApi(path, init = {}) {
  const timeoutMs = init.timeoutMs || 15000;
  const { timeoutMs: _omit, ...rest } = init;
  const headers = agentHeaders(rest.headers);
  const res = await fetch(`${agentApiBase()}${path}`, { ...rest, headers, signal: AbortSignal.timeout(timeoutMs) });
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  if (!res.ok) {
    const message=errorText(body?.error, `桥接 API HTTP ${res.status}`);
    const rejection=describeSendRejection(message);
    throw new Error(rejection?serializeModelData({...rejection,error:message}):message);
  }
  // 桥接的部分端点会用 200 + {ok:false,error} 表达业务失败（例如发送被审计拦截）。
  // 不检查 body.ok 会把「被拦截」当成「发送成功」上报给模型 —— 模型据此认为消息已发出，
  // 于是不再重试也不告诉用户，是典型的静默错误。
  if (body && typeof body === 'object' && body.ok === false) {
    const message=errorText(body.error, '桥接 API 返回 ok:false（未说明原因）');
    const rejection=describeSendRejection(message);
    throw new Error(rejection?serializeModelData({...rejection,error:message}):message);
  }
  return body;
}

/**
 * 桥接 API 请求头（含控制台令牌、x-agent-call 与调用方附加头）。
 * 拆出来是为了长轮询通道复用同一套鉴权，避免两条通路口径漂移。
 */
function agentHeaders(extra = {}) {
  const consoleToken = readConsoleToken();
  const headers = {
    'content-type': 'application/json',
    ...(consoleToken ? { 'x-console-token': consoleToken } : {}),
    ...(extra ?? {})
  };
  // 声明「这是一次智能体调用」。桥接据此把「没带会话令牌」判定为**拒绝**，而不是
  // 退化成「管理端全权」——所以这个头绝不能随 token 一起被省略。历史上 331/355/379/877
  // 行用 `...(token ? {headers:{...}} : {})` 把整个头省掉了，于是「模型漏传 token」
  // 不是被拒绝，反而提权成控制台权限（confused deputy）。
  // 令牌本身仍然只在真有时才发：/api/status 的模式探测（legacyReadToolAllowed）本来就是
  // 无令牌调用，桥接对它单独放行并按最小对象返回。
  headers['x-agent-call'] = '1';
  return headers;
}

/**
 * 长轮询专用 POST（`node:http`，不经过 undici）。
 *
 * 为什么必须单独一条：Node 的全局 `fetch` 是 undici，自带 300 秒 `headersTimeout`。
 * 而 `qq_wait_for_messages` 的常规用法就是 `timeoutMs=300000` 的沉睡前观察 ——
 * 客户端会在第 301 秒以 `fetch failed / Headers Timeout Error` 断掉，桥接侧的
 * 长轮询却还在跑满自己的预算：AI 拿不到结果只能重试，而 `activeWaits` 仍占着会话
 * （重新等待被 429），于是空转烧 token（见 issue #24）。`node:http` 没有默认响应超时，
 * 超时完全由这里的计时器按调用方预算控制。
 */
function agentApiLongPoll(path, init = {}) {
  const timeoutMs = Math.max(1000, Number(init.timeoutMs) || 15000);
  const url = new URL(`${agentApiBase()}${path}`);
  const body = init.body == null ? '' : String(init.body);
  const headers = agentHeaders(init.headers);
  headers['content-length'] = Buffer.byteLength(body);
  return new Promise((resolve, reject) => {
    let settled = false;
    let req;
    let res;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(() => {
      const error = new Error(`等待超时（${Math.round(timeoutMs / 1000)}s）`);
      finish(error);
      req?.destroy(error);
      res?.destroy();
    }, timeoutMs);
    timer.unref?.();
    try {
      req = http.request({
        hostname: url.hostname,
        port: url.port || 80,
        path: url.pathname + url.search,
        method: init.method || 'GET',
        headers,
        timeout: 0
      }, (response) => {
        res = response;
        const chunks = [];
        let size = 0;
        response.on('data', (chunk) => {
          if (settled) return;
          size += chunk.length;
          // 桥接的 wait 响应本来就是小 JSON；超过 4MB 说明对端异常，别把内存吃光。
          if (size > 4 * 1024 * 1024) {
            finish(new Error('等待响应体过大，已中止'));
            response.destroy();
            return;
          }
          chunks.push(chunk);
        });
        response.on('error', (error) => finish(error));
        response.on('aborted', () => finish(new Error('等待响应中断')));
        response.on('close', () => { if (!response.complete) finish(new Error('等待响应中断')); });
        response.on('end', () => {
          if (settled) return;
          let parsed = null;
          try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { parsed = null; }
          const status = response.statusCode || 0;
          if (status < 200 || status >= 300) {
            finish(new Error(errorText(parsed?.error, `桥接 API HTTP ${status}`)));
            return;
          }
          if (parsed && typeof parsed === 'object' && parsed.ok === false) {
            finish(new Error(errorText(parsed.error, '桥接 API 返回 ok:false（未说明原因）')));
            return;
          }
          finish(null, parsed);
        });
      });
      req.on('error', (error) => finish(error));
      req.end(body);
    } catch (error) {
      finish(error);
      req?.destroy();
    }
  });
}

async function authorizeRead(key) {
  // 会话令牌必须显式携带：桥接已把空令牌的请求一律拒绝（避免把该端点变成免鉴权入口）。
  // 旧只读工具没有令牌，因此它们改由 legacyReadToolAllowed() 做模式判定，不再调用本函数。
  throw new Error('旧只读工具没有会话令牌；请使用带会话令牌的 v2 读工具');
}

// 旧只读工具（qq_status 之外的 qq_list_groups / qq_get_group_members / qq_get_group_history）
// 没有会话令牌，因此**只能在封闭 agent（管理员私聊）里使用**。
//
// 这里用「确认是 closed-agent 才放行」的白名单写法，而不是「看到 reserved2 就拒绝」的黑名单写法：
// 桥接的 /api/status 在「带 agent 令牌」时返回的是最小状态对象（不含 mode 字段），
// 用 `status?.mode === 'reserved2'` 判断会得到 undefined ⇒ 黑名单判定为假 ⇒ 旧工具被放行，
// 等于在二代仿真模式下把白名单群名、群成员名单注入模型上下文。
async function legacyReadToolAllowed() {
  const status = await agentApi('/api/status');
  return String(status?.mode ?? '') === 'closed-agent';
}

const server = new McpServer({ name: 'snowluma-safe', version: '0.2.1-r1' });

// ── 工具开关必须在**注册期**生效，而不是只在校验期 ──────────────────────────
//
// 为什么：每个工具的描述 + 参数 schema 都会随 system prompt 在**每一次**请求里重发
// （实测 41 个工具约 8.8k token）。只在校验时 403 的话，被关掉的工具依然占着上下文、
// 依然会让模型看见并调用它（然后拿到一个错误），等于「关了个寂寞」。
//
// 这里用一个注册过滤器统一处理：开关关闭 ⇒ 该工具根本不注册 ⇒ 既省 token 又不给模型误调的机会。
// DSH 在启动时读取工具清单，所以关掉/打开后需要重启 DSH 才会刷新（控制台面板已注明）。
//
// 只列**各模式共用的工具不在其中**：qq_send_group_message / qq_send_private_message / qq_reply
// 同时服务 chat / reserved / closed-agent 模式，用 v2 的开关去决定它们是否注册会误伤其它模式，
// 所以这三个仍然只在调用时由桥接校验。

const disabledTools = [];
{
  const registerTool = server.tool.bind(server);
  server.tool = (name, ...rest) => {
    const flag = TOOL_CONFIG_FLAGS[name];
    if (flag && cfg.socialV2?.tools?.[flag] === false) {
      disabledTools.push(`${name}(${flag})`);
      return undefined;
    }
    return registerTool(name, ...rest);
  };
}

server.tool(
  'qq_status',
  '查询 QQ 机器人登录状态与账号信息（只读）。',
  {},
  async () => {
    try {
      const login = await onebot('get_login_info');
      let status = {};
      try { status = await onebot('get_status'); } catch {}
      return { content: [{ type: 'text', text: serializeModelData({ ...login, online: status.online, good: status.good }) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `查询失败：${error?.message ?? error}` }], isError: true };
    }
  }
);

// ── 旧只读工具：**按启动时的桥接模式决定是否注册** ─────────────────────────
//
// 为什么必须在注册期就砍掉（而不是只在调用期 403）：
//   每个工具的描述 + 参数 schema 都随 system prompt 在**每一次**请求里重发。
//   实测一份 reserved2 会话的请求头是「58 个工具 / 45.5 KB schema（≈14k token/次）」，
//   其中 3 个旧只读工具在 reserved2 下**必然**返回 403，却照样占着 2500+ 字节；
//   更要命的是它们会诱导模型误调（实测 turn10 有一次 qq_get_group_members → 403，白烧一步）。
//   本文件开头（TOOL_CONFIG_FLAGS 那段）已经为「关掉的工具」立过同样的规矩，这里补齐模式维度。
//
// 语义：旧只读工具没有会话令牌，`legacyReadToolAllowed()` 只放行 closed-agent。
//   所以只有在 closed-agent 下注册它们才有意义。探测失败（读不到状态文件）时按「注册」处理：
//   那种情况下所有 QQ 工具都不可用，少注册只会让模型看到更少的失败路径，不必激进。
//
// ⚠️ 为什么读 `state/mode.json` 而**不**去问 `/api/status`：
//   注册发生在模块加载期，走网络就得用 top-level await；而本文件会被若干离线回归
//   （test-audit-security-mcp.mjs）用 `vm`/`new Function` 求值，那里没有 TLA —— 会直接
//   `ReferenceError: await is not defined`，把整批断言打红。模式文件是桥接每次切换模式时
//   原子写出的（bridge.js 的 writeMode），与 `/api/status` 同源，读盘既准确又是同步的。
const bootBridgeMode = (() => {
  try {
    const raw = fs.readFileSync(path.join(ROOT, 'state', 'mode.json'), 'utf8');
    const parsed = JSON.parse(raw);
    return String(parsed?.mode ?? '').trim();
  } catch { return ''; }
})();
const registerLegacyReadTools = bootBridgeMode === '' || bootBridgeMode === 'closed-agent';
if (!registerLegacyReadTools) {
  console.error(`[snowluma-safe] 当前桥接模式 ${bootBridgeMode}：不注册旧只读工具（qq_list_groups / qq_get_group_history），改用带令牌的 v2 读工具`);
}

if (registerLegacyReadTools) {
server.tool(
  'qq_list_groups',
  '列出机器人所在的全部 QQ 群（只读）：群号、群名。',
  {},
  async () => {
    // 旧只读工具没有 agent token：只允许在封闭 agent（管理员私聊）里使用。
    // 判定失败一律拒绝（fail-closed），不依赖「看到某个模式才拒绝」的黑名单写法。
    try {
      if (!(await legacyReadToolAllowed())) {
        return { content: [{ type: 'text', text: '旧只读工具仅在封闭 agent（管理员私聊）模式可用；其它模式请使用带会话令牌的 v2 读工具' }], isError: true };
      }
    } catch (error) {
      return { content: [{ type: 'text', text: `无法确认当前模式，拒绝执行：${error?.message ?? error}` }], isError: true };
    }
    try {
      const a = getAccess();
      const data = await onebot('get_group_list');
      const list = (Array.isArray(data) ? data : (data?.data ?? []))
          .filter((g) => isAllowed(a.allowGroups, a.denyGroups, g.group_id, a.allowAllWhenEmpty))
          .map((g) => ({ group_id: g.group_id, group_name: g.group_name }));
      return { content: [{ type: 'text', text: serializeModelData(list) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `查询失败：${error?.message ?? error}` }], isError: true };
    }
  }
);
}

// 群成员列表：**换成 v2 形态**（key + token）。
//
// 为什么不再沿用旧的无令牌版本：它是 qq-chat-v2 预设里唯一被点名的"拿 QQ 号"的途径
// （见 dsh/agent-presets/qq-chat-v2/agent.cordis.yml 第 6 条），但旧版在 reserved2 下必然 403
// —— 预设教模型用一个永远失败的工具，等于每次都白烧一步。改成 v2 后同一个名字在两种模式下都成立。
server.tool(
  'qq_get_group_members',
  '列出指定群的成员（只读）：QQ 号、昵称、群名片。等特定的人、要 @ 某个人、或需要确认谁在群里时用；QQ 号取返回里的 userId。只返回白名单群，且只读取桥接允许的会话。',
  {
    key: z.string().describe('会话 key，格式 group:群号'),
    token: z.string().optional().describe('会话令牌（见唤醒提示中的【会话令牌】；closed-agent 模式不需要）'),
    limit: z.number().optional().describe('最多返回多少成员，默认 50，最大 100')
  },
  async ({ key, token, limit }) => {
    try {
      const q = new URLSearchParams({ key });
      if (limit != null) q.set('limit', String(limit));
      // token 可选：closed-agent（管理员私聊）里代理没有会话令牌，走的是操作者路径；
      // 桥接那边的白名单/模式判定对**这条**请求同样生效（不依赖 header 是否存在）。
      const data = await agentApi(`/api/socialV2/group-members?${q.toString()}`, token ? { headers: { 'x-agent-token': token } } : {});
      return { content: [{ type: 'text', text: serializeModelData(data) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `获取群成员失败：${error?.message ?? error}` }], isError: true };
    }
  }
);

if (registerLegacyReadTools) {
server.tool(
  'qq_get_group_history',
  '获取指定群的最近消息历史（只读）。messageSeq 可选：从该消息序号往前取。注意：是否可用取决于 SnowLuma 是否实现 get_group_msg_history。',
  { groupId: z.union([z.number(), z.string()]).describe('群号'), messageSeq: z.number().optional().describe('起始消息序号（可选）') },
  async ({ groupId, messageSeq }) => {
    const g = String(groupId);
    try {
      if (!(await legacyReadToolAllowed())) {
        return { content: [{ type: 'text', text: '旧只读工具仅在封闭 agent（管理员私聊）模式可用；其它模式请使用带会话令牌的 v2 读工具' }], isError: true };
      }
    } catch (error) {
      return { content: [{ type: 'text', text: `无法确认当前模式，拒绝读取：${error?.message ?? error}` }], isError: true };
    }
    const a = getAccess();
    if (!isAllowed(a.allowGroups, a.denyGroups, g, a.allowAllWhenEmpty)) {
      return { content: [{ type: 'text', text: `拒绝：群 ${g} 不在只读白名单中` }], isError: true };
    }
    try {
      const params = { group_id: Number(g) };
      if (messageSeq !== undefined) params.message_seq = messageSeq;
      const data = await onebot('get_group_msg_history', params);
      return { content: [{ type: 'text', text: serializeModelData(data) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `查询失败：${error?.message ?? error}` }], isError: true };
    }
  }
);
}

server.tool(
  'qq_send_group_message',
  '向指定 QQ 群发送一条纯文本消息；如需引用某条消息，可传 replyToMessageId（非零整数，可为负数），可先用 qq_get_recent_messages / qq_get_message_detail 查询。二代模式（reserved2）下这是可用的发送工具之一，但优先使用 qq_send_message；reserved2 下调用时必须携带会话令牌 token，否则会被拒绝。不要在发送后输出“已发送”类汇报。目标群必须命中系统白名单（config.json 的 allow.groups），否则拒绝。',
  {
    groupId: z.union([z.number(), z.string()]).describe('群号（必须在白名单内）'),
    message: z.string().describe('消息文本，纯文本，不要用 Markdown 或 CQ 码'),
    replyToMessageId: z.union([z.number(), z.string()]).optional().describe('要引用/回复的消息 id（非零整数，可为负数，可选）'),
    token: z.string().optional().describe('二代会话令牌（reserved2 模式下必填；closed-agent 模式不需要）')
  },
  async ({ groupId, message, replyToMessageId, token }) => {
    try {
      const cleanMessage = unquoteJsonString(message);
      const data = await agentApi('/api/send/group', {
        method: 'POST',
        // token 既放 body（兼容旧调用）又放 header：桥接的「agent 流量」判定基于 header，
        // 只带 body 会让这条请求在桥接眼里像控制台请求，绕过 agent 专用的闸门与审计。
        ...(token ? { headers: { 'x-agent-token': token } } : {}),
        body: JSON.stringify({ groupId: String(groupId), message: cleanMessage, replyToMessageId, token: token || undefined })
      });
      return { content: [{ type: 'text', text: serializeModelData(data) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `发送失败：${error?.message ?? error}` }], isError: true };
    }
  }
);

server.tool(
  'qq_reply',
  '在指定 QQ 群里引用/回复某条消息，并发送一条文本。多条待处理消息语义不同、对象不同或需要分别回应时，每条被回应的原消息都必须单独调用本工具并传入对应 messageId；不可用 qq_send_message 数组、qq_send_burst 或一次引用替代。若只有一条待处理消息，或多条消息本质含义相同且一个回答可完整回应，可用 qq_send_message 发送一条，不必为了引用而引用。需要引用时先核对原消息发送者、内容和 id，回复文本必须切实回应被引用消息；引用错对象或回复内容不对应都视为错误。可通过 qq_get_recent_messages / qq_get_unread_messages / qq_get_message_detail 查询消息内容和 id；messageId 不能用本地 seq/readThroughSeq 替代。发送前桥接会校验 id 存在且属于当前会话。reserved2 下必须携带会话令牌 token。目标群必须命中白名单（config.json 的 allow.groups），否则拒绝。',
  {
    conversationIntent: z.enum(['reply','followup','newTopic']).optional().describe('本次实际发送内容的语义；追问/新话题计数以真实送达为准'),
    topicId: z.string().max(120).optional().describe('实际新话题的简短标识，不填秘密或个人信息'),
    groupId: z.union([z.number(), z.string()]).describe('群号（必须在白名单内）'),
    replyToMessageId: z.union([z.number(), z.string()]).describe('被引用/回复的消息 id（非零整数，可为负数）'),
    message: z.string().describe('要发送的文本，纯文本，不要用 Markdown 或 CQ 码'),
    token: z.string().optional().describe('二代会话令牌（reserved2 模式下必填；closed-agent 模式不需要）')
  },
  async ({ groupId, replyToMessageId, message, token, conversationIntent, topicId }) => {
    try {
      const cleanMessage = unquoteJsonString(message);
      const data = await agentApi('/api/send/reply', {
        method: 'POST',
        ...(token ? { headers: { 'x-agent-token': token } } : {}),
        body: JSON.stringify({ groupId: String(groupId), replyToMessageId, message: cleanMessage, token: token || undefined, conversationIntent, topicId })
      });
      return { content: [{ type: 'text', text: serializeModelData(data) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `发送失败：${error?.message ?? error}` }], isError: true };
    }
  }
);

server.tool(
  'qq_send_private_message',
  '向指定 QQ 好友发送一条私聊消息。若提供 replyToMessageId，会以 QQ 引用/回复形式发出（引用条 + 文本）。replyToMessageId 必须是非零整数消息 id（QQ 消息 id 可能为负数），可先用 qq_get_message_detail 查询。二代模式（reserved2）下这是可用的发送工具之一，但优先使用 qq_send_message；调用时必须携带会话令牌 token，否则会被拒绝。不要在发送后输出“已发送”类汇报。目标 QQ 必须命中系统白名单（config.json 的 allow.private），否则拒绝。',
  {
    userId: z.union([z.number(), z.string()]).describe('好友 QQ 号（必须在白名单内）'),
    message: z.string().describe('消息文本，纯文本，不要用 Markdown 或 CQ 码'),
    replyToMessageId: z.union([z.number(), z.string()]).optional().describe('要引用/回复的消息 id（非零整数，可为负数，可选）'),
    token: z.string().optional().describe('二代会话令牌（reserved2 模式下必填；closed-agent 模式不需要）')
  },
  async ({ userId, message, replyToMessageId, token }) => {
    try {
      const cleanMessage = unquoteJsonString(message);
      const data = await agentApi('/api/send/private', {
        method: 'POST',
        ...(token ? { headers: { 'x-agent-token': token } } : {}),
        body: JSON.stringify({ userId: String(userId), message: cleanMessage, replyToMessageId, token: token || undefined })
      });
      return { content: [{ type: 'text', text: serializeModelData(data) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `发送失败：${error?.message ?? error}` }], isError: true };
    }
  }
);

// ── 二代仿真模式（reserved2）工具 ─────────────────────────────────────────
server.tool(
  'qq_get_prompt',
  '查看当前二代仿真模式的提示词/角色/推荐值/可用工具/当前唤醒配置（只读）。',
  { key: z.string().describe('会话 key，格式 group:群号 或 private:QQ号'), token: z.string().describe('会话令牌（见唤醒提示中的【会话令牌】）') },
  async ({ key, token }) => {
    try {
      const data = await agentApi(`/api/socialV2/prompt?key=${encodeURIComponent(key)}`, { headers: { 'x-agent-token': token } });
      return { content: [{ type: 'text', text: serializeModelData(data) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `获取提示词失败：${error?.message ?? error}` }], isError: true };
    }
  }
);

server.tool(
  'qq_get_unread_messages',
  '查看未读消息，不自动标记已读。大量积压或快照 partial=true 时，用 afterSeq=readThroughSeq 从水位后按时间顺序补读；从最早未读开始传 0。',
  {
    key: z.string().describe('会话 key，格式 group:群号 或 private:QQ号'),
    token: z.string().describe('会话令牌（见唤醒提示中的【会话令牌】）'),
    limit: z.number().optional().describe('最多返回条数，默认 30，最大 100'),
    afterSeq: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional().describe('读取本地 seq 大于此水位的最早一页；省略则沿用返回最新一页的旧行为')
  },
  async ({ key, token, limit, afterSeq }) => {
    try {
      const data = await agentApi(`/api/socialV2/unread?key=${encodeURIComponent(key)}&limit=${limit ?? 30}${afterSeq === undefined ? '' : `&afterSeq=${afterSeq}`}`, { headers: { 'x-agent-token': token } });
      return { content: [{ type: 'text', text: serializeModelData(data) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `获取未读消息失败：${error?.message ?? error}` }], isError: true };
    }
  }
);

server.tool(
  'qq_get_recent_messages',
  '查看指定会话的最近消息（只读），支持 offset 扩大范围。',
  {
    key: z.string().describe('会话 key，格式 group:群号 或 private:QQ号'),
    token: z.string().describe('会话令牌（见唤醒提示中的【会话令牌】）'),
    limit: z.number().optional().describe('最多返回条数，默认 20，最大 100'),
    offset: z.number().optional().describe('跳过最近 N 条，用于向前翻看更早消息，默认 0')
  },
  async ({ key, token, limit, offset }) => {
    try {
      const data = await agentApi(`/api/socialV2/recent?key=${encodeURIComponent(key)}&limit=${limit ?? 20}&offset=${offset ?? 0}`, { headers: { 'x-agent-token': token } });
      return { content: [{ type: 'text', text: serializeModelData(data) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `获取最近消息失败：${error?.message ?? error}` }], isError: true };
    }
  }
);

server.tool(
  'qq_social_state',
  '查看指定会话的二代仿真状态：WakeConfig、未读数、上次唤醒原因、上次发言时间等（只读）。',
  { key: z.string().describe('会话 key，格式 group:群号 或 private:QQ号'), token: z.string().describe('会话令牌（见唤醒提示中的【会话令牌】）') },
  async ({ key, token }) => {
    try {
      const data = await agentApi(`/api/socialV2/state?key=${encodeURIComponent(key)}`, { headers: { 'x-agent-token': token } });
      return { content: [{ type: 'text', text: serializeModelData(data) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `获取状态失败：${error?.message ?? error}` }], isError: true };
    }
  }
);

server.tool(
  'qq_mark_read',
  '将指定会话已查看的未读消息标记为已读。双戳回查启用时，此工具只确认 seenAt，不能代替逐条 JSON 回复回执；完成回复后必须调用 qq_report_message_receipts 报 replied，消息才会闭合。throughSeq 使用最近读取结果的 readThroughSeq，避免清除读取后才到达的新消息；双戳关闭时保留旧版收尾语义。每次完成一波实际回复和回执后，用 qq_wait_for_messages 等新互动；无人回复时后台按递增概率结束当前回合，不能以 mark_read 代替等待或绕过已结束状态。',
  {
    key: z.string().describe('会话 key，格式 group:群号 或 private:QQ号'),
    token: z.string().describe('会话令牌（见唤醒提示中的【会话令牌】）'),
    throughSeq: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional().describe('本次确认已读的消息水位，使用已查看结果中的 readThroughSeq；不会清除更晚到达的消息。双戳启用时只确认已读，已回复状态必须由 qq_report_message_receipts 提交')
  },
  async ({ key, token, throughSeq }) => {
    try {
      const data = await agentApi('/api/socialV2/mark-read', { method: 'POST', body: JSON.stringify({ key, throughSeq }), headers: { 'x-agent-token': token } });
      return { content: [{ type: 'text', text: serializeModelData(data) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `标记已读失败：${error?.message ?? error}` }], isError: true };
    }
  }
);

server.tool(
  'qq_report_message_receipts',
  '向 Harness 回报逐条消息处理结果的 JSON。每条使用已读到的 seq：seen=已看但未回复，replied=这条消息已有成功发送，complete=本来就有双戳，anomaly=戳状态异常并需上报。replied 必须对应发送成功时已读的同一 seq；成功凭据会在桥接重启后保留。若回执失败，先按错误说明检查已读戳或发送凭据；不要因回执失败再次发送，以免重复回复。',
  {
    conversationId: z.string().describe('会话 ID，格式 group:群号 或 private:QQ号，与唤醒快照的 key 相同'),
    token: z.string().describe('当前会话令牌'),
    receipts: z.array(z.object({
      seq: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
      status: z.enum(['seen', 'replied', 'complete', 'anomaly']),
      note: z.string().max(300).optional().describe('anomaly 的简要原因')
    })).min(1).max(100).describe('按消息 seq 逐条报告；相似消息可合并回复，但每条都要有自己的状态')
  },
  async ({ conversationId, token, receipts }) => {
    try {
      const data = await agentApi('/api/socialV2/receipt-report', {
        method: 'POST',
        body: JSON.stringify({ conversationId, receipts }),
        headers: { 'x-agent-token': token }
      });
      return { content: [{ type: 'text', text: serializeModelData(data) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `双戳回执更新失败：${error?.message ?? error}` }], isError: true };
    }
  }
);

server.tool(
  'qq_mood',
  '按本会话真实语境调整心情。仅支持 add/dec；value 为正数，reason 说明依据，可引用当前规则 ruleId。不能设置绝对值、修改其他会话或按关键词自动加减。',
  {key:z.string(),token:z.string(),action:z.enum(['add','dec']),value:z.number().positive().max(100),reason:z.string().min(1).max(500),ruleId:z.string().max(64).optional()},
  async ({key,token,action,value,reason,ruleId})=>{
    try {const data=await agentApi('/api/socialV2/mood',{method:'POST',headers:{'x-agent-token':token},body:JSON.stringify({key,action,value,reason,ruleId})});return {content:[{type:'text',text:serializeModelData(data)}]};}
    catch(error){return {content:[{type:'text',text:'调整心情失败：'+error.message}],isError:true};}
  }
);

server.tool(
  'qq_set_wake_config',
  '设置当前会话收尾和明确约定的到时唤醒，或评估0–100聊天意愿。群聊来信统一使用 min(1,p+max(q))，p受静默阶段、心情与意愿影响，q由管理员配置；私聊不抽签，独立限制允许时每条进入回复。此工具不能改群聊触发条件或开启每条群消息必回。等待新消息超时的收尾规则由等待工具返回；按实际返回状态处理。throughSeq只确认已读，已回复须用qq_report_message_receipts逐条报告。',
  {
    key: z.string().describe('会话 key，格式 group:群号 或 private:QQ号'),
    token: z.string().describe('会话令牌（见唤醒提示中的【会话令牌】）'),
    throughSeq: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional().describe('可同时确认已读：使用已查看结果中的 readThroughSeq，省去额外 qq_mark_read；不传则只设置唤醒配置。双戳启用时不能借此设置 repliedAt；若 markRead 工具被关闭，该水位会被忽略'),
    chatWillingness: z.number().min(0).max(100).optional().describe('客观聊天可用度0–100：根据用户是否工作、开会、疲劳或有空评估，必须附reason依据；无依据保持原分。不代表bot喜好，不因没回复自动降分；不改变聊天风格'),
    reason: z.string().max(300).optional().describe('用户当前忙闲、时间或精力状况的证据；不是bot的喜好'),
    config: z.object({
      infinite: z.boolean().optional().describe('true=不设置到时检查；false=必须同时指定 sleepMs 或 sleepUntil；来信与独立排程仍可提前触发'),
      sleepMs: z.number().nonnegative().optional().describe('明确约定的到时唤醒，距现在毫秒数；普通潜水不设置此项'),
      sleepUntil: z.string().optional().describe('明确约定的到时唤醒 ISO 时间，优先于 sleepMs'),
    }).optional().describe('要设置的唤醒配置，缺省字段保留原值')
  },
  async ({ key, token, config, throughSeq, chatWillingness, reason }) => {
    try {
      const data = await agentApi('/api/socialV2/wake-config', { method: 'POST', body: JSON.stringify({ key, config, throughSeq, chatWillingness, reason }), headers: { 'x-agent-token': token } });
      return { content: [{ type: 'text', text: serializeModelData(data) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `设置唤醒配置失败：${error?.message ?? error}` }], isError: true };
    }
  }
);

server.tool(
  'qq_send_burst',
  '在指定 QQ 群分多条发送消息（二代仿真模式专用），桥接会按真人化随机间隔发送。暂不支持引用，需要引用请用 qq_reply。注意：数组里的每个字符串就是一条 QQ 消息，字符串内部不要用空格分隔中文短句，需要多条请用数组元素；每条消息要读起来完整，不要把同一句话拆到两条里。',
  {
    conversationIntent: z.enum(['reply','followup','newTopic']).optional().describe('本次实际发送内容的语义；追问/新话题计数以真实送达为准'),
    topicId: z.string().max(120).optional().describe('实际新话题的简短标识，不填秘密或个人信息'),
    groupId: z.union([z.number(), z.string()]).describe('群号（必须在白名单内）'),
    token: z.string().describe('会话令牌（见唤醒提示中的【会话令牌】）'),
    messages: z.union([z.array(z.string()).min(1), z.string()]).describe('要发送的消息数组，每条为纯文本；也兼容传入 JSON 数组字符串')
  },
  async ({ groupId, token, messages, conversationIntent, topicId }) => {
    try {
      const key = `group:${groupId}`;
      let finalMessages = messages;
      if (typeof finalMessages === 'string') {
        const trimmed = finalMessages.trim();
        // 兼容模型把数组序列化成 JSON 字符串传入的情况，例如 "[...]"。
        if (trimmed.startsWith('[')) {
          try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed)) finalMessages = parsed.map(String);
          } catch {}
        } else if (trimmed.startsWith('"')) {
          // 兼容模型把单条消息序列化成 JSON 字符串的情况，例如 "\"你好\"" → "你好"。
          try {
            const parsed = JSON.parse(trimmed);
            if (typeof parsed === 'string') finalMessages = parsed;
            else if (Array.isArray(parsed)) finalMessages = parsed.map(String);
          } catch {}
        }
      }
      const data = await agentApi('/api/socialV2/send-burst', {
        method: 'POST',
        body: JSON.stringify({ key, messages: finalMessages, conversationIntent, topicId }),
        headers: { 'x-agent-token': token },
        timeoutMs: 300000
      });
      return { content: [{ type: 'text', text: serializeModelData(data) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `分条发送失败：${error?.message ?? error}` }], isError: true };
    }
  }
);

server.tool(
  'qq_send_message',
  '统一发送工具：可发一条或多条，二代仿真模式专用。字符串=一条消息，数组=多条气泡。若只有一条入站消息，或多条消息本质含义相同且一个回答能完整回应，用本工具发送一条即可。若多条入站消息语义不同、对象不同或需要分别回应，对每条分别用 qq_reply 引用准确原消息；不要用数组代替多条引用回复。数组仍可用于拆分一段连续回复或主动发言。每条发送内容应完整、清楚，不要把同一句话拆碎。',
  {
    conversationIntent: z.enum(['reply','followup','newTopic']).optional().describe('本次实际发送内容的语义；追问/新话题计数以真实送达为准'),
    topicId: z.string().max(120).optional().describe('实际新话题的简短标识，不填秘密或个人信息'),
    key: z.string().describe('会话 key，格式 group:群号 或 private:QQ号'),
    token: z.string().describe('会话令牌（见唤醒提示中的【会话令牌】）'),
    messages: z.union([z.string(), z.array(z.string()).min(1)]).describe('要发送的内容：字符串=一条；数组=分多条'),
    replyToMessageId: z.union([z.number(), z.string()]).optional().describe('要引用/回复的消息 id（非零整数，可为负数，可选）'),
    atUserId: z.union([z.number(), z.string()]).optional().describe('要 @ 的群成员 QQ 号（群聊中用于点名某个人；与引用二选一即可，不要滥用）'),
    gapMode: z.enum(['auto', 'fixed']).optional().describe('auto=本轮计划随机；fixed=请求间隔，仍受本轮计划范围约束'),
    gapMs: z.number().optional().describe('fixed 模式下的统一间隔（毫秒）'),
    gaps: z.array(z.number()).optional().describe('fixed 模式下逐条间隔（长度=条数-1）')
  },
  async ({ key, token, messages, replyToMessageId, atUserId, gapMode, gapMs, gaps, conversationIntent, topicId }) => {
    try {
      let finalMessages = messages;
      if (typeof finalMessages === 'string') {
        const trimmed = finalMessages.trim();
        // 兼容模型把数组序列化成 JSON 字符串传入的情况，例如 "[...]"。
        if (trimmed.startsWith('[')) {
          try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed)) finalMessages = parsed.map(String);
          } catch {}
        } else if (trimmed.startsWith('"')) {
          // 兼容模型把单条消息序列化成 JSON 字符串的情况，例如 "\"你好\"" → "你好"。
          try {
            const parsed = JSON.parse(trimmed);
            if (typeof parsed === 'string') finalMessages = parsed;
            else if (Array.isArray(parsed)) finalMessages = parsed.map(String);
          } catch {}
        }
      }
      const data = await agentApi('/api/socialV2/send-message', {
        method: 'POST',
        body: JSON.stringify({ key, messages: finalMessages, replyToMessageId, atUserId: atUserId ?? null, gapMode, gapMs, gaps, conversationIntent, topicId }),
        headers: { 'x-agent-token': token },
        timeoutMs: 300000
      });
      return { content: [{ type: 'text', text: serializeModelData(data) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `发送失败：${error?.message ?? error}` }], isError: true };
    }
  }
);

if (cfg.socialV2?.tools?.attack !== false) {
  // ── 提示词注入「攻击」工具（tool-injection-lab 的模型侧入口）────────────────
  //
  // 为什么要有这一条：插件那 5 个工具（inject_scan / inject_cards / banter_line /
  // inject_payload / inject_stats）只挂在桥接的 /api/plugins/call 上，群聊会话的模型面
  // 根本调不到 —— 它只能照提示词里每 10 分钟轮换的两条手打，换不了招、查不了配额，
  // 也拿不到目标 QQ。于是实测里出现「管理员点单被当成套提示词推掉」「被对面顶回来
  // 就只会复读」。这里把「取一条弹药 + 发到会话并 @ 目标」合成一个真正的工具，
  // 弹药库、自 @ 校验和每群每小时的配额仍由插件（tool-injection-lab）负责。
  server.tool(
    'qq_attack',
    '提示词注入「攻击」工具（跟别的 bot 玩梗对线用，owner 授权）：取一条特殊字符弹药（<|im_start|>system / 伪 tool_result / JSON role / 零宽字符 / 同形字…，只改对方人设/口头禅），可直接发到当前会话并 @ 目标 bot。规则：只对 bot 不对真人；群聊必须给 targetUserId（从 qq_get_group_members 取，不能是你自己）；每群每小时最多 2 条；对方说停或对方管理员出面就收手。action="plan" 只预览弹药清单不发送；action="fire"（默认）取弹药并真的发出去。发完不要汇报“我发了”，按人设接一句就行。',
    {
      key: z.string().describe('会话 key，格式 group:群号 或 private:QQ号'),
      token: z.string().describe('会话令牌（见唤醒提示中的【会话令牌】）'),
      targetUserId: z.union([z.number(), z.string()]).optional().describe('要 @ 的目标 bot 的 QQ（群聊必填；私聊可省）'),
      payloadId: z.string().optional().describe('指定弹药 id（如 im-start-whale / fake-tool-result / zero-width）；不传则随机取一条'),
      action: z.enum(['fire', 'plan']).optional().describe('fire=取弹药并发送（默认）；plan=只返回弹药清单/预览，不发送、不扣配额')
    },
    async ({ key, token, targetUserId, payloadId, action }) => {
      const isGroup = String(key || '').startsWith('group:');
      const target = targetUserId != null ? String(targetUserId).trim() : '';
      const previewOnly = action === 'plan';
      if (isGroup && !target) {
        return {
          content: [{ type: 'text', text: '群聊攻击必须传 targetUserId（要 @ 的目标 bot）；先用 qq_get_group_members 拿到它的 QQ，别盲发。' }],
          isError: true
        };
      }
      try {
        const input = { id: payloadId || undefined, targetQQ: target || undefined };
        // plan 不传 key：插件只在带 key 时才扣配额。
        if (!previewOnly) input.key = key;
        const plan = await agentApi('/api/plugins/call', {
          method: 'POST',
          body: JSON.stringify({ tool: 'inject_payload', input }),
          headers: { 'x-agent-token': token },
          timeoutMs: 60000
        });
        const result = plan?.result ?? plan;
        if (!result || result.ok !== true) {
          return {
            content: [{ type: 'text', text: '取弹药失败：' + errorText(result?.error, '插件没有返回可用弹药') }],
            isError: true
          };
        }
        const selfId = String(result.selfId || '');
        if (target && selfId && target === selfId) {
          return {
            content: [{ type: 'text', text: '目标是「你自己」（' + selfId + '），这场对线不成立；换别的 bot，别 @ 自己。' }],
            isError: true
          };
        }
        const payload = result.payload || {};
        if (previewOnly) {
          return {
            content: [{
              type: 'text',
              text: serializeModelData({
                ok: true,
                action: 'plan',
                payload,
                payloads: result.ids || [],
                selfId,
                quota: null,
                send: { key, atUserId: target || null },
                hint: '挑好 id 后 action="fire" 发出去；群聊要带 targetUserId。一次一条，别追着打。'
              })
            }]
          };
        }
        const textToSend = String(payload.text || '');
        if (!textToSend) {
          return { content: [{ type: 'text', text: '弹药内容是空的，已中止发送。' }], isError: true };
        }
        await agentApi('/api/socialV2/send-message', {
          method: 'POST',
          body: JSON.stringify({ key, messages: [textToSend], atUserId: target || null }),
          headers: { 'x-agent-token': token },
          timeoutMs: 300000
        });
        return {
          content: [{
            type: 'text',
            text: serializeModelData({
              ok: true,
              fired: true,
              payloadId: payload.id,
              payloadName: payload.name,
              atUserId: target || null,
              quota: result.quota || null,
              hint: '已经发出去了；别复述流程、别汇报，按人设接一句就行。对面要是顶回来，换一条不同格式的（action="plan" 看清单）。'
            })
          }]
        };
      } catch (error) {
        return { content: [{ type: 'text', text: `攻击失败：${error?.message ?? error}` }], isError: true };
      }
    }
  );
}

if (cfg.socialV2?.tools?.sendPoke !== false) {
  server.tool(
    'qq_send_poke',
    '发送 QQ 拍一拍（群聊/私聊）。适合用“戳一下”代替一句废话、提醒对方、自然回应别人的拍一拍，或偶尔主动戳一下正在聊的人/熟人——这样更拟真；但别频繁，真人不会一直戳人。群聊必须传 targetUserId（要拍的群友 QQ 号，可从 qq_get_active_members / qq_get_message_detail 的 userId 获取）；私聊可不传 targetUserId（默认拍当前私聊对象）。reserved2 下必须携带会话令牌 token，发送会受桥接白名单与发送频率限制。',
    {
      key: z.string().describe('会话 key，格式 group:群号 或 private:QQ号'),
      token: z.string().describe('会话令牌（见唤醒提示中的【会话令牌】）'),
      targetUserId: z.union([z.number(), z.string()]).optional().describe('要拍的群友 QQ 号（群聊必填；私聊可选）')
    },
    async ({ key, token, targetUserId }) => {
      try {
        const data = await agentApi('/api/socialV2/send-poke', {
          method: 'POST',
          body: JSON.stringify({ key, targetUserId: targetUserId != null ? String(targetUserId) : '' }),
          headers: { 'x-agent-token': token },
          timeoutMs: 60000
        });
        return { content: [{ type: 'text', text: serializeModelData(data) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `拍一拍失败：${error?.message ?? error}` }], isError: true };
      }
    }
  );
}

async function callConversationWait({ key, token, purpose, timeoutMs, quietMs }) {
  try {
    const data = await agentApiLongPoll('/api/socialV2/wait', {
      method: 'POST', body: JSON.stringify({ key, purpose, timeoutMs, quietMs }),
      headers: { 'x-agent-token': token }, timeoutMs: 725000
    });
    return { content: [{ type: 'text', text: serializeModelData(data) }] };
  } catch (error) { return { content: [{ type: 'text', text: '等待失败：' + (error?.message ?? error) }], isError: true }; }
}
server.tool('qq_wait_for_messages',
  '私聊与群聊共用：每完成一波实际回复并处理回执后，调用本工具等用户新消息，自选 timeoutMs。收到新消息即返回，按需要再调用 qq_wait_for_quiet 等对方说完。没有新消息且超时，由后台按可编辑 p、q 递增概率判定 endRound：true 时后台停止本轮，不能继续等待或追发；false 时再调用一次本工具。新来信重置概率。不能有待处理来信时用本工具拖延回复；旧的固定沉睡前观察已退役。',
  { key:z.string().describe('private:QQ号 或 group:群号'), token:z.string().describe('当前会话令牌'),
    timeoutMs:z.number().optional().describe('本次等新消息的时长，受后台上下限限制；未指定用后台默认值'),
    purpose:z.enum(['messages','reply']).optional().describe('兼容旧调用；等新消息用 messages；需要静默时改用 qq_wait_for_quiet'),
    quietMs:z.number().optional().describe('仅兼容旧 reply 用途；新调用用 qq_wait_for_quiet'),
    minNewMessages:z.number().optional().describe('兼容字段；新消息一到就返回，不要求凑够多条') },
  args=>callConversationWait({...args,purpose:args.purpose||'messages'})
);
server.tool('qq_wait_for_quiet',
  '独立的短静默工具：用户发来消息后，确需判断对方是否还会补充时调用。从最后一条来信计时；阅读思考耗时也算，已安静够久立即返回，新消息重新计时。timeoutMs 是单次上限，quiet=false 不表示对方说完。返回一批消息时，不同问题或对象分别准确引用回复，相同或接近的内容合并成一波；逐条提交回复回执。这个工具不增加或绕过无人回复结束计数，不负责等未来新互动。',
  { key:z.string().describe('private:QQ号 或 group:群号'),token:z.string().describe('当前会话令牌'),
    quietMs:z.number().optional().describe('最后一条来信后需连续安静多久（毫秒），后台下限仍生效'),
    timeoutMs:z.number().optional().describe('本次确认静默的最长等待时间（毫秒）') },
  args=>callConversationWait({...args,purpose:'reply'})
);

server.tool(
  'qq_report_feedback',
  '向控制台/管理端反馈 AI 遇到的问题、困惑或需要管理员介入的情况。',
  {
    key: z.string().describe('会话 key，格式 group:群号 或 private:QQ号'),
    token: z.string().describe('会话令牌（见唤醒提示中的【会话令牌】）'),
    level: z.enum(['info', 'warning', 'error']).optional().describe('反馈级别，默认 info'),
    message: z.string().describe('反馈内容')
  },
  async ({ key, token, level, message }) => {
    try {
      const data = await agentApi('/api/socialV2/feedback', {
        method: 'POST',
        body: JSON.stringify({ key, level, message }),
        headers: { 'x-agent-token': token }
      });
      return { content: [{ type: 'text', text: serializeModelData(data) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `反馈失败：${error?.message ?? error}` }], isError: true };
    }
  }
);

server.tool(
  'qq_get_my_recent_messages',
  '查看自己最近发过的消息（只读），避免重复/保持人设。',
  {
    key: z.string().describe('会话 key，格式 group:群号 或 private:QQ号'),
    token: z.string().describe('会话令牌（见唤醒提示中的【会话令牌】）'),
    limit: z.number().optional().describe('最多返回条数，默认 10，最大 50')
  },
  async ({ key, token, limit }) => {
    try {
      const data = await agentApi(`/api/socialV2/my-recent?key=${encodeURIComponent(key)}&limit=${limit ?? 10}`, { headers: { 'x-agent-token': token } });
      return { content: [{ type: 'text', text: serializeModelData(data) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `获取自己消息失败：${error?.message ?? error}` }], isError: true };
    }
  }
);

server.tool(
  'qq_get_message_detail',
  '按 message_id / 本地 seq 查看单条消息的发送者、引用信息与正文（只读）。注意：正文最多返回 200 字符，textTruncated=true 表示被截断，这里不是读取长消息全文的入口。',
  {
    key: z.string().describe('会话 key，格式 group:群号 或 private:QQ号'),
    token: z.string().describe('会话令牌（见唤醒提示中的【会话令牌】）'),
    messageId: z.union([z.number(), z.string()]).describe('要查看的消息 id（QQ 消息 id 可能为负数）')
  },
  async ({ key, token, messageId }) => {
    try {
      const data = await agentApi(`/api/socialV2/message-detail?key=${encodeURIComponent(key)}&messageId=${encodeURIComponent(String(messageId))}`, { headers: { 'x-agent-token': token } });
      return { content: [{ type: 'text', text: serializeModelData(data) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `获取消息详情失败：${error?.message ?? error}` }], isError: true };
    }
  }
);

server.tool(
  'qq_get_active_members',
  '查看最近活跃成员列表（只读），帮助判断话题参与者。',
  {
    key: z.string().describe('会话 key，格式 group:群号 或 private:QQ号'),
    token: z.string().describe('会话令牌（见唤醒提示中的【会话令牌】）'),
    limit: z.number().optional().describe('最多返回人数，默认 10，最大 20')
  },
  async ({ key, token, limit }) => {
    try {
      const data = await agentApi(`/api/socialV2/active-members?key=${encodeURIComponent(key)}&limit=${limit ?? 10}`, { headers: { 'x-agent-token': token } });
      return { content: [{ type: 'text', text: serializeModelData(data) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `获取活跃成员失败：${error?.message ?? error}` }], isError: true };
    }
  }
);

server.tool(
  'qq_memory_append',
  '记录当前窗口的轻量记忆：activeTopic=当前话题；pendingThought=bot待说想法；memberImpression=窗口内实际发言用户的行为观察。持续价值先提炼成会话事实；稳定作息/爱好写人物档案，任务/承诺/随口安排写qq_task_note。不把印象当稳定性格。',
  {
    key: z.string().describe('会话 key，格式 group:群号 或 private:QQ号'),
    token: z.string().describe('会话令牌（见唤醒提示中的【会话令牌】）'),
    category: z.enum(['activeTopic', 'pendingThought', 'memberImpression']).describe('记忆类别'),
    content: z.string().describe('记忆内容，例如话题、想说的话、对某人的印象标签'),
    extra: z.object({
      target: z.string().optional().describe('memberImpression 时的群友名字/昵称'),
      participants: z.array(z.string()).optional().describe('activeTopic 的参与者列表'),
      pendingQuestion: z.string().optional().describe('activeTopic 里还没问出口的问题'),
      motivation: z.string().optional().describe('pendingThought 的动机，如 curiosity/sociability'),
      expiresAtMs: z.number().optional().describe('pendingThought 过期毫秒数，默认 2 小时')
    }).optional().describe('附加信息')
  },
  async ({ key, token, category, content, extra }) => {
    try {
      const data = await agentApi('/api/socialV2/memory-append', {
        method: 'POST',
        body: JSON.stringify({ key, category, content, extra: extra || {} }),
        headers: { 'x-agent-token': token }
      });
      return { content: [{ type: 'text', text: serializeModelData(data) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `记忆写入失败：${error?.message ?? error}` }], isError: true };
    }
  }
);

server.tool(
  'qq_availability',
  '登记/查询/取消本会话的免打扰与「稍后联系」约定。识别由你负责：用户说“别打扰/我上班/最近忙/晚上聊/晚点再聊/改个时间/取消约定”等，先自己理解成具体时间再调用；含糊时间（“晚上聊”）先补问，不要猜。'
  + 'action=set 时：kind=daily 传 windows（可多段 HH:MM，如工作时段两段，支持跨午夜）；kind=quiet 传 startISO/endISO（一次性，带时区）；kind=later 传 contactISO（到点联系一次，带时区）；kind=indefinite 不需要时间（用户现在不想聊又没给结束时间，用户再直接找你时自动解除）。'
  + '改期=重新 set（替换旧约定）；取消用 action=cancel；不确定当前约定用 action=query。用户明确提前回来并恢复聊天、本次稍后联系已不再需要时，使用 action=returned 并传本次 planId（set 返回 planId，query 返回 plan.id）；只撤销对应的 later 约定，不取消其他免打扰计划。不按固定分钟数或单条发言自动判断用户回来。登记成功后用一句话确认具体时间，不要只嘴上答应。',
  {
    key: z.string().describe('会话 key，格式 group:群号 或 private:QQ号'),
    token: z.string().describe('会话令牌（见唤醒提示中的【会话令牌】）'),
    action: z.enum(['set', 'cancel', 'query', 'returned']).optional().describe('默认 set；returned=确认用户提前回来，撤销本次稍后联系'),
    planId: z.string().optional().describe('action=returned 必填，使用 set 返回的 planId 或 query 返回的 plan.id，防止撤销已改期的新约定'),
    kind: z.enum(['daily', 'quiet', 'later', 'indefinite']).optional().describe('set 时的约定类型'),
    windows: z.array(z.object({
      start: z.string().describe('开始时间 HH:MM（24 小时制）'),
      end: z.string().describe('结束时间 HH:MM（可跨午夜，如 22:00–08:00）')
    })).optional().describe('kind=daily 的时段列表，最多 6 段'),
    startISO: z.string().optional().describe('kind=quiet 的开始时间 ISO（必须带时区，如 2026-10-27T22:00:00+08:00）'),
    endISO: z.string().optional().describe('kind=quiet 的结束时间 ISO（必须带时区）'),
    contactISO: z.string().optional().describe('kind=later 的联系时间 ISO（必须带时区，且在未来）'),
    reason: z.string().optional().describe('简短原因，方便控制台查看，如“上班”“开会”“去忙了”')
  },
  async ({ key, token, action, planId, kind, windows, startISO, endISO, contactISO, reason }) => {
    try {
      const data = await agentApi('/api/socialV2/availability', {
        method: 'POST',
        body: JSON.stringify({ key, action: action || 'set', planId, kind, windows, startISO, endISO, contactISO, reason }),
        headers: { 'x-agent-token': token }
      });
      return { content: [{ type: 'text', text: serializeModelData(data) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `免打扰登记失败：${error?.message ?? error}` }], isError: true };
    }
  }
);

server.tool(
  'qq_task_note',
  '当前事务记忆：记录任务、承诺、随口安排的状态/进度/下一步。list 查看活跃或历史；upsert 新建或按 id 与 expectedRevision 更新。完成用 done、取消用 cancelled；不写通知流水、不因时间自动完成、不据旧笔记推定授权。存储没有15000字总上限。',
  {
    key: z.string().describe('会话 key，格式 group:群号 或 private:QQ号'),
    token: z.string().describe('会话令牌（见唤醒提示中的【会话令牌】）'),
    action: z.enum(['upsert', 'list']).describe('upsert=新建或修改事务；list=查看'),
    id: z.string().optional().describe('修改时传入已有事务ID；新建省略'),
    expectedRevision: z.number().int().optional().describe('修改时必须传 list 返回的 revision；冲突后重读'),
    title: z.string().max(240).optional(),
    detail: z.string().max(20000).optional(),
    nextAction: z.string().max(2000).optional(),
    source: z.string().max(2000).optional().describe('真实来源、日期、消息标识；未知就留空'),
    status: z.enum(['active', 'all', 'needs_review', 'pending', 'doing', 'waiting', 'done', 'cancelled', 'superseded']).optional(),
    priority: z.number().int().min(0).max(2).optional(),
    offset: z.number().int().min(0).optional(),
    limit: z.number().int().min(1).max(100).optional()
  },
  async ({ key, token, action, ...fields }) => {
    try {
      if (action === 'list') {
        const query = new URLSearchParams({ key, ...Object.fromEntries(['status', 'offset', 'limit'].filter(k => fields[k] !== undefined).map(k => [k, String(fields[k])])) });
        const data = await agentApi(`/api/socialV2/affairs?${query}`, { headers: { 'x-agent-token': token } });
        return { content: [{ type: 'text', text: serializeModelData(data) }] };
      }
      const data = await agentApi('/api/socialV2/affairs', {
        method: 'POST',
        body: JSON.stringify({ key, action, ...fields }),
        headers: { 'x-agent-token': token }
      });
      return { content: [{ type: 'text', text: serializeModelData(data) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `任务进度读写失败：${error?.message ?? error}` }], isError: true };
    }
  }
);

server.tool(
  'qq_memory_query',
  '查看当前会话的轻量记忆：当前话题、bot待说想法、当前小上下文窗口内实际发言用户的行为印象（只读）；任务/承诺用qq_task_note，稳定资料用人物档案工具。',
  {
    key: z.string().describe('会话 key，格式 group:群号 或 private:QQ号'),
    token: z.string().describe('会话令牌（见唤醒提示中的【会话令牌】）'),
    category: z.enum(['activeTopic', 'pendingThought', 'memberImpression']).optional().describe('可选：只看某一类记忆')
  },
  async ({ key, token, category }) => {
    try {
      const q = new URLSearchParams({ key });
      if (category) q.set('category', category);
      const data = await agentApi(`/api/socialV2/memory?${q.toString()}`, { headers: { 'x-agent-token': token } });
      return { content: [{ type: 'text', text: serializeModelData(data) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `记忆读取失败：${error?.message ?? error}` }], isError: true };
    }
  }
);

server.tool(
  'qq_memory_remove',
  '删除一条轻量记忆：activeTopic/pendingThought 用 content 匹配原文删除；memberImpression 用 target 参数指定群友名字删除。',
  {
    key: z.string().describe('会话 key，格式 group:群号 或 private:QQ号'),
    token: z.string().describe('会话令牌（见唤醒提示中的【会话令牌】）'),
    category: z.enum(['activeTopic', 'pendingThought', 'memberImpression']).describe('记忆类别'),
    content: z.string().optional().describe('要删除的话题/想法原文（memberImpression 不需要）'),
    target: z.string().optional().describe('memberImpression 时要删除的群友名字')
  },
  async ({ key, token, category, content, target }) => {
    try {
      const data = await agentApi('/api/socialV2/memory-remove', {
        method: 'POST',
        body: JSON.stringify({ key, category, content: content || '', target: target || '' }),
        headers: { 'x-agent-token': token }
      });
      return { content: [{ type: 'text', text: serializeModelData(data) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `记忆删除失败：${error?.message ?? error}` }], isError: true };
    }
  }
);

server.tool(
  'qq_memory_clear',
  '清空轻量记忆：不传 category 清空全部；传 activeTopic/pendingThought/memberImpression 只清空对应类别。',
  {
    key: z.string().describe('会话 key，格式 group:群号 或 private:QQ号'),
    token: z.string().describe('会话令牌（见唤醒提示中的【会话令牌】）'),
    category: z.enum(['activeTopic', 'pendingThought', 'memberImpression']).optional().describe('要清空的类别，缺省清空全部')
  },
  async ({ key, token, category }) => {
    try {
      const data = await agentApi('/api/socialV2/memory-clear', {
        method: 'POST',
        body: JSON.stringify({ key, category: category || '' }),
        headers: { 'x-agent-token': token }
      });
      return { content: [{ type: 'text', text: serializeModelData(data) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `记忆清空失败：${error?.message ?? error}` }], isError: true };
    }
  }
);

server.tool(
  'time_bubble_manage',
  '读取或调整当前会话的每日定时冒泡时段（时间、时段名和文案）。action=get 先读取完整计划与锁定状态；action=set 提交完整目标列表，未列出的未锁定项会删除，锁定项由桥接保留且不会被修改。整栏锁定时拒绝全部修改。只有用户明确分享或修改本人作息/饮食时间、且适合安排时才使用；不要推断、跨会话读取或代别人修改。',
  {
    key: z.string().describe('当前会话 key，格式 group:群号 或 private:QQ号'),
    token: z.string().min(1).describe('当前会话令牌（见唤醒提示中的【会话令牌】）'),
    action: z.enum(['get', 'set']).describe('get=读取时段和锁定状态；set=创建、修改或删除未锁定时段'),
    slots: z.array(z.object({
      id: z.string().optional(),
      hour: z.number().int().min(0).max(23),
      minute: z.number().int().min(0).max(59),
      label: z.string().max(20),
      hint: z.string().max(120).optional(),
      enabled: z.boolean().optional()
    })).max(20).optional().describe('set 时传入完整目标时段列表；不要传 locked 字段，锁由桥接保护')
  },
  async ({ key, token, action, slots }) => {
    try {
      const data = await agentApi('/api/plugins/call', {
        method: 'POST',
        body: JSON.stringify({ tool: 'time_bubble_manage', input: { key, action, slots } }),
        headers: { 'x-agent-token': token }
      });
      return { content: [{ type: 'text', text: serializeModelData(data) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `定时冒泡设置失败：${error?.message ?? error}` }], isError: true };
    }
  }
);

server.tool(
  'qq_schedule',
  '日程工具（明确提醒的讲座/考试/课程/活动/截止日期/约定/回访）。随口安排先写当前事务qq_task_note，小事不必建日程；确认需要提醒且时间具体时才action=add。leadMinutes控制提前量（默认30），intervalMinutes控制提醒间隔（默认30），完成或取消需明确依据。'
  + 'action=add 必填 title + when：when 用 ISO（带时区，如 2026-11-22T23:59:00+08:00）或「YYYY-MM-DD HH:MM」；只知道日期就省略时刻（按当天 09:00）。时间含糊（“下周”“过几天”“回头”）先补问，不要猜。'
  + 'action=list 查看当前会话未完成日程（含 id、提醒开始时刻 remindAt、间歇周期和下次提醒时间）；action=update 用 id/match 修改标题、时间、地点、描述、重复、leadMinutes、intervalMinutes；只有用户明确说“我已经去做这事了”后，才用 action=complete 确认；action=cancel 取消。不要把沉默、“知道了”或“谢谢”当作完成。'
  + '只有确实需要到点提醒的事才登记，普通话题不要记成日程。',
  {
    key: z.string().describe('会话 key，格式 group:群号 或 private:QQ号'),
    token: z.string().describe('会话令牌（见唤醒提示中的【会话令牌】）'),
    action: z.enum(['add', 'list', 'cancel', 'update', 'complete']).optional().describe('默认 add'),
    title: z.string().optional().describe('add 时必填：事情本身，如「计算机系统大作业截止」'),
    when: z.string().optional().describe('add 时必填：ISO 时间（带时区）或 YYYY-MM-DD HH:MM；只有日期按当天 09:00'),
    place: z.string().optional().describe('地点/平台，如「bb 平台」「3A 楼 101」'),
    detail: z.string().optional().describe('补充要点，如「满分 20，提交 pdf」'),
    repeat: z.enum(['none', 'daily', 'weekly']).optional().describe('重复：none（默认）/daily/weekly'),
    leadMinutes: z.number().min(0).max(1440).optional().describe('add/update 用：提前多少分钟开始提醒（0–1440；0 = 到点开始；不填用全局默认）'),
    intervalMinutes: z.number().int().min(1).max(1440).optional().describe('add/update 用：提醒开始后每隔多少分钟重复一次，1–1440；不填用全局默认，直到用户明确确认“我已经去做这事了”'),
    id: z.string().optional().describe('cancel/update/complete 时的日程 id（list 返回）'),
    match: z.string().optional().describe('cancel/update/complete 时按标题关键词匹配（不知道 id 时用）'),
    includePast: z.boolean().optional().describe('list 时是否包含已提醒过的条目'),
    limit: z.number().optional().describe('list 最多返回几条，默认 50')
  },
  async ({ key, token, action, title, when, place, detail, repeat, leadMinutes, intervalMinutes, id, match, includePast, limit }) => {
    try {
      const data = await agentApi('/api/socialV2/schedules', {
        method: 'POST',
        body: JSON.stringify({ key, action: action || 'add', title, when, place, detail, repeat, leadMinutes, intervalMinutes, id, match, includePast, limit }),
        headers: { 'x-agent-token': token }
      });
      return { content: [{ type: 'text', text: serializeModelData(data) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `日程操作失败：${error?.message ?? error}` }], isError: true };
    }
  }
);

server.tool(
  'qq_slang_query',
  '查询已确认黑话的含义与用法。当前适用来源内可检索；其他来源仅完整黑话名称匹配，不返回原始聊天证据。',
  {
    key: z.string().describe('会话 key，格式 group:群号 或 private:QQ号'),
    token: z.string().min(1).describe('会话令牌（见唤醒提示中的【会话令牌】）'),
    q: z.string().optional().describe('完整黑话名称；当前来源内可按含义检索，其他来源仅完整词名匹配')
  },
  async ({ key, token, q }) => {
    try {
      const query = q ? `&q=${encodeURIComponent(String(q))}` : '';
      const data = await agentApi(`/api/socialV2/slang/query?key=${encodeURIComponent(key)}${query}`, { headers: { 'x-agent-token': token } });
      return { content: [{ type: 'text', text: serializeModelData(data) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `查询黑话失败：${error?.message ?? error}` }], isError: true };
    }
  }
);

server.tool(
  'qq_slang_submit',
  '把你在群里经常看到但不确定含义/用法的陌生词、黑话、梗或网络表达提交给管理员筛选。提交后进入候选库，管理员确认后会被写入黑话提示词，成为你后续可查询和使用的记忆。',
  {
    key: z.string().describe('会话 key，格式 group:群号 或 private:QQ号'),
    token: z.string().describe('会话令牌（见唤醒提示中的【会话令牌】）'),
    content: z.string().describe('要提交的陌生词/黑话/梗（最多 50 字）'),
    context: z.string().optional().describe('可选：你是在什么语境/哪条消息里看到的，帮助管理员判断')
  },
  async ({ key, token, content, context }) => {
    try {
      const data = await agentApi('/api/socialV2/slang/submit', {
        method: 'POST',
        body: JSON.stringify({ key, content, context: context || '' }),
        headers: { 'x-agent-token': token }
      });
      return { content: [{ type: 'text', text: serializeModelData(data) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `提交黑话失败：${error?.message ?? error}` }], isError: true };
    }
  }
);

server.tool(
  'qq_alias_query',
  '查看成员绰号表（谁是谁）：按绰号或 QQ 号查询对应关系（只读）。认人、@人、传话时用它确认某个名字对应哪个 QQ。',
  {
    key: z.string().describe('会话 key，格式 group:群号 或 private:QQ号'),
    token: z.string().min(1).describe('会话令牌（见唤醒提示中的【会话令牌】）'),
    q: z.string().optional().describe('绰号或完整 QQ 号；跨会话仅完整匹配，空值只查当前适用名单')
  },
  async ({ key, token, q }) => {
    try {
      const query = q ? `&q=${encodeURIComponent(String(q))}` : '';
      const data = await agentApi(`/api/socialV2/alias/query?key=${encodeURIComponent(key)}${query}`, { headers: { 'x-agent-token': token } });
      return { content: [{ type: 'text', text: serializeModelData(data) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `查询绰号失败：${error?.message ?? error}` }], isError: true };
    }
  }
);

server.tool(
  'qq_alias_submit',
  '把明确或疑似称呼提交到控制台候选；一个用户可有多个绰号。QQ 无证据可留空，note 写语境；管理员编辑确认后才成为身份映射。',
  {
    key: z.string().describe('会话 key，格式 group:群号 或 private:QQ号'),
    token: z.string().min(1).describe('会话令牌（见唤醒提示中的【会话令牌】）'),
    alias: z.string().describe('绰号（如 小林）'),
    qq: z.string().optional().describe('有证据的对应 QQ；不确定可省略或留空，不能默认填发言者'),
    note: z.string().optional().describe('疑似称呼的原话语境与被称呼者线索')
  },
  async ({ key, token, alias, qq, note }) => {
    try {
      const data = await agentApi('/api/socialV2/alias/submit', {
        method: 'POST',
        body: JSON.stringify({ key, alias, qq, note: note || '' }),
        headers: { 'x-agent-token': token }
      });
      return { content: [{ type: 'text', text: serializeModelData(data) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `提交绰号失败：${error?.message ?? error}` }], isError: true };
    }
  }
);

server.tool('qq_knowledge_sources','调整一条已确认词条、黑话或绰号在当前会话的默认注入来源。高频使用且适合当前会话时 include_here；不再适用时 exclude_here。保持其他会话名单与原始证据，不能确认候选。',{key:z.string().regex(/^(group|private):[1-9]\d*$/),token:z.string().min(1),kind:z.enum(['term','slang','alias']),id:z.string().min(1).max(100),action:z.enum(['include_here','exclude_here'])},async input=>{try{const {token,...body}=input;const data=await agentApi('/api/socialV2/knowledge-sources',{method:'POST',headers:{'x-agent-token':token},body:JSON.stringify(body)});return {content:[{type:'text',text:serializeModelData(data)}]};}catch(error){return {isError:true,content:[{type:'text',text:'修改适用来源失败：'+error.message}]};}});

server.tool('qq_term_query','查询当前适用名单内的确认词条；其他会话仅完整词名/别称匹配可查，返回资料不含采集语境。',{key:z.string(),token:z.string().min(1),q:z.string().optional()},async({key,token,q})=>{
  try{const data=await agentApi('/api/socialV2/term/query?key='+encodeURIComponent(key)+'&q='+encodeURIComponent(q||''),{headers:{'x-agent-token':token}});return {content:[{type:'text',text:serializeModelData(data)}]};}
  catch(error){return {isError:true,content:[{type:'text',text:'查询词条失败：'+error.message}]};}
});
server.tool('qq_term_submit','提交共同兴趣词条候选，保留语境/公开来源，待管理员确认。游戏只收玩法机制，不收录入圈退圈；文化知识不把个人观点泛化到整个群体。',{key:z.string(),token:z.string().min(1),term:z.string().max(60),topic:z.string().max(60),category:z.enum(['游戏玩法','文化与活动','兴趣知识']).optional(),summary:z.string().max(2000).optional(),context:z.string().max(300).optional(),sources:z.array(z.string()).max(8).optional()},async({key,token,...input})=>{
  try{const data=await agentApi('/api/socialV2/term/submit',{method:'POST',headers:{'x-agent-token':token},body:JSON.stringify({key,...input})});return {content:[{type:'text',text:serializeModelData(data)}]};}
  catch(error){return {isError:true,content:[{type:'text',text:'提交词条失败：'+error.message}]};}
});

server.tool(
  'profile_get',
  '读取 JSON 人物档案。私聊只读取当前私聊用户本人；群聊只读取本轮真实发言者并返回四个固定字段。管理员私聊可按明确 QQ 号跨档案查看。不得用昵称猜 QQ 号；群聊不要读取其他成员档案。',
  { userId: z.string().regex(/^\d{1,20}$/).describe('档案对象 QQ 号'), key: z.string().regex(/^(private|group):\d+$/).describe('当前会话 key；管理员跨档案请用 private:<目标QQ>'), token: z.string().min(1).describe('当前会话令牌') },
  async ({ userId, key, token }) => {
    try {
      const data = await agentApi('/api/plugins/call', { method: 'POST', headers: { 'x-agent-token': token }, body: JSON.stringify({ tool: 'profile_get', input: { userId, key } }) });
      return { content: [{ type: 'text', text: serializeModelData(data) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `读取人物档案失败：${error?.message ?? error}` }], isError: true };
    }
  }
);

server.tool(
  'profile_update',
  '根据档案对象本人在当前会话亲自表达的信息，增改 JSON 人物档案字段。私聊只能修改本人；群聊只可修改本轮真实发言者的四个固定字段；管理员私聊可按明确 QQ 号跨档案修改。先用 profile_get 保留其他字段，再只提交需要改动的键。',
  {
    userId: z.string().regex(/^\d{1,20}$/).describe('档案对象 QQ 号'),
    key: z.string().regex(/^(private|group):\d+$/).describe('当前会话 key；管理员跨档案请用 private:<目标QQ>'),
    profile: z.record(z.string(), z.string()).describe('需要新增或修改的 JSON 字段；每个值必须是描述本人的完整字符串，只传有变化的键'),
    deleteKeys: z.array(z.string().regex(/^[a-z][a-z0-9_]{0,63}$/i)).optional().describe('删除明确指定的扩展字段；固定四个字段只能清空，不能删除'),
    token: z.string().min(1).describe('当前会话令牌')
  },
  async ({ userId, key, profile, deleteKeys, token }) => {
    try {
      const data = await agentApi('/api/plugins/call', {
        method: 'POST', headers: { 'x-agent-token': token },
        body: JSON.stringify({ tool: 'profile_update', input: { userId, key, profile, deleteKeys } })
      });
      return { content: [{ type: 'text', text: serializeModelData(data) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `修改人物档案失败：${error?.message ?? error}` }], isError: true };
    }
  }
);

server.tool(
  'private_followup_send',
  '群聊回复完成后，确认已成功送达；若本轮实际发言者值得关心，或你对其具体经历确实感兴趣并自然想了解后续，向该发言者私聊追问一句。只问一个简短、具体的问题，不复述群里回复。必须使用当前群聊 key、本轮实际发言者 QQ 和会话令牌；桥接会校验本轮发言、群/私聊关系、白名单与限频。不得用本工具代替群聊回复。',
  {
    groupKey: z.string().regex(/^group:\d+$/).describe('当前群聊 key，使用本轮唤醒提示中的 group key'),
    userId: z.string().regex(/^\d{1,20}$/).describe('本轮群消息实际发送者 QQ，不要猜测或换成其他成员'),
    text: z.string().trim().min(1).max(300).refine(value => !/[\r\n]/.test(value), '只能发送一条简短消息').describe('一句简短、具体的私聊追问'),
    token: z.string().min(1).describe('当前群聊会话令牌')
  },
  async ({ groupKey, userId, text, token }) => {
    try {
      const data = await agentApi('/api/plugins/call', {
        method: 'POST',
        headers: { 'x-agent-token': token },
        body: JSON.stringify({ tool: 'private_followup_send', input: { groupKey, userId, text } })
      });
      return { content: [{ type: 'text', text: serializeModelData(data) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `私聊追问失败：${error?.message ?? error}` }], isError: true };
    }
  }
);

// ── 图片/表情查看工具（一代/二代仿真共用） ─────────────────────────────────
if (cfg.socialV2?.tools?.getImages !== false) {
  server.tool(
    'qq_get_message_images',
    '获取指定 QQ 消息中的图片/表情，并直接以图像内容返回给模型（视觉模型可“看懂”）。当消息文本里出现 [图片]、[表情] 或 hasMedia=true 时调用。支持一条消息里的多张图片/表情；二代模式下必须携带会话令牌。**动图（GIF/动态表情）会被桥接抽帧拼成多格图再给你**：说明里会写「动图 N 帧/…s，已抽 X 帧拼成 A×B 网格，行优先 左上→右下」——按格子顺序理解动作即可，不要把它当成一张九宫格照片；没有这类说明就是静态图。体积过大的图会被自动缩放/重编码，说明里会给出原始尺寸与体积；如果真的压不到可用体积，返回里会直接写明原因（例如「超过上限」），此时如实告诉对方你看不到，不要编造画面。',
    {
      key: z.string().describe('会话 key，格式 group:群号 或 private:QQ号'),
      messageId: z.union([z.number(), z.string()]).describe('要查看的消息 id（QQ 消息 id 可为负数；二代也可用本地 seq）'),
      token: z.string().optional().describe('二代会话令牌（reserved2 下必填，见唤醒提示中的【会话令牌】）')
    },
    async ({ key, messageId, token }) => {
      try {
        const q = new URLSearchParams({ key, messageId: String(messageId) });
        const data = await agentApi(`/api/images/message?${q.toString()}`, {
          headers: token ? { 'x-agent-token': token } : {},
          timeoutMs: 180000
        });
        const images = Array.isArray(data?.images) ? data.images : [];
        if (!images.length) {
          return { content: [{ type: 'text', text: `消息 ${messageId} 没有可返回的图片/表情：${data?.note || '未找到'}` }] };
        }
        const content = [];
        const textParts = [];
        for (const img of images) {
          if (img?.data && img?.mimeType) {
            textParts.push(`[${img.kind === 'face' ? '表情' : '图片'}${img.index ?? ''}${img.text ? ' ' + img.text : ''}]`);
            content.push({ type: 'image', mimeType: img.mimeType, data: img.data });
          } else {
            textParts.push(`[${img.kind === 'face' ? '表情' : '图片'}${img.index ?? ''}${img.text ? ' ' + img.text : '（获取失败）'}]`);
          }
        }
        if (textParts.length) {
          content.unshift({ type: 'text', text: `消息 ${messageId} 的媒体内容（${images.length} 项）：\n${textParts.join('\n')}` });
        }
        return { content };
      } catch (error) {
        return { content: [{ type: 'text', text: `获取图片失败：${error?.message ?? error}` }], isError: true };
      }
    }
  );
}

// 托管图片工具：生成的图片只能回到创建它的当前会话，模型不传本机路径。
server.tool('qq_make_meme','按提示词生成梗图；可用当前会话中真实消息 ID 的图片作参考。只提交一次，返回 jobId 后用 qq_get_meme_job 查询。requestId 应由当前消息 ID 加本次序号组成，重复调用不会重复计费。',{
 key:z.string(),token:z.string().optional(),requestId:z.string().min(3).max(96),prompt:z.string().min(1),referenceMessageId:z.union([z.string(),z.number()]).optional(),automatic:z.boolean().optional()
},async({key,token,requestId,prompt,referenceMessageId,automatic})=>{
 try{const data=await agentApi('/api/images/generated',{method:'POST',headers:token?{'x-agent-token':token}:{},body:JSON.stringify({action:'create',key,token:token||'',requestId,prompt,referenceMessageId,automatic:automatic===true}),timeoutMs:30000});return {content:[{type:'text',text:serializeModelData(data)}]};}
 catch(error){return {content:[{type:'text',text:'生图提交失败：'+errorText(error?.message,'未知错误')}],isError:true};}
});
server.tool('qq_get_meme_job','查询已提交的梗图任务。完成时返回图片；图片会进入统一暂存清单，需要发送时调用 qq_list_staged_images 获取 imageId。',{
 key:z.string(),token:z.string().optional(),jobId:z.string()
},async({key,token,jobId})=>{
 try{const data=await agentApi('/api/images/generated',{method:'POST',headers:token?{'x-agent-token':token}:{},body:JSON.stringify({action:'status',key,token:token||'',jobId}),timeoutMs:30000});const content=[{type:'text',text:serializeModelData({...data,image:undefined})}];if(data.image?.data&&data.image?.mimeType)content.push({type:'image',mimeType:data.image.mimeType,data:data.image.data});return {content};}
 catch(error){return {content:[{type:'text',text:'查询生图失败：'+errorText(error?.message,'未知错误')}],isError:true};}
});
server.tool('qq_list_staged_images','列出当前会话暂存的图片：包括收到的 QQ 图片和 MCP/tool 返回图片。返回 imageId、名称和来源；资源仅属于当前会话并自动过期。',{key:z.string(),token:z.string().optional()},async({key,token})=>{
 try{const data=await agentApi('/api/images/staged',{method:'POST',headers:token?{'x-agent-token':token}:{},body:JSON.stringify({action:'list',key,token:token||''})});return{content:[{type:'text',text:serializeModelData(data)}]};}
 catch(error){return{content:[{type:'text',text:'列出暂存图片失败：'+errorText(error?.message,'未知错误')}],isError:true};}
});
server.tool('qq_import_image','把图片导入统一暂存目录。url 仅允许 HTTPS 图片地址；filePath 仅管理员私聊可读取任意本机路径。二者只能提供一个。成功后返回图片 ID、名称和图像内容。',{key:z.string(),token:z.string().optional(),url:z.string().optional(),filePath:z.string().optional(),name:z.string().optional()},async({key,token,url,filePath,name})=>{
 try{const data=await agentApi('/api/images/staged',{method:'POST',headers:token?{'x-agent-token':token}:{},body:JSON.stringify({action:'import',key,token:token||'',url,filePath,name}),timeoutMs:30000});const content=[{type:'text',text:serializeModelData({...data,image:undefined})}];if(data.image?.data&&data.image?.mimeType)content.push({type:'image',mimeType:data.image.mimeType,data:data.image.data});return{content};}
 catch(error){return{content:[{type:'text',text:'导入图片失败：'+errorText(error?.message,'未知错误')}],isError:true};}
});
server.tool('qq_send_image','把暂存图片发到当前 QQ 会话。收到 MCP/tool 图片后先用 qq_list_staged_images 按名称找到 imageId；发送回执会给出名称、来源和 QQ 消息 ID。同一图片只尝试发送一次。',{
 key:z.string(),token:z.string().optional(),imageId:z.string()
},async({key,token,imageId})=>{
 try{const data=await agentApi('/api/images/staged',{method:'POST',headers:token?{'x-agent-token':token}:{},body:JSON.stringify({action:'send',key,token:token||'',imageId}),timeoutMs:30000});const content=[{type:'text',text:serializeModelData({...data,image:undefined})}];if(data.image?.data&&data.image?.mimeType)content.push({type:'image',mimeType:data.image.mimeType,data:data.image.data});return {content};}
 catch(error){return {content:[{type:'text',text:'发图失败或结果未知，请勿自动重试：'+errorText(error?.message,'未知错误')}],isError:true};}
});
server.tool('qq_relay_image','将当前私聊的暂存图片传到一个白名单 QQ 会话。沿用传话内容闸门与限频；管理员本机图片不能跨会话传送。',{key:z.string(),token:z.string().optional(),target:z.string(),imageId:z.string(),message:z.string().optional()},async({key,token,target,imageId,message})=>{
 try{const data=await agentApi('/api/images/staged',{method:'POST',headers:token?{'x-agent-token':token}:{},body:JSON.stringify({action:'relay',key,token:token||'',target,imageId,message}),timeoutMs:30000});const content=[{type:'text',text:serializeModelData({...data,image:undefined})}];if(data.image?.data&&data.image?.mimeType)content.push({type:'image',mimeType:data.image.mimeType,data:data.image.data});return{content};}
 catch(error){return{content:[{type:'text',text:'传话发图失败或结果未知，请勿自动重试：'+errorText(error?.message,'未知错误')}],isError:true};}
});

// ── 表情包体系工具（二代仿真模式） ─────────────────────────────────────────
if (cfg.socialV2?.sticker?.enabled !== false && cfg.socialV2?.tools?.listStickers !== false) {
  server.tool(
    'qq_list_stickers',
    '查看 QQ 账号上已收藏的表情包（自定义表情）列表：包含 emoji_id、备注 desc、本地笔记 localNote、标签 tags、使用次数等。可通过 query 按备注/笔记/标签搜索；无备注的表情可以先调用 qq_get_sticker_image 看图理解，再用 qq_sticker_note 记下含义。刚新增/删除表情后如需立即同步，请传 refresh=true。',
    {
      key: z.string().describe('会话 key，格式 group:群号 或 private:QQ号'),
      token: z.string().describe('会话令牌（见唤醒提示中的【会话令牌】）'),
      query: z.string().optional().describe('可选搜索词，按备注/本地笔记/标签/用法过滤'),
      count: z.number().optional().describe('最多返回条数，默认 48，受 socialV2.sticker.maxListCount 配置上限约束（当前通常 100）'),
      refresh: z.boolean().optional().describe('是否强制从 QQ 重新同步收藏表情，默认 false（走缓存）')
    },
    async ({ key, token, query, count, refresh }) => {
      try {
        // 强制同步走 POST：GET 上的 refresh 参数会让「读接口」产生写副作用
        // （真的去问 OneBot 拉收藏表情并落盘 state/stickers.json），
        // 从而绕开控制台对所有非 GET 请求的 CSRF 防护（一个 <img src=...> 就能触发）。
        const data = await agentApi('/api/socialV2/sticker-list', {
          method: 'POST',
          headers: { 'x-agent-token': token },
          body: JSON.stringify({ key, query: query ? String(query) : '', count, refresh: refresh === true, token })
        });
        return { content: [{ type: 'text', text: serializeModelData(data) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `获取表情列表失败：${error?.message ?? error}` }], isError: true };
      }
    }
  );
}

if (cfg.socialV2?.sticker?.enabled !== false && cfg.socialV2?.tools?.getStickerImage !== false) {
  server.tool(
    'qq_get_sticker_image',
    '获取指定收藏表情的图片内容并直接以图像返回给模型（视觉模型可“看懂”）。当 qq_list_stickers 返回的表情 desc/localNote 为空、或你想确认表情实际长什么样时调用。stickerId 可用 qq_list_stickers 返回的 id / md5 / url。动图表情会被抽帧拼成多格图（行优先：左上→右下），说明里会写帧数与网格尺寸；体积过大时会自动缩放，说明里会给出原始尺寸。',
    {
      key: z.string().describe('会话 key，格式 group:群号 或 private:QQ号'),
      token: z.string().describe('会话令牌（见唤醒提示中的【会话令牌】）'),
      stickerId: z.string().describe('表情标识：emoji_id / md5 / 图片 URL（来自 qq_list_stickers）')
    },
    async ({ key, token, stickerId }) => {
      try {
        const q = new URLSearchParams({ key, stickerId: String(stickerId) });
        const data = await agentApi(`/api/socialV2/sticker-image?${q.toString()}`, { headers: { 'x-agent-token': token }, timeoutMs: 180000 });
        if (!data?.image?.data || !data?.image?.mimeType) {
          return { content: [{ type: 'text', text: `表情没有可返回的图片：${errorText(data?.error, '未知')}` }], isError: true };
        }
        const content = [
          { type: 'text', text: `表情 ${data.sticker?.id || stickerId}${data.sticker?.desc ? '（备注：' + data.sticker.desc + '）' : ''} 的图片内容：${data.note ? '（' + data.note + '）' : ''}` },
          { type: 'image', mimeType: data.image.mimeType, data: data.image.data }
        ];
        return { content };
      } catch (error) {
        return { content: [{ type: 'text', text: `获取表情图片失败：${error?.message ?? error}` }], isError: true };
      }
    }
  );
}

if (cfg.socialV2?.sticker?.enabled !== false && cfg.socialV2?.tools?.sendSticker !== false) {
  server.tool(
    'qq_send_sticker',
    '在指定会话发送一个 QQ 收藏表情包（自定义表情）。stickerId 用 qq_list_stickers 返回的 id / md5 / url。注意：一条消息只能是一张表情，不能在同一气泡里附带文字；想说的话请先用 qq_send_message / qq_reply 作为单独气泡发送，再单独发这张表情。需要引用/点名时可用 replyToMessageId / atUserId（群聊）。真人偶尔用表情包很自然，但别刷屏。',
    {
      key: z.string().describe('会话 key，格式 group:群号 或 private:QQ号'),
      token: z.string().describe('会话令牌（见唤醒提示中的【会话令牌】）'),
      stickerId: z.string().describe('表情标识：emoji_id / md5 / 图片 URL（来自 qq_list_stickers）'),
      replyToMessageId: z.union([z.number(), z.string()]).optional().describe('要引用/回复的消息 id（非零整数，可为负数，可选）'),
      atUserId: z.union([z.number(), z.string()]).optional().describe('要 @ 的群成员 QQ 号（群聊中可选，私聊不可用）')
    },
    async ({ key, token, stickerId, replyToMessageId, atUserId }) => {
      try {
        const data = await agentApi('/api/socialV2/send-sticker', {
          method: 'POST',
          body: JSON.stringify({ key, stickerId: String(stickerId), replyToMessageId, atUserId: atUserId ?? null }),
          headers: { 'x-agent-token': token },
          timeoutMs: 300000
        });
        return { content: [{ type: 'text', text: serializeModelData(data) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `发送表情失败：${error?.message ?? error}` }], isError: true };
      }
    }
  );
}

if (cfg.socialV2?.sticker?.enabled !== false && cfg.socialV2?.tools?.collectSticker !== false) {
  server.tool(
    'qq_collect_sticker',
    '收藏当前会话里别人发的一张表情/图片到你的 QQ 收藏表情，并可写一句简短备注（如“好图偷了，兄弟”）。messageId 用 qq_get_unread_messages / qq_get_recent_messages 返回的 messageId 或 seq。注意：不要频繁收藏，只在真的觉得有意思/好用/戳中你时才偷图；收藏后你可以在 qq_list_stickers 里看到并继续使用。',
    {
      key: z.string().describe('会话 key，格式 group:群号 或 private:QQ号'),
      token: z.string().describe('会话令牌（见唤醒提示中的【会话令牌】）'),
      messageId: z.string().describe('要收藏的那条消息的 messageId 或 seq（来自 qq_get_unread_messages / qq_get_recent_messages）'),
      remark: z.string().optional().describe('简短备注，最多 20 字，例如“好图偷了，兄弟”')
    },
    async ({ key, token, messageId, remark }) => {
      try {
        const data = await agentApi('/api/socialV2/collect-sticker', {
          method: 'POST',
          body: JSON.stringify({ key, messageId: String(messageId), remark: remark || '' }),
          headers: { 'x-agent-token': token },
          timeoutMs: 60000
        });
        return { content: [{ type: 'text', text: serializeModelData(data) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `收藏表情失败：${error?.message ?? error}` }], isError: true };
      }
    }
  );
}

if (cfg.socialV2?.tools?.sendFile !== false) {
  server.tool(
    'qq_send_file',
    '把本机上的一个文件通过 QQ 私聊发给管理员（仅 owner 私聊可用）。用于管理员开发模式：让 AI 读取/生成文件（日志、截图、导出的数据、脚本产物等）后发给自己。filePath 传本机路径（绝对路径，或相对 qq-bridge 仓库根目录）；name 是 QQ 里的显示文件名（可选）。一次只发一个文件，默认上限 100MB。不要在普通群聊/陌生人会话里尝试（会被拒绝）。',
    {
      key: z.string().describe('会话 key，必须是管理员私聊 private:<ownerQQ>'),
      token: z.string().describe('会话令牌（见唤醒提示中的【会话令牌】）'),
      filePath: z.string().describe('本机文件路径（绝对路径，或相对 qq-bridge 仓库根目录）'),
      name: z.string().optional().describe('可选：QQ 里显示的文件名，默认用磁盘文件名')
    },
    async ({ key, token, filePath, name }) => {
      try {
        const data = await agentApi('/api/socialV2/send-file', {
          method: 'POST',
          body: JSON.stringify({ key, filePath: String(filePath), name: name || '', token }),
          headers: { 'x-agent-token': token },
          timeoutMs: 300000
        });
        return { content: [{ type: 'text', text: serializeModelData(data) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: '发送文件失败：' + (error?.message ?? error) }], isError: true };
      }
    }
  );
}

if (cfg.socialV2?.voice?.enabled !== false && cfg.socialV2?.tools?.sendVoice !== false) {
  server.tool(
    'qq_send_voice',
    '在指定会话发一条 QQ 语音（把语音库里准备好的音频当语音条发出去）。voice 传 qq_list_voices 返回的 name（文件名，可带子目录），也可以直接传语音库里的文件名（不带扩展名也能匹配）。注意：① 只能发语音库（qq-bridge/audio/）里的文件，不能发任意本地路径，也不能发 URL/base64；② 受时长与频率上限约束（见 qq_list_voices 的 limits），超限会被拒绝；③ 语音是「开口说话」的强表达，别滥用，闲聊里偶尔发一条即可；④ 返回的 verified=true 表示已经用 get_msg 回读到这条消息的 record 段（语音确实落地了）—— 只有 verified=true 才能对用户说你发了语音；⑤ readback 只对「收到的」语音有意义（QQ 会转写别人的语音），自己发的语音一般拿不到转写文本，默认关闭，别依赖它。',
    {
      key: z.string().describe('会话 key，格式 group:群号 或 private:QQ号'),
      token: z.string().describe('会话令牌（见唤醒提示中的【会话令牌】）'),
      voice: z.string().describe('语音库里的文件名（来自 qq_list_voices 的 name，可带子目录/可省略扩展名）'),
      label: z.string().optional().describe('可选：写进会话记录里的说明，如「说了句晚安」'),
      verify: z.boolean().optional().describe('是否回读校验语音已落地（默认 true，建议保持开启）'),
      readback: z.boolean().optional().describe('是否额外索取 QQ 转写文本（自己发的语音通常没有，默认 false）')
    },
    async ({ key, token, voice, label, verify, readback }) => {
      try {
        const data = await agentApi('/api/socialV2/send-voice', {
          method: 'POST',
          body: JSON.stringify({
            key,
            voice: String(voice),
            label: label || '',
            verify: verify !== false,
            readback: readback === true,
            token
          }),
          headers: { 'x-agent-token': token },
          timeoutMs: 300000
        });
        return { content: [{ type: 'text', text: serializeModelData(data) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `发送语音失败：${error?.message ?? error}` }], isError: true };
      }
    }
  );

  server.tool(
    'qq_list_voices',
    '查看可用的语音库（qq-bridge 的 audio 目录里准备好的音频文件）：文件名、时长、大小。想发语音前先调用这个看有哪些能发（名字用返回的 name）。返回里 limits 是时长/体积/频率上限。语音库里没有合适内容时不要硬发，也不要假装发了语音。',
    {
      key: z.string().describe('会话 key，格式 group:群号 或 private:QQ号'),
      token: z.string().describe('会话令牌（见唤醒提示中的【会话令牌】）'),
      probe: z.boolean().optional().describe('是否逐个探测时长（默认 true；文件多时可传 false 加快）')
    },
    async ({ key, token, probe }) => {
      try {
        const q = new URLSearchParams({ key });
        if (probe === false) q.set('probe', '0');
        const data = await agentApi(`/api/socialV2/voices?${q.toString()}`, { headers: { 'x-agent-token': token } });
        return { content: [{ type: 'text', text: serializeModelData(data) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `获取语音库失败：${error?.message ?? error}` }], isError: true };
      }
    }
  );
}

if (cfg.socialV2?.tools?.getSelfImage !== false) {
  server.tool(
    'qq_get_self_image',
    '查看你自己的默认 Q 版形象图片（DeepSeek AI助手形象）。当你被问“你长什么样/发张自拍/你是什么形象”时，可以调用这个工具看自己的样子；返回的图片会直接进入你的视觉上下文。',
    {
      key: z.string().describe('会话 key，格式 group:群号 或 private:QQ号'),
      token: z.string().describe('会话令牌（见唤醒提示中的【会话令牌】）')
    },
    async ({ key, token }) => {
      try {
        const q = new URLSearchParams({ key });
        const data = await agentApi(`/api/socialV2/self-image?${q.toString()}`, { headers: { 'x-agent-token': token } });
        if (!data?.image?.data || !data?.image?.mimeType) {
          return { content: [{ type: 'text', text: `没有可返回的形象图片：${errorText(data?.error, '未知')}` }], isError: true };
        }
        return {
          content: [
            { type: 'text', text: '这是你的默认 Q 版形象：' },
            { type: 'image', mimeType: data.image.mimeType, data: data.image.data }
          ]
        };
      } catch (error) {
        return { content: [{ type: 'text', text: `获取形象图片失败：${error?.message ?? error}` }], isError: true };
      }
    }
  );
}

if (cfg.socialV2?.sticker?.enabled !== false && cfg.socialV2?.tools?.stickerNote !== false) {
  server.tool(
    'qq_sticker_note',
    '给一个收藏表情记录你自己的理解/备注/标签/用法，供以后选择表情时参考。这是本地记忆，不会修改 QQ 账号的官方备注；适合对没有备注的表情看图后记住含义。',
    {
      key: z.string().describe('会话 key，格式 group:群号 或 private:QQ号'),
      token: z.string().describe('会话令牌（见唤醒提示中的【会话令牌】）'),
      stickerId: z.string().describe('表情标识：emoji_id / md5 / 图片 URL（来自 qq_list_stickers）'),
      note: z.string().optional().describe('你理解的表情含义/适合场景，最多 200 字'),
      tags: z.array(z.string()).optional().describe('可选标签，如 ["嘲讽","笑哭","怼人"]'),
      usage: z.string().optional().describe('可选用法说明，最多 200 字')
    },
    async ({ key, token, stickerId, note, tags, usage }) => {
      try {
        const payload = { key, stickerId: String(stickerId) };
        if (note !== undefined && note !== null) payload.note = String(note);
        if (tags !== undefined && tags !== null) payload.tags = Array.isArray(tags) ? tags.map(String) : [];
        if (usage !== undefined && usage !== null) payload.usage = String(usage);
        const data = await agentApi('/api/socialV2/sticker-note', {
          method: 'POST',
          body: JSON.stringify(payload),
          headers: { 'x-agent-token': token }
        });
        return { content: [{ type: 'text', text: serializeModelData(data) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `记录表情备注失败：${error?.message ?? error}` }], isError: true };
      }
    }
  );
}

if (cfg.socialV2?.sticker?.enabled !== false && cfg.socialV2?.tools?.setStickerRemark !== false) {
  server.tool(
    'qq_set_sticker_remark',
    '修改 QQ 账号里收藏表情的官方备注（desc）。这是写操作，会直接影响 QQ 账号的表情备注；仅在管理员明确允许（socialV2.tools.setStickerRemark=true）时可用。一般优先用 qq_sticker_note 记录自己的理解，不要随意改官方备注。',
    {
      key: z.string().describe('会话 key，格式 group:群号 或 private:QQ号'),
      token: z.string().describe('会话令牌（见唤醒提示中的【会话令牌】）'),
      stickerId: z.string().describe('表情标识：emoji_id / md5 / 图片 URL（来自 qq_list_stickers）'),
      remark: z.string().describe('新的表情备注，最多 50 字')
    },
    async ({ key, token, stickerId, remark }) => {
      try {
        const data = await agentApi('/api/socialV2/sticker-remark', {
          method: 'POST',
          body: JSON.stringify({ key, stickerId: String(stickerId), remark: String(remark || '') }),
          headers: { 'x-agent-token': token }
        });
        return { content: [{ type: 'text', text: serializeModelData(data) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `修改表情备注失败：${error?.message ?? error}` }], isError: true };
      }
    }
  );
}

// ── 合并转发消息查看工具（二代仿真模式） ────────────────────────────────────
if (cfg.socialV2?.tools?.getForwardMsg !== false) {
  server.tool(
    'qq_get_forward_msg',
    '查看当前会话中出现的合并转发消息/聊天记录内容（只读）。当消息文本里出现 `[转发消息 id=...]`，或 `qq_get_unread_messages` / `qq_get_recent_messages` / `qq_get_message_detail` 返回的某条消息带 `forwardIds` / `hasForward: true` 时调用。只能查看当前会话确实收到过的转发消息 id，不能任意读取。返回内容会包含每条消息的 text、media（图片/表情元数据）与 nestedForwardIds；如果合并转发里有图片，工具会直接把最多 5 张图片以图像内容返回给视觉模型；如果里面有嵌套合并转发，会附带嵌套转发 id 和前几条预览，必要时可继续用本工具查看嵌套 id。',
    {
      key: z.string().describe('会话 key，格式 group:群号 或 private:QQ号'),
      token: z.string().describe('会话令牌（见唤醒提示中的【会话令牌】）'),
      id: z.string().describe('合并转发消息 id（来自消息里的 [转发消息 id=...] 或 forwardIds 数组）')
    },
    async ({ key, token, id }) => {
      try {
        const q = new URLSearchParams({ key, id: String(id) });
        const data = await agentApi(`/api/socialV2/forward-message?${q.toString()}`, {
          headers: { 'x-agent-token': token },
          timeoutMs: 120000
        });
        const content = [{ type: 'text', text: serializeModelData(data) }];
        // 收集所有层级的图片/表情元数据（含嵌套预览），最多返回 5 张。
        const images = [];
        const seen = new Set();
        const collectMedia = (msgs) => {
          if (!Array.isArray(msgs)) return;
          for (const m of msgs) {
            if (!m || typeof m !== 'object') continue;
            for (const media of Array.isArray(m.media) ? m.media : []) {
              if (!media || typeof media !== 'object') continue;
              const keyId = media.url || media.file || media.faceId || '';
              if (!keyId || seen.has(keyId)) continue;
              seen.add(keyId);
              images.push(media);
            }
          }
        };
        collectMedia(data?.messages);
        if (Array.isArray(data?.nestedPreviews)) {
          for (const np of data.nestedPreviews) collectMedia(np?.messages);
        }
        const MAX_IMAGES = 5;
        const imageTexts = [];
        if (images.length) {
          try {
            const mediaRes = await agentApi('/api/socialV2/forward-media', {
              method: 'POST',
              body: JSON.stringify({ key, media: images.slice(0, MAX_IMAGES) }),
              headers: { 'x-agent-token': token },
              timeoutMs: 180000
            });
            const mediaImages = Array.isArray(mediaRes?.images) ? mediaRes.images : [];
            for (const img of mediaImages) {
              if (img?.data && img?.mimeType) {
                content.push({ type: 'image', mimeType: img.mimeType, data: img.data });
                imageTexts.push(`[转发内图片${img.index != null ? ' ' + img.index : ''}${img.text ? ' ' + img.text : ''}]`);
              } else {
                imageTexts.push(`[转发内图片${img.index != null ? ' ' + img.index : ''}（${img.text || '获取失败'}）]`);
              }
            }
          } catch (error) {
            imageTexts.push(`[转发内图片（批量获取失败：${error?.message ?? error}）]`);
          }
        }
        if (imageTexts.length) {
          content.unshift({ type: 'text', text: `合并转发 ${id} 的图片内容（${imageTexts.length} 项）：\n${imageTexts.join('\n')}` });
        }
        return { content };
      } catch (error) {
        return { content: [{ type: 'text', text: `查看合并转发失败：${error?.message ?? error}` }], isError: true };
      }
    }
  );
}

// ── 账户余额：有效私聊/群聊可查档位，管理员私聊可看账户金额 ──
server.tool(
  'deepseek_balance',
  '只读查询AI助手的账户余额（DeepSeek API余额）和最近变化。已授权私聊/群聊可查调用额度档位及补充状态，具体账户金额只在管理员私聊返回。偏少、见底、空了或刚补充时按当前形态自然接话，普通形态可清晰友好交流；带唤醒提示中的会话令牌。查询失败不等于存量为零，不改额度策略。',
  { token: z.string().describe('你的会话令牌（见唤醒提示中的【会话令牌】）') },
  async ({ token }) => {
    try {
      const data = await agentApi('/api/plugins/call', {
        method: 'POST',
        headers: { 'x-agent-token': token },
        body: JSON.stringify({ tool: 'deepseek_balance', input: {} }),
        timeoutMs: 20000
      });
      return { content: [{ type: 'text', text: serializeModelData(data) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `查询 DeepSeek API 余额失败：${error?.message ?? error}` }], isError: true };
    }
  }
);

// ── L 层任务委派会话工具（life-task-session 插件；桥接执行 + 仅管理员会话可用） ──
server.tool(
  'qq_task_spawn',
  '在 DSH 里启动一个独立任务会话（qq-task-worker，用户在界面「AI助手任务」工作区可见）：把需要长时间、多步骤、或要独立完成的任务交给它；它独立执行，缺少输入时通过任务状态返回；完成或待补充时桥接会唤醒你，用 qq_task_result 取结果再向管理员汇报。仅管理员（管理员）会话可用，其它会话调用会被拒绝。',
  {
    token: z.string().describe('你的会话令牌（见唤醒提示中的【会话令牌】）'),
    title: z.string().describe('任务标题（简短，会显示在 DSH 工作区）'),
    task: z.string().describe('任务说明：目标、背景、约束、期望产物，写清楚')
  },
  async ({ token, title, task }) => {
    try {
      const data = await agentApi('/api/plugins/call', {
        method: 'POST',
        headers: { 'x-agent-token': token },
        body: JSON.stringify({ tool: 'task_spawn', input: { token, title, task } }),
        timeoutMs: 120000
      });
      return { content: [{ type: 'text', text: serializeModelData(data) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `启动任务会话失败：${error?.message ?? error}` }], isError: true };
    }
  }
);

server.tool(
  'qq_task_list',
  '列出你（管理员会话）启动过的任务会话：id、标题、状态（running/waiting_input/done/failed/cancelled）、时间与结果预览。仅管理员（管理员）会话可用。',
  { token: z.string().describe('你的会话令牌（见唤醒提示中的【会话令牌】）') },
  async ({ token }) => {
    try {
      const data = await agentApi('/api/plugins/call', {
        method: 'POST',
        headers: { 'x-agent-token': token },
        body: JSON.stringify({ tool: 'task_list', input: { token } }),
        timeoutMs: 30000
      });
      return { content: [{ type: 'text', text: serializeModelData(data) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `查询任务列表失败：${error?.message ?? error}` }], isError: true };
    }
  }
);

server.tool(
  'qq_task_result',
  '取某个任务会话的结果：status（running/waiting_input/done/failed/cancelled）、汇报文本或错误信息。任务会话结束后（带 [任务完成] 标记）调用它，然后把结果自然地向管理员转达。仅管理员（管理员）会话可用。',
  {
    token: z.string().describe('你的会话令牌（见唤醒提示中的【会话令牌】）'),
    taskId: z.string().describe('qq_task_spawn 返回的 taskId')
  },
  async ({ token, taskId }) => {
    try {
      const data = await agentApi('/api/plugins/call', {
        method: 'POST',
        headers: { 'x-agent-token': token },
        body: JSON.stringify({ tool: 'task_result', input: { token, taskId } }),
        timeoutMs: 30000
      });
      return { content: [{ type: 'text', text: serializeModelData(data) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `获取任务结果失败：${error?.message ?? error}` }], isError: true };
    }
  }
);

server.tool(
  'qq_task_input',
  '向已有独立任务补充需求或回答问题，继续同一 taskId；只传任务所需输入，不附带聊天人设或唤醒提示词。requestId 为本次输入的稳定唯一编号，重试复用它。仅管理员会话可用。',
  {
    token: z.string().describe('当前聊天会话令牌，只交给桥接验证'),
    taskId: z.string().describe('需要继续的 taskId'),
    input: z.string().min(1).max(20000).describe('补充需求或用户回答'),
    requestId: z.string().regex(/^[a-zA-Z0-9._:-]{1,100}$/).describe('本次输入唯一编号；同一次输入的重试必须保持不变'),
    replyToRequest: z.string().optional().describe('回答 task_result.pendingRequests 中的确切请求 id；普通补充输入省略'),
    decision: z.enum(['allowed-once','rejected']).optional().describe('权限决定，仅在用户明确同意或拒绝该项操作后填写'),
    answers: z.array(z.object({id:z.string(),selected:z.array(z.string()),custom:z.string().max(20000).optional()})).optional().describe('结构化问题的完整回答；id 与选项来自 pendingRequests.questions'),
  },
  async ({token,taskId,input,requestId,replyToRequest,decision,answers}) => {
    try {
      const data = await agentApi('/api/plugins/call', {
        method:'POST', headers:{'x-agent-token':token},
        body:JSON.stringify({tool:'task_input',input:{token,taskId,input,requestId,replyToRequest,decision,answers}}),timeoutMs:30000,
      });
      return {content:[{type:'text',text:serializeModelData(data)}]};
    } catch (error) {
      return {content:[{type:'text',text:`任务输入未确认：${error?.message ?? error}`}],isError:true};
    }
  }
);

server.tool(
  'qq_task_cancel',
  '终止某个在跑的任务会话（取消当前回合并标记为 cancelled）。管理员说「终止/停掉/取消/别干了」某个任务时用它。仅管理员（管理员）会话可用。',
  {
    token: z.string().describe('你的会话令牌（见唤醒提示中的【会话令牌】）'),
    taskId: z.string().describe('要终止的任务 taskId')
  },
  async ({ token, taskId }) => {
    try {
      const data = await agentApi('/api/plugins/call', {
        method: 'POST',
        headers: { 'x-agent-token': token },
        body: JSON.stringify({ tool: 'task_cancel', input: { token, taskId } }),
        timeoutMs: 30000
      });
      return { content: [{ type: 'text', text: serializeModelData(data) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `终止任务失败：${error?.message ?? error}` }], isError: true };
    }
  }
);

// ── 自查与桌面便签（tool-user-checking 插件；机主授权的一点点本机权限） ──
server.tool(
  'user_checking',
  '自查与桌面便签（机主已授权，不用每次讨许可）。action=status 读本机运行状态（只读指标：负载/内存/磁盘/进程，不含任何本机路径）；action=note 往桌面上机主指定的 txt 追加一句你想说的话（只追加，不覆盖不删除，一次一句、别太长）。',
  {
    token: z.string().describe('你的会话令牌（见唤醒提示中的【会话令牌】）'),
    action: z.enum(['status', 'note']).describe('status=看本机状态；note=写桌面便签'),
    text: z.string().optional().describe('action=note 时要写的话（一句，短一点）'),
    milkEventId: z.string().optional().describe('调用额度变化便签带上下文给出的事件ID，跨会话同一事件只写一次')
  },
  async ({ token, action, text, milkEventId }) => {
    try {
      const data = await agentApi('/api/plugins/call', {
        method: 'POST',
        headers: { 'x-agent-token': token },
        body: JSON.stringify({ tool: 'user_checking', input: { action, text, milkEventId } }),
        timeoutMs: 20000
      });
      return { content: [{ type: 'text', text: serializeModelData(data) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `自查失败：${error?.message ?? error}` }], isError: true };
    }
  }
);

registerBilibiliTools(server, { enabled: cfg.bilibili?.enabled !== false, agentApi });
await server.connect(new StdioServerTransport());
