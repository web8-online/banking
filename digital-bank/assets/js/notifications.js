/* =============================================================
   MERIDIAN — International Digital Banking
   Notifications: assets/js/notifications.js

   Two things live here:

     1. Toast helper (toastSuccess / toastError / toastInfo) — builds
        the .toast-stack markup already defined in style.css and
        drops transient messages into it. Works on any page, no
        Supabase needed.

     2. The header notification bell — this now drives the REAL
        markup already shipped in components/app-navbar.html
        ([data-notification-bell] and its children), instead of
        building a second dropdown from scratch. It pulls unread
        count + recent notifications from the `notifications` table
        via supabase/database.js, and subscribes to Supabase Realtime
        so a new notification appears without a refresh.

     import { toastSuccess, toastError, initNotificationCenter } from '../assets/js/notifications.js';

   FIXES vs the previous version of this file:
     - No longer builds a duplicate dropdown and appends it INSIDE
       the bell <button> (invalid markup, visually clipped). It now
       finds and drives the dropdown that's already a sibling of the
       button in app-navbar.html via data-notification-* attributes.
     - resolveSupabaseBase() now returns a fixed relative path
       instead of branching on the current page's URL. It's used
       only for dynamic import() calls below, and import() specifiers
       resolve relative to THIS FILE's own location — not the page
       that's currently loaded. This file always lives at
       /assets/js/notifications.js (two directories deep from the
       project root: assets/, then js/), so it always needs exactly
       '../../' to reach the root-level supabase/ folder, regardless
       of which page (root-level or under /pages/) triggered the
       import. (Compare with resolveComponentsBase() in
       components.js, which correctly DOES branch on the page URL —
       but that one uses fetch(), which resolves against the page,
       not the importing file.)
     - Dynamic imports and every Supabase call are now wrapped in
       try/catch. A failure shows the existing error state (with the
       Try again button already in the markup) instead of throwing
       silently and leaving the bell dead with no console clue.
   ============================================================= */

import { $, $$, formatTimestamp } from './utils.js';
import { pulse } from './animations.js';

/* -----------------------------------------------------------
   Toasts
   ----------------------------------------------------------- */

const TOAST_ICONS = {
  success: '<path d="M5 12.5 10 17l9-10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  error: '<path d="M6 6l8 8M14 6l-8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  info: '<circle cx="10" cy="10" r="8" stroke="currentColor" stroke-width="1.6"/><path d="M10 9v5M10 6.5v.1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
};

function getOrCreateToastStack() {
  let stack = $('.toast-stack');
  if (!stack) {
    stack = document.createElement('div');
    stack.className = 'toast-stack';
    stack.setAttribute('aria-live', 'polite');
    document.body.appendChild(stack);
  }
  return stack;
}

/**
 * Shows a toast. `type` is 'success' | 'error' | 'info'.
 * Auto-dismisses after `duration` ms (0 disables auto-dismiss).
 */
export function showToast({ type = 'info', title, message, duration = 5000 } = {}) {
  const stack = getOrCreateToastStack();

  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
  toast.innerHTML = `
    <span class="toast-icon"><svg viewBox="0 0 20 20" fill="none" aria-hidden="true">${TOAST_ICONS[type] || TOAST_ICONS.info}</svg></span>
    <div class="toast-body">
      ${title ? `<strong></strong>` : ''}
      <span></span>
    </div>
    <button type="button" class="toast-close" aria-label="Dismiss notification">
      <svg viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M2 2l10 10M12 2 2 12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
    </button>
  `;
  if (title) $('strong', toast).textContent = title;
  $('.toast-body span', toast).textContent = message || '';

  stack.appendChild(toast);
  // Force layout before adding the visible class so the transition actually runs.
  requestAnimationFrame(() => toast.classList.add('is-visible'));

  let dismissTimer;
  const dismiss = () => {
    clearTimeout(dismissTimer);
    toast.classList.remove('is-visible');
    toast.addEventListener('transitionend', () => toast.remove(), { once: true });
    // Fallback in case the transition never fires (e.g. reduced motion strips it).
    setTimeout(() => toast.remove(), 400);
  };

  $('.toast-close', toast).addEventListener('click', dismiss);
  if (duration > 0) dismissTimer = setTimeout(dismiss, duration);

  return { dismiss };
}

