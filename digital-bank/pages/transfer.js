/* =============================================================
   MERIDIAN — Send money page
   Script: pages/transfer.js
   Loaded as a module by transfer.html only. Handles:
     1. Auth guard + shared app-header bits (same pattern as
        accounts.js: avatar initial, name, notification badge,
        user menu, log out)
     2. A 4-step wizard: Recipient -> Amount -> Review -> Done
     3. Recipient step: saved beneficiaries (search + select),
        a "Recent" one-tap strip (client-side, via localStorage —
        purely a UI convenience, not synced anywhere), and a new-
        recipient flow that auto-verifies an account number/IBAN
        via findRecipient() before falling back to manual entry
     4. Amount step: a from-account picker, live currency
        conversion via getExchangeRate(), a transparent fee
        breakdown, a delivery-speed choice, and optional scheduling
     5. Review step: an editable summary + a 2FA code for larger
        sends (demo-only — see the note by handleConfirmSend)
     6. Send: addBeneficiary() (if the recipient is new and the
        user opted to save them) + createTransfer(), then a
        success screen with the real reference number
   ============================================================= */

import { signOutUser } from '../supabase/auth.js';
import { guardPage } from '../supabase/page-guard.js';
import {
  getMyProfile,
  getUnreadNotificationCount,
  getMyAccounts,
  getMyBeneficiaries,
  addBeneficiary,
  findRecipient,
  getExchangeRate,
  createTransfer,
} from '../supabase/database.js';

const $ = (selector, scope) => (scope || document).querySelector(selector);
const $$ = (selector, scope) => Array.from((scope || document).querySelectorAll(selector));

const CURRENCY_SYMBOLS = {
  USD: '$', EUR: '€', GBP: '£', SGD: 'S$', JPY: '¥', NGN: '₦', CAD: 'C$', AUD: 'A$', CHF: 'CHF',
};
const RECENT_RECIPIENTS_KEY = 'meridian_recent_recipients';

function currencySymbol(code) {
  return CURRENCY_SYMBOLS[code] || code || '';
}

function formatAmount(value) {
  return Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* -----------------------------------------------------------
   State
   ----------------------------------------------------------- */
let accounts = [];
let beneficiaries = [];
let currentStep = 1;
let selectedFromAccountId = null;
let recipientMode = 'existing'; // 'existing' | 'new'
let selectedBeneficiary = null;
let verifiedRecipient = null; // { source: 'beneficiary', beneficiary } | { source: 'internal', display_name, bank_name, currency }
let identifierLookupTimer = null;

/* -----------------------------------------------------------
   Toasts (same pattern as accounts.js)
   ----------------------------------------------------------- */
function showToast(message, variant = 'success') {
  const stack = $('#toast-stack');
  if (!stack) return;
  const toast = document.createElement('div');
  toast.className = `toast${variant === 'error' ? ' toast--error' : ' toast--success'}`;
  toast.innerHTML = `
    <svg class="toast-ic" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      ${variant === 'error'
        ? '<path d="M10 6.5v4M10 13.2v.1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="10" cy="10" r="8" stroke="currentColor" stroke-width="1.4"/>'
        : '<path d="M4 10.5 8 14.5 16 5.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>'}
    </svg>
    <span>${escapeHtml(message)}</span>
  `;
  stack.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(6px)';
    toast.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
    setTimeout(() => toast.remove(), 220);
  }, 3200);
}

/* -----------------------------------------------------------
   Header: name, avatar, notification badge, user menu, logout
   ----------------------------------------------------------- */
