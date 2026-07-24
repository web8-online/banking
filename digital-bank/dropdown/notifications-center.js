/* =============================================================
   MERIDIAN — International Digital Banking
   Notification Center page controller: assets/js/notifications-center.js
   Loaded only by pages/notifications.html.

   Drives every element in that page: search, status tabs
   (all/unread/archived), category chips, Today/Yesterday/This
   week/Earlier grouping, Load more pagination, the detail
   slide-out panel, and a live Realtime subscription so new/updated
   notifications reflect without a refresh.

   Data comes from supabase/notifications.js (the richer module with
   category/search/archive/pin support) — NOT supabase/database.js's
   simpler notification helpers, which the navbar bell uses instead.

   NOTE on relative paths: this file always lives at
   /assets/js/notifications-center.js — two directories deep from
   the project root — so its dynamic import() calls always need
   '../../' to reach root-level supabase/, regardless of which page
   loaded it. (import() resolves relative to THIS file, not the page.)
   ============================================================= */

import { $, $$, formatTimestamp, debounce } from './utils.js';
import { categoryIconSvg, categoryLabel, NOTIFICATION_CATEGORY_LIST } from './notification-icons.js';
import { toastSuccess, toastError } from './notifications.js';

const PAGE_SIZE = 20;

let notifApiPromise = null;
function loadNotifApi() {
  if (!notifApiPromise) notifApiPromise = import('../../supabase/notifications.js');
  return notifApiPromise;
}

let dbApiPromise = null;
function loadDbApi() {
  if (!dbApiPromise) dbApiPromise = import('../../supabase/database.js');
  return dbApiPromise;
}

let configApiPromise = null;
function loadConfigApi() {
  if (!configApiPromise) configApiPromise = import('../../supabase/config.js');
  return configApiPromise;
}

let authApiPromise = null;
function loadAuthApi() {
  if (!authApiPromise) authApiPromise = import('../../supabase/auth.js');
  return authApiPromise;
}

const state = {
  user: null,
  category: 'all',
  tab: 'all', // 'all' | 'unread' | 'archived'
  search: '',
  offset: 0,
  hasMore: true,
  items: [],
  loading: false,
};

let currentDetail = null;
let unsubscribeRealtime = null;
const els = {};

/* -----------------------------------------------------------
   Setup
   ----------------------------------------------------------- */

function cacheEls() {
  els.markAllBtn = $('#notif-mark-all');
  els.searchInput = $('#notif-search-input');
  els.statusTabs = $('#notif-status-tabs');
  els.categoryChips = $('#notif-category-chips');

  els.list = $('#notif-list');
  els.loading = $('#notif-loading');
  els.empty = $('#notif-empty');
  els.error = $('#notif-error');
  els.retryBtn = $('#notif-retry');
  els.loadMoreWrap = $('#notif-load-more');
  els.loadMoreBtn = $('#notif-load-more-btn');

  els.detailOverlay = $('#notif-detail-overlay');
  els.detailCategory = $('#notif-detail-category');
  els.detailTitle = $('#notif-detail-title');
  els.detailMessage = $('#notif-detail-message');
  els.detailDate = $('#notif-detail-date');
  els.detailStatus = $('#notif-detail-status');
  els.detailAccountRow = $('#notif-detail-account-row');
  els.detailAccount = $('#notif-detail-account');
  els.detailTxRow = $('#notif-detail-tx-row');
  els.detailTx = $('#notif-detail-tx');
  els.detailAction = $('#notif-detail-action');
  els.detailArchive = $('#notif-detail-archive');
  els.detailDelete = $('#notif-detail-delete');
  els.detailClose = $('#notif-detail-close');
}

function buildCategoryChips() {
  NOTIFICATION_CATEGORY_LIST.forEach((value) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'notif-chip';
    btn.dataset.category = value;
    btn.textContent = categoryLabel(value);
    els.categoryChips.appendChild(btn);
  });
}

/**
 * Explicitly sets inline display instead of relying solely on the
 * `hidden` attribute — notifications.css gives `.notification-state--loading`
 * (and `.notification-list`) an explicit `display:` that otherwise
 * beats the browser's default `[hidden] { display:none }` rule and
 * leaves the element visibly stuck on screen.
 */
function setViewState(view) {
  const targets = { loading: els.loading, list: els.list, empty: els.empty, error: els.error };
  Object.entries(targets).forEach(([key, el]) => {
    if (!el) return;
    const show = key === view;
    el.hidden = !show;
    el.style.display = show ? '' : 'none';
  });
}

/* -----------------------------------------------------------
   Grouping — Today / Yesterday / This week / Earlier
   ----------------------------------------------------------- */

function groupLabelFor(date) {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfToday.getDate() - 1);
  const startOfWeek = new Date(startOfToday);
  startOfWeek.setDate(startOfToday.getDate() - 7);

  if (date >= startOfToday) return 'Today';
  if (date >= startOfYesterday) return 'Yesterday';
  if (date >= startOfWeek) return 'This week';
  return 'Earlier';
}

/* -----------------------------------------------------------
   Rendering
   ----------------------------------------------------------- */

