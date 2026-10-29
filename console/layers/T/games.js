
import { api, esc } from '../../shared/api.js';
// layers/T/games: explicit imports; initialize is called in the application startup order.

let gamesParameterLabels;

function renderGames(games) {
  const host = document.getElementById('gamesRegistry');
  if (!host) return;
  if (!games?.length) { host.innerHTML = '<div class="meta">暂无游戏。</div>'; return; }
  host.innerHTML = games.map(game => {
    const params = game.custom ? '' : Object.entries(game.parameters || {}).map(([key, value]) => {
      const [label, min, max] = gamesParameterLabels[key] || [key, 0, 100];
      return `<label class="games-param">${esc(label)}<input type="number" data-game-param="${esc(key)}" min="${min}" max="${max}" step="1" value="${Number(value)}"></label>`;
    }).join('');
    return `<article class="games-card" data-game-card="${esc(game.id)}">
      <div class="games-card-head"><div><h3>${esc(game.name)}${game.custom ? ' <span class="meta">自定义</span>' : ''}</h3><div class="meta">${esc(game.id)} · ${esc(game.summary)}</div></div>
      <label class="games-toggle"><input type="checkbox" data-game-enabled ${game.enabled ? 'checked' : ''}> 启用</label></div>
      <p class="games-rules"><strong>规则：</strong>${esc(game.rules)}</p>
      ${params ? `<div class="games-params">${params}</div>` : '<div class="meta">参数通过 adapter 的初始状态和合法动作定义。</div>'}
      <div class="row"><button class="small" data-game-save>保存设置</button>${game.custom ? '<button class="small danger" data-game-delete>删除游戏</button>' : ''}<span class="meta" data-game-message role="status"></span></div>
    </article>`;
  }).join('');
}

async function loadGames() {
  const host = document.getElementById('gamesRegistry');
  try { const result = await api('/api/games'); if (!result.ok) throw new Error(result.error || '游戏清单读取失败'); renderGames(result.games); }
  catch (error) { if (host) host.innerHTML = `<div class="meta err">${esc(error.message)}</div>`; }
}

async function saveGameCard(card) {
  const id = card.dataset.gameCard;
  const message = card.querySelector('[data-game-message]');
  const parameters = Object.fromEntries([...card.querySelectorAll('[data-game-param]')].map(input => [input.dataset.gameParam, Number(input.value)]));
  try {
    const result = await api('/api/games/config', 'POST', { id, enabled: card.querySelector('[data-game-enabled]').checked, parameters });
    if (!result.ok) throw new Error(result.error || '保存失败');
    message.textContent = '已保存'; message.className = 'meta ok';
  } catch (error) { message.textContent = error.message; message.className = 'meta err'; }
}

let gamesRegistry;

export function initialize() {
gamesParameterLabels = {
  minSparks: ['最少虚构火花', 1, 5], maxSparks: ['最多虚构火花', 1, 5],
  minGlowLevel: ['最低虚构亮度等级', 1, 3], maxGlowLevel: ['最高虚构亮度等级', 1, 3],
  minCadenceMs: ['最短叙述间隔（毫秒）', 250, 5000], maxCadenceMs: ['最长叙述间隔（毫秒）', 250, 5000],
  minDurationSec: ['最短特效时长（秒）', 1, 5], maxDurationSec: ['最长特效时长（秒）', 1, 5],
  sides: ['骰子面数', 2, 20], maxAttempts: ['最大作答次数', 1, 10]
};
gamesRegistry = document.getElementById('gamesRegistry');
gamesRegistry?.addEventListener('click', async event => {
  const card = event.target.closest('[data-game-card]');
  if (!card) return;
  if (event.target.closest('[data-game-save]')) { await saveGameCard(card); return; }
  if (event.target.closest('[data-game-delete]')) {
    if (!confirm(`删除自定义游戏「${card.dataset.gameCard}」？`)) return;
    const message = card.querySelector('[data-game-message]');
    try { const result = await api('/api/games/delete', 'POST', { id: card.dataset.gameCard }); if (!result.ok) throw new Error(result.error || '删除失败'); await loadGames(); }
    catch (error) { message.textContent = error.message; message.className = 'meta err'; }
  }
});
document.getElementById('gamesReload')?.addEventListener('click', loadGames);
document.getElementById('gamesSaveDefinition')?.addEventListener('click', async () => {
  const message = document.getElementById('gamesSaveMessage');
  const button = document.getElementById('gamesSaveDefinition');
  try {
    const definition = JSON.parse(document.getElementById('gamesDefinition').value);
    button.disabled = true; message.textContent = '校验并保存中…'; message.className = 'meta';
    const result = await api('/api/games/create', 'POST', { definition });
    if (!result.ok) throw new Error(result.error || '保存失败');
    message.textContent = `已保存并启用：${result.game.name}`; message.className = 'meta ok'; await loadGames();
  } catch (error) { message.textContent = error.message; message.className = 'meta err'; }
  finally { button.disabled = false; }
});
loadGames();
}
export { gamesParameterLabels, renderGames, loadGames, saveGameCard, gamesRegistry };
