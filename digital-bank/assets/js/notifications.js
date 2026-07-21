/* =============================================================
   MERIDIAN — International Digital Banking
   Notifications: assets/js/notifications.js

   Two things live here:

     1. Toast helper (toastSuccess / toastError / toastInfo) — builds
        the .toast-stack markup already defined in style.css and
        drops transient messages into it. Works on any page, no
        Supabase needed.

     2. The header notification bell (.app-icon-btn[aria-label="Notifications"]
        + its .app-icon-btn-badge) on logged-in pages — pulls unread
        count from the `notifications` table via supabase/database.js,
        renders a dropdown on click, and subscribes to Supabase
        Realtime so a new notification appears without a refresh.

     import { toastSuccess, toastError, initNotificationCenter } from '../assets/js/notifications.js';
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

function resolveSupabaseBase() {
  const inPagesDir = window.location.pathname.includes('/pages/');
  return inPagesDir ? '../supabase/' : 'supabase/';
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

function findBellButton() {
  return $$('.app-icon-btn').find((btn) => (btn.getAttribute('aria-label') || '').toLowerCase() === 'notifications');
}

function renderNotificationRow(notification) {
  const row = document.createElement('li');
  row.className = 'chat-menu-item'; // reuses the existing dropdown-row styling from the chat menu
  row.dataset.notificationId = notification.id;
  row.innerHTML = `
    <span class="chat-menu-item-text">
      <span>${notification.title || 'Notification'}</span>
      <small></small>
    </span>
    ${notification.is_read ? '' : '<span class="chat-menu-item-state" data-state="on">New</span>'}
  `;
  $('small', row).textContent = `${notification.message || ''} · ${formatTimestamp(notification.created_at)}`;
  return row;
}

function buildDropdown() {
  const dropdown = document.createElement('div');
  dropdown.className = 'app-user-dropdown notification-dropdown';
  dropdown.setAttribute('role', 'menu');
  dropdown.style.width = '320px';
  dropdown.innerHTML = `
    <div style="display:flex; align-items:center; justify-content:space-between; padding:0.5rem 0.6rem;">
      <strong style="font-size:0.85rem;">Notifications</strong>
      <button type="button" data-mark-all style="background:none;border:none;color:var(--brass-dark);font-size:0.78rem;font-weight:600;cursor:pointer;">Mark all read</button>
    </div>
    <ul style="list-style:none; max-height:320px; overflow-y:auto; display:flex; flex-direction:column; gap:0.15rem;"></ul>
    <p data-empty style="display:none; padding:1.25rem 0.6rem; text-align:center; font-size:0.82rem; color:var(--slate);">You're all caught up.</p>
  `;
  return dropdown;
}

/**
 * Wires the bell icon in the app header: click to toggle a dropdown
 * of recent notifications, badge shows unread count, realtime
 * subscription surfaces new ones as a toast + badge bump without a
 * page reload. No-ops quietly if the page has no bell button.
 */
export async function initNotificationCenter(userId) {
  const bell = findBellButton();
  if (!bell) return;

  const { getNotifications, getUnreadNotificationCount, markNotificationRead, markAllNotificationsRead } =
    await loadDatabaseModule();

  const badge = $('.app-icon-btn-badge', bell) || (() => {
    const span = document.createElement('span');
    span.className = 'app-icon-btn-badge';
    bell.appendChild(span);
    return span;
  })();

  async function refreshBadge() {
    const { data: count } = await getUnreadNotificationCount(userId);
    badge.textContent = count > 9 ? '9+' : String(count);
    badge.style.display = count > 0 ? 'flex' : 'none';
  }

  const dropdown = buildDropdown();
  bell.style.position = 'relative';
  bell.appendChild(dropdown);
  dropdown.style.display = 'none';

  async function renderList() {
    const list = $('ul', dropdown);
    const empty = $('[data-empty]', dropdown);
    const { data: notifications } = await getNotifications(userId, { limit: 20 });

    list.innerHTML = '';
    if (!notifications.length) {
      empty.style.display = 'block';
      return;
    }
    empty.style.display = 'none';
    notifications.forEach((n) => list.appendChild(renderNotificationRow(n)));

    list.querySelectorAll('[data-notification-id]').forEach((row) => {
      row.addEventListener('click', async () => {
        await markNotificationRead(row.dataset.notificationId);
        row.querySelector('.chat-menu-item-state')?.remove();
        refreshBadge();
      });
    });
  }

  bell.addEventListener('click', async (event) => {
    event.stopPropagation();
    const isOpen = dropdown.style.display !== 'none';
    if (isOpen) {
      dropdown.style.display = 'none';
      return;
    }
    await renderList();
    dropdown.style.display = 'block';
  });

  document.addEventListener('click', (event) => {
    if (!dropdown.contains(event.target) && event.target !== bell) {
      dropdown.style.display = 'none';
    }
  });

  $('[data-mark-all]', dropdown).addEventListener('click', async (event) => {
    event.stopPropagation();
    await markAllNotificationsRead(userId);
    dropdown.querySelectorAll('.chat-menu-item-state').forEach((el) => el.remove());
    refreshBadge();
  });

  await refreshBadge();
  subscribeToNewNotifications(userId, async (notification) => {
    toastInfo(notification.message, notification.title || 'New notification');
    pulse(bell);
    refreshBadge();
    if (dropdown.style.display !== 'none') renderList();
  });
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
