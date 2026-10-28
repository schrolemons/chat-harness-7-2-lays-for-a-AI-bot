# Games MCP

Games is an independent T-layer MCP for small, optional text interactions. Its tools return text to the current agent; they never send QQ messages themselves.

## Games

- `spark`: fictional toy-spark wordplay. Start only after the participant themselves clearly agrees. A third party cannot consent on someone else's behalf. If anyone declines, seems uncomfortable, steps away, or asks to stop, stop immediately. Keep it to a tiny spark in the air; never claim real electricity or describe body sensation, pain, wounds, or injury. Each move varies the fictional spark count, visual glow, narrative cadence and effect duration within the bounds configured in console. These values describe visual text effects only; never present voltage, current strength or bodily exposure. When responding to harassment, set a verbal boundary without making a non-consenting person the target of the game.
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

## Prompt extracted from the whale role

The old role prompts, including the whale-tail joke, “要不要试一点点电流呀”, the harassment/bullying trigger, opt-in wording, stop rule, and shared-context note, are preserved verbatim in `games.json`. The old governance rule is preserved there too. This prompt has been centralized here; the live `spark` tool narrows actual play to explicit participant consent and air-only spark effects.

## Hard limits

- Require `consentConfirmed: true` on `games_start` for `spark`, and only use it after hearing clear consent from the participant themselves.
- Do not infer consent from silence, prior interaction, group membership, roleplay, or a third party's request.
- End the session immediately on refusal, discomfort, withdrawal, or a request to stop.
- Do not send messages, target users, identify recipients, or claim that anything happened in the real world.
- Sessions are ephemeral and expire after 20 minutes. Do not put personal information in game actions.

## Tool flow

Use `games_catalog` to discover enabled games and their rules, `games_start` to open a session, `games_action` with a listed legal action and payload for one bounded move, `games_status` to check the session, and `games_stop` to end it. A finished or unknown session cannot be played again. Users may describe a new game; construct the JSON adapter and call `games_create` only in response to that explicit request.