export const toastSuccess = (message, title = 'Success') => showToast({ type: 'success', title, message });
export const toastError = (message, title = 'Something went wrong') => showToast({ type: 'error', title, message });
export const toastInfo = (message, title) => showToast({ type: 'info', title, message });

/* -----------------------------------------------------------
   Header notification bell — logged-in app pages only
   ----------------------------------------------------------- */

/**
 * Used only for dynamic import() below. import() specifiers resolve
 * relative to THIS file's own location, not the current page's URL.
 * This file always lives at /assets/js/notifications.js — two
 * directories deep from the project root — so it always needs
 * exactly '../../' to reach root-level supabase/, regardless of
 * which page triggered the import. Do NOT branch this on
 * window.location.pathname.
 */
function resolveSupabaseBase() {
  return '../../supabase/';
}

let dbModulePromise = null;
function loadDatabaseModule() {
  if (!dbModulePromise) dbModulePromise = import(`${resolveSupabaseBase()}database.js`);
  return dbModulePromise;
}

let configModulePromise = null;
function loadConfigModule() {
  if (!configModulePromise) configModulePromise = import(`${resolveSupabaseBase()}config.js`);
  return configModulePromise;
}

/**
 * Grabs every element the navbar markup already defines for the
 * bell/dropdown. Returns null if the bell isn't on this page (some
 * pages may not render the navbar at all), so callers can no-op.
 */
function getBellElements() {
  const wrap = document.querySelector('[data-notification-bell]');
  if (!wrap) return null;

  const toggle = wrap.querySelector('[data-notification-toggle]');
  const dropdown = wrap.querySelector('[data-notification-dropdown]');
  if (!toggle || !dropdown) return null;

  return {
    wrap,
    toggle,
    dropdown,
    badge: wrap.querySelector('[data-notification-badge]'),
    body: dropdown.querySelector('[data-notification-body]'),
    list: dropdown.querySelector('[data-notification-list]'),
    loading: dropdown.querySelector('[data-notification-loading]'),
    empty: dropdown.querySelector('[data-notification-empty]'),
    error: dropdown.querySelector('[data-notification-error]'),
    retryBtn: dropdown.querySelector('[data-notification-retry]'),
    markAllBtn: dropdown.querySelector('[data-notification-mark-all]'),
  };
}

function showBodyState(els, state) {
  // state is one of: 'loading' | 'list' | 'empty' | 'error'
  if (els.loading) els.loading.hidden = state !== 'loading';
  if (els.list) els.list.hidden = state !== 'list';
  if (els.empty) els.empty.hidden = state !== 'empty';
  if (els.error) els.error.hidden = state !== 'error';
}

function renderNotificationRow(notification) {
  const row = document.createElement('li');
  row.className = 'notification-row';
  row.dataset.notificationId = notification.id;
  row.setAttribute('role', 'menuitem');
  row.tabIndex = 0;
  row.innerHTML = `
    <span class="notification-row-text">
      <span>${notification.title || 'Notification'}</span>
      <small></small>
    </span>
    ${notification.is_read ? '' : '<span class="notification-row-state" data-state="on">New</span>'}
  `;
  row.querySelector('small').textContent = `${notification.message || ''} · ${formatTimestamp(notification.created_at)}`;
  return row;
}

function setBadgeCount(badge, count) {
  if (!badge) return;
  badge.textContent = count > 9 ? '9+' : String(count);
  badge.style.display = count > 0 ? 'flex' : 'none';
}

function openDropdown(els) {
  els.dropdown.setAttribute('aria-hidden', 'false');
  els.toggle.setAttribute('aria-expanded', 'true');
  els.dropdown.style.display = 'block';
}

function closeDropdown(els) {
  els.dropdown.setAttribute('aria-hidden', 'true');
  els.toggle.setAttribute('aria-expanded', 'false');
  els.dropdown.style.display = 'none';
}

function isDropdownOpen(els) {
  return els.dropdown.getAttribute('aria-hidden') === 'false';
}

