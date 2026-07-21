/* =============================================================
   MERIDIAN — International Digital Banking
   App UI: assets/js/app-ui.js

   Page-agnostic interaction logic that main.js doesn't cover
   because main.js is scoped to the public marketing site
   (index.html). Everything here is for the logged-in app pages
   and the auth wizard pages:

     - Multi-step wizards (register.html, transfer.html) — panel
       switching, step-indicator state, per-step validation
     - Register step 1 — account-type card selection
     - Register step 3 — password show/hide + strength meter
     - Transfer step 1 — recipient tab toggle + beneficiary selection
     - profile.html / settings.html — sidebar tab switching
     - accounts.html — personal/business filter tabs
     - transactions.html — row click → detail panel

   No Supabase calls happen here — this file only handles DOM state.
   Actual data (submitting the wizard, loading real transactions)
   is each page's own *.js file (register.js, transfer.js, etc.),
   which should call the init function(s) it needs from this module.

   Usage — call only what a given page actually has:

     import { initWizard, initSidebarTabs } from '../assets/js/app-ui.js';
     initWizard('.auth-form-wrap--wizard');

   Or let it figure out the page itself:

     import { initAppUI } from '../assets/js/app-ui.js';
     initAppUI();
   ============================================================= */

import { $, $$, getPasswordStrength } from './utils.js';
import { shake } from './animations.js';

/* =============================================================
   1. Generic multi-step wizard
   (drives both register.html and transfer.html — same markup shape:
   .wizard-steps > .wizard-step[data-step], .wizard-panel[data-panel],
   .wizard-next/.wizard-back/.wizard-edit-link[data-goto])
   ============================================================= */

/**
 * Wires a wizard inside `root` (a selector or element containing both
 * the .wizard-steps indicator and the .wizard-panel elements — they
 * don't need to be inside the same <form>, just the same container).
 *
 * `onStepChange(stepNumber, container)` fires after every panel
 * switch — use it to populate a review step or run step-specific
 * setup. Returns a `{ goToStep }` handle so a page script can jump
 * to a step programmatically (e.g. back to step 1 on a submit error).
 */
export function initWizard(root, { onStepChange } = {}) {
  const container = typeof root === 'string' ? $(root) : root;
  if (!container) return null;

  const steps = $$('.wizard-step', container);
  const panels = $$('.wizard-panel', container);
  if (!panels.length) return null;

  const stepCurrentEl = container.querySelector('[id$="-step-current"]');
  const stepLabelEl = container.querySelector('[id$="-step-label"]');

  function activePanel() {
    return panels.find((p) => p.classList.contains('is-active'));
  }

  /** Shakes and flags every empty required field in `panel`; returns false if any were empty. */
  function validatePanel(panel) {
    let valid = true;
    $$('input[required], select[required]', panel).forEach((field) => {
      const isCheckbox = field.type === 'checkbox';
      const isEmpty = isCheckbox ? !field.checked : !field.value.trim();
      const wrap = field.closest('.field') || field.closest('.checkbox-field');
      if (isEmpty) {
        valid = false;
        wrap?.classList.add('has-error');
        shake(wrap || field);
      } else {
        wrap?.classList.remove('has-error');
      }
    });

    // Password-confirmation panels (register step 3): make sure they match.
    const pw = $('input[name="password"]', panel);
    const pwConfirm = $('input[name="password_confirm"]', panel);
    if (pw && pwConfirm && pw.value && pwConfirm.value && pw.value !== pwConfirm.value) {
      valid = false;
      const wrap = pwConfirm.closest('.field');
      wrap?.classList.add('has-error');
      const errorEl = $('.field-error', wrap);
      if (errorEl) errorEl.textContent = "Passwords don't match.";
      shake(wrap || pwConfirm);
    }

    return valid;
  }

  function goToStep(stepNumber) {
    const target = String(stepNumber);
    if (!panels.some((p) => p.dataset.panel === target)) return;

    panels.forEach((p) => p.classList.toggle('is-active', p.dataset.panel === target));
    steps.forEach((s) => {
      const n = s.dataset.step;
      s.classList.toggle('is-active', n === target);
      s.classList.toggle('is-complete', Number(n) < Number(target));
    });

    if (stepCurrentEl) stepCurrentEl.textContent = target;
    if (stepLabelEl) {
      const activeStep = steps.find((s) => s.dataset.step === target);
      const name = activeStep?.querySelector('.wizard-step-name')?.textContent;
      if (name) stepLabelEl.textContent = name;
    }

    const panelEl = panels.find((p) => p.dataset.panel === target);
    panelEl?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

    if (onStepChange) onStepChange(target, container);
  }

  container.addEventListener('click', (event) => {
    const btn = event.target.closest('.wizard-next, .wizard-back, .wizard-edit-link');
    if (!btn || !container.contains(btn)) return;

    const goto = btn.dataset.goto;
    if (!goto) return; // e.g. the real submit button on the final step — let the form handle it

    const isForward = btn.classList.contains('wizard-next');
    const current = activePanel();

    if (isForward && current && !validatePanel(current)) {
      event.preventDefault();
      return;
    }

    event.preventDefault();
    goToStep(goto);
  });

  // Initialize on whichever panel already carries .is-active in the markup (step 1).
  const startPanel = activePanel()?.dataset.panel || panels[0].dataset.panel;
  goToStep(startPanel);

  return { goToStep };
}

