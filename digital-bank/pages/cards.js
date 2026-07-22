/* =============================================================
   MERIDIAN — Cards page
   Script: pages/cards.js
   Loaded as a module by cards.html only. Handles:
     1. Auth guard + shared header wiring (same pattern as
        dashboard.js / transactions.js — no shared header module
        exists yet, see components/components.js's header note)
     2. Loading accounts + cards across all of them
     3. Rendering each card as a face visual + meta + actions
     4. Freeze / unfreeze (optimistic toggle via setCardStatus)
     5. Activating a Pending card
     6. Set daily limit modal (setCardDailyLimit)
     7. Add card modal (createCard — see note below)

   NOTE ON createCard(): supabase/database.js does not currently
   export a createCard() function — only getCardsForAccount(),
   setCardStatus(), and setCardDailyLimit(). This file assumes
   you've added the createCard() export shown alongside this file
   (mirrors the demo-friendly generateAccountDetails() pattern
   already used by createAccount()). Without it, the "Add a card"
   flow will fail at runtime with an import error.
   ============================================================= */

import { requireAuth, signOutUser } from '../supabase/auth.js';
import {
  getMyProfile,
  getUnreadNotificationCount,
  getMyAccounts,
  getCardsForAccount,
  setCardStatus,
  setCardDailyLimit,
  createCard,
} from '../supabase/database.js';
import { formatCurrency, $, $$, getInitials, maskAccountNumber } from '../assets/js/utils.js';

/* -----------------------------------------------------------
   State
   ----------------------------------------------------------- */
const state = {
  accounts: [],
  accountsById: new Map(),
  cards: [],
  profile: null,
  loading: false,
};

/* -----------------------------------------------------------
   Helpers
   ----------------------------------------------------------- */
function typeLabel(type) {
  return String(type || 'card').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function expiryLabel(card) {
  if (!card.expiry_month || !card.expiry_year) return '··/··';
  const mm = String(card.expiry_month).padStart(2, '0');
  const yy = String(card.expiry_year).slice(-2);
  return `${mm}/${yy}`;
}

function statusPillClass(status) {
  const s = (status || '').toLowerCase();
  if (s === 'active') return 'status-pill--verified';
  if (s === 'blocked') return 'status-pill--blocked';
  if (s === 'pending') return 'status-pill--pending';
  return 'status-pill--neutral';
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function showToast(message, variant = 'default') {
  const stack = $('#toast-stack');
  if (!stack) return;
  const toast = document.createElement('div');
  toast.className = `toast${variant === 'error' ? ' toast--error' : ''}`;
  toast.textContent = message;
  stack.appendChild(toast);
  window.setTimeout(() => toast.remove(), 4000);
}

/* -----------------------------------------------------------
   Header chrome (mirrors dashboard.js / transactions.js)
   ----------------------------------------------------------- */
async function populateUserChrome() {
  const { data: profile } = await getMyProfile();
  state.profile = profile || null;
  const fullName = profile ? `${profile.first_name || ''} ${profile.last_name || ''}`.trim() : '';

  const nameEl = $('.app-user-name');
  const avatarEl = $('.avatar-initial--sm');
  if (nameEl && fullName) nameEl.textContent = fullName;
  if (avatarEl) avatarEl.textContent = getInitials(fullName || 'Meridian User');

  const holderInput = $('#card-add-holder');
  if (holderInput && fullName && !holderInput.value) {
    holderInput.value = fullName.toUpperCase();
  }

  const { data: count } = await getUnreadNotificationCount();
  const badge = $('.app-icon-btn-badge');
  if (badge) {
    if (count) {
      badge.hidden = false;
      badge.textContent = count > 9 ? '9+' : String(count);
    } else {
      badge.hidden = true;
    }
  }
}

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
    if (event.key === 'Escape') { close(); trigger.focus(); }
  }

  trigger.addEventListener('click', (event) => {
    event.stopPropagation();
    menu.classList.contains('is-open') ? close() : open();
  });
}

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
   Loading accounts + cards
   ----------------------------------------------------------- */
async function loadCards() {
  const grid = $('#card-grid');
  state.loading = true;

  try {
    const results = await Promise.all(state.accounts.map((a) => getCardsForAccount(a.id)));
    const anyError = results.find((r) => r.error);
    if (anyError && results.every((r) => r.error)) {
      renderError(grid, anyError.error);
      return;
    }
    state.cards = results.flatMap((r) => r.data || []);
    state.cards.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    renderGrid();
  } catch (err) {
    renderError(grid, err.message || 'Something went wrong loading your cards.');
  } finally {
    state.loading = false;
  }
}

