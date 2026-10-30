
// shared/icons: explicit imports; initialize is called in the application startup order.

let NAV_ICON_PATHS;

function renderNavIcon(view) {
  return '<span class="nav-icon" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false">' + (NAV_ICON_PATHS[view] || NAV_ICON_PATHS.registry) + '</svg></span>';
}

export function initialize() {
NAV_ICON_PATHS = {
  "context-visual": "<path d=\"m12 2 10 5-10 5L2 7Zm-10 10 10 5 10-5M2 17l10 5 10-5\"/><path d=\"M12 12v10\"/>",
  "setting-o-2": "<path d=\"M14 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h9M8 7h5M8 11h3M8 15h2\"/><path d=\"M17 10a5 5 0 1 1-4 8m0-4v4h4m3-11v3h-3\"/>",
  "terms": "<path d=\"m12 3-10 5 10 5 10-5ZM6 11v5c3 3 9 3 12 0v-5M22 8v8\"/>",
  "persona": "<circle cx=\"12\" cy=\"8\" r=\"3.5\"/><path d=\"M5 21v-2a7 7 0 0 1 14 0v2\"/>",
  "slang": "<path d=\"M4 5a2 2 0 0 1 2-2h14v18H6a2 2 0 0 1 0-4h14M4 5v14M8 7h8M8 11h6\"/>",
  "alias": "<path d=\"M3 4h8l10 10-7 7L3 10Z\"/><circle cx=\"7.5\" cy=\"7.5\" r=\"1\"/>",
  "reference": "<circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M12 11v6M12 7h.01\"/>",
  "v2-t": "<path d=\"M4 7h7m4 0h5M4 17h3m4 0h9\"/><circle cx=\"13\" cy=\"7\" r=\"2\"/><circle cx=\"9\" cy=\"17\" r=\"2\"/>",
  "games": "<path d=\"M6 8h12a4 4 0 0 1 3.8 5.2l-1 3A2 2 0 0 1 17 17l-2-2H9l-2 2a2 2 0 0 1-3.8-.8l-1-3A4 4 0 0 1 6 8Z\"/><path d=\"M7 10v4m-2-2h4m7-1h.01M18 13h.01\"/>",
  "codex-peer": "<rect x=\"2\" y=\"4\" width=\"8\" height=\"7\" rx=\"1.5\"/><rect x=\"14\" y=\"13\" width=\"8\" height=\"7\" rx=\"1.5\"/><path d=\"M14 6h5v4m-3-3 3 3M10 18H5v-4m3 3-3-3\"/>",
  "injection-lab": "<path d=\"M9 3h6M10 3v6L4 19a1.3 1.3 0 0 0 1 2h14a1.3 1.3 0 0 0 1-2L14 9V3M7 15h10M10 18h.01M14 12h.01\"/>",
  "environment-chat": "<path d=\"M21 11a8 8 0 0 1-8 8H7l-4 2V9a7 7 0 0 1 7-7h4a7 7 0 0 1 7 7Z\"/>",
  "environment-admin": "<path d=\"m12 3-8 3v6c0 5 8 9 8 9s8-4 8-9V6Z\"/><path d=\"m9 12 2 2 4-4\"/>",
  "environment-web": "<rect x=\"3\" y=\"3\" width=\"18\" height=\"18\" rx=\"2\"/><path d=\"M3 8h18m-8 4 5 2-3 1-1 3Z\"/>",
  "environment-watch": "<path d=\"M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z\"/><circle cx=\"12\" cy=\"12\" r=\"3\"/>",
  "environment-scripts": "<rect x=\"3\" y=\"4\" width=\"18\" height=\"16\" rx=\"2\"/><path d=\"m7 9 3 3-3 3m6 0h4\"/>",
  "images": "<rect x=\"3\" y=\"3\" width=\"18\" height=\"18\" rx=\"2\"/><circle cx=\"8\" cy=\"8\" r=\"2\"/><path d=\"m3 17 5-5 4 4 3-3 6 6\"/>",
  "video": "<rect x=\"3\" y=\"5\" width=\"13\" height=\"14\" rx=\"2\"/><path d=\"m16 10 5-3v10l-5-3\"/>",
  "sessions": "<path d=\"M21 12a8 8 0 0 1-8 8H7l-4 2V10a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8Z\"/><path d=\"m8 11 3 3 5-5\"/>",
  "v2-e": "<rect x=\"9\" y=\"2\" width=\"6\" height=\"12\" rx=\"3\"/><path d=\"M5 10v1a7 7 0 0 0 14 0v-1M12 18v4M8 22h8\"/>",
  "v2-l": "<path d=\"m13 2-9 12h7l-1 8 10-12h-7Z\"/>",
  "social-v1": "<path d=\"M3 10a9 9 0 1 1 2 8M3 4v6h6M12 7v5l3 2\"/>",
  "overview": "<rect x=\"3\" y=\"3\" width=\"7\" height=\"7\" rx=\"1.5\"/><rect x=\"14\" y=\"3\" width=\"7\" height=\"11\" rx=\"1.5\"/><rect x=\"3\" y=\"14\" width=\"7\" height=\"7\" rx=\"1.5\"/><rect x=\"14\" y=\"18\" width=\"7\" height=\"3\" rx=\"1\"/>",
  "usage": "<path d=\"M4 20V10m6 10V4m6 16v-7M2 22h20\"/><circle cx=\"19\" cy=\"6\" r=\"3\"/>",
  "operations": "<path d=\"M14 6a6 6 0 0 0-7 7L3 17a2.8 2.8 0 0 0 4 4l5-5a6 6 0 0 0 7-8l-4 4-3-3 4-4Z\"/>",
  "layer-v": "<path d=\"m12 3-8 3v6c0 5 8 9 8 9s8-4 8-9V6Z\"/><path d=\"m8 12 3 3 5-6\"/>",
  "human": "<circle cx=\"12\" cy=\"7\" r=\"4\"/><path d=\"M4 21v-2a8 8 0 0 1 16 0v2Z\"/>",
  "access": "<rect x=\"5\" y=\"10\" width=\"14\" height=\"11\" rx=\"2\"/><path d=\"M8 10V7a4 4 0 0 1 8 0v3M12 15v2\"/>",
  "layer-s": "<path d=\"M3 3h7a3 3 0 0 1 3 3v15a4 4 0 0 0-4-2H3Zm18 0h-5a3 3 0 0 0-3 3v15a4 4 0 0 1 4-2h4Z\"/>",
  "registry": "<path d=\"M9 3v5H4v5h5v8h5v-5h6v-5h-6V3Z\"/>",
  "setting-c-0": "<circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M8 9h.01M16 9h.01M8 14a4.5 4.5 0 0 0 8 0\"/>",
  "setting-c-1": "<path d=\"M12 5a3 3 0 0 0-6-1 4 4 0 0 0-3 6 4 4 0 0 0 1 7 4 4 0 0 0 8 2m0-14a3 3 0 0 1 6-1 4 4 0 0 1 3 6 4 4 0 0 1-1 7 4 4 0 0 1-8 2V5ZM8 8l-2 2m12-2 2 2M7 14l2 2m8-2-2 2\"/>",
  "setting-c-2": "<path d=\"M21 11a8 8 0 0 1-8 8H8l-5 3V11a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8Z\"/><path d=\"M7 8h10M7 12h8M7 16h4\"/>",
  "setting-l-0": "<path d=\"M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4M12 2V1\"/>",
  "setting-l-1": "<path d=\"m22 2-7 20-4-9L2 9Zm0 0L11 13\"/>",
  "setting-l-2": "<rect x=\"3\" y=\"4\" width=\"18\" height=\"17\" rx=\"2\"/><path d=\"M7 2v4M17 2v4M3 10h18M7 14h3M7 17h3\"/><circle cx=\"16\" cy=\"16\" r=\"3\"/><path d=\"M16 14v2l1 1\"/>",
  "setting-o-0": "<path d=\"M2 12h5l3-8 4 16 3-8h5\"/>",
  "setting-o-1": "<path d=\"M14 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-8M7 8h4M7 12h2m4-1 7-7 2 2-7 7-3 1Z\"/>"
};
for (const nav of document.querySelectorAll('#mainNav .nav-item[data-view]')) {
  const icon = nav.querySelector('.nav-icon');
  if (icon) icon.outerHTML = renderNavIcon(nav.dataset.view);
}
}
export { NAV_ICON_PATHS, renderNavIcon };
