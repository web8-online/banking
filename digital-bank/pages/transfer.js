/* =============================================================
   MERIDIAN — Transfer page
   Script: pages/transfer.js
   Loaded as a module by transfer.html only. Handles:
     1. Auth guard + shared header wiring (same pattern as
        accounts.js / cards.js)
     2. Loading the signed-in user's accounts
     3. Tab switching: "To my own account" vs "To someone else"
     4. Live summary panel (fee, converted amount, total debited)
     5. Confirm-before-send modal
     6. Calling createTransfer()

   SCOPE NOTE: this only supports (a) transfers between your own
   Meridian accounts and (b) external transfers where the money
   simply leaves Meridian (no receiver_account, no verification of
   the recipient's details — same as a real international wire).
   It intentionally does NOT support sending to another Meridian
   user's account by ID/number: that needs a secure server-side
   lookup (RLS blocks a client from reading someone else's account
   row, as it should), which is a good candidate for a Postgres RPC
   function once beneficiaries are built.
   ============================================================= */

import { requireAuth, signOutUser } from '../supabase/auth.js';
import {
  getMyProfile,
  getUnreadNotificationCount,
  getMyAccounts,
  getExchangeRate,
  createTransfer,
} from '../supabase/database.js';
import { $, $$, formatCurrency, getQueryParam, debounce } from '../assets/js/utils.js';

/* -----------------------------------------------------------
   State
   ----------------------------------------------------------- */
const state = {
  accounts: [],
  accountsById: new Map(),
  activeTab: 'own', // 'own' | 'external'
  fromAccount: null,
  toAccount: null, // only used for 'own' tab
  exchangeRate: 1,
  submitting: false,
};

const EXTERNAL_FEE_RATE = 0.005; // 0.5% flat, demo-only

const COUNTRY_LABELS = {
  US: 'United States', GB: 'United Kingdom', DE: 'Germany',
  FR: 'France', SG: 'Singapore', NG: 'Nigeria', OTHER: 'Other',
};

/* -----------------------------------------------------------
   Toasts (same shape as accounts.js / cards.js)
   ----------------------------------------------------------- */
function showToast(message, variant = 'success') {
  const stack = $('#toast-stack');
  if (!stack) return;
  const toast = document.createElement('div');
  toast.className = `toast${variant === 'error' ? ' toast--error' : ' toast--success'}`;
  toast.textContent = message;
  stack.appendChild(toast);
  window.setTimeout(() => toast.remove(), 4000);
}

function setFieldError(fieldEl, message) {
  if (!fieldEl) return;
  fieldEl.classList.toggle('has-error', Boolean(message));
  const errorEl = $('.field-error', fieldEl);
  if (errorEl) errorEl.textContent = message || '';
}

function clearAllFieldErrors(form) {
  $$('.field, fieldset', form).forEach((el) => el.classList.remove('has-error'));
  $$('.field-error', form).forEach((el) => { el.textContent = ''; });
}

/* -----------------------------------------------------------
   Header chrome (mirrors accounts.js / cards.js)
   ----------------------------------------------------------- */
async function populateHeader() {
  const { data: profile } = await getMyProfile();
  const fullName = profile ? `${profile.first_name || ''} ${profile.last_name || ''}`.trim() : '';

  const nameEl = $('.app-user-name');
  const avatarEl = $('.app-user-trigger .avatar-initial');
  if (nameEl) nameEl.textContent = fullName || 'Your account';
  if (avatarEl) avatarEl.textContent = (profile?.first_name?.[0] || 'M').toUpperCase();

  const { data: count } = await getUnreadNotificationCount();
  const badge = $('.app-icon-btn-badge');
  if (badge) {
    if (count) {
      badge.textContent = count > 9 ? '9+' : String(count);
      badge.style.display = 'flex';
    } else {
      badge.style.display = 'none';
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
  const logoutLink = $('#logout-link');
  if (!logoutLink) return;
  logoutLink.addEventListener('click', async (event) => {
    event.preventDefault();
    await signOutUser();
    window.location.href = logoutLink.getAttribute('href');
  });
}

/* -----------------------------------------------------------
   Modal plumbing (same shape as accounts.js)
   ----------------------------------------------------------- */
function openModal(modal) {
  modal.classList.add('is-open');
  modal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}

function closeModal(modal) {
  modal.classList.remove('is-open');
  modal.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}

function initModalDismissal() {
  $$('.modal-overlay').forEach((overlay) => {
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) closeModal(overlay);
    });
    $$('[data-close-modal]', overlay).forEach((btn) => {
      btn.addEventListener('click', () => closeModal(overlay));
    });
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    $$('.modal-overlay.is-open').forEach((overlay) => closeModal(overlay));
  });
}

