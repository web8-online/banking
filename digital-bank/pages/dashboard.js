/* =============================================================
   MERIDIAN — Dashboard / overview page
   Script: pages/dashboard.js
   Loaded as a module by dashboard.html only. Handles:
     1. Auth guard (redirect to login if no session)
     2. Personalized greeting from the signed-in user's profile
     3. Notification badge count
     4. User menu dropdown (open/close, outside-click, Escape)
     5. Log out
     6. Total balance + account strip, built from real accounts
     7. Recent transactions, spending breakdown, savings goals,
        and card preview — all scoped to the user's primary
        (first-opened) account. See the note above
        renderPrimaryAccountSections() for why.
   ============================================================= */

import { requireAuth, signOutUser } from '../supabase/auth.js';
import {
  getMyProfile,
  getUnreadNotificationCount,
  getMyAccounts,
  getTotalBalance,
  getTransactions,
  getSavingsGoals,
  getCardsForAccount,
} from '../supabase/database.js';

const $ = (selector, scope) => (scope || document).querySelector(selector);

const CURRENCY_SYMBOLS = {
  USD: '$', EUR: '€', GBP: '£', SGD: 'S$', JPY: '¥', NGN: '₦', CAD: 'C$', AUD: 'A$', CHF: 'CHF',
};

function currencySymbol(code) {
  return CURRENCY_SYMBOLS[code] || code || '';
}

