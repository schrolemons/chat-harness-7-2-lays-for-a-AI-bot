// qq-launcher —— 客户端半边：把「小鲸鱼红绿灯 + 一键启动」挂到 Windows 标题栏
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
    const CONSOLE_URL = 'http://127.0.0.1:3100';

    const COLORS = {
      green: '#22c55e',
      red: '#ef4444',
      amber: '#f59e0b',
      grey: '#9ca3af'
    };

    const TEXT = {
      green: '小鲸鱼',
      red: '小鲸鱼',
      amber: '启动中',
      grey: '小鲸鱼'
    };

    let host = null;
    let button = null;
    let dot = null;
    let label = null;
    let timer = null;
    let busy = false;
    let lastState = 'grey';

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
      btn.title = '小鲸鱼：读取状态中…';
      btn.setAttribute('aria-label', '小鲸鱼一键启动');
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
      txt.textContent = '小鲸鱼';
      Object.assign(txt.style, {
        fontVariantNumeric: 'tabular-nums',
        letterSpacing: '0.01em'
      });

      btn.append(d, txt);
      btn.addEventListener('click', onClick);
      el.append(btn);
      return { el, btn, d, txt };
    }

    function menubarElement() {
      return document.querySelector('[data-windows-menu]');
    }

    function place() {
      if (host === null) return;
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
      lastState = state;
      if (dot === null || label === null) return;
      const color = COLORS[state] || COLORS.grey;
      dot.style.background = color;
      dot.style.boxShadow = state === 'green'
        ? '0 0 0 2px rgba(34,197,94,.18)'
        : state === 'red'
          ? '0 0 0 2px rgba(239,68,68,.16)'
          : '0 0 0 2px rgba(245,158,11,.18)';
      label.textContent = busy ? '启动中' : (TEXT[state] || TEXT.grey);
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
      try {
        const res = await fetch(SERVICE + '/status', { cache: 'no-store' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        if (!busy) paint(data.light || 'red');
        if (button !== null) {
          button.title = (data.ready ? '小鲸鱼运行中（点击打开桥接控制台）' : '点一下启动 QQ → SnowLuma → 桥接')
            + '\n' + describe(data);
        }
      } catch (error) {
        if (!busy) paint('red');
        if (button !== null) {
          button.title = '启动器服务未响应（' + (error && error.message ? error.message : error) + '）\n点一下试试重新拉起';
        }
      }
    }

    async function onClick() {
      if (busy) return;
      if (lastState === 'green') {
        window.open(CONSOLE_URL, '_blank', 'noopener');
        return;
      }
      busy = true;
      paint('amber');
      if (button !== null) button.title = '正在启动：QQ → SnowLuma → 桥接…';
      try {
        await fetch(SERVICE + '/start', { method: 'POST', cache: 'no-store' });
      } catch {}
      // 启动要 90s 上下（SnowLuma 上线 + 桥接连 DSH），期间保持黄灯。
      setTimeout(() => {
        busy = false;
        poll();
      }, 8000);
      setTimeout(poll, 20000);
      setTimeout(poll, 45000);
      setTimeout(poll, 80000);
    }

    function mount() {
      if (host !== null && host.isConnected) return;
      const built = buildHost();
      host = built.el;
      button = built.btn;
      dot = built.d;
      label = built.txt;
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

    function apply(ctx) {
      const start = () => {
        if (document.body === null) return;
        mount();
      };
      if (document.body !== null && document.querySelector('[data-windows-menu]') !== null) {
        start();
        return;
      }
      // menubar 由 preload 在 shell overlay 出现后注入，晚于本插件；等它。
      const observer = new MutationObserver(() => {
        if (document.querySelector('[data-windows-menu]') !== null) {
          observer.disconnect();
          start();
        }
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
      // 兜底：菜单始终没出现（普通浏览器）也要挂。
      let waited = 0;
      const fallback = setInterval(() => {
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
      if (typeof ctx?.on === 'function') {
        ctx.on('dispose', () => {
          observer.disconnect();
          clearInterval(fallback);
          if (timer !== null) clearInterval(timer);
          window.removeEventListener('resize', place);
          if (host !== null) host.remove();
          host = null;
        });
      }
    }

    exports.apply = apply;
    exports.inject = [];
    return module.exports;
  }
});