function renderRow(n) {
  const li = document.createElement('li');
  li.className = `notification-row${n.is_read ? '' : ' is-unread'}`;
  li.dataset.id = n.id;
  li.tabIndex = 0;
  li.setAttribute('role', 'button');
  li.innerHTML = `
    <span class="notification-row-icon notification-row-icon--${n.category || 'system'}">${categoryIconSvg(n.category)}</span>
    <span class="notification-row-body">
      <strong></strong>
      <span class="notification-row-msg"></span>
      <time></time>
    </span>
    ${n.is_read ? '' : '<span class="notification-dot" aria-hidden="true"></span>'}
  `;
  $('strong', li).textContent = n.title || 'Notification';
  $('.notification-row-msg', li).textContent = n.message || '';
  $('time', li).textContent = formatTimestamp(n.created_at);

  const open = () => openDetail(n);
  li.addEventListener('click', open);
  li.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      open();
    }
  });
  return li;
}

function renderList() {
  if (!state.items.length) {
    setViewState('empty');
    els.loadMoreWrap.hidden = true;
    return;
  }

  setViewState('list');
  els.list.innerHTML = '';

  // Re-sort newest-first for display purposes: the API may return
  // pinned items first, which would otherwise scramble the
  // Today/Yesterday/This week/Earlier grouping below.
  const sorted = [...state.items].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  let currentGroup = null;
  sorted.forEach((n) => {
    const group = groupLabelFor(new Date(n.created_at));
    if (group !== currentGroup) {
      currentGroup = group;
      const label = document.createElement('li');
      label.className = 'notif-group-label';
      label.style.listStyle = 'none';
      label.textContent = group;
      els.list.appendChild(label);
    }
    els.list.appendChild(renderRow(n));
  });

  els.loadMoreWrap.hidden = !state.hasMore;
}

/* -----------------------------------------------------------
   Data fetching
   ----------------------------------------------------------- */

function currentQueryOpts() {
  const opts = { category: state.category, search: state.search, limit: PAGE_SIZE, offset: state.offset };
  if (state.tab === 'archived') {
    opts.archived = true;
    opts.status = 'all';
  } else if (state.tab === 'unread') {
    opts.archived = false;
    opts.status = 'unread';
  } else {
    opts.archived = false;
    opts.status = 'all';
  }
  return opts;
}

async function fetchPage({ reset }) {
  if (state.loading) return;
  state.loading = true;

  if (reset) {
    state.offset = 0;
    state.items = [];
  }
  if (!state.items.length) setViewState('loading');
  if (els.loadMoreBtn) els.loadMoreBtn.disabled = true;

  try {
    const api = await loadNotifApi();
    const { data, error, count } = await api.getNotifications(state.user.id, currentQueryOpts());
    if (error) throw new Error(error);

    state.items = reset ? data : state.items.concat(data);
    state.offset += data.length;
    state.hasMore = typeof count === 'number' ? state.offset < count : data.length === PAGE_SIZE;

    renderList();
  } catch (err) {
    console.error('Notification Center: failed to load notifications', err);
    setViewState('error');
  } finally {
    state.loading = false;
    if (els.loadMoreBtn) els.loadMoreBtn.disabled = false;
  }
}

/* -----------------------------------------------------------
   Detail panel
   ----------------------------------------------------------- */

async function openDetail(n) {
  currentDetail = n;

  els.detailCategory.textContent = categoryLabel(n.category);
  els.detailTitle.textContent = n.title || 'Notification';
  els.detailMessage.textContent = n.message || '';
  els.detailDate.textContent = formatTimestamp(n.created_at);
  els.detailStatus.textContent = n.is_archived ? 'Archived' : (n.is_read ? 'Read' : 'Unread');
  els.detailArchive.textContent = n.is_archived ? 'Restore' : 'Archive';

  els.detailAccountRow.hidden = !n.related_account_id;
  els.detailTxRow.hidden = !n.related_transaction_id;
  els.detailAccount.textContent = '';
  els.detailTx.textContent = '';

  if (n.action_url) {
    els.detailAction.href = n.action_url;
    els.detailAction.hidden = false;
  } else {
    els.detailAction.hidden = true;
  }

  els.detailOverlay.classList.add('is-open');
  els.detailOverlay.setAttribute('aria-hidden', 'false');

  if (!n.is_read) {
    try {
      const api = await loadNotifApi();
      await api.markAsRead(n.id);
      n.is_read = true;
      const row = els.list.querySelector(`[data-id="${n.id}"]`);
      row?.classList.remove('is-unread');
      row?.querySelector('.notification-dot')?.remove();
      els.detailStatus.textContent = n.is_archived ? 'Archived' : 'Read';
    } catch (err) {
      console.error('Notification Center: failed to mark as read', err);
    }
  }

  if (n.related_account_id || n.related_transaction_id) {
    try {
      const db = await loadDbApi();
      if (n.related_account_id) {
        const { data: account } = await db.getAccountById(n.related_account_id);
        if (account) {
          const tail = String(account.account_number || account.iban || '').replace(/\s+/g, '').slice(-4);
          els.detailAccount.textContent = tail ? `${account.currency} account ···· ${tail}` : `${account.currency} account`;
        }
      }
      if (n.related_transaction_id) {
        // related_transaction_id is the transaction's UUID, not its
        // human transaction_reference — database.js's
        // getTransactionByReference() looks up by the latter, so
        // query the id directly instead of misusing that helper.
        const { supabase } = await loadConfigApi();
        const { data: tx } = await supabase
          .from('transactions')
          .select('transaction_reference')
          .eq('id', n.related_transaction_id)
          .maybeSingle();
        els.detailTx.textContent = tx?.transaction_reference || n.related_transaction_id;
      }
    } catch (err) {
      console.error('Notification Center: failed to load related record', err);
    }
  }
}

