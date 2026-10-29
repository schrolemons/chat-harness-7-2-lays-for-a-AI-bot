
// Apply only the T-layer configuration fields.
export function applyTConfig(c) {
document.querySelectorAll('[data-v2-tool]').forEach(el => {
      el.checked = (c.tools && c.tools[el.dataset.v2Tool] !== false);
    });
}