/* -----------------------------------------------------------
   Populating account selects
   ----------------------------------------------------------- */
function accountOptionLabel(account) {
  const balance = formatCurrency(account.available_balance ?? account.balance, account.currency);
  return `${account.currency} account — ${balance}`;
}

function populateFromAccountSelect() {
  const select = $('#transfer-from-account');
  select.innerHTML = state.accounts.map((a) => `<option value="${a.id}">${accountOptionLabel(a)}</option>`).join('');
}

function populateToAccountSelect() {
  const select = $('#transfer-to-account');
  const options = state.accounts.filter((a) => a.id !== state.fromAccount?.id);

  if (!options.length) {
    select.innerHTML = '<option value="">Open a second account first</option>';
    return;
  }
  select.innerHTML = options.map((a) => `<option value="${a.id}">${accountOptionLabel(a)}</option>`).join('');
}

/* -----------------------------------------------------------
   Tab switching
   ----------------------------------------------------------- */
function setActiveTab(tab) {
  state.activeTab = tab;

  $$('.tab-toggle-btn[data-transfer-tab]').forEach((btn) => {
    const isActive = btn.dataset.transferTab === tab;
    btn.classList.toggle('is-active', isActive);
    btn.setAttribute('aria-selected', String(isActive));
  });

  $$('[data-tab-panel]').forEach((panel) => {
    const matches = panel.dataset.tabPanel === tab;
    panel.hidden = !matches;
    $$('input, select', panel).forEach((el) => { el.disabled = !matches; });
  });

  updateSummary();
}

function initTabs() {
  $$('.tab-toggle-btn[data-transfer-tab]').forEach((btn) => {
    btn.addEventListener('click', () => setActiveTab(btn.dataset.transferTab));
  });
}

/* -----------------------------------------------------------
   Live summary panel
   ----------------------------------------------------------- */
const refreshExchangeRate = debounce(async () => {
  if (state.activeTab !== 'own' || !state.fromAccount || !state.toAccount) {
    state.exchangeRate = 1;
    renderSummary();
    return;
  }
  if (state.fromAccount.currency === state.toAccount.currency) {
    state.exchangeRate = 1;
    renderSummary();
    return;
  }
  const { data } = await getExchangeRate(state.fromAccount.currency, state.toAccount.currency);
  state.exchangeRate = data?.exchange_rate ?? 1;
  renderSummary();
}, 300);

function currentAmount() {
  return Number($('#transfer-amount').value) || 0;
}

function currentFee() {
  return state.activeTab === 'external' ? Math.round(currentAmount() * EXTERNAL_FEE_RATE * 100) / 100 : 0;
}

function updateSummary() {
  $('#transfer-amount-currency').textContent = state.fromAccount?.currency || 'USD';
  refreshExchangeRate();
  renderSummary();
}

function renderSummary() {
  const amount = currentAmount();
  const fee = currentFee();
  const total = amount + fee;
  const fromCurrency = state.fromAccount?.currency || 'USD';

  $('#summary-from').textContent = state.fromAccount
    ? `${fromCurrency} account — ${formatCurrency(state.fromAccount.available_balance ?? state.fromAccount.balance, fromCurrency)}`
    : '—';

  if (state.activeTab === 'own') {
    $('#summary-to').textContent = state.toAccount ? `${state.toAccount.currency} account` : '—';
  } else {
    const name = $('#transfer-recipient-name').value.trim();
    const country = COUNTRY_LABELS[$('#transfer-recipient-country').value] || '';
    $('#summary-to').textContent = name ? `${name}${country ? ` (${country})` : ''}` : '—';
  }

  $('#summary-amount').textContent = amount ? formatCurrency(amount, fromCurrency) : '—';
  $('#summary-fee').textContent = fee ? formatCurrency(fee, fromCurrency) : formatCurrency(0, fromCurrency);

  const convertedRow = $('#summary-converted-row');
  if (state.activeTab === 'own' && state.toAccount && state.toAccount.currency !== fromCurrency && amount) {
    convertedRow.hidden = false;
    $('#summary-converted').textContent = formatCurrency(amount * state.exchangeRate, state.toAccount.currency);
  } else {
    convertedRow.hidden = true;
  }

  $('#summary-total').textContent = amount ? formatCurrency(total, fromCurrency) : '—';

  const noteEl = $('#summary-balance-note');
  const available = Number(state.fromAccount?.available_balance ?? state.fromAccount?.balance ?? 0);
  if (amount && total > available) {
    noteEl.textContent = `This exceeds your available balance of ${formatCurrency(available, fromCurrency)}.`;
    noteEl.classList.add('transfer-summary-note--error');
  } else {
    noteEl.textContent = '';
    noteEl.classList.remove('transfer-summary-note--error');
  }
}