function formatAmount(value) {
  return Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function capitalizeWords(str) {
  return String(str || 'Transaction')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatTxTime(isoString) {
  const date = new Date(isoString);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }
  if (date.toDateString() === yesterday.toDateString()) {
    return 'Yesterday';
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function emptyStateNote(container, message) {
  if (!container) return;
  container.innerHTML = `<p style="font-size:0.88rem;">${message}</p>`;
}

/* -----------------------------------------------------------
   Greeting
   ----------------------------------------------------------- */
function timeOfDayGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

async function populateGreeting() {
  const heading = $('.dashboard-head h1');
  if (!heading) return;

  const { data: profile } = await getMyProfile();
  const firstName = profile?.first_name;
  heading.textContent = `${timeOfDayGreeting()}${firstName ? `, ${firstName}` : ''}.`;
}

/* -----------------------------------------------------------
   Notification badge
   ----------------------------------------------------------- */
async function populateNotificationBadge() {
  const badge = $('.app-icon-btn-badge');
  if (!badge) return;

  const { data: count } = await getUnreadNotificationCount();
  if (!count) {
    badge.style.display = 'none';
    return;
  }
  badge.textContent = count > 9 ? '9+' : String(count);
}

/* -----------------------------------------------------------
   User menu dropdown
   ----------------------------------------------------------- */
function initUserMenu() {
  const menu = $('.app-user-menu');
  const trigger = $('.app-user-trigger', menu);
  if (!menu || !trigger) return;

  function open() {
    menu.classList.add('is-open');
    trigger.setAttribute('aria-expanded', 'true');
    document.addEventListener('click', handleOutsideClick);
    document.addEventListener('keydown', handleKeydown);
  }

  function close() {
    menu.classList.remove('is-open');
    trigger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', handleOutsideClick);
    document.removeEventListener('keydown', handleKeydown);
  }

  function handleOutsideClick(event) {
    if (!menu.contains(event.target)) close();
  }

  function handleKeydown(event) {
    if (event.key === 'Escape') {
      close();
      trigger.focus();
    }
  }

  trigger.addEventListener('click', (event) => {
    event.stopPropagation();
    if (menu.classList.contains('is-open')) close();
    else open();
  });
}

/* -----------------------------------------------------------
   Log out
   ----------------------------------------------------------- */
function initLogout() {
  const logoutLink = $('.app-user-dropdown a[href="../index.html"]');
  if (!logoutLink) return;

  logoutLink.addEventListener('click', async (event) => {
    event.preventDefault();
    await signOutUser();
    window.location.href = logoutLink.getAttribute('href');
  });
}

/* -----------------------------------------------------------
   Total balance + account strip
   Uses every account the user has, since the balance card is
   meant to represent their whole portfolio, not just one
   currency.
   ----------------------------------------------------------- */
async function renderBalanceAndAccounts(accounts) {
  const balanceEl = $('.dashboard-balance-card .balance-amount');
  const stripEl = $('.account-strip');
  const addItem = stripEl ? stripEl.querySelector('.account-strip-item--add') : null;

  if (!accounts.length) {
    if (balanceEl) balanceEl.innerHTML = '0<small>.00 USD</small>';
    if (stripEl) {
      Array.from(stripEl.querySelectorAll('.account-strip-item:not(.account-strip-item--add)')).forEach((el) => el.remove());
    }
    return;
  }

  if (balanceEl) {
    const { data: totalData } = await getTotalBalance(undefined, 'USD');
    const [intPart, decPart = '00'] = Number(totalData?.total || 0).toFixed(2).split('.');
    balanceEl.innerHTML = `${Number(intPart).toLocaleString('en-US')}<small>.${decPart} USD</small>`;
  }

  if (stripEl) {
    Array.from(stripEl.querySelectorAll('.account-strip-item:not(.account-strip-item--add)')).forEach((el) => el.remove());

    const fragment = document.createDocumentFragment();
    accounts.forEach((account) => {
      const item = document.createElement('a');
      item.href = 'accounts.html';
      item.className = 'account-strip-item';
      item.innerHTML = `
        <span class="account-strip-flag">${currencySymbol(account.currency)}</span>
        <div>
          <strong>${account.currency} account</strong>
          <span>${formatAmount(account.balance)}</span>
        </div>
      `;
      fragment.appendChild(item);
    });

    if (addItem) stripEl.insertBefore(fragment, addItem);
    else stripEl.appendChild(fragment);
  }
}

/* -----------------------------------------------------------
   Recent transactions, spending breakdown, savings goals, and
   card preview — all scoped to a single "primary" account
   (the first one the user opened, per getMyAccounts()'s
   created_at ascending order).

   Why: transactions, savings_goals, and cards all key off a
   single account_id in the schema, not the user directly. A
   fully accurate dashboard would merge these across every
   account the user holds, but that means N extra queries (one
   per account per section) and de-duplicating transfers between
   a user's own accounts. For a dashboard summary, showing the
   primary account's activity — with "View all" links already in
   the markup pointing to accounts.html / transactions.html for
   the full picture — is the simpler, honest tradeoff. Revisit
   this if the product needs a true cross-account activity feed.
   ----------------------------------------------------------- */
async function renderRecentTransactions(accountId) {
  const listEl = $('.tx-list');
  if (!listEl) return;

  const { data: transactions } = await getTransactions(accountId, { limit: 3 });

  if (!transactions.length) {
    emptyStateNote(listEl, "No transactions yet — they'll show up here once money moves.");
    return;
  }

  listEl.innerHTML = '';
  transactions.forEach((tx) => {
    const isIncoming = tx.receiver_account === accountId;
    const row = document.createElement('li');
    row.className = 'tx-row';
    row.innerHTML = `
      <span class="tx-icon ${isIncoming ? 'tx-icon--in' : 'tx-icon--out'}">
        <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
          ${isIncoming
            ? '<path d="M10 17V3M4 9l6-6 6 6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>'
            : '<rect x="3" y="6" width="14" height="9" rx="1.5" stroke="currentColor" stroke-width="1.4"/>'}
        </svg>
      </span>
      <div class="tx-row-main">
        <strong>${tx.description || tx.transaction_reference || 'Transaction'}</strong>
        <span>${capitalizeWords(tx.transaction_type)}</span>
      </div>
      <span class="amt ${isIncoming ? 'pos' : ''}">${isIncoming ? '+' : '-'}${currencySymbol(tx.currency)}${formatAmount(tx.amount)}</span>
      <time>${formatTxTime(tx.created_at)}</time>
    `;
    listEl.appendChild(row);
  });
}

async function renderSpendingBreakdown(accountId) {
  const listEl = $('.spend-breakdown');
  if (!listEl) return;

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const { data: transactions } = await getTransactions(accountId, { from: monthStart.toISOString(), limit: 100 });

  const totals = {};
  transactions.forEach((tx) => {
    if (tx.sender_account !== accountId) return; // only outgoing counts as spend
    const key = tx.transaction_type || 'other';
    totals[key] = (totals[key] || 0) + Number(tx.amount) + Number(tx.fee || 0);
  });

  const entries = Object.entries(totals).sort((a, b) => b[1] - a[1]);

  if (!entries.length) {
    emptyStateNote(listEl, 'No spending recorded yet this month.');
    return;
  }

  const max = entries[0][1];
  listEl.innerHTML = '';
  entries.forEach(([type, amount]) => {
    const row = document.createElement('li');
    row.className = 'spend-row';
    const pct = max > 0 ? Math.max(6, Math.round((amount / max) * 100)) : 0;
    row.innerHTML = `
      <span class="spend-row-label">${capitalizeWords(type)}</span>
      <span class="spend-bar-track"><span class="spend-bar-fill" style="width:${pct}%"></span></span>
      <span class="mono">${formatAmount(amount)}</span>
    `;
    listEl.appendChild(row);
  });
}

async function renderSavingsGoals(accountId) {
  const goalItems = Array.from(document.querySelectorAll('.goal-item'));
  const container = goalItems.length ? goalItems[0].parentElement : null;
  goalItems.forEach((el) => el.remove());
  if (!container) return;

  const { data: goals } = await getSavingsGoals(accountId);

  if (!goals.length) {
    const p = document.createElement('p');
    p.style.fontSize = '0.88rem';
    p.textContent = 'No savings goals yet — start one to track progress here.';
    container.appendChild(p);
    return;
  }

  goals.forEach((goal) => {
    const target = Number(goal.target_amount) || 0;
    const current = Number(goal.current_amount) || 0;
    const pct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;

    const item = document.createElement('div');
    item.className = 'goal-item';
    item.innerHTML = `
      <div class="goal-item-head">
        <strong>${goal.goal_name}</strong>
        <span class="mono">${formatAmount(current)} / ${formatAmount(target)}</span>
      </div>
      <span class="goal-bar-track"><span class="goal-bar-fill" style="width:${pct}%"></span></span>
    `;
    container.appendChild(item);
  });
}

async function renderCardPreview(accountId) {
  const previewEl = $('.mini-card-preview');
  if (!previewEl) return;

  const { data: cards } = await getCardsForAccount(accountId);

  if (!cards.length) {
    const wrap = previewEl.closest('.profile-card');
    emptyStateNote(wrap, "You haven't added a card yet.");
    return;
  }

  const card = cards[0];
  const last4 = (card.card_number || '').slice(-4) || '····';
  const statusClass = card.card_status === 'Active'
    ? 'status-pill--verified'
    : card.card_status === 'Blocked'
      ? 'status-pill--blocked'
      : 'status-pill--pending';

  previewEl.innerHTML = `
    <div class="mini-card mini-card--dark">
      <span>MERIDIAN</span>
      <span class="mono">···· ${last4}</span>
    </div>
    <div>
      <strong>${capitalizeWords(card.card_type)} card</strong>
      <span class="status-pill ${statusClass}">${card.card_status || 'Pending'}</span>
    </div>
  `;
}

async function renderPrimaryAccountSections(accounts) {
  if (!accounts.length) {
    emptyStateNote($('.tx-list'), 'Open your first account to start seeing transactions here.');
    emptyStateNote($('.spend-breakdown'), 'Open your first account to see spending by category.');
    const goalItems = Array.from(document.querySelectorAll('.goal-item'));
    if (goalItems.length) emptyStateNote(goalItems[0].parentElement, 'Open an account to start a savings goal.');
    const cardWrap = $('.mini-card-preview')?.closest('.profile-card');
    emptyStateNote(cardWrap, 'Open an account to add a card.');
    return;
  }

  const primaryAccountId = accounts[0].id;

  await Promise.all([
    renderRecentTransactions(primaryAccountId),
    renderSpendingBreakdown(primaryAccountId),
    renderSavingsGoals(primaryAccountId),
    renderCardPreview(primaryAccountId),
  ]);
}

/* -----------------------------------------------------------
   Init
   ----------------------------------------------------------- */
(async function init() {
  const user = await requireAuth();
  if (!user) return; // requireAuth() already redirected to login.html

  populateGreeting();
  populateNotificationBadge();
  initUserMenu();
  initLogout();

  const { data: accounts } = await getMyAccounts();
  await renderBalanceAndAccounts(accounts);
  await renderPrimaryAccountSections(accounts);
})();
