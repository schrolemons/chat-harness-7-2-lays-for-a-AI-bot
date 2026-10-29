import globals from 'globals';
export default [{
  files: ['console/**/*.js'],
  languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: globals.browser },
  rules: { 'no-undef':'error', 'no-dupe-keys':'error' },
}, {
  files: [
    'src/bridge.js', 'src/outbound-context.js', 'src/reply-shape.js', 'src/conversation-drive.js',
    'src/plugin-host.js', 'src/mcp-snowluma-safe.js', 'src/migrations/outbound-mood.mjs',
    'src/bridge-core/direct-timed-notices.js', 'src/tools/flags.js',
    'plugins/qq-components/{ctx-chat-reply-shape,ctx-chat-style,ctx-chat-topic-drive,ctx-context-dynamics,ctx-media-sticker-pick,ctx-user-mood,life-wake-reasons}/**/*.{js,mjs}',
  ],
  languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: globals.node },
  rules: { 'no-undef':'error', 'no-dupe-keys':'error' },
}];