/* -----------------------------------------------------------
   Validation
   ----------------------------------------------------------- */
function validateForm() {
  const form = $('#transfer-form');
  clearAllFieldErrors(form);
  let valid = true;

  const amount = currentAmount();
  if (!amount || amount <= 0) {
    setFieldError($('#transfer-amount-field'), 'Enter an amount greater than 0.');
    valid = false;
  }

  const available = Number(state.fromAccount?.available_balance ?? state.fromAccount?.balance ?? 0);
  if (amount && amount + currentFee() > available) {
    setFieldError($('#transfer-amount-field'), 'This exceeds your available balance.');
    valid = false;
  }

  if (state.activeTab === 'own') {
    if (!state.toAccount) {
      setFieldError($('#transfer-to-account-field'), 'Choose an account to send to.');
      valid = false;
    } else if (state.toAccount.id === state.fromAccount?.id) {
      setFieldError($('#transfer-to-account-field'), 'Choose a different account than the one you\u2019re sending from.');
      valid = false;
    }
  } else {
    if (!$('#transfer-recipient-name').value.trim()) {
      setFieldError($('#transfer-recipient-name-field'), 'Enter the recipient\u2019s name.');
      valid = false;
    }
    if (!$('#transfer-recipient-account').value.trim()) {
      setFieldError($('#transfer-recipient-account-field'), 'Enter an account number or IBAN.');
      valid = false;
    }
    if (!$('#transfer-recipient-bank').value.trim()) {
      setFieldError($('#transfer-recipient-bank-field'), 'Enter the recipient\u2019s bank name.');
      valid = false;
    }
  }

  return valid;
}

/* -----------------------------------------------------------
   Confirm modal
   ----------------------------------------------------------- */
function buildConfirmSummary() {
  const amount = currentAmount();
  const fee = currentFee();
  const fromCurrency = state.fromAccount.currency;

  const rows = [
    ['From', `${fromCurrency} account`],
    ['Amount', formatCurrency(amount, fromCurrency)],
    ['Fee', formatCurrency(fee, fromCurrency)],
    ['Total debited', formatCurrency(amount + fee, fromCurrency)],
  ];

  if (state.activeTab === 'own') {
    rows.splice(1, 0, ['To', `${state.toAccount.currency} account`]);
    if (state.toAccount.currency !== fromCurrency) {
      rows.push(['Recipient gets (approx.)', formatCurrency(amount * state.exchangeRate, state.toAccount.currency)]);
    }
  } else {
    const name = $('#transfer-recipient-name').value.trim();
    const bank = $('#transfer-recipient-bank').value.trim();
    const accountNumber = $('#transfer-recipient-account').value.trim();
    const swift = $('#transfer-recipient-swift').value.trim();
    const country = COUNTRY_LABELS[$('#transfer-recipient-country').value] || '';
    const reference = $('#transfer-reference').value.trim();

    rows.splice(1, 0, ['To', name]);
    rows.push(['Bank', bank]);
    rows.push(['Account / IBAN', accountNumber]);
    if (swift) rows.push(['SWIFT / BIC', swift]);
    if (country) rows.push(['Country', country]);
    if (reference) rows.push(['Reference', reference]);
  }

  return rows;
}

function openConfirmModal() {
  const list = $('#transfer-confirm-list');
  list.innerHTML = buildConfirmSummary()
    .map(([label, value]) => `<div><dt>${label}</dt><dd class="mono">${value}</dd></div>`)
    .join('');
  $('#transfer-confirm-error').style.display = 'none';
  openModal($('#transfer-confirm-modal'));
}