function renderError(grid, message) {
  grid.innerHTML = `
    <li class="cards-error-state">
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9.5" stroke="currentColor" stroke-width="1.4"/><path d="M12 7.5v6M12 16.5h.01" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
      <strong>Couldn't load your cards</strong>
      <p>${escapeHtml(message)}</p>
      <button type="button" class="btn btn-ghost btn-sm" id="cards-retry-btn" style="margin-top:1rem;">Try again</button>
    </li>
  `;
  const retryBtn = $('#cards-retry-btn');
  if (retryBtn) retryBtn.addEventListener('click', loadCards);
}

/* -----------------------------------------------------------
   Rendering the grid
   ----------------------------------------------------------- */
function renderGrid() {
  const grid = $('#card-grid');

  const cardTiles = state.cards.map((card) => cardTileMarkup(card)).join('');
  const addTile = `
    <li class="card-tile card-tile--add">
      <button type="button" class="card-visual" id="card-add-trigger" aria-label="Add a card">
        <span class="card-tile--add-inner">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
          Add a card
        </span>
      </button>
    </li>
  `;

  if (!state.cards.length) {
    grid.innerHTML = `
      <li class="cards-empty-state">
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="2.5" y="6" width="19" height="13" rx="2.2" stroke="currentColor" stroke-width="1.4"/><path d="M2.5 10.5h19" stroke="currentColor" stroke-width="1.4"/></svg>
        <strong>No cards yet</strong>
        <p>Add your first card below to start spending from one of your accounts.</p>
      </li>
      ${addTile}
    `;
  } else {
    grid.innerHTML = cardTiles + addTile;
  }

  $$('.card-tile[data-card-id]', grid).forEach(wireCardTile);
  $('#card-add-trigger').addEventListener('click', openAddCardModal);
}

function cardTileMarkup(card) {
  const account = state.accountsById.get(card.account_id);
  const isFrozen = (card.card_status || '').toLowerCase() === 'blocked';
  const isPending = (card.card_status || '').toLowerCase() === 'pending';
  const isActive = (card.card_status || '').toLowerCase() === 'active';
  const last4 = (card.card_number || '').replace(/\s+/g, '').slice(-4) || '····';

  return `
    <li class="card-tile${isPending ? ' card-tile--pending' : ''}" data-card-id="${card.id}">
      <div class="card-visual card-visual--${(card.card_type || 'debit').toLowerCase()}${isFrozen ? ' is-frozen' : ''}">
        ${isFrozen ? `
          <div class="card-visual-frozen-badge">
            <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><rect x="4.5" y="9" width="11" height="7.5" rx="1.5" stroke="currentColor" stroke-width="1.4"/><path d="M6.5 9V6.5a3.5 3.5 0 0 1 7 0V9" stroke="currentColor" stroke-width="1.4"/></svg>
            Frozen
          </div>
        ` : ''}
        <div class="card-visual-top">
          <span class="card-visual-brand">MERIDIAN</span>
          <span class="card-visual-type">${escapeHtml(typeLabel(card.card_type))}</span>
        </div>
        <div class="card-visual-chip" aria-hidden="true"></div>
        <div class="card-visual-number">•••• •••• •••• ${escapeHtml(last4)}</div>
        <div class="card-visual-bottom">
          <div>
            <span class="card-visual-label">Card holder</span>
            <strong>${escapeHtml((card.card_holder || 'Card holder').toUpperCase())}</strong>
          </div>
          <div>
            <span class="card-visual-label">Expires</span>
            <strong>${expiryLabel(card)}</strong>
          </div>
        </div>
      </div>

      <div class="card-tile-meta">
        <div class="card-tile-meta-row">
          <span>Linked account</span>
          <strong>${account ? `${escapeHtml(account.currency)} ${escapeHtml(maskAccountNumber(account.account_number || account.iban || ''))}` : '—'}</strong>
        </div>
        <div class="card-tile-meta-row">
          <span>Daily limit</span>
          <strong>${formatCurrency(Number(card.daily_limit) || 0, account?.currency || 'USD')}</strong>
        </div>
        <div class="card-tile-status-row">
          <span class="status-pill ${statusPillClass(card.card_status)}">${escapeHtml(card.card_status || 'Unknown')}</span>
        </div>

        ${isPending ? `
          <div class="card-tile-actions">
            <p class="card-tile-pending-note">This card hasn't been activated yet.</p>
            <button type="button" class="btn btn-primary btn-sm" data-action="activate">Activate card</button>
          </div>
        ` : `
          <div class="card-tile-actions">
            <label class="switch">
              <input type="checkbox" data-action="freeze-toggle" ${isActive ? 'checked' : ''} aria-label="Freeze card">
              <span class="switch-track"></span>
            </label>
            <div class="card-tile-freeze"><span>${isFrozen ? 'Frozen' : 'Active'}</span></div>
            <button type="button" class="btn btn-ghost btn-sm" data-action="limit">Set limit</button>
          </div>
        `}
      </div>
    </li>
  `;
}