function closeDetail() {
  els.detailOverlay.classList.remove('is-open');
  els.detailOverlay.setAttribute('aria-hidden', 'true');
  currentDetail = null;
}

/* -----------------------------------------------------------
   Event wiring
   ----------------------------------------------------------- */

function wireEvents() {
  els.searchInput.addEventListener(
    'input',
    debounce(() => {
      state.search = els.searchInput.value.trim();
      fetchPage({ reset: true });
    }, 350)
  );

  $$('.tab-toggle-btn', els.statusTabs).forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('.tab-toggle-btn', els.statusTabs).forEach((b) => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      state.tab = btn.dataset.status;
      fetchPage({ reset: true });
    });
  });

  els.categoryChips.addEventListener('click', (event) => {
    const btn = event.target.closest('.notif-chip');
    if (!btn) return;
    $$('.notif-chip', els.categoryChips).forEach((c) => c.classList.remove('is-active'));
    btn.classList.add('is-active');
    state.category = btn.dataset.category;
    fetchPage({ reset: true });
  });

  els.markAllBtn.addEventListener('click', async () => {
    try {
      const api = await loadNotifApi();
      await api.markAllAsRead(state.user.id);
      toastSuccess('All notifications marked as read.');
      fetchPage({ reset: true });
    } catch (err) {
      console.error('Notification Center: failed to mark all as read', err);
      toastError("Couldn't mark all notifications as read.");
    }
  });

  els.loadMoreBtn.addEventListener('click', () => fetchPage({ reset: false }));
  els.retryBtn.addEventListener('click', () => fetchPage({ reset: state.items.length === 0 }));

  els.detailClose.addEventListener('click', closeDetail);
  els.detailOverlay.addEventListener('click', (event) => {
    if (event.target === els.detailOverlay) closeDetail();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && els.detailOverlay.classList.contains('is-open')) closeDetail();
  });

  els.detailArchive.addEventListener('click', async () => {
    if (!currentDetail) return;
    try {
      const api = await loadNotifApi();
      if (currentDetail.is_archived) {
        await api.restoreNotification(currentDetail.id);
        toastSuccess('Notification restored.');
      } else {
        await api.archiveNotification(currentDetail.id);
        toastSuccess('Notification archived.');
      }
      closeDetail();
      fetchPage({ reset: true });
    } catch (err) {
      console.error('Notification Center: failed to archive/restore', err);
      toastError("Couldn't update this notification.");
    }
  });

  els.detailDelete.addEventListener('click', async () => {
    if (!currentDetail) return;
    try {
      const api = await loadNotifApi();
      await api.deleteNotification(currentDetail.id);
      toastSuccess('Notification deleted.');
      closeDetail();
      fetchPage({ reset: true });
    } catch (err) {
      console.error('Notification Center: failed to delete', err);
      toastError("Couldn't delete this notification.");
    }
  });
}

/* -----------------------------------------------------------
   Realtime
   ----------------------------------------------------------- */

async function initRealtime() {
  try {
    const api = await loadNotifApi();
    unsubscribeRealtime = api.subscribeToNotifications(state.user.id, {
      onInsert: (n) => {
        const matchesTab =
          (state.tab === 'archived' && n.is_archived) ||
          (state.tab === 'unread' && !n.is_archived && !n.is_read) ||
          (state.tab === 'all' && !n.is_archived);
        const matchesCategory = state.category === 'all' || n.category === state.category;
        if (!matchesTab || !matchesCategory) return;

        state.items = [n, ...state.items];
        renderList();
      },
      onUpdate: (n) => {
        const idx = state.items.findIndex((item) => item.id === n.id);
        if (idx !== -1) {
          state.items[idx] = n;
          renderList();
        }
      },
    });
  } catch (err) {
    console.error('Notification Center: realtime subscription failed', err);
  }
}

/* -----------------------------------------------------------
   Init
   ----------------------------------------------------------- */

async function init() {
  cacheEls();
  buildCategoryChips();

  try {
    const { requireAuth } = await loadAuthApi();
    const user = await requireAuth(); // redirects to login.html if not signed in
    if (!user) return;
    state.user = user;
  } catch (err) {
    console.error('Notification Center: auth check failed', err);
    setViewState('error');
    return;
  }

  wireEvents();
  await fetchPage({ reset: true });
  initRealtime();

  window.addEventListener('beforeunload', () => unsubscribeRealtime?.());
}

document.addEventListener('DOMContentLoaded', init);