function initConfirmModal() {
  const submitBtn = $('#transfer-confirm-submit');
  submitBtn.addEventListener('click', async () => {
    if (state.submitting) return;
    state.submitting = true;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending…';

    const amount = currentAmount();
    const fee = currentFee();
    const fromCurrency = state.fromAccount.currency;

    const description = state.activeTab === 'own'
      ? `Transfer to your ${state.toAccount.currency} account`
      : [
          `Transfer to ${$('#transfer-recipient-name').value.trim()}`,
          $('#transfer-recipient-bank').value.trim() && `(${$('#transfer-recipient-bank').value.trim()})`,
          $('#transfer-reference').value.trim() && `— ${$('#transfer-reference').value.trim()}`,
        ].filter(Boolean).join(' ');

    const { data, error } = await createTransfer({
      senderAccountId: state.fromAccount.id,
      receiverAccountId: state.activeTab === 'own' ? state.toAccount.id : null,
      amount,
      fee,
      currency: fromCurrency,
      description,
    });

    submitBtn.disabled = false;
    submitBtn.textContent = 'Confirm & send';
    state.submitting = false;

    if (error) {
      const errorEl = $('#transfer-confirm-error');
      errorEl.textContent = error;
      errorEl.style.display = 'block';
      return;
    }

    closeModal($('#transfer-confirm-modal'));
    showToast(`Transfer sent — reference ${data.transaction_reference}.`);
    resetForm();
    await refreshAccounts();
  });
}

/* -----------------------------------------------------------
   Form reset / refresh
   ----------------------------------------------------------- */
function resetForm() {
  $('#transfer-form').reset();
  $('#transfer-recipient-country').value = '';
  updateFromAccount();
  renderSummary();
}

async function refreshAccounts() {
  const { data: accounts } = await getMyAccounts();
  state.accounts = accounts || [];
  state.accountsById = new Map(state.accounts.map((a) => [a.id, a]));
  populateFromAccountSelect();
  updateFromAccount();
}

/* -----------------------------------------------------------
   From/To account change handlers
   ----------------------------------------------------------- */
function updateFromAccount() {
  const select = $('#transfer-from-account');
  state.fromAccount = state.accountsById.get(select.value) || state.accounts[0] || null;
  if (state.fromAccount && select.value !== state.fromAccount.id) select.value = state.fromAccount.id;
  populateToAccountSelect();
  updateToAccount();
  updateSummary();
}

function updateToAccount() {
  const select = $('#transfer-to-account');
  state.toAccount = state.accountsById.get(select.value) || null;
}

/* -----------------------------------------------------------
   Wiring
   ----------------------------------------------------------- */
function initFormEvents() {
  $('#transfer-from-account').addEventListener('change', () => {
    updateFromAccount();
  });

  $('#transfer-to-account').addEventListener('change', () => {
    updateToAccount();
    updateSummary();
  });

  $('#transfer-amount').addEventListener('input', renderSummary);
  $('#transfer-recipient-name').addEventListener('input', renderSummary);
  $('#transfer-recipient-country').addEventListener('change', renderSummary);

  $('#transfer-form').addEventListener('submit', (event) => {
    event.preventDefault();
    if (!state.fromAccount) return;
    if (!validateForm()) return;
    openConfirmModal();
  });
}

/* -----------------------------------------------------------
   Init
   ----------------------------------------------------------- */
(async function init() {
  const user = await requireAuth();
  if (!user) return; // requireAuth() already redirected to login.html

  // Reveal content now that a real session is confirmed — see
  // assets/js/auth-guard.js for the fast pre-check that hid it.
  document.body.classList.remove('auth-pending');

  initUserMenu();
  initLogout();
  initModalDismissal();
  initTabs();
  initFormEvents();
  initConfirmModal();
  await populateHeader();

  const { data: accounts, error } = await getMyAccounts();
  if (error) {
    showToast("Couldn't load your accounts. Please refresh.", 'error');
    return;
  }

  state.accounts = accounts || [];
  state.accountsById = new Map(state.accounts.map((a) => [a.id, a]));

  if (!state.accounts.length) {
    $('#transfer-form').innerHTML = `
      <p class="field-hint">You'll need at least one Meridian account before you can send money. Open one from the Accounts page first.</p>
      <a href="accounts.html" class="btn btn-primary" style="align-self:flex-start;">Go to accounts</a>
    `;
    return;
  }

  populateFromAccountSelect();

  // Support accounts.html's "Send" link: transfer.html?from=<accountId>
  const preselectId = getQueryParam('from');
  if (preselectId && state.accountsById.has(preselectId)) {
    $('#transfer-from-account').value = preselectId;
  }

  updateFromAccount();
})();