/* -----------------------------------------------------------
   Card tile actions
   ----------------------------------------------------------- */
function wireCardTile(tile) {
  const cardId = tile.getAttribute('data-card-id');
  const card = state.cards.find((c) => c.id === cardId);
  if (!card) return;

  const freezeToggle = $('[data-action="freeze-toggle"]', tile);
  if (freezeToggle) {
    freezeToggle.addEventListener('change', () => toggleFreeze(card, tile, freezeToggle));
  }

  const activateBtn = $('[data-action="activate"]', tile);
  if (activateBtn) {
    activateBtn.addEventListener('click', () => activateCard(card, tile, activateBtn));
  }

  const limitBtn = $('[data-action="limit"]', tile);
  if (limitBtn) {
    limitBtn.addEventListener('click', () => openLimitModal(card));
  }
}

async function toggleFreeze(card, tile, toggleEl) {
  const goingActive = toggleEl.checked;
  const newStatus = goingActive ? 'Active' : 'Blocked';
  toggleEl.disabled = true;

  const { data, error } = await setCardStatus(card.id, newStatus);

  if (error) {
    toggleEl.checked = !goingActive; // revert
    toggleEl.disabled = false;
    showToast(`Couldn't update the card: ${error}`, 'error');
    return;
  }

  card.card_status = data?.card_status || newStatus;
  toggleEl.disabled = false;
  refreshTile(card);
  showToast(goingActive ? 'Card unfrozen.' : 'Card frozen. No new charges will go through.');
}

async function activateCard(card, tile, btn) {
  btn.disabled = true;
  btn.textContent = 'Activating…';

  const { data, error } = await setCardStatus(card.id, 'Active');

  if (error) {
    btn.disabled = false;
    btn.textContent = 'Activate card';
    showToast(`Couldn't activate the card: ${error}`, 'error');
    return;
  }

  card.card_status = data?.card_status || 'Active';
  refreshTile(card);
  showToast('Card activated.');
}

function refreshTile(card) {
  const oldTile = document.querySelector(`.card-tile[data-card-id="${card.id}"]`);
  if (!oldTile) return;
  const wrapper = document.createElement('div');
  wrapper.innerHTML = cardTileMarkup(card).trim();
  const newTile = wrapper.firstElementChild;
  oldTile.replaceWith(newTile);
  wireCardTile(newTile);
}

/* -----------------------------------------------------------
   Set daily limit modal
   ----------------------------------------------------------- */
function openLimitModal(card) {
  const modal = $('#card-limit-modal');
  const account = state.accountsById.get(card.account_id);
  $('#card-limit-card-id').value = card.id;
  $('#card-limit-amount').value = Number(card.daily_limit) || 0;
  $('#card-limit-subtitle').textContent = `•••• ${String(card.card_number || '').slice(-4)} — ${account ? account.currency : ''} account`;
  openModal(modal);
  window.setTimeout(() => $('#card-limit-amount').focus(), 50);
}

function initLimitModal() {
  const modal = $('#card-limit-modal');
  const form = $('#card-limit-form');
  const closeBtn = $('#card-limit-close');
  const cancelBtn = $('#card-limit-cancel');

  closeBtn.addEventListener('click', () => closeModal(modal));
  cancelBtn.addEventListener('click', () => closeModal(modal));
  modal.addEventListener('click', (event) => { if (event.target === modal) closeModal(modal); });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const cardId = $('#card-limit-card-id').value;
    const amountInput = $('#card-limit-amount');
    const amountField = amountInput.closest('.field');
    const amount = Number(amountInput.value);

    if (!Number.isFinite(amount) || amount < 0) {
      setFieldError(amountField, 'Enter a valid amount.');
      return;
    }
    setFieldError(amountField, '');

    const submitBtn = $('#card-limit-submit');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving…';

    const { data, error } = await setCardDailyLimit(cardId, amount);

    submitBtn.disabled = false;
    submitBtn.textContent = 'Save limit';

    if (error) {
      showToast(`Couldn't update the limit: ${error}`, 'error');
      return;
    }

    const card = state.cards.find((c) => c.id === cardId);
    if (card) {
      card.daily_limit = data?.daily_limit ?? amount;
      refreshTile(card);
    }
    closeModal(modal);
    showToast('Daily limit updated.');
  });
}

