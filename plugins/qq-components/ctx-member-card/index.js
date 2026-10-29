// Compatibility shell for the existing console navigation entry.
// Canonical storage, tools, and private-chat injection live in ctx-memory-profile-store.
// This component deliberately has no storage, tools, or prompt injection.
export function createPlugin() {
  return { hooks: { beforePrompt() { return ''; } } };
}
