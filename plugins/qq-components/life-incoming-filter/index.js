// Inspect only this message's own text, before rendering quotes or QQ nicknames.
export function createPlugin() {
  return {
    services: {
      incomingFilter: {
        evaluate({ message, rawMessage } = {}) {
          const text = Array.isArray(message)
            ? message.filter(segment => segment?.type === 'text')
              .map(segment => String(segment.data?.text ?? '')).join('')
            : String(message ?? rawMessage ?? '');
          const blocked = text.trimStart().startsWith('[自动回复]');
          return { blocked, reason: blocked ? 'auto_reply_prefix' : '' };
        },
      },
    },
  };
}
