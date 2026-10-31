// qq-launcher —— 客户端半边：把「AI助手红绿灯 + 一键启动」挂到 Windows 标题栏
// 「应用 / 编辑」右边的同一行里。
//
// 实现约束（都是实测出来的，别改回去）：
//   1) 标题栏那条 menubar 是 DSH 桌面 preload 注入的 `<div data-windows-menu>`，
//      shadow DOM 封着「应用 / 编辑」两个按钮；我们**不碰它的 shadow**，
//      只量它的 getBoundingClientRect()，然后把自绘的一小段挂在它右边。
//   2) 这一行是窗口拖拽区，元素必须 `-webkit-app-region: no-drag`，否则点不到。
//   3) 客户端插件跑在浏览器里，起不了进程；真正的启动请求打给 Host 半边的
//      http://127.0.0.1:3199/start（见 lib/index.js）。
//   4) 不 require 任何模块（不用 react），手写 DOM，插件加载失败也不会拖垮 shell。

window.__ModuleLoader__.load({
  id: 'qq-launcher',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

    const SERVICE = 'http://127.0.0.1:3199';
    const POLL_MS = 3000;
    const TITLEBAR_HEIGHT = 40;
    let consoleUrl = 'http://127.0.0.1:3100';

    const COLORS = {
      green: '#22c55e',
      red: '#ef4444',
      amber: '#f59e0b',
      grey: '#9ca3af'
    };

    const TEXT = {
      green: 'AI助手',
      red: 'AI助手',
      amber: '启动中',
      grey: 'AI助手'
    };

    let host = null;
    let button = null;
    let dot = null;
    let label = null;
    let timer = null;
    let busy = false;
    let startDeadline = 0;
    let launchAttempted = false;
    let startRequestFailed = false;
    let lastState = 'grey';
    let controlBusy = false;
    let stopping = false;
    let phaseMessage = '';
    let currentPhase = '';
    let restartButton = null;
    let stopButton = null;
    let disposed = false;
    let observer = null;
    let fallback = null;
    let settingsButton = null;
    let settingsPanel = null;
    let settingsFields = null;
    let settingsMessage = null;
    let settingsSave = null;
    let settingsRevision = '';
    let pendingAction = null;
    let settingsSaving = false;
    let settingsRequest = 0;

    function buildHost() {
      const el = document.createElement('div');
      el.dataset.qqLauncher = '';
      el.setAttribute('role', 'presentation');
      Object.assign(el.style, {
        position: 'fixed',
        top: '0px',
        left: '0px',
        height: TITLEBAR_HEIGHT + 'px',
        display: 'flex',
        alignItems: 'center',
        zIndex: '1201',
        pointerEvents: 'none',
        WebkitAppRegion: 'no-drag',
        fontFamily: 'var(--dsw-font-family, "Segoe UI", system-ui, sans-serif)'
      });

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.id = 'qq-launcher-button';
      btn.title = 'AI助手：读取状态中…';
      btn.setAttribute('aria-label', 'AI助手一键启动');
      Object.assign(btn.style, {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        height: '26px',
        margin: '0px',
        padding: '0px 10px',
        border: '0px',
        borderRadius: '6px',
        background: 'transparent',
        color: 'var(--dsw-alias-label-secondary, #3f4753)',
        font: 'inherit',
        fontSize: '13px',
        lineHeight: '1',
        cursor: 'pointer',
        pointerEvents: 'auto',
        WebkitAppRegion: 'no-drag',
        whiteSpace: 'nowrap'
      });
      btn.addEventListener('mouseenter', () => {
        btn.style.background = 'var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.06))';
      });
      btn.addEventListener('mouseleave', () => {
        btn.style.background = 'transparent';
      });

      const d = document.createElement('span');
      Object.assign(d.style, {
        width: '8px',
        height: '8px',
        flex: '0 0 8px',
        borderRadius: '50%',
        background: COLORS.grey,
        boxShadow: '0 0 0 2px rgba(0,0,0,.045)'
      });

      const txt = document.createElement('span');
      txt.textContent = 'AI助手';
      Object.assign(txt.style, {
        minWidth: '4em',
        flexShrink: '0',
        fontVariantNumeric: 'tabular-nums',
        letterSpacing: '0.01em'
      });

      btn.append(d, txt);
      btn.addEventListener('click', onClick);
      el.append(btn);
      const actionButton = (id, text, title, action) => {
        const control = document.createElement('button');
        control.type = 'button';
        control.id = id;
        control.textContent = text;
        control.title = title;
        control.setAttribute('aria-label', title);
        control.style.cssText = btn.style.cssText;
        control.style.padding = '0px 7px';
        control.style.fontSize = '12px';
        control.addEventListener('mouseenter', () => { control.style.background = 'var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.06))'; });
        control.addEventListener('mouseleave', () => { control.style.background = 'transparent'; });
        control.addEventListener('click', () => action === 'settings'
          ? settingsPanel?.style.display === 'block' ? closeSettings() : openSettings()
          : runControl(action));
        el.append(control);
        return control;
      };
      const restart = actionButton('qq-launcher-restart', '重启', '重启 bot（先停止守护和桥接）', 'restart');
      const stop = actionButton('qq-launcher-stop', '关闭', '关闭 bot（保留 QQ 和 DSH）', 'stop');
      const settings = actionButton('qq-launcher-settings', '设置', '机器人 QQ、管理员和白名单设置', 'settings');
      settings.setAttribute('aria-expanded', 'false');
      settings.setAttribute('aria-controls', 'qq-launcher-settings-panel');
      return { el, btn, d, txt, restart, stop, settings };
    }

    function buildSettingsPanel() {
      const panel = document.createElement('section');
      panel.id = 'qq-launcher-settings-panel';
      panel.setAttribute('aria-label', 'AI助手启动设置');
      Object.assign(panel.style, { position: 'absolute', top: '40px', left: '0', width: '340px',
        maxWidth: 'calc(100vw - 32px)', boxSizing: 'border-box', padding: '16px', borderRadius: '10px',
        border: '1px solid var(--dsw-alias-border-default, #d7dce3)',
        background: 'var(--dsw-alias-background-primary, #fff)', color: 'var(--dsw-alias-label-primary, #20252c)',
        boxShadow: '0 8px 30px rgba(0,0,0,.16)', pointerEvents: 'auto', WebkitAppRegion: 'no-drag', display: 'none',
        fontSize: '13px', lineHeight: '1.5', maxHeight: 'calc(100vh - 56px)', overflowY: 'auto' });
      const title = document.createElement('strong'); title.textContent = 'AI助手设置';
      const form = document.createElement('form'); form.id = 'qq-launcher-settings-form';
      const field = (id, title, multiline = false) => {
        const row = document.createElement('label');
        Object.assign(row.style, { display: 'block', marginTop: '12px' });
        const caption = document.createElement('span'); caption.textContent = title;
        const input = document.createElement(multiline ? 'textarea' : 'input');
        input.id = id; input.value = ''; input.rows = 2;
        if (!multiline) { input.type = 'text'; input.inputMode = 'numeric'; input.autocomplete = 'off'; }
        Object.assign(input.style, { display: 'block', boxSizing: 'border-box', width: '100%', marginTop: '4px',
          padding: '6px 8px', borderRadius: '6px', border: '1px solid #cbd2dc', background: 'transparent', color: 'inherit',
          font: 'inherit', resize: 'vertical', WebkitAppRegion: 'no-drag' });
        row.append(caption, input); form.append(row); return input;
      };
      const bot = field('qq-launcher-bot-qq', '机器人 QQ *'); bot.required = true; bot.pattern = '[1-9][0-9]{4,19}';
      const owner = field('qq-launcher-owner-qq', '管理员 QQ');
      const privates = field('qq-launcher-allow-private', '私聊白名单', true);
      const groups = field('qq-launcher-allow-groups', '群白名单', true);
      const hint = document.createElement('div'); hint.textContent = '多个 QQ / 群号可用空格、逗号或换行分隔。机器人 QQ 为必填。';
      Object.assign(hint.style, { marginTop: '8px', color: '#667080', fontSize: '12px' });
      settingsMessage = document.createElement('div'); settingsMessage.id = 'qq-launcher-settings-message';
      settingsMessage.setAttribute('role', 'status'); settingsMessage.setAttribute('aria-live', 'polite');
      Object.assign(settingsMessage.style, { marginTop: '8px', minHeight: '20px', whiteSpace: 'normal' });
      const actions = document.createElement('div'); Object.assign(actions.style, { display: 'flex', gap: '8px', marginTop: '10px' });
      const smallButton = (id, text, type = 'button') => {
        const node = document.createElement('button'); node.id = id; node.type = type; node.textContent = text;
        Object.assign(node.style, { padding: '5px 10px', border: '1px solid #cbd2dc', borderRadius: '6px',
          cursor: 'pointer', background: 'transparent', color: 'inherit', font: 'inherit', WebkitAppRegion: 'no-drag' });
        actions.append(node); return node;
      };
      settingsSave = smallButton('qq-launcher-settings-save', '保存', 'submit');
      smallButton('qq-launcher-settings-refresh', '重新读取').addEventListener('click', () => openSettings(pendingAction));
      smallButton('qq-launcher-settings-cancel', '关闭').addEventListener('click', closeSettings);
      form.addEventListener('submit', saveSettings);
      form.append(hint, settingsMessage, actions); panel.append(title, form);
      settingsFields = { bot, owner, privates, groups };
      return panel;
    }

    async function fetchSettings() {
      const res = await fetch(SERVICE + '/config', { cache: 'no-store', signal: AbortSignal.timeout(6000) });
      const data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`);
      return data;
    }

    function closeSettings() {
      ++settingsRequest;
      pendingAction = null;
      if (settingsPanel) settingsPanel.style.display = 'none';
      settingsButton?.setAttribute('aria-expanded', 'false');
    }

    async function openSettings(action = null) {
      if (disposed || settingsSaving) return;
      pendingAction = action;
      settingsPanel.style.display = 'block';
      settingsButton?.setAttribute('aria-expanded', 'true');
      settingsSave.textContent = action ? '保存并' + (action === 'restart' ? '重启' : '启动') : '保存';
      settingsSave.disabled = true;
      settingsMessage.textContent = '正在读取真实配置…';
      const request = ++settingsRequest;
      try {
        const data = await fetchSettings();
        if (disposed || request !== settingsRequest) return;
        settingsFields.bot.value = data.botUin || '';
        settingsFields.owner.value = String(data.ownerQQ ?? '');
        settingsFields.privates.value = (data.allow?.private || []).join('\n');
        settingsFields.groups.value = (data.allow?.groups || []).join('\n');
        settingsRevision = data.revision || '';
        settingsMessage.textContent = action && !data.botUin ? '请先填写机器人 QQ；保存后继续。'
          : data.live ? '已连接当前运行配置。管理员和白名单保存后实时更新。' : '已读取 config.json；保存后供下次启动使用。';
        settingsSave.disabled = false;
        settingsFields.bot.focus();
      } catch (error) {
        if (!disposed && request === settingsRequest) settingsMessage.textContent = '读取失败：' + error.message;
      }
    }

    async function saveSettings(event) {
      event.preventDefault();
      if (settingsSaving || settingsSave.disabled) return;
      const botUin = settingsFields.bot.value.trim();
      if (!/^[1-9]\d{4,19}$/.test(botUin)) {
        settingsMessage.textContent = '请填写有效的机器人 QQ 号（必填）'; settingsFields.bot.focus(); return;
      }
      settingsSaving = true; settingsSave.disabled = true;
      const split = value => value.split(/[\s,，;；]+/u).filter(Boolean);
      try {
        const res = await fetch(SERVICE + '/config', { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ botUin, ownerQQ: settingsFields.owner.value.trim(), revision: settingsRevision,
            allow: { private: split(settingsFields.privates.value), groups: split(settingsFields.groups.value) } }),
          signal: AbortSignal.timeout(12000) });
        const data = await res.json();
        if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`);
        if (disposed) return;
        settingsRevision = data.revision || '';
        settingsMessage.textContent = data.message || '已保存到真实配置';
        const action = pendingAction;
        if (action) {
          closeSettings();
          if (action === 'restart') await runControl('restart', true);
          else await requestStart();
        }
      } catch (error) { if (!disposed) settingsMessage.textContent = '保存失败：' + error.message; }
      finally { settingsSaving = false; if (settingsSave) settingsSave.disabled = false; }
    }

    function menubarElement() {
      return document.querySelector('[data-windows-menu]');
    }

    function place() {
      if (disposed || host === null) return;
      // Also remove DOM left by versions that did not register a disposer.
      for (const stale of document.querySelectorAll('[data-qq-launcher]')) {
        if (stale !== host) stale.remove();
      }
      const bar = menubarElement();
      if (bar !== null) {
        const rect = bar.getBoundingClientRect();
        if (rect.width > 0) {
          host.style.left = Math.round(rect.right + 6) + 'px';
          host.style.right = 'auto';
          host.style.top = '0px';
          host.style.height = (rect.height || TITLEBAR_HEIGHT) + 'px';
          return;
        }
      }
      // 普通浏览器里没有标题栏 menubar：退回页面右上角。
      host.style.left = 'auto';
      host.style.right = '16px';
      host.style.top = document.documentElement.dataset.windowsTitlebar === undefined ? '8px' : '0px';
    }

    function paint(state) {
      if (disposed) return;
      lastState = state;
      if (dot === null || label === null) return;
      const color = COLORS[state] || COLORS.grey;
      dot.style.background = color;
      dot.style.boxShadow = state === 'green'
        ? '0 0 0 2px rgba(34,197,94,.18)'
        : state === 'red'
          ? '0 0 0 2px rgba(239,68,68,.16)'
          : '0 0 0 2px rgba(245,158,11,.18)';
      label.textContent = stopping ? '关闭中' : busy
        ? currentPhase === 'waiting_gateway' ? '连接中' : phaseMessage.includes('QQ 登录') ? '等待登录' : '启动中'
        : (TEXT[state] || TEXT.grey);
      if (restartButton) restartButton.disabled = controlBusy || busy || stopping;
      if (stopButton) stopButton.disabled = controlBusy || stopping;
      if (button !== null) {
        button.style.color = state === 'red'
          ? 'var(--dsw-alias-label-secondary, #3f4753)'
          : 'var(--dsw-alias-label-secondary, #3f4753)';
      }
    }

    function describe(data) {
      if (data === null || typeof data !== 'object') return '状态未知';
      const c = data.checks || {};
      const parts = [
        'QQ ' + (c.qq ? '✓' : '✗'),
        'SnowLuma ' + (c.snowluma ? '✓' : '✗'),
        '桥接 ' + (c.bridge ? '✓' : '✗')
      ];
      parts.push('预设 ' + (c.presetsReady ? '✓' : '✗'));
      if (c.health && c.health !== 'ready') parts.push('诊断：' + c.health);
      if (data.lastError) parts.push('错误：' + data.lastError);
      return parts.join(' · ');
    }

    async function poll() {
      if (disposed) return;
      const currentHost = host;
      try {
        const res = await fetch(SERVICE + '/status', { cache: 'no-store', signal: AbortSignal.timeout(5000) });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        if (disposed || host !== currentHost) return;
        phaseMessage = data.message || '';
        currentPhase = data.phase || '';
        stopping = data.operation === 'stopping';
        if (data.stopped) {
          busy = false;
          launchAttempted = false;
          startDeadline = 0;
        }
        let timedOut = false;
        const checks = data.checks || {};
        if (Number.isInteger(checks.ports?.bridgeConsole) && checks.ports.bridgeConsole > 0) {
          consoleUrl = `http://127.0.0.1:${checks.ports.bridgeConsole}`;
        }
        if (data.ready) {
          busy = false;
          startDeadline = 0;
          launchAttempted = true;
          startRequestFailed = false;
        } else if (data.starting) {
          busy = true;
          launchAttempted = true;
          startRequestFailed = false;
        } else if (data.lastError) {
          busy = false;
          startDeadline = 0;
          launchAttempted = false;
        } else if (busy && startDeadline > 0 && Date.now() >= startDeadline) {
          busy = false;
          startDeadline = 0;
          timedOut = true;
          launchAttempted = false;
        } else if (startRequestFailed) {
          launchAttempted = false;
          startRequestFailed = false;
        }
        paint(busy || stopping ? 'amber' : data.light || 'red');
        if (button !== null) {
          const title = data.ready
            ? 'AI助手运行中（点击打开桥接控制台）'
            : timedOut
              ? '启动超时，请检查 DSH、QQ 与 SnowLuma；查看启动日志'
              : data.lastError
                ? `启动失败：${data.lastError}`
                : stopping ? '正在停止守护和桥接…'
                  : busy ? phaseMessage || '启动中：正在检查 QQ → SnowLuma → 桥接…' : '点一下启动 QQ → SnowLuma → 桥接';
          button.title = `${title}\n${describe(data)}`;
        }
      } catch (error) {
        if (disposed || host !== currentHost) return;
        if (startRequestFailed) {
          launchAttempted = false;
          startRequestFailed = false;
        }
        if (!busy) paint('red');
        if (button !== null) {
          button.title = '启动器服务未响应（' + (error && error.message ? error.message : error) + '）\n点一下试试重新拉起';
        }
      }
    }

    async function onClick() {
      if (stopping || controlBusy) return;
      if (launchAttempted) {
        window.open(consoleUrl, '_blank', 'noopener');
        return;
      }
      try {
        const data = await fetchSettings();
        if (disposed) return;
        if (!data.configured || !data.botUin) { await openSettings('start'); return; }
      } catch (error) { await openSettings('start'); return; }
      return requestStart();
    }

    async function requestStart() {
      if (disposed || stopping) return;
      if (launchAttempted) { window.open(consoleUrl, '_blank', 'noopener'); return; }
      launchAttempted = true;
      busy = true;
      startDeadline = Date.now() + 420_000;
      paint('amber');
      if (button !== null) button.title = '正在清理旧桥接并启动：QQ → SnowLuma → 桥接…';
      try {
        const res = await fetch(SERVICE + '/start', {
          method: 'POST',
          cache: 'no-store',
          signal: AbortSignal.timeout(15_000)
        });
        const body = await res.json().catch(() => ({}));
        if (body.code === 'BOT_QQ_REQUIRED') {
          busy = false; launchAttempted = false; startDeadline = 0; paint('red'); await openSettings('start'); return;
        }
        if (!res.ok || body.ok === false) throw new Error(body.error || `HTTP ${res.status}`);
        if (button !== null) button.title = '旧桥接已处理，正在等待 QQ → SnowLuma → 桥接就绪…';
        void poll();
      } catch (error) {
        busy = false;
        startDeadline = 0;
        startRequestFailed = true;
        if (button !== null) button.title = `启动失败：${error && error.message ? error.message : error}`;
        void poll();
      }
    }

    async function runControl(action, configured = false) {
      if (controlBusy || stopping || (action === 'restart' && busy)) return;
      if (action === 'restart' && !configured) {
        try {
          const data = await fetchSettings();
          if (!data.configured || !data.botUin) { await openSettings('restart'); return; }
        } catch { await openSettings('restart'); return; }
      }
      controlBusy = true;
      stopping = true;
      paint('amber');
      try {
        const res = await fetch(SERVICE + '/' + action, { method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(15000) });
        const body = await res.json().catch(() => ({}));
        if (body.code === 'BOT_QQ_REQUIRED') { stopping = false; await openSettings('restart'); return; }
        if (!res.ok || body.ok === false) throw new Error(body.error || `HTTP ${res.status}`);
        launchAttempted = action === 'restart';
        busy = action === 'restart';
        startDeadline = busy ? Date.now() + 420000 : 0;
      } catch (error) {
        stopping = false;
        if (button) button.title = `操作失败：${error.message || error}`;
      } finally {
        controlBusy = false;
        void poll();
      }
    }

    function mount() {
      if (disposed) return;
      if (host !== null && host.isConnected) return;
      const built = buildHost();
      host = built.el;
      button = built.btn;
      dot = built.d;
      label = built.txt;
      restartButton = built.restart;
      stopButton = built.stop;
      settingsButton = built.settings;
      settingsPanel = buildSettingsPanel();
      host.append(settingsPanel);
      document.body.append(host);
      place();
      paint('grey');
      window.addEventListener('resize', place);
      timer = setInterval(() => {
        place();
        poll();
      }, POLL_MS);
      poll();
    }

    function dispose() {
      if (disposed) return;
      disposed = true;
      ++settingsRequest;
      observer?.disconnect();
      if (fallback !== null) clearInterval(fallback);
      if (timer !== null) clearInterval(timer);
      window.removeEventListener('resize', place);
      host?.remove();
      host = null;
      timer = fallback = null;
      if (window.__qqLauncherDispose === dispose) delete window.__qqLauncherDispose;
    }

    function apply(ctx) {
      // Hot reload may create a new module factory before the old scope disposes.
      // Own one page-level widget and register cleanup before either mount path.
      window.__qqLauncherDispose?.();
      disposed = false;
      window.__qqLauncherDispose = dispose;
      if (typeof ctx?.effect === 'function') ctx.effect(() => dispose);
      else if (typeof ctx?.on === 'function') ctx.on('dispose', dispose);
      const start = () => {
        if (disposed || document.body === null) return;
        mount();
      };
      if (document.body !== null && document.querySelector('[data-windows-menu]') !== null) {
        start();
        return dispose;
      }
      // menubar 由 preload 在 shell overlay 出现后注入，晚于本插件；等它。
      observer = new MutationObserver(() => {
        if (document.querySelector('[data-windows-menu]') !== null) {
          observer.disconnect();
          start();
        }
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
      // 兜底：菜单始终没出现（普通浏览器）也要挂。
      let waited = 0;
      fallback = setInterval(() => {
        waited += 500;
        if (host !== null && host.isConnected) {
          clearInterval(fallback);
          return;
        }
        if (waited >= 4000) {
          clearInterval(fallback);
          observer.disconnect();
          start();
        }
      }, 500);
      return dispose;
    }

    exports.apply = apply;
    exports.inject = [];
    return module.exports;
  }
});