async function populateHeader() {
  const nameEl = $('.app-user-name');
  const avatarEl = $('.app-user-trigger .avatar-initial');

  const { data: profile } = await getMyProfile();
  const firstName = profile?.first_name || '';
  const lastName = profile?.last_name || '';
  const fullName = `${firstName} ${lastName}`.trim() || 'Your account';

  if (nameEl) nameEl.textContent = fullName;
  if (avatarEl) avatarEl.textContent = (firstName[0] || 'M').toUpperCase();

  const badge = $('.app-icon-btn-badge');
  if (badge) {
    const { data: count } = await getUnreadNotificationCount();
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
    if (event.key === 'Escape') {
      close();
      trigger.focus();
    }
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
   Wizard navigation
   ----------------------------------------------------------- */
const STEP_LABELS = ['Recipient', 'Amount', 'Review', 'Done'];

function goToStep(n) {
  currentStep = n;
  $$('.wizard-panel').forEach((panel) => panel.classList.toggle('is-active', Number(panel.dataset.panel) === n));
  $$('.wizard-step').forEach((step) => {
    const stepNum = Number(step.dataset.step);
    step.classList.toggle('is-active', stepNum === n);
    step.classList.toggle('is-complete', stepNum < n);
  });
  $('#wizard-step-current').textContent = n;
  $('#wizard-step-label').textContent = STEP_LABELS[n - 1];

  if (n === 2) recalcConversion();
  if (n === 3) populateReview();

  const card = $('.transfer-card');
  if (card) window.scrollTo({ top: card.getBoundingClientRect().top + window.scrollY - 90, behavior: 'smooth' });
}

function wireRadioGroup(name) {
  const radios = $$(`input[name="${name}"]`);
  radios.forEach((radio) => {
    radio.addEventListener('change', () => {
      radios.forEach((r) => r.closest('.auth-method-btn')?.classList.toggle('is-selected', r.checked));
    });
  });
}

/* -----------------------------------------------------------
   Recipient step — tabs
   ----------------------------------------------------------- */
function initRecipientTabs() {
  const tabButtons = $$('.tab-toggle-btn[data-recipient-tab]');
  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      tabButtons.forEach((b) => {
        b.classList.remove('is-active');
        b.setAttribute('aria-selected', 'false');
      });
      btn.classList.add('is-active');
      btn.setAttribute('aria-selected', 'true');
      recipientMode = btn.dataset.recipientTab;
      $$('.recipient-tab-panel').forEach((panel) => {
        const match = panel.dataset.recipientPanel === recipientMode;
        panel.classList.toggle('is-active', match);
        panel.hidden = !match;
      });
      updateStep1ContinueState();
    });
  });
}

/* -----------------------------------------------------------
   Saved beneficiaries: list, search, select
   ----------------------------------------------------------- */
function maskAccount(value) {
  if (!value) return '';
  const clean = String(value).replace(/\s+/g, '');
  return clean.length > 4 ? `···· ${clean.slice(-4)}` : clean;
}

function beneficiaryInitial(b) {
  return (b?.beneficiary_name || '?').trim().charAt(0).toUpperCase();
}

function beneficiarySubtitle(b) {
  return [b?.bank_name, maskAccount(b?.account_number)].filter(Boolean).join(' · ');
}

