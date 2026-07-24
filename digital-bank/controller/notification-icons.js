/* =============================================================
   MERIDIAN — Notification category icons: assets/js/notification-icons.js
   One place for the icon + label shown per notification.category,
   shared between the navbar bell dropdown and the full
   Notification Center page so the two never drift apart.
   ============================================================= */

const ICONS = {
  banking: '<path d="M10 3v14M4 9l6-6 6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
  account: '<circle cx="10" cy="7" r="3.2" stroke="currentColor" stroke-width="1.4"/><path d="M4 17c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
  security: '<path d="M10 2.5 16 5v4.5c0 4-2.7 6.9-6 8-3.3-1.1-6-4-6-8V5Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M7.4 10 9.2 11.8 12.8 8.2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>',
  cards: '<rect x="2.5" y="5.5" width="15" height="10" rx="2" stroke="currentColor" stroke-width="1.4"/><path d="M2.5 9h15" stroke="currentColor" stroke-width="1.4"/>',
  investments: '<path d="M4 15.5 8 10l3 2.5 5-6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M12.5 6.5h4v4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
  loans: '<path d="M4 17V8l6-4 6 4v9" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M7.5 17v-5h5v5" stroke="currentColor" stroke-width="1.4"/>',
  savings: '<circle cx="10" cy="11" r="6" stroke="currentColor" stroke-width="1.4"/><path d="M13.5 6 15 4.2M7 5l-1-1.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="12.3" cy="10.3" r="0.9" fill="currentColor"/>',
  rewards: '<path d="M10 6.5 11.6 9.7 15.2 10.2 12.6 12.7 13.2 16.3 10 14.6 6.8 16.3 7.4 12.7 4.8 10.2 8.4 9.7Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>',
  system: '<circle cx="10" cy="10" r="7" stroke="currentColor" stroke-width="1.4"/><path d="M10 9v4.2M10 6.7v.1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
};

const LABELS = {
  banking: 'Banking',
  account: 'Account',
  security: 'Security',
  cards: 'Cards',
  investments: 'Investments',
  loans: 'Loans',
  savings: 'Savings',
  rewards: 'Rewards',
  system: 'System',
};

/** Returns an inline <svg> string for a notification category (falls back to "system"). */
export function categoryIconSvg(category) {
  const inner = ICONS[category] || ICONS.system;
  return `<svg viewBox="0 0 20 20" fill="none" aria-hidden="true">${inner}</svg>`;
}

/** Human label for a category value, e.g. "investments" -> "Investments". */
export function categoryLabel(category) {
  return LABELS[category] || 'System';
}

export const NOTIFICATION_CATEGORY_LIST = Object.keys(LABELS);
