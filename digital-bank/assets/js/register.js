/* =============================================================
   MERIDIAN — Register page
   Script: pages/register.js
   Loaded as a module by register.html only. Handles:
     1. Wizard step navigation (Continue / Back / Edit)
     2. Account type card selection
     3. Password show/hide + strength meter
     4. Review step population
     5. Submit validation + demo alert
   ============================================================= */

const $ = (selector, scope) => (scope || document).querySelector(selector);
const $$ = (selector, scope) => Array.from((scope || document).querySelectorAll(selector));

const STEP_LABELS = {
  1: 'Account type',
  2: 'Your details',
  3: 'Security',
  4: 'Review',
};

function showAlert(alertBox, message) {
  if (!alertBox) return;
  const text = $('.auth-form-alert-text', alertBox);
  if (text) text.textContent = message;
  alertBox.hidden = false;
}

function hideAlert(alertBox) {
  if (!alertBox) return;
  alertBox.hidden = true;
}

/* -----------------------------------------------------------
   Wizard navigation
   ----------------------------------------------------------- */
function initWizard() {
  const form = $('#register-form');
  if (!form) return;

  const panels = $$('.wizard-panel', form);
  const steps = $$('.wizard-step');
  const stepCurrentEl = $('#wizard-step-current');
  const stepLabelEl = $('#wizard-step-label');
  const alertBox = $('.auth-form-alert');

  function validatePanel(panelEl) {
    const controls = $$('input, select', panelEl).filter((el) => !el.disabled);
    for (const control of controls) {
      if (!control.checkValidity()) {
        control.reportValidity();
        return false;
      }
    }
    return true;
  }

  function goToStep(targetStep) {
    panels.forEach((panel) => {
      panel.classList.toggle('is-active', Number(panel.getAttribute('data-panel')) === targetStep);
    });

    steps.forEach((step) => {
      const stepNum = Number(step.getAttribute('data-step'));
      step.classList.toggle('is-active', stepNum === targetStep);
      step.classList.toggle('is-complete', stepNum < targetStep);
    });

    if (stepCurrentEl) stepCurrentEl.textContent = String(targetStep);
    if (stepLabelEl) stepLabelEl.textContent = STEP_LABELS[targetStep] || '';

    if (targetStep === 4) populateReview();

    hideAlert(alertBox);
  }

  $$('.wizard-next', form).forEach((btn) => {
    btn.addEventListener('click', () => {
      const currentPanel = btn.closest('.wizard-panel');
      if (!validatePanel(currentPanel)) return;

      if (currentPanel.getAttribute('data-panel') === '3' && !passwordsMatch()) return;

      goToStep(Number(btn.getAttribute('data-goto')));
    });
  });

  $$('.wizard-back, .wizard-edit-link', form).forEach((btn) => {
    btn.addEventListener('click', () => goToStep(Number(btn.getAttribute('data-goto'))));
  });

  function passwordsMatch() {
    const pw = $('#register-password');
    const confirm = $('#register-password-confirm');
    if (!pw || !confirm) return true;

    const field = confirm.closest('.field');
    if (pw.value !== confirm.value) {
      field.classList.add('has-error');
      $('.field-error', field).textContent = "Passwords don't match.";
      confirm.focus();
      return false;
    }
    field.classList.remove('has-error');
    $('.field-error', field).textContent = '';
    return true;
  }

  function populateReview() {
    const accountType = $('input[name="account_type"]:checked', form);
    const firstName = $('#register-first-name').value.trim();
    const lastName = $('#register-last-name').value.trim();
    const email = $('#register-email').value.trim();
    const countrySelect = $('#register-country');
    const twoFactor = $('input[name="two_factor_method"]:checked', form);

    const countryText = countrySelect && countrySelect.selectedIndex > 0
      ? countrySelect.options[countrySelect.selectedIndex].textContent
      : '—';

    const twoFactorLabels = { email: 'Email code', authenticator: 'Authenticator app' };

    setReview('account_type', accountType ? capitalize(accountType.value) : '—');
    setReview('full_name', firstName || lastName ? `${firstName} ${lastName}`.trim() : '—');
    setReview('email', email || '—');
    setReview('country', countryText);
    setReview('two_factor_method', twoFactor ? twoFactorLabels[twoFactor.value] : '—');
  }

  function setReview(key, value) {
    const el = $(`[data-review="${key}"]`, form);
    if (el) el.textContent = value;
  }

  function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  goToStep(1);
}

/* -----------------------------------------------------------
   Account type card selection
   ----------------------------------------------------------- */
function initAccountTypeCards() {
  const cards = $$('.account-type-card');
  if (!cards.length) return;

  cards.forEach((card) => {
    const input = $('input', card);
    if (!input) return;
    input.addEventListener('change', () => {
      cards.forEach((c) => c.classList.toggle('is-selected', c === card));
    });
  });
}

/* -----------------------------------------------------------
   Password show/hide (both fields, independent)
   ----------------------------------------------------------- */
function initPasswordToggles() {
  $$('.password-toggle').forEach((toggle) => {
    const wrap = toggle.closest('.password-field-wrap');
    const input = wrap ? $('input', wrap) : null;
    if (!input) return;

    toggle.addEventListener('click', () => {
      const isHidden = input.type === 'password';
      input.type = isHidden ? 'text' : 'password';
      toggle.setAttribute('aria-pressed', String(isHidden));
      toggle.setAttribute('aria-label', isHidden ? 'Hide password' : 'Show password');
    });
  });
}

/* -----------------------------------------------------------
   Password strength meter
   ----------------------------------------------------------- */
function initPasswordStrength() {
  const input = $('#register-password');
  const meter = $('.password-strength');
  if (!input || !meter) return;

  input.addEventListener('input', () => {
    const value = input.value;
    let score = 0;
    if (value.length >= 8) score += 1;
    if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score += 1;
    if (/\d/.test(value)) score += 1;
    if (/[^A-Za-z0-9]/.test(value)) score += 1;
    meter.setAttribute('data-strength', String(score));
  });
}

/* -----------------------------------------------------------
   Final submit
   ----------------------------------------------------------- */
function initSubmit() {
  const form = $('#register-form');
  if (!form) return;

  const alertBox = $('.auth-form-alert');
  const termsCheckbox = $('#register-terms');
  const submitBtn = $('.auth-submit-btn', form);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    hideAlert(alertBox);

    if (!termsCheckbox.checkValidity()) {
      termsCheckbox.reportValidity();
      return;
    }

    if (submitBtn) submitBtn.classList.add('is-loading');

    // Demo only: no real account is created.
    window.setTimeout(() => {
      if (submitBtn) submitBtn.classList.remove('is-loading');
      showAlert(alertBox, 'This is a demo registration form — no real Meridian account has been created.');
    }, 900);
  });
}

initWizard();
initAccountTypeCards();
initPasswordToggles();
initPasswordStrength();
initSubmit();