function renderBeneficiaryList(filterText = '') {
  const container = $('#beneficiary-list');
  if (!container) return;
  const q = filterText.trim().toLowerCase();

  if (!beneficiaries.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="8" r="3.5" stroke="currentColor" stroke-width="1.5"/><path d="M4.5 19.5c0-3.6 3.4-6 7.5-6s7.5 2.4 7.5 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        </div>
        <h3>No saved beneficiaries yet</h3>
        <p>Add a new recipient — you'll be able to save them here for next time.</p>
      </div>
    `;
    return;
  }

  const filtered = beneficiaries.filter(
    (b) => !q || b.beneficiary_name?.toLowerCase().includes(q) || b.bank_name?.toLowerCase().includes(q)
  );

  if (!filtered.length) {
    container.innerHTML = `<p class="balance-note">No saved recipients match "${escapeHtml(filterText)}".</p>`;
    return;
  }

  container.innerHTML = filtered
    .map(
      (b) => `
    <label class="beneficiary-card${selectedBeneficiary?.id === b.id ? ' is-selected' : ''}" data-beneficiary-id="${b.id}">
      <input type="radio" name="beneficiary" value="${b.id}" ${selectedBeneficiary?.id === b.id ? 'checked' : ''}>
      <span class="avatar-initial avatar-initial--sm">${beneficiaryInitial(b)}</span>
      <span class="beneficiary-card-info">
        <strong>${escapeHtml(b.beneficiary_name)}</strong>
        <span>${escapeHtml(beneficiarySubtitle(b))}</span>
      </span>
      <span class="beneficiary-card-check">
        <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 8.5 6.5 12 13 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </span>
    </label>
  `
    )
    .join('');

  $$('.beneficiary-card', container).forEach((card) => {
    card.addEventListener('click', () => {
      const id = card.dataset.beneficiaryId;
      selectedBeneficiary = beneficiaries.find((b) => String(b.id) === id) || null;
      $$('.beneficiary-card', container).forEach((c) => c.classList.toggle('is-selected', c === card));
      pushRecentRecipient(selectedBeneficiary);
      updateStep1ContinueState();
    });
  });
}

/* -----------------------------------------------------------
   Recent recipients — client-side convenience only (not synced
   to Supabase; just remembers the last few beneficiary ids this
   browser sent to, for a one-tap "recent" strip).
   ----------------------------------------------------------- */
function getRecentIds() {
  try {
    return JSON.parse(localStorage.getItem(RECENT_RECIPIENTS_KEY) || '[]');
  } catch {
    return [];
  }
}

function pushRecentRecipient(b) {
  if (!b?.id) return;
  let ids = getRecentIds().filter((id) => String(id) !== String(b.id));
  ids.unshift(b.id);
  ids = ids.slice(0, 6);
  try {
    localStorage.setItem(RECENT_RECIPIENTS_KEY, JSON.stringify(ids));
  } catch {
    /* ignore quota/availability errors — this is a nice-to-have, not critical */
  }
}

function renderRecentStrip() {
  const wrap = $('#recipient-recent-wrap');
  const strip = $('#recipient-recent-strip');
  if (!wrap || !strip) return;

  const matches = getRecentIds()
    .map((id) => beneficiaries.find((b) => String(b.id) === String(id)))
    .filter(Boolean);

  if (!matches.length) {
    wrap.hidden = true;
    return;
  }
  wrap.hidden = false;
  strip.innerHTML = matches
    .map(
      (b) => `
    <button type="button" class="recipient-quick-chip" data-recent-id="${b.id}" title="${escapeHtml(b.beneficiary_name)}">
      <span class="avatar-initial">${beneficiaryInitial(b)}</span>
      <span>${escapeHtml((b.beneficiary_name || '').split(' ')[0] || '—')}</span>
    </button>
  `
    )
    .join('');

  $$('.recipient-quick-chip', strip).forEach((chip) => {
    chip.addEventListener('click', () => {
      const b = beneficiaries.find((x) => String(x.id) === chip.dataset.recentId);
      if (!b) return;
      $('.tab-toggle-btn[data-recipient-tab="existing"]')?.click();
      selectedBeneficiary = b;
      $('#beneficiary-search').value = '';
      renderBeneficiaryList('');
      pushRecentRecipient(b);
      updateStep1ContinueState();
    });
  });
}

/* -----------------------------------------------------------
   New recipient — account-number auto-verification
   ----------------------------------------------------------- */
function showVerifiedCard(name, meta, initial) {
  $('#recipient-verified-name').textContent = name || '—';
  $('#recipient-verified-meta').textContent = meta || '';
  $('#recipient-verified-avatar').textContent = initial || '?';
  $('#recipient-verified-card').hidden = false;
  $('#recipient-manual-fields').hidden = true;
}

function resetNewRecipientUi() {
  verifiedRecipient = null;
  $('#recipient-verified-card').hidden = true;
  $('#recipient-manual-fields').hidden = true;
  $('#recipient-lookup-status').innerHTML = '';
}

function handleIdentifierInput(event) {
  const value = event.target.value;
  clearTimeout(identifierLookupTimer);
  resetNewRecipientUi();
  updateStep1ContinueState();

  if (!value.trim()) return;

  const statusEl = $('#recipient-lookup-status');
  statusEl.innerHTML = `<span class="recipient-lookup-spinner"></span> Verifying recipient…`;

  identifierLookupTimer = setTimeout(async () => {
    const { data } = await findRecipient(value, { beneficiaries });

    if (data?.source === 'beneficiary') {
      verifiedRecipient = data;
      const b = data.beneficiary;
      showVerifiedCard(b.beneficiary_name, `${beneficiarySubtitle(b) || 'Saved recipient'} · you've sent to them before`, beneficiaryInitial(b));
      statusEl.innerHTML = '';
    } else if (data?.source === 'internal') {
      verifiedRecipient = data;
      showVerifiedCard(data.display_name, `${data.bank_name} · ${data.currency} Meridian account`, (data.display_name || '?').charAt(0).toUpperCase());
      statusEl.innerHTML = '';
    } else {
      statusEl.innerHTML = `We couldn't verify this automatically — add their details below.`;
      $('#recipient-manual-fields').hidden = false;
      $('#new-beneficiary-account').value = value;
    }
    updateStep1ContinueState();
  }, 550);
}

