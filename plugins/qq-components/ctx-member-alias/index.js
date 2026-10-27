// ctx-member-alias（C 层｜成员绰号表）
//
// 维护「绰号 → QQ号」映射，让 AI 明白群里谁是谁：
//   · 手动添加（alias_add）、自动提取候选（onIncoming 见到新说话人时提一条 candidate）、
//     确认（alias_confirm）、删除（alias_reject）、查询（alias_query / alias_list）；
//   · 每轮提示词注入「【成员绰号速查】」已确认表；
//   · 传话/点名时按此表用 atUserId 对应到正确的人。
//
// 状态在 state/plugins/member-alias.json（插件自有 state，热加载不丢）。
const MAX_ENTRIES = 200;
const GENERIC_ALIASES = new Set(['私聊', '群聊', '群消息', '好友', '陌生人', '管理员', '群主', '成员', '用户', '本人', '我', '你', '他', '她', '它']);

// sender 通常是平台资料里的 QQ 昵称，不能据此推断为绰号。只接受消息正文里的明确自称。
export function extractSelfAlias(text) {
  const source = String(text || '').replace(/[\r\n]+/g, ' ').trim();
  const patterns = [
    /(?:大家|以后|今后)?(?:都)?叫我\s*[“"「『]?([^，。！？!?；;、\s”"」』]{1,20})/,
    /(?:你|你们)?可以叫我\s*[“"「『]?([^，。！？!?；;、\s”"」』]{1,20})/,
    /我(?:的)?(?:绰号|昵称|网名)是\s*[“"「『]?([^，。！？!?；;、\s”"」』]{1,20})/
  ];
  for (const re of patterns) {
    const match = source.match(re);
    const alias = String(match?.[1] || '').replace(/[”"」』]+$/g, '').trim();
    if (!alias || GENERIC_ALIASES.has(alias.toLowerCase()) || /^\d{5,12}$/.test(alias)) continue;
    if (/^(私聊|群聊|群消息|管理员|群主|成员|用户)/i.test(alias)) continue;
    return alias;
  }
  return '';
}

export function createPlugin(ctx) {
  const state = () => ctx.state.get();
  const write = (patch) => ctx.state.set(patch);

  const entries = () => (Array.isArray(state().entries) ? state().entries : []);
  const save = (list) => write({ entries: list.slice(0, MAX_ENTRIES) });
  const clean = (s) => String(s == null ? '' : s).trim();

  ctx.registerTool('alias_list', {
    description: '列出成员绰号表（含已确认与候选）',
    handler: () => ({ ok: true, entries: entries() })
  });
  ctx.registerTool('alias_add', {
    description: '手动添加/更新一条绰号映射 { alias, qq, note? }',
    handler: (input) => {
      const alias = clean(input?.alias); const qq = clean(input?.qq);
      if (!alias || !qq) return { ok: false, error: 'alias 与 qq 必填' };
      const list = entries();
      const idx = list.findIndex((e) => e.qq === qq);
      const entry = { qq, alias, note: clean(input?.note).slice(0, 200), status: 'confirmed', at: Date.now() };
      if (idx >= 0) list[idx] = entry; else list.push(entry);
      save(list);
      return { ok: true, entry };
    }
  });
  ctx.registerTool('alias_confirm', {
    description: '确认候选绰号 { alias, qq }（把 candidate 转成 confirmed，可顺带改 alias/qq）',
    handler: (input) => {
      const alias = clean(input?.alias); const qq = clean(input?.qq);
      const list = entries();
      const e = list.find((x) => (alias && x.alias === alias) || (qq && x.qq === qq));
      if (!e) return { ok: false, error: '没有这条候选' };
      if (qq) e.qq = qq; if (alias) e.alias = alias;
      e.status = 'confirmed'; e.at = Date.now();
      save(list);
      return { ok: true, entry: e };
    }
  });
  ctx.registerTool('alias_reject', {
    description: '删除一条绰号（候选或已确认）',
    handler: (input) => {
      const alias = clean(input?.alias); const qq = clean(input?.qq);
      const list = entries();
      const idx = list.findIndex((x) => (alias && x.alias === alias) || (qq && x.qq === qq));
      if (idx < 0) return { ok: false, error: '没有这条' };
      const [removed] = list.splice(idx, 1);
      save(list);
      return { ok: true, removed };
    }
  });
  ctx.registerTool('alias_query', {
    description: '按绰号或 QQ 查询谁是谁（AI 可用；不区分大小写子串匹配）',
    handler: (input) => {
      const q = clean(input?.q).toLowerCase();
      const list = entries();
      const matches = list.filter((e) => !q || String(e.alias).toLowerCase().includes(q) || String(e.qq).includes(q));
      return { ok: true, matches };
    }
  });
  ctx.registerTool('alias_submit', {
    description: '把你在会话里遇到的「绰号 = QQ号」提交给管理员筛选（进候选，管理员确认后生效）',
    handler: (input) => {
      const alias = clean(input?.alias); const qq = clean(input?.qq);
      if (!alias || !qq) return { ok: false, error: 'alias 与 qq 必填' };
      const list = entries();
      const existing = list.find((e) => e.qq === qq);
      if (existing) {
        if (existing.status === 'confirmed') return { ok: true, duplicate: true, status: 'confirmed', entry: existing };
        existing.alias = alias; existing.at = Date.now(); existing.source = 'agent';
        save(list);
        return { ok: true, duplicate: true, status: 'candidate', entry: existing };
      }
      const entry = { qq, alias, note: clean(input?.note).slice(0, 200), status: 'candidate', at: Date.now(), source: 'agent' };
      list.push(entry);
      save(list);
      return { ok: true, entry };
    }
  });

  return {
    hooks: {
      // 自动提取：sender 是 QQ 平台昵称，不当作绰号；仅从消息正文的明确自称创建候选。
      onIncoming(payload = {}) {
        if (ctx.config?.autoExtract === false) return;
        const qq = clean(payload.userId); const alias = extractSelfAlias(payload.text);
        if (!qq || !alias || !/^\d{5,12}$/.test(qq)) return;
        const list = entries();
        if (list.some((e) => e.qq === qq)) return; // 已有（无论候选/确认）就不重复
        list.push({ qq, alias, note: '', status: 'candidate', at: Date.now(), source: 'auto' });
        save(list);
        ctx.log('自动提取自称绰号候选：' + alias + ' = ' + qq);
      },
      // 每轮提示词：注入已确认的绰号速查表。
      // 管理员那几行必须显式标成「主人」，否则模型只知道这个名字对应一个 QQ，
      // 会在别的会话里说「墨辞啊，群里认识的，不算熟」——实测就是这样翻车的。
      beforePrompt(payload = {}) {
        const confirmed = entries().filter((e) => e.status === 'confirmed');
        if (!confirmed.length) return '';
        let ownerQQ = '';
        try { ownerQQ = String(ctx.capabilities?.getOwnerQQ?.() || ''); } catch {}
        const lines = confirmed.map((e) => {
          const isOwner = ownerQQ && String(e.qq) === ownerQQ;
          const tag = isOwner ? '（= 管理员/主人，别名都指同一个人）' : '';
          return '- ' + e.alias + ' = ' + e.qq + tag + (e.note ? '（' + e.note + '）' : '');
        });
        return '【成员绰号速查】这些名字对应这些 QQ：\n' + lines.join('\n')
          + (ownerQQ ? '\n其中 ' + ownerQQ + ' 就是管理员/主人本人；提到这些别名时按同一个人对待，不要当成「群里另一个不太熟的人」。' : '')
          + '\n（传话 / @ 人 / 认人时按此表对应；拿不准就用 alias_query 查，新绰号 alias_add 登记。）';
      }
    }
  };
}