/* -----------------------------------------------------------
   Register wizard extras — account type cards, password UI
   ----------------------------------------------------------- */

function initAccountTypeCards(container) {
  const cards = $$('.account-type-card', container);
  if (!cards.length) return;

  cards.forEach((card) => {
    const input = $('input[type="radio"]', card);
    input?.addEventListener('change', () => {
      cards.forEach((c) => c.classList.toggle('is-selected', c === card));
    });
  });
}

function initPasswordToggles(container) {
  $$('.password-toggle', container).forEach((btn) => {
    const input = btn.closest('.password-field-wrap')?.querySelector('input');
    if (!input) return;
    btn.addEventListener('click', () => {
      const showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      btn.setAttribute('aria-pressed', String(!showing));
    });
  });
}

function initPasswordStrengthMeter(container) {
  const passwordInput = $('#register-password', container);
  const meter = $('.password-strength', container);
  if (!passwordInput || !meter) return;

  passwordInput.addEventListener('input', () => {
    const score = getPasswordStrength(passwordInput.value);
    meter.setAttribute('data-strength', String(score));
  });
}

/** Copies step 1/2/3 values into the step 4 review row for register.html. */
function populateRegisterReview(container) {
  const reviewPanel = $('.wizard-panel[data-panel="4"]', container);
  if (!reviewPanel) return;

  const accountType = $('input[name="account_type"]:checked', container);
  const firstName = $('#register-first-name', container)?.value.trim() || '';
  const lastName = $('#register-last-name', container)?.value.trim() || '';
  const email = $('#register-email', container)?.value.trim() || '';
  const countrySelect = $('#register-country', container);
  const country = countrySelect?.options[countrySelect.selectedIndex]?.text || '';
  const twoFactor = $('input[name="two_factor_method"]:checked', container);

  const setReview = (key, value) => {
    const el = $(`[data-review="${key}"]`, reviewPanel);
    if (el && value) el.textContent = value;
  };

  setReview('account_type', accountType?.closest('.account-type-card')?.querySelector('.account-type-title')?.textContent);
  setReview('full_name', [firstName, lastName].filter(Boolean).join(' '));
  setReview('email', email);
  setReview('country', country && country !== 'Choose your country' ? country : '');
  setReview('two_factor_method', twoFactor?.closest('.auth-method-btn')?.textContent.trim());
}

/**
 * Sets up register.html end to end: account-type cards, password
 * show/hide + strength meter, and the 4-step wizard with review
 * auto-population. Call this from register.js.
 */
export function initRegisterWizard() {
  const root = $('.auth-form-wrap--wizard');
  if (!root) return null;

  initAccountTypeCards(root);
  initPasswordToggles(root);
  initPasswordStrengthMeter(root);

  return initWizard(root, {
    onStepChange: (step, container) => {
      if (step === '4') populateRegisterReview(container);
    },
  });
}

/* =============================================================
   2. Transfer wizard extras — recipient tabs, beneficiary cards
   ============================================================= */

function initRecipientTabs(container) {
  const tabButtons = $$('[data-recipient-tab]', container);
  if (!tabButtons.length) return;

  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.recipientTab;

      tabButtons.forEach((b) => {
        const isActive = b === btn;
        b.classList.toggle('is-active', isActive);
        b.setAttribute('aria-selected', String(isActive));
      });

      $$('[data-recipient-panel]', container).forEach((panel) => {
        const show = panel.dataset.recipientPanel === target;
        panel.hidden = !show;
        panel.classList.toggle('is-active', show);
      });
    });
  });
}

function initBeneficiaryCards(container) {
  const cards = $$('.beneficiary-card', container);
  if (!cards.length) return;

  cards.forEach((card) => {
    const input = $('input[type="radio"]', card);
    input?.addEventListener('change', () => {
      cards.forEach((c) => c.classList.toggle('is-selected', c === card));
    });
  });
}