function manualFieldsValid() {
  return Boolean(
    $('#new-beneficiary-name').value.trim() &&
    $('#new-beneficiary-bank').value.trim() &&
    $('#new-beneficiary-account').value.trim()
  );
}

function updateStep1ContinueState() {
  let valid = false;
  if (recipientMode === 'existing') {
    valid = Boolean(selectedBeneficiary);
  } else {
    valid = Boolean(verifiedRecipient) || (!$('#recipient-manual-fields').hidden && manualFieldsValid());
  }
  $('#step1-continue').disabled = !valid;
}

/** A single normalized view of "who are we sending to", regardless
 *  of which of the three recipient paths (saved / internal-verified
 *  / manual) produced it. Read by the amount, review, and send steps. */
function getRecipientSummary() {
  if (recipientMode === 'existing' && selectedBeneficiary) {
    return {
      name: selectedBeneficiary.beneficiary_name,
      meta: beneficiarySubtitle(selectedBeneficiary),
      currency: null,
      beneficiaryId: selectedBeneficiary.id,
      isNew: false,
    };
  }
  if (verifiedRecipient?.source === 'beneficiary') {
    const b = verifiedRecipient.beneficiary;
    return { name: b.beneficiary_name, meta: beneficiarySubtitle(b), currency: null, beneficiaryId: b.id, isNew: false };
  }
  if (verifiedRecipient?.source === 'internal') {
    return {
      name: verifiedRecipient.display_name,
      meta: `${verifiedRecipient.bank_name} · ${verifiedRecipient.currency}`,
      currency: verifiedRecipient.currency,
      beneficiaryId: null,
      isNew: false,
      isInternal: true,
    };
  }
  const countrySelect = $('#new-beneficiary-country');
  return {
    name: $('#new-beneficiary-name').value.trim(),
    meta: [$('#new-beneficiary-bank').value.trim(), countrySelect.options[countrySelect.selectedIndex]?.textContent].filter(Boolean).join(' · '),
    currency: null,
    beneficiaryId: null,
    isNew: true,
    manual: {
      beneficiaryName: $('#new-beneficiary-name').value.trim(),
      bankName: $('#new-beneficiary-bank').value.trim(),
      accountNumber: $('#new-beneficiary-account').value.trim(),
      swiftCode: $('#new-beneficiary-swift').value.trim(),
      country: countrySelect.value,
    },
  };
}

/* -----------------------------------------------------------
   Amount step — from-account picker
   ----------------------------------------------------------- */
function currentFromAccount() {
  return accounts.find((a) => String(a.id) === String(selectedFromAccountId));
}

function renderFromAccountStrip() {
  const strip = $('#from-account-strip');
  if (!strip) return;

  if (!accounts.length) {
    strip.innerHTML = `<p class="balance-note">Open a currency account before you can send money.</p>`;
    return;
  }
  if (!selectedFromAccountId || !currentFromAccount()) selectedFromAccountId = accounts[0].id;

  strip.innerHTML = accounts
    .map((a) => {
      const selected = String(a.id) === String(selectedFromAccountId);
      return `
      <button type="button" class="account-strip-item" data-account-id="${a.id}"
              role="radio" aria-checked="${selected}">
        <span class="account-strip-flag">${currencySymbol(a.currency)}</span>
        <div>
          <strong>${a.currency} account</strong>
          <span>${formatAmount(a.available_balance ?? a.balance)}</span>
        </div>
      </button>
    `;
    })
    .join('');

  $$('.account-strip-item[data-account-id]', strip).forEach((btn) => {
    btn.addEventListener('click', () => {
      selectedFromAccountId = btn.dataset.accountId;
      renderFromAccountStrip();
      recalcConversion();
    });
  });
}

/* -----------------------------------------------------------
   Live conversion + fee breakdown
   -----------------------------------------------------------
   DEMO-ONLY FEE MODEL: there's no fee-schedule table in the
   current schema, so this is a simple percentage-with-a-floor
   shape (mirroring how real transfer pricing tends to look)
   rather than a fabricated "real" number. Swap this for a lookup
   against a proper fee schedule (keyed by currency pair + speed)
   once one exists.
   ----------------------------------------------------------- */
function computeFee(amount, speed) {
  const amt = Math.max(0, Number(amount) || 0);
  return speed === 'instant' ? Math.max(2.5, +(amt * 0.012).toFixed(2)) : Math.max(1, +(amt * 0.0021).toFixed(2));
}