/**
 * Wires the bell icon in the app header: click to toggle the
 * dropdown that's already in app-navbar.html, badge shows unread
 * count, realtime subscription surfaces new ones as a toast + badge
 * bump without a page reload. No-ops quietly if the page has no
 * bell markup (e.g. a page that doesn't render the navbar).
 */
export async function initNotificationCenter(userId) {
  const els = getBellElements();
  if (!els) return;

  // Start closed regardless of markup default.
  closeDropdown(els);

  let db;
  try {
    db = await loadDatabaseModule();
  } catch (err) {
    console.error('Notifications: failed to load database module', err);
    showBodyState(els, 'error');
    return;
  }

  const { getNotifications, getUnreadNotificationCount, markNotificationRead, markAllNotificationsRead } = db;

  async function refreshBadge() {
    try {
      const { data: count, error } = await getUnreadNotificationCount(userId);
      if (error) throw new Error(error);
      setBadgeCount(els.badge, count);
    } catch (err) {
      console.error('Notifications: failed to refresh unread count', err);
      // Don't blow up the badge over this — just leave it as-is.
    }
  }

  async function renderList() {
    showBodyState(els, 'loading');
    try {
      const { data: notifications, error } = await getNotifications(userId, { limit: 20 });
      if (error) throw new Error(error);

      if (els.list) els.list.innerHTML = '';

      if (!notifications.length) {
        showBodyState(els, 'empty');
        return;
      }

      notifications.forEach((n) => els.list.appendChild(renderNotificationRow(n)));
      showBodyState(els, 'list');

      els.list.querySelectorAll('[data-notification-id]').forEach((row) => {
        row.addEventListener('click', async () => {
          try {
            await markNotificationRead(row.dataset.notificationId);
            row.querySelector('.notification-row-state')?.remove();
            refreshBadge();
          } catch (err) {
            console.error('Notifications: failed to mark row read', err);
          }
        });
      });
    } catch (err) {
      console.error('Notifications: failed to load notification list', err);
      showBodyState(els, 'error');
    }
  }

  els.toggle.addEventListener('click', async (event) => {
    event.stopPropagation();
    if (isDropdownOpen(els)) {
      closeDropdown(els);
      return;
    }
    openDropdown(els);
    await renderList();
  });

  document.addEventListener('click', (event) => {
    if (isDropdownOpen(els) && !els.dropdown.contains(event.target) && event.target !== els.toggle) {
      closeDropdown(els);
    }
  });

  els.retryBtn?.addEventListener('click', async (event) => {
    event.stopPropagation();
    await renderList();
  });

  els.markAllBtn?.addEventListener('click', async (event) => {
    event.stopPropagation();
    try {
      await markAllNotificationsRead(userId);
      els.list?.querySelectorAll('.notification-row-state').forEach((el) => el.remove());
      refreshBadge();
    } catch (err) {
      console.error('Notifications: failed to mark all read', err);
      toastError("Couldn't mark all notifications as read.");
    }
  });

  await refreshBadge();

  try {
    await subscribeToNewNotifications(userId, async (notification) => {
      toastInfo(notification.message, notification.title || 'New notification');
      pulse(els.toggle);
      refreshBadge();
      if (isDropdownOpen(els)) renderList();
    });
  } catch (err) {
    // Realtime is a nice-to-have, not a hard requirement — don't
    // break the rest of the bell (click-to-open, badge, mark-read)
    // just because the subscription failed (e.g. replication isn't
    // enabled on the notifications table yet).
    console.error('Notifications: realtime subscription failed', err);
  }
}

/**
 * Subscribes to INSERTs on the notifications table for one user via
 * Supabase Realtime. Requires the `notifications` table to have
 * realtime replication enabled in the Supabase dashboard. Returns an
 * unsubscribe function.
 */
export async function subscribeToNewNotifications(userId, onInsert) {
  const { supabase } = await loadConfigModule();

  const channel = supabase
    .channel(`notifications:${userId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
      (payload) => onInsert(payload.new)
    )
    .subscribe();

  return () => supabase.removeChannel(channel);
}