/** Copies step 1/2 values into the step 3 review row for transfer.html. */
function populateTransferReview(container) {
  const reviewPanel = $('.wizard-panel[data-panel="3"]', container);
  if (!reviewPanel) return;

  const selectedBeneficiary = $('input[name="beneficiary"]:checked', container);
  const beneficiaryName = selectedBeneficiary?.closest('.beneficiary-card')?.querySelector('strong')?.textContent;
  const newRecipientName = $('#new-beneficiary-name', container)?.value.trim();

  const sendAmount = $('#transfer-send-amount', container)?.value;
  const sendCurrency = $('#transfer-send-amount', container)
    ?.closest('.converter-group')
    ?.querySelector('.converter-currency-tag')?.textContent;
  const receiveAmount = $('#transfer-receive-amount', container)?.value;
  const receiveCurrency = $('#transfer-receive-amount', container)
    ?.closest('.converter-group')
    ?.querySelector('.converter-currency-tag')?.textContent;

  const feeRow = $$('.transfer-fee-row', container).find((row) => row.firstElementChild?.textContent.trim() === 'Transfer fee');
  const fee = feeRow?.lastElementChild?.textContent;
  const totalRow = $$('.transfer-fee-row', container).find((row) => row.firstElementChild?.textContent.trim() === 'Total to pay');
  const total = totalRow?.lastElementChild?.textContent;
  const scheduleChoice = $('input[name="schedule"]:checked', container);
  const arrivesRow = $$('.transfer-fee-row', container).find((row) => row.firstElementChild?.textContent.trim() === 'Arrives');
  const arrives = arrivesRow?.lastElementChild?.textContent;

  const setReview = (key, value) => {
    const el = $(`[data-review="${key}"]`, reviewPanel);
    if (el && value) el.textContent = value;
  };

  setReview('beneficiary', beneficiaryName || newRecipientName);
  if (sendAmount) setReview('send_amount', `${sendCurrency || ''} ${sendAmount}`.trim());
  if (receiveAmount) setReview('receive_amount', `${receiveCurrency || ''} ${receiveAmount}`.trim());
  setReview('fee', fee);
  setReview('total', total);
  setReview(
    'schedule',
    scheduleChoice?.value === 'later' ? 'Scheduled' : `Now${arrives ? ` · arrives ${arrives.toLowerCase()}` : ''}`
  );
}

/**
 * Sets up transfer.html end to end: recipient tabs, beneficiary
 * selection, and the 4-step wizard with review auto-population.
 * Call this from transfer.js (amount ↔ currency conversion itself
 * stays in transfer.js since it needs live exchange-rate data).
 */
export function initTransferWizard() {
  const root = $('.container--narrow');
  if (!root || !$('#transfer-form', root)) return null;

  initRecipientTabs(root);
  initBeneficiaryCards(root);

  return initWizard(root, {
    onStepChange: (step, container) => {
      if (step === '3') populateTransferReview(container);
    },
  });
}

/* =============================================================
   3. Sidebar tabs — profile.html / settings.html
   ============================================================= */

/**
 * Wires the .profile-nav-link[data-tab] sidebar to show/hide the
 * matching .profile-panel[data-panel]. Reads/writes the URL hash so
 * a direct link (e.g. settings.html#linked) opens on the right tab.
 */
export function initSidebarTabs() {
  const links = $$('.profile-nav-link[data-tab]');
  const panels = $$('.profile-panel[data-panel]');
  if (!links.length || !panels.length) return;

  function activate(tabName, { updateHash = true } = {}) {
    const hasMatch = links.some((l) => l.dataset.tab === tabName);
    const target = hasMatch ? tabName : links[0].dataset.tab;

    links.forEach((l) => l.classList.toggle('is-active', l.dataset.tab === target));
    panels.forEach((p) => p.classList.toggle('is-active', p.dataset.panel === target));

    if (updateHash) {
      history.replaceState(null, '', `#${target}`);
    }
  }

  links.forEach((link) => {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      activate(link.dataset.tab);
      link.focus({ preventScroll: true });
    });
  });

  window.addEventListener('hashchange', () => {
    activate(window.location.hash.replace('#', ''), { updateHash: false });
  });

  const initialTab = window.location.hash.replace('#', '');
  activate(initialTab || links[0].dataset.tab, { updateHash: false });
}

/* =============================================================
   4. Filter tabs — accounts.html (personal / business / all)
   ============================================================= */