async function recalcConversion() {
  const fromAccount = currentFromAccount();
  const fromCurrency = fromAccount?.currency || 'USD';
  $('#transfer-send-currency-tag').textContent = fromCurrency;

  const recipient = getRecipientSummary();
  const receiveSelect = $('#transfer-receive-currency');
  if (recipient.currency) {
    receiveSelect.value = recipient.currency;
    receiveSelect.disabled = true;
  } else {
    receiveSelect.disabled = false;
  }
  const toCurrency = receiveSelect.value;

  const sendAmount = Number($('#transfer-send-amount').value) || 0;
  const speed = $('input[name="speed"]:checked')?.value || 'standard';
  const fee = computeFee(sendAmount, speed);

  const { data: rateData } = await getExchangeRate(fromCurrency, toCurrency);
  const rate = Number(rateData?.exchange_rate ?? 1);
  const isFallback = fromCurrency !== toCurrency && rate === 1;
  const receiveAmount = sendAmount * rate;

  $('#transfer-receive-amount').value = receiveAmount.toFixed(2);
  $('#fee-rate-note').textContent = `1 ${fromCurrency} = ${rate.toFixed(4)} ${toCurrency}${isFallback ? ' · indicative' : ' · mid-market'}`;
  $('#fee-amount').textContent = `${currencySymbol(fromCurrency)}${formatAmount(fee)}`;
  $('#fee-total').textContent = `${currencySymbol(fromCurrency)}${formatAmount(sendAmount + fee)}`;
  $('#fee-arrives').textContent = speed === 'instant' ? 'Within minutes' : 'Within a few hours';

  const noteEl = $('#balance-note');
  const available = Number(fromAccount?.available_balance ?? fromAccount?.balance ?? 0);
  const total = sendAmount + fee;
  if (fromAccount && total > available) {
    noteEl.textContent = `Insufficient balance — you have ${currencySymbol(fromCurrency)}${formatAmount(available)} available in this account.`;
    noteEl.classList.add('balance-note--warning');
  } else if (fromAccount) {
    noteEl.textContent = `${currencySymbol(fromCurrency)}${formatAmount(Math.max(0, available - total))} left in this account after sending.`;
    noteEl.classList.remove('balance-note--warning');
  } else {
    noteEl.textContent = '';
  }

  return { fromAccount, fromCurrency, toCurrency, sendAmount, fee, rate, receiveAmount, speed, total, available };
}

async function validateStep2() {
  const info = await recalcConversion();
  if (!info.fromAccount) {
    showToast('Open a currency account before sending money.', 'error');
    return false;
  }
  if (info.sendAmount <= 0) {
    showToast('Enter an amount greater than zero.', 'error');
    $('#transfer-send-amount').focus();
    return false;
  }
  if (info.total > info.available) {
    showToast("That's more than the available balance on this account.", 'error');
    return false;
  }
  return true;
}

/* -----------------------------------------------------------
   Review step
   ----------------------------------------------------------- */
