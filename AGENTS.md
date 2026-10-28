# Development and deployment rules

Before changing code, read [the workspace and DSH Desktop contract](docs/WORKSPACE_AND_DSH_DESKTOP.md).

## Identify the checkout and the running installation

- Run `git status --short --branch`, `git remote -v`, and `git worktree list`. Preserve existing uncommitted work. A folder with similar files is not automatically this Git worktree.
- Identify the running bridge from its verified process command, its lock PID and its loaded build. Record the runtime root separately from this repository root.
- Inspect the selected DSH profile and its plugin junctions. A linked plugin in the runtime directory is live deployment code; changing the repository does not necessarily change Desktop, and changing the runtime may affect Desktop immediately.
- If a local `workspace.local.json` is present, read it before cross-directory work. It is a machine-specific map, not permission to restart or to overwrite anything.

## Preserve newer source

- Before a runtime change, save the touched files and a source manifest outside Git. Use `node scripts/source-workspace.mjs snapshot ROOT` and retain the output in local state.
- Use `source-workspace.mjs diff LEFT RIGHT` to inspect full differences before any cross-directory synchronization. The script only reports hashes and paths; it never copies files.
- Never overwrite a runtime file with an entire file from another checkout merely because the proposed change is small. Merge against the runtime's current version and preserve its existing optimizations.
- Verify the baseline immediately before writing. If another edit has appeared, re-merge; never restore an older snapshot over it. Protect files explicitly identified by the user with before/after hashes.
- Backups are evidence, not a replacement for newer changes. Recover by three-way comparison and replay reviewed patches; keep restoration and refactoring as separate steps.

## Code boundaries

- Prompts, wording and behavior belong in `plugins/qq-components`; `bridge.js` owns transport, authorization, hook dispatch and capabilities.
- Prefer small modules under `src/bridge-core/` for reusable state calculations and protocol parsing. Pass state explicitly; do not capture a stale copy of mutable configuration.
- Business scheduling uses `life-scheduler`; do not add independent business timers or duplicate pending queues in the bridge.
- Preset source is `dsh/agent-presets/*/{preset.yml,agent.cordis.yml}`. Generated files under `plugins/qq-agent-presets/presets/` must be rebuilt, not edited as a second source of truth.

## DSH Desktop changes

- Change versioned plugin/preset/installer source first. Do not repair this project by directly editing DSH's bundled application code or installed `node_modules`.
- Applying an installer changes profile files and may repoint junctions. Require an explicit target profile; inspect its current links, preserve unrelated entries, and back up before applying. Do not run setup from a mirror checkout just to publish source.
- Existing conversations keep their history and may retain their old preset. Do not retire, recreate, archive or reset sessions to make a prompt change appear effective without explicit user authorization.
- Prefer component hot reload. Bridge restart, MCP reload and DSH Desktop restart are distinct operations. Explain the required scope and obtain user authorization before a runtime interruption; do not restart Desktop as a substitute for reconnecting one MCP client.
- After an authorized bridge restart, run `scripts/verify-runtime-build.mjs` and a read-only health check. A successful syntax check or copied file does not prove the running process loaded the change.

## Validation and publication

- Use isolated fixtures and fake QQ/DSH peers. Do not send test messages to ordinary conversations without specific authorization. A tool returning queued is not proof of delivery.
- Run appropriate regression tests and required package checks. Keep source tests, live verification and uncertainty distinct in reports.
- Never commit runtime state, cookies, credentials, private reference material, personal automation, machine-specific workspace maps or local audit archives. Public fixtures and examples must be synthetic.
- Before publishing, run `npm test`, `npm run privacy:check`, `node scripts/build-agent-preset-patches.mjs --check`, and `git diff --check`. Review all staged paths and the actual diff; do not bypass a failing privacy check.
