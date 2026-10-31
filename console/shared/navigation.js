
import { loadPageData } from './page-loaders.js';
import { componentUI } from './components/service.js';
import { renderSnowlumaHealth, refresh } from '../layers/O/status.js';
import { refreshSessions, refreshPending } from '../layers/E/sessions.js';
import { loadVoiceLibrary } from '../layers/E/voice.js';
import { refreshV2Activity } from '../layers/L/activity.js';
import { refreshSocialStatus } from '../layers/L/social-v1.js';
import { closeConsoleSearch } from './accessibility.js';
import { refreshUsageDashboard } from '../layers/O/usage.js';
// shared/navigation: explicit imports; initialize is called in the application startup order.







let consolePages;

let currentConsolePage;

let toastTimer;

function showConsoleToast(message) {
  const toast = document.getElementById('consoleToast');
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 4200);
}

function setConsolePage(page, { updateHash = true, focus = false, target = '' } = {}) {
  if (!Object.hasOwn(consolePages, page)) page = 'overview';
  currentConsolePage = page;
  document.querySelectorAll('[data-page]').forEach(el => { el.hidden = el.dataset.page !== page; });
  document.querySelectorAll('#mainNav [data-view]').forEach(button => {
    const selected = button.dataset.view === page;
    button.classList.toggle('active', selected);
    if (selected) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  document.getElementById('breadcrumbPage').textContent = consolePages[page][0];
  document.getElementById('pageTitle').textContent = consolePages[page][1];
  document.getElementById('pageDescription').textContent = consolePages[page][2];
  document.title = consolePages[page][0] + ' · QQ 桥接控制台';
  if (updateHash && location.hash !== '#' + page) history.pushState({}, '', '#' + page);
  closeConsoleSearch();
  // 语音库按需加载：进入二代仿真页时才探测（避免每次开控制台都压网关）。
  void loadPageData(page);
  if (page === 'v2-e' && typeof loadVoiceLibrary === 'function') loadVoiceLibrary();
  const messageAckPage = document.getElementById('messageAckComponentRoot')?.closest('section[data-page]')?.dataset.page;
  if (page === messageAckPage && typeof componentUI.loadMessageAck === 'function') componentUI.loadMessageAck();
  // Load usage after the initial route has been applied, so first-page data
  // follows the same path as navigation and cannot race a bootstrap request.
  if (page === 'usage' && typeof refreshUsageDashboard === 'function') void refreshUsageDashboard();
  if (focus) {
    document.getElementById('mainContent').focus({ preventScroll: true });
    document.getElementById(target || 'mainContent')?.scrollIntoView({ block: 'start', behavior: 'instant' });
  }
}

async function readLiveConsoleSource() {
  const url = new URL('/', location.origin);
  url.searchParams.set('__console_refresh_check', String(Date.now()));
  const response = await fetch(url, { cache: 'no-store', headers: { 'Cache-Control': 'no-cache', 'x-console-token': localStorage.getItem('consoleToken') || '' } });
  if (!response.ok) throw new Error('console source check failed');
  return response.text();
}

let initialConsoleSource;

let sidebarRefreshCheckInProgress;

let pendingSidebarNavigation;

function updateOverview(status, modeLabel) {
  const connection = document.getElementById('statusText');
  connection.textContent = status.dshReady ? 'DSH 已连接' : 'DSH 未连接';
  connection.className = 'status-badge ' + (status.dshReady ? 'online' : 'offline');
  document.getElementById('metricDsh').textContent = status.dshReady ? '已连接' : '未连接';
  document.getElementById('metricDsh').className = status.dshReady ? 'ok' : 'err';
  document.getElementById('metricDshHint').textContent = status.dshReady ? '桥接状态已同步' : '请检查 DSH 是否运行';
  renderSnowlumaHealth(status.snowluma);
  document.getElementById('metricMode').textContent = modeLabel.replace('模式', '');
  document.getElementById('metricRole').textContent = '角色 · ' + (status.role || '默认人格');
  document.getElementById('accessSummary').textContent = '管理员 ' + (status.ownerQQ || '未设置') + ' · ' + (status.allowGroups || []).length + ' 个白名单群 · ' + (status.allowPrivate || []).length + ' 位白名单好友';
  document.getElementById('lastUpdated').textContent = '状态同步于 ' + new Date().toLocaleTimeString('zh-CN', { hour12: false });
  document.getElementById('connectionAlert').hidden = true;
  const silent = status.roleMode === 'silent';
  for (const [id, active] of [['silentOn', silent], ['silentOff', !silent]]) {
    const button = document.getElementById(id);
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  }
}

function setConnectionError(error) {
  document.getElementById('statusText').className = 'status-badge offline';
  document.getElementById('metricDsh').textContent = '连接中断';
  document.getElementById('metricDsh').className = 'err';
  document.getElementById('metricDshHint').textContent = '当前状态可能已过期';
  // 上游健康也一起过期：桥接都联系不上时，别让上一次的 SnowLuma 结论继续挂着。
  document.getElementById('metricSnowluma').textContent = '未知';
  document.getElementById('metricSnowluma').className = '';
  document.getElementById('metricSnowlumaHint').textContent = '当前状态可能已过期';
  document.getElementById('snowlumaWarn').style.display = 'none';
  const alert = document.getElementById('connectionAlert');
  alert.textContent = error.message === '未授权' ? '访问令牌无效或已取消输入。请使用启动日志中的控制台链接重新打开。' : '无法连接桥接服务，当前显示的是上次同步结果。请检查桥接是否运行，再点击右上角刷新。';
  alert.hidden = false;
}

export function initialize() {
consolePages = {
  'context-visual': ['可视化 context', '可视化 context', '选择发给 AI 的背景信息，调整顺序，并查看上次实际发送的内容。'],
  'setting-c-0': ['心情与表情', '心情与表情', '设置双形态、心情加减规则和欢迎冷却；查看真实结算。'],
  'setting-c-1': ['上下文与记忆', '上下文与记忆', '管理当前事务、轻量记忆和持久记忆的读取范围。'],
  'setting-c-2': ['会话背景', '会话背景', '按 QQ 管理人物档案、专业问答限额与会话背景。'],
  'setting-l-0': ['生命周期组件', '生命周期组件', '设置来信唤醒、思考补话和回合收尾，查看免打扰与实时状态。'],
  'setting-l-1': ['发送与等待', '发送与等待', '设置开口时机、发送间隔与分条回复限制。'],
  'setting-l-2': ['主动行为', '主动行为', '设置定时冒泡、话题跟进、日程提醒与起床问候。'],
  'setting-o-0': ['质量与工具日志', '质量与工具日志', '查看调用记录、反馈与失败原因。'],
  'setting-o-1': ['日记、日报与反馈', '日记、日报与反馈', '分别管理会话日记、运维日报与用户反馈。'],
  'setting-o-2': ['自我更新与摘要', '自我更新与摘要', '设置自查频率、摘要与改进记录。'],
  overview: ['运行总览', '让每一次连接，都自然发生。', '掌握桥接状态，轻松管理你的 QQ 智能伙伴。'],
  sessions: ['会话与审批', '让每一段对话，都有迹可循。', '查看 QQ 与 DSH 的会话映射，以及等待你回复的审批和提问。'],
  persona: ['人格与角色', '给你的伙伴，一点独特个性。', '选择已有角色，或用自己的语言写下新的性格与表达方式。'],
  'v2-t': ['工具开关', '工具开关', '勾选 AI 可以调用的工具。'],
  'games': ['Games', 'Games · 独立互动 MCP', '查看 Games T 层工具、玩法与互动边界。'],
  'codex-peer': ['Codex Peer', 'Codex Peer · AI助手与 Codex 专用通道', '管理端专用 Codex 通信工具与组件设置。'],
  'injection-lab': ['提示词注入实验室', '提示词注入实验室 · 免疫 + 嘴炮', '管理注入免疫、对线工具与组件设置。'],
  'v2-e': ['语音', '语音', '管理语音库与发送设置。'],
  'social-v1': ['一代仿真', '为自然对话，设定合适的节奏。', '调整参与概率、活跃周期和分条发送。'],
  slang: ['黑话词库', '读懂群聊里的，言外之意。', '从候选到确认，让 AI 逐渐熟悉大家的表达习惯。'],
  alias: ['成员绰号', '记住每个名字，对应到每个人。', '维护「绰号 → QQ号」映射：手动添加、自动提取候选、确认后注入提示词供 AI 认人/传话。'],
  terms: ['词条学习', '把共同兴趣，变成有来源的知识。', '学习实际玩法、兴趣术语、公开活动与文化；候选由管理员审核，确认后按语境使用。'],
  usage: ['令牌与花费', '每一次思考，都算得清楚。', '实时查看 AI 的 token 消耗与花费，可下钻到每个群、每个好友、每一轮对话。'],
  access: ['访问与安全', '明确边界，安心连接。', '管理允许对话的对象、管理员权限与控制台访问凭证。'],
  operations: ['调试与运维', '让桥接，始终井然有序。', '测试消息、引导 AI，或维护桥接进程与会话工作区。'],
  "environment-chat": ["普通聊天环境","普通聊天环境","管理普通聊天可用的会话辅助功能。"],
  "environment-admin": ["管理员环境","管理员环境","管理员私聊的开发模式与预设。"],
  "environment-web": ["网站操控","网站操控","管理打开网页、点击按钮、填写表单等通用网页操作。"],
  "environment-watch": ["网页监督","网页监督","设置监控网址、检查间隔及监控时的浏览器运行方式。"],
  "environment-scripts": ["脚本协同","脚本协同","添加脚本地址；执行与搜索约定显示在对应地址下方。"],
  "images": ["图片","图片","设置 OpenAI 图片接口、图片额度与本机密钥。"],
  "video": ["视频","视频","预留栏目；尚未接入视频生成或处理服务。"],
  'layer-v': ['失败回归', '失败回归', '将失败记录整理为可复查的用例。'],
  'human': ['human', 'HUMAN IN THE LOOP', '我也是一个组件。'],
  'layer-s': ['私人资料库', '私人资料库', '挂载个人思想与知识资料包，按目录选择、按需读取原文。'],
  reference: ['工具参考', '每一种能力，都清晰可见。', '查看桥接提供给 DSH 的 MCP 工具与用途。'],
  registry: ['扩展组件', '扩展组件', '查看接入的扩展项目。']
};
currentConsolePage = 'overview';
initialConsoleSource = readLiveConsoleSource().catch(() => '');
sidebarRefreshCheckInProgress = false;
pendingSidebarNavigation = null;
document.addEventListener('click', async event => {
  const nav = event.target.closest('#mainNav .nav-item[data-view]');
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
      history.replaceState({}, '', location.pathname + location.search + '#' + targetNav.dataset.view);
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
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => {
  setConsolePage(button.dataset.view, { focus: true, target: button.dataset.target });
}));
window.addEventListener('hashchange', () => {
  const page = location.hash.slice(1);
  if (Object.hasOwn(consolePages, page) || !page) setConsolePage(page, { updateHash: false });
});
document.querySelector('.skip-link').addEventListener('click', event => {
  event.preventDefault();
  document.getElementById('mainContent').focus();
  document.getElementById('mainContent').scrollIntoView({ block: 'start', behavior: 'instant' });
});
document.getElementById('refreshConsole').addEventListener('click', async function () {
  this.disabled = true;
  await Promise.allSettled([refresh(), refreshSessions(), refreshPending(), refreshSocialStatus(), refreshV2Activity()]);
  this.disabled = false;
  if (document.getElementById('connectionAlert').hidden) showConsoleToast('运行状态已刷新');
});
}
export { consolePages, currentConsolePage, toastTimer, showConsoleToast, setConsolePage, readLiveConsoleSource, initialConsoleSource, sidebarRefreshCheckInProgress, pendingSidebarNavigation, updateOverview, setConnectionError };