function formatScheduledDate() {
  const val = $('#schedule-later-datetime').value;
  if (!val) return 'a later date';
  return new Date(val).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function populateReview() {
  const recipient = getRecipientSummary();
  const fromAccount = currentFromAccount();
  const sendAmount = Number($('#transfer-send-amount').value) || 0;
  const speed = $('input[name="speed"]:checked')?.value || 'standard';
  const schedule = $('input[name="schedule"]:checked')?.value || 'now';
  const fee = computeFee(sendAmount, speed);
  const receiveAmount = Number($('#transfer-receive-amount').value) || 0;
  const toCurrency = $('#transfer-receive-currency').value;

  $('[data-review="beneficiary"]').textContent = recipient.name || '—';
  $('[data-review="from_account"]').textContent = fromAccount
    ? `${fromAccount.currency} account · ${currencySymbol(fromAccount.currency)}${formatAmount(fromAccount.available_balance ?? fromAccount.balance)} available`
    : '—';
  $('[data-review="send_amount"]').textContent = fromAccount ? `${currencySymbol(fromAccount.currency)}${formatAmount(sendAmount)}` : '—';
  $('[data-review="receive_amount"]').textContent = `${currencySymbol(toCurrency)}${formatAmount(receiveAmount)}`;
  $('[data-review="fee"]').textContent = fromAccount ? `${currencySymbol(fromAccount.currency)}${formatAmount(fee)}` : '—';
  $('[data-review="total"]').textContent = fromAccount ? `${currencySymbol(fromAccount.currency)}${formatAmount(sendAmount + fee)}` : '—';
  $('[data-review="schedule"]').textContent = `${speed === 'instant' ? 'Instant' : 'Standard'} · ${
    schedule === 'later' ? `Scheduled for ${formatScheduledDate()}` : 'Sending now'
  }`;

  const needs2fa = sendAmount > 1000;
  $('#two-fa-hint').textContent = needs2fa ? 'Required for transfers over $1,000.' : 'Optional — add it if you have one handy.';
}

/* -----------------------------------------------------------
   Confirm & send
   ----------------------------------------------------------- */
async function handleConfirmSend() {
  const errorEl = $('#review-error');
  errorEl.style.display = 'none';

  const sendAmount = Number($('#transfer-send-amount').value) || 0;
  const code = $('#transfer-2fa-code').value.trim();

  // DEMO-ONLY 2FA: there's no real one-time-code delivery wired up
  // (that would live alongside the two_factor_method preference on
  // profile/settings), so any 6-digit code is accepted here. Swap
  // this for a real verify-code call once that endpoint exists.
  if (sendAmount > 1000 && !/^\d{6}$/.test(code)) {
    errorEl.textContent = 'Enter the 6-digit confirmation code to continue.';
    errorEl.style.display = 'block';
    $('#transfer-2fa-code').focus();
    return;
  }

  const fromAccount = currentFromAccount();
  if (!fromAccount) {
    showToast('Choose an account to send from first.', 'error');
    return;
  }

  const recipient = getRecipientSummary();
  const fee = computeFee(sendAmount, $('input[name="speed"]:checked')?.value || 'standard');
  const reference = $('#transfer-reference').value.trim();

  const btn = $('#confirm-send-btn');
  btn.disabled = true;
  btn.querySelector('.auth-submit-label').textContent = 'Sending…';

  let beneficiaryRecordId = recipient.beneficiaryId;

  if (recipient.isNew && $('#save-beneficiary-checkbox').checked && recipient.manual?.beneficiaryName) {
    const { data: newBeneficiary, error: benError } = await addBeneficiary(recipient.manual);
    if (benError) {
      showToast(`Couldn't save this recipient: ${benError}`, 'error');
    } else if (newBeneficiary) {
      beneficiaries.push(newBeneficiary);
      beneficiaryRecordId = newBeneficiary.id;
    }
  }

  // NOTE: receiverAccountId stays null even for an "internal"
  // verified match — find_account_holder() only returns a name/
  // bank/currency by design (see the comment above findRecipient()
  // in database.js), never another user's account id. Real P2P
  // crediting would need that RPC extended to also return an
  // account id, still via a SECURITY DEFINER function.
  const { data: tx, error } = await createTransfer({
    senderAccountId: fromAccount.id,
    receiverAccountId: null,
    amount: sendAmount,
    fee,
    currency: fromAccount.currency,
    description: reference || `Transfer to ${recipient.name}`,
  });

  btn.disabled = false;
  btn.querySelector('.auth-submit-label').textContent = 'Confirm & send';

  if (error) {
    errorEl.textContent = error;
    errorEl.style.display = 'block';
    showToast(error, 'error');
    return;
  }

  if (beneficiaryRecordId) {
    const saved = beneficiaries.find((b) => b.id === beneficiaryRecordId);
    if (saved) pushRecentRecipient(saved);
  }

  const speedLabel = ($('input[name="speed"]:checked')?.value || 'standard') === 'instant' ? 'minutes' : 'a few hours';
  $('#success-reference').textContent = tx.transaction_reference;
  $('#success-status').textContent = tx.status;
  $('#success-message').textContent = `${currencySymbol(fromAccount.currency)}${formatAmount(sendAmount)} is on its way to ${recipient.name}. Most transfers arrive within ${speedLabel}.`;

  goToStep(4);
}

/* -----------------------------------------------------------
   Reset wizard for "Send another"
   ----------------------------------------------------------- */
function resetWizard() {
  selectedBeneficiary = null;
  resetNewRecipientUi();
  $('#transfer-form').reset();
  $('#beneficiary-search').value = '';
  recipientMode = 'existing';
  $('.tab-toggle-btn[data-recipient-tab="existing"]')?.click();
  $$('input[name="speed"]').forEach((r) => r.closest('.auth-method-btn')?.classList.toggle('is-selected', r.checked));
  $$('input[name="schedule"]').forEach((r) => r.closest('.auth-method-btn')?.classList.toggle('is-selected', r.checked));
  $('#schedule-later-field').hidden = true;
  renderBeneficiaryList('');
  renderRecentStrip();
  renderFromAccountStrip();
  updateStep1ContinueState();
  goToStep(1);
}

/* -----------------------------------------------------------
   Query params — ?from=<accountId> from accounts.html's "Send"
   button, ?beneficiary=<id> for a future "send again" link
   ----------------------------------------------------------- */
function applyQueryParams() {
  const params = new URLSearchParams(window.location.search);
  const fromId = params.get('from');
  if (fromId && accounts.some((a) => String(a.id) === fromId)) selectedFromAccountId = fromId;

  const benId = params.get('beneficiary');
  if (benId) {
    const match = beneficiaries.find((b) => String(b.id) === benId);
    if (match) {
      selectedBeneficiary = match;
      recipientMode = 'existing';
    }
  }
}

/* -----------------------------------------------------------
   Init
   ----------------------------------------------------------- */
(async function init() {
  const user = await guardPage();
  if (!user) return; // guardPage() already redirected to login.html

  populateHeader();
  initUserMenu();
  initLogout();
  initRecipientTabs();
  wireRadioGroup('speed');
  wireRadioGroup('schedule');

  // Safety net: every button in this form is type="button" on
  // purpose (the wizard advances via JS, never a real submit), but
  // pressing Enter in a lone visible text field can still trigger
  // native form submission in some browsers. Block it so that
  // never reloads the page and wipes wizard state.
  $('#transfer-form').addEventListener('submit', (event) => event.preventDefault());

  $('#beneficiary-search').addEventListener('input', (e) => renderBeneficiaryList(e.target.value));
  $('#recipient-identifier').addEventListener('input', handleIdentifierInput);
  $('#recipient-verified-clear').addEventListener('click', () => {
    verifiedRecipient = null;
    $('#recipient-verified-card').hidden = true;
    $('#recipient-manual-fields').hidden = false;
    $('#recipient-lookup-status').innerHTML = '';
    updateStep1ContinueState();
  });
  $$('#recipient-manual-fields input, #recipient-manual-fields select').forEach((el) =>
    el.addEventListener('input', updateStep1ContinueState)
  );

  $$('.wizard-next').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (currentStep === 2) {
        const ok = await validateStep2();
        if (!ok) return;
      }
      goToStep(Number(btn.dataset.goto));
    });
  });
  $$('.wizard-back, .wizard-edit-link[data-goto]').forEach((btn) => {
    btn.addEventListener('click', () => goToStep(Number(btn.dataset.goto)));
  });

  $('#transfer-send-amount').addEventListener('input', recalcConversion);
  $('#transfer-receive-currency').addEventListener('change', recalcConversion);
  $$('input[name="speed"]').forEach((r) => r.addEventListener('change', recalcConversion));
  $$('input[name="schedule"]').forEach((r) =>
    r.addEventListener('change', () => {
      $('#schedule-later-field').hidden = $('input[name="schedule"]:checked').value !== 'later';
    })
  );

  $('#confirm-send-btn').addEventListener('click', handleConfirmSend);
  $('#send-another-btn').addEventListener('click', resetWizard);
  $('#copy-reference-btn').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText($('#success-reference').textContent);
      showToast('Reference copied.');
    } catch {
      showToast("Couldn't copy — copy it manually instead.", 'error');
    }
  });

  const [{ data: accs, error: accError }, { data: bens, error: benError }] = await Promise.all([
    getMyAccounts(user.id),
    getMyBeneficiaries(user.id),
  ]);
  if (accError) showToast("Couldn't load your accounts. Please refresh.", 'error');
  if (benError) showToast("Couldn't load your beneficiaries. Please refresh.", 'error');
  accounts = accs || [];
  beneficiaries = bens || [];

  applyQueryParams();
  renderFromAccountStrip();
  renderBeneficiaryList('');
  renderRecentStrip();
  updateStep1ContinueState();

  if (!accounts.length) {
    showToast('Open a currency account before you can send money.', 'error');
  }
})();