/* -----------------------------------------------------------
   Add card modal
   ----------------------------------------------------------- */
function populateAddCardAccountOptions() {
  const select = $('#card-add-account');
  select.innerHTML = state.accounts.map((account) => `
    <option value="${account.id}">${escapeHtml(account.currency)} account · ${escapeHtml(maskAccountNumber(account.account_number || account.iban || ''))}</option>
  `).join('');
}

function openAddCardModal() {
  const modal = $('#card-add-modal');
  $('#card-add-form').reset();
  populateAddCardAccountOptions();

  const fullName = state.profile ? `${state.profile.first_name || ''} ${state.profile.last_name || ''}`.trim() : '';
  if (fullName) $('#card-add-holder').value = fullName.toUpperCase();

  openModal(modal);
  window.setTimeout(() => $('#card-add-account').focus(), 50);
}

function initAddCardModal() {
  const modal = $('#card-add-modal');
  const form = $('#card-add-form');
  const closeBtn = $('#card-add-close');
  const cancelBtn = $('#card-add-cancel');

  closeBtn.addEventListener('click', () => closeModal(modal));
  cancelBtn.addEventListener('click', () => closeModal(modal));
  modal.addEventListener('click', (event) => { if (event.target === modal) closeModal(modal); });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const accountId = $('#card-add-account').value;
    const cardType = $('#card-add-type').value;
    const holderInput = $('#card-add-holder');
    const limitInput = $('#card-add-limit');

    let valid = true;
    if (!holderInput.value.trim()) {
      setFieldError(holderInput.closest('.field'), 'Enter the name to print on the card.');
      valid = false;
    } else {
      setFieldError(holderInput.closest('.field'), '');
    }

    const limitValue = Number(limitInput.value);
    if (!Number.isFinite(limitValue) || limitValue < 0) {
      setFieldError(limitInput.closest('.field'), 'Enter a valid daily limit.');
      valid = false;
    } else {
      setFieldError(limitInput.closest('.field'), '');
    }

    if (!accountId) {
      setFieldError($('#card-add-account-field'), 'Choose an account to link this card to.');
      valid = false;
    } else {
      setFieldError($('#card-add-account-field'), '');
    }

    if (!valid) return;

    const submitBtn = $('#card-add-submit');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Adding…';

    const { data, error } = await createCard({
      accountId,
      cardType,
      cardHolder: holderInput.value.trim().toUpperCase(),
      dailyLimit: limitValue,
    });

    submitBtn.disabled = false;
    submitBtn.textContent = 'Add card';

    if (error) {
      showToast(`Couldn't add the card: ${error}`, 'error');
      return;
    }

    state.cards.unshift(data);
    renderGrid();
    closeModal(modal);
    showToast('Card added — activate it whenever you\u2019re ready.');
  });
}

function setFieldError(fieldEl, message) {
  if (!fieldEl) return;
  fieldEl.classList.toggle('has-error', Boolean(message));
  const errorEl = $('.field-error', fieldEl);
  if (errorEl) errorEl.textContent = message || '';
}

/* -----------------------------------------------------------
   Modal open/close primitives (shared shape across both modals)
   ----------------------------------------------------------- */
function openModal(modal) {
  modal.classList.add('is-open');
  modal.setAttribute('aria-hidden', 'false');
  document.addEventListener('keydown', escCloseHandler(modal));
}

function closeModal(modal) {
  modal.classList.remove('is-open');
  modal.setAttribute('aria-hidden', 'true');
}

function escCloseHandler(modal) {
  return function handler(event) {
    if (event.key === 'Escape' && modal.classList.contains('is-open')) {
      closeModal(modal);
      document.removeEventListener('keydown', handler);
    }
  };
}

/* -----------------------------------------------------------
   Init
   ----------------------------------------------------------- */
(async function init() {
  const user = await requireAuth();
  if (!user) return; // requireAuth() already redirected to login.html

  initUserMenu();
  initLogout();
  initLimitModal();
  initAddCardModal();
  await populateUserChrome();

  const { data: accounts, error } = await getMyAccounts();
  if (error) {
    renderError($('#card-grid'), error);
    return;
  }

  state.accounts = accounts || [];
  state.accountsById = new Map(state.accounts.map((a) => [a.id, a]));

  if (!state.accounts.length) {
    $('#card-grid').innerHTML = `
      <li class="cards-empty-state">
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="2.5" y="6" width="19" height="13" rx="2.2" stroke="currentColor" stroke-width="1.4"/></svg>
        <strong>Open an account first</strong>
        <p>You'll need at least one Meridian account before you can add a card.</p>
      </li>
    `;
    return;
  }

  await loadCards();
})();

