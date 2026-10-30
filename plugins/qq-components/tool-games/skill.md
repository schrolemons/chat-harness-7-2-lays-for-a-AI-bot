# Games MCP

Games is an independent T-layer MCP for small, optional text interactions. Its tools return text to the current agent; they never send QQ messages themselves.

## Games

- `spark` / 轻微电流：虚构文字演出，可以由bot主动接梗，无需开始前本人同意。payload支持bodyPart、durationSec、intensityLevel和waveform，未指定时使用console默认值。正常输出不反复解释强度微小；可以描写轻松酥麻的演出效果，不写疼痛、伤口或伤害。对方拒绝、不适、退开或要求停止时立即结束。它不连接设备，不发送QQ，也不产生物理电流参数。
- `dice`: a configurable 2–20-sided dice roll, with no money, stakes, or punishment.
- `riddle`: one fixed short riddle, a hint, and a configurable 1–10 answers.
- Custom games: the `games_create` tool turns a user's explicit description into a bounded JSON GameAdapter and persists it. The runtime interprets data only; it never executes generated code.

Every catalog entry includes its own rules, current enabled state and parameters. Console shows those rules and provides an independent enable switch and parameter controls per game. Custom entries can also be deleted there.

## Custom adapter format

```json
{
  "id": "custom-coin-guess",
  "name": "猜硬币",
  "summary": "猜正反面",
  "rules": "猜测一次硬币结果。",
  "initialState": { "result": "", "guesses": 0 },
  "actions": [{
    "type": "guess",
    "label": "猜正反",
    "description": "提交正面或反面",
    "inputs": [{ "name": "side", "type": "choice", "options": ["正面", "反面"] }],
    "effects": [
      { "op": "set", "field": "result", "input": "side" },
      { "op": "increment", "field": "guesses", "by": 1, "min": 0, "max": 10 }
    ],
    "message": "猜测已记录。",
    "endsGame": true
  }]
}
```

`initialState` is JSON only. Each action may declare bounded `string`, `number` or `choice` inputs. Effects are limited to `set`, `increment` and `randomInt`, and can only change fields declared in `initialState`. Definitions, state depth, actions, inputs and output text are size-limited. Do not store personal or sensitive information in a game definition. `games_start` and `games_status` return the serialized `gameState` and `legalActions`; `games_action` validates its action and payload before applying effects.

## 轻微电流参数合同

- 稳定gameId/action仍为spark，显示名为轻微电流，不保留第二个旧玩法。
- bodyPart：手指、手掌、手背、手腕、前臂、肩膀、小腿、脚踝；默认手腕。
- durationSec：1–5秒，默认3。intensityLevel：1–3叙事等级，默认2。
- waveform：steady均匀、pulse脉冲、rampUp渐强、rampDown渐弱、wave起伏；默认pulse。
- console保存的是该游戏的默认值，games_action.payload只覆盖本次动作。返回fictionalEffect包含实际部位、时长、等级、波形和samples轨迹，叙事与参数保持一致。
- 游戏定义和schema集中在games.json；current-effect.mjs拥有参数验证、轨迹和叙事，store与runtime共用，不保留旧火花数量/亮度参数或同意开关。
- 拒绝、不适、退开或要求停止时立即games_stop。没有现实设备、真实电流单位、目标收件人或自动发送能力。
- 内存会话20分钟到期，停止后不能继续执行。参数无效不消耗动作次数。

## Tool flow

Use `games_catalog` to discover enabled games and their rules, `games_start` to open a session, `games_action` with a listed legal action and payload for one bounded move, `games_status` to check the session, and `games_stop` to end it. A finished or unknown session cannot be played again. Users may describe a new game; construct the JSON adapter and call `games_create` only in response to that explicit request.