export function initAccountFilterTabs() {
  const buttons = $$('[data-account-filter]');
  const grids = $$('.accounts-grid[data-account-type]');
  if (!buttons.length || !grids.length) return;

  function applyFilter(filter) {
    grids.forEach((grid) => {
      const matches = filter === 'all' || grid.dataset.accountType === filter;
      grid.style.display = matches ? '' : 'none';

      // Business grid has its own section heading immediately before it in the DOM;
      // hide that alongside the grid so a filtered-out section doesn't leave an orphan title.
      const heading = grid.previousElementSibling;
      if (heading?.classList.contains('profile-panel-head')) {
        heading.style.display = matches ? '' : 'none';
      }
    });
  }

  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      buttons.forEach((b) => {
        const isActive = b === btn;
        b.classList.toggle('is-active', isActive);
        b.setAttribute('aria-selected', String(isActive));
      });
      applyFilter(btn.dataset.accountFilter);
    });
  });

  const initialBtn = buttons.find((b) => b.classList.contains('is-active')) || buttons[0];
  applyFilter(initialBtn.dataset.accountFilter);
}

/* =============================================================
   5. Transaction detail panel — transactions.html
   ============================================================= */

/**
 * Wires each .tx-row[data-tx] to populate the sticky .tx-detail-panel
 * on click, using only what's already rendered in the row (icon
 * direction, title, subtitle, tag, status, amount, time). This is a
 * static-markup stand-in — once transactions.js loads real rows from
 * Supabase, swap this for a click handler that looks the transaction
 * up by ID and renders full detail (counterparty account, description)
 * from the database instead of scraping the DOM.
 */
export function initTransactionDetailPanel() {
  const rows = $$('.tx-row[data-tx]');
  const panel = $('.tx-detail-panel');
  if (!rows.length || !panel) return;

  function selectRow(row) {
    rows.forEach((r) => r.classList.toggle('is-selected', r === row));

    const iconEl = $('.tx-icon', row);
    const title = $('.tx-row-main strong', row)?.textContent || '';
    const subtitle = $('.tx-row-main span', row)?.textContent || '';
    const tag = $('.tag', row)?.textContent || '';
    const statusPill = $('.status-pill', row);
    const amountEl = $('.amt', row);
    const time = $('time', row)?.textContent || '';
    const reference = row.dataset.tx?.replace('ref-', '').toUpperCase() || '';

    const panelIcon = $('.tx-detail-head .tx-icon', panel);
    if (panelIcon && iconEl) {
      panelIcon.className = iconEl.className;
      panelIcon.innerHTML = iconEl.innerHTML;
    }

    const panelTitle = $('.tx-detail-head strong', panel);
    if (panelTitle) panelTitle.textContent = title;

    const panelStatus = $('.tx-detail-head .status-pill', panel);
    if (panelStatus && statusPill) {
      panelStatus.className = statusPill.className;
      panelStatus.textContent = statusPill.textContent;
    }

    const panelAmount = $('.tx-detail-amount', panel);
    if (panelAmount && amountEl) {
      panelAmount.textContent = amountEl.textContent;
      panelAmount.classList.toggle('pos', amountEl.classList.contains('pos'));
    }

    const setDetail = (label, value) => {
      const dt = $$('.tx-detail-list dt', panel).find((el) => el.textContent.trim() === label);
      const dd = dt?.nextElementSibling;
      if (dd && value) dd.textContent = value;
    };

    setDetail('Reference', reference);
    setDetail('Type', subtitle.split('·')[0]?.trim() || tag);
    setDetail('Date', time);
  }

  rows.forEach((row) => {
    row.addEventListener('click', () => selectRow(row));
    row.setAttribute('tabindex', '0');
    row.setAttribute('role', 'button');
    row.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        selectRow(row);
      }
    });
  });

  // Default to the first row so the panel isn't showing stale markup on load.
  if (rows[0]) selectRow(rows[0]);
}

/* =============================================================
   6. Auto-init — figures out which of the above a page needs
   ============================================================= */

/**
 * Detects the current page by markup fingerprint and calls whichever
 * initializers apply. Safe to call on every app/auth page — anything
 * that doesn't find its markup just no-ops.
 */
export function initAppUI() {
  if ($('.auth-form-wrap--wizard')) initRegisterWizard();
  if ($('#transfer-form')) initTransferWizard();
  if ($('.profile-nav-link[data-tab]')) initSidebarTabs();
  if ($('[data-account-filter]')) initAccountFilterTabs();
  if ($('.tx-detail-panel')) initTransactionDetailPanel();
}
