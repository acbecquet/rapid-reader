// Inline 16x16 SVG glyphs, one per source/action key.
// Each value is a complete <svg> string that inherits text color via currentColor.
export const ICONS = {
  lightning: '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M9 1 3 9h4l-1 6 7-9H9l1-5z"/></svg>',

  plus: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M8 3v10M3 8h10"/></svg>',

  book: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M8 4C6.5 2.8 4.3 2.8 2 3.3v9c2.3-.5 4.5-.5 6 .7 1.5-1.2 3.7-1.2 6-.7v-9C11.7 2.8 9.5 2.8 8 4zM8 4v9.7"/></svg>',

  claude: '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M8 1l1.3 4 3-2.6L10.7 6 15 5.7l-3.6 2.3L15 10.3 10.7 10l1.6 3.6-3-2.6L8 15l-1.3-4-3 2.6L5.3 10 1 10.3l3.6-2.3L1 5.7 5.3 6 3.7 2.4l3 2.6L8 1z"/></svg>',

  codex: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M8 1.5l5.6 3.25v6.5L8 14.5l-5.6-3.25v-6.5L8 1.5z"/><circle cx="8" cy="8" r="2.2"/></svg>',

  copilot: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><rect x="2.5" y="4.5" width="11" height="8" rx="4"/><circle cx="6" cy="8.5" r="1.1" fill="currentColor" stroke="none"/><circle cx="10" cy="8.5" r="1.1" fill="currentColor" stroke="none"/><path d="M8 2.5v2"/></svg>',

  docs: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"><path d="M4 1.5h5l3 3v10H4v-13z"/><path d="M9 1.5v3h3M6 8h4M6 10.5h4"/></svg>',

  email: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><rect x="2" y="3.5" width="12" height="9" rx="1.5"/><path d="M2.5 4.5L8 9l5.5-4.5"/></svg>',

  telegram: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"><path d="M14 2L1.5 7l4 1.5L14 2zM5.5 8.5L14 2 7.5 13l-2-3.5L5.5 8.5z"/></svg>',

  news: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"><path d="M2 3.5h9v9H3a1 1 0 01-1-1v-8z"/><path d="M11 6h2.5v5.5a1 1 0 01-1 1H11V3.5z"/><path d="M4 6h3v3H4zM8.5 6.5H9M4 11h5"/></svg>',

  general: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M8 1.5l6 3-6 3-6-3 6-3z"/><path d="M2 8l6 3 6-3M2 11l6 3 6-3"/></svg>',

  agents: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><rect x="3.5" y="5" width="9" height="8" rx="1.5"/><path d="M8 2v3M6 8h.01M10 8h.01M6.5 10.5h3M1.5 7.5v3M14.5 7.5v3"/></svg>',
};

export function icon(key) {
  return ICONS[key] || ICONS.general;
}
