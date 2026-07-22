/* =============================================================
   MERIDIAN — Register page
   Script: pages/register.js
   Loaded as a module by register.html only. Handles:
     1. Wizard step navigation (Continue / Back / Edit)
     2. Account type card selection
     3. Password show/hide + strength meter
     4. Review step population
     5. Submit validation + real API call
   ============================================================= */

const $ = (selector, scope) => (scope || document).querySelector(selector);
const $$ = (selector, scope) => Array.from((scope || document).querySelectorAll(selector));

const STEP_LABELS = {
  1: 'Account type',
  2: 'Your details',
  3: 'Security',
  4: 'Review',
};

// Brand gold, sampled from the logo marks already used in register.html.
const BRAND_SELECTED_COLOR = '#B58A44';
const BRAND_SELECTED_SHADOW = 'rgba(181, 138, 68, 0.18)';

function showAlert(alertBox, message, tone = 'error') {
  if (!alertBox) return;
  const text = $('.auth-form-alert-text', alertBox);
  if (text) text.textContent = message;
  alertBox.hidden = false;
  // Belt-and-suspenders: force visibility with inline style too, in case
  // author CSS (e.g. `.auth-form-alert { display:flex }`) overrides the
  // browser's default `[hidden]{display:none}` rule.
  alertBox.style.display = 'flex';
  alertBox.classList.toggle('auth-form-alert--success', tone === 'success');
}

function hideAlert(alertBox) {
  if (!alertBox) return;
  alertBox.hidden = true;
  alertBox.style.display = 'none';
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
      const isActive = Number(panel.getAttribute('data-panel')) === targetStep;
      panel.classList.toggle('is-active', isActive);
      // Force it, independent of whatever CSS does (or doesn't) define
      // for .wizard-panel / .wizard-panel.is-active.
      panel.style.display = isActive ? '' : 'none';
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

    // Move focus to the panel for accessibility + so screen readers/users
    // clearly land on the new step.
    const activePanel = panels.find((p) => Number(p.getAttribute('data-panel')) === targetStep);
    if (activePanel) {
      activePanel.setAttribute('tabindex', '-1');
      activePanel.focus({ preventScroll: false });
    }
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

  // Initial state: show step 1, force every other panel hidden and the
  // alert box hidden, regardless of what CSS says.
  goToStep(1);
}

/* -----------------------------------------------------------
   Account type card selection
   ----------------------------------------------------------- */
function initAccountTypeCards() {
  const cards = $$('.account-type-card');
  if (!cards.length) return;

  function paint(card, selected) {
    card.classList.toggle('is-selected', selected);
    // Force the visual state inline so it can't get stuck due to
    // conflicting/absent CSS rules for .is-selected.
    if (selected) {
      card.style.borderColor = BRAND_SELECTED_COLOR;
      card.style.boxShadow = `0 0 0 3px ${BRAND_SELECTED_SHADOW}`;
    } else {
      card.style.borderColor = '';
      card.style.boxShadow = '';
    }
  }

  function syncFromChecked() {
    cards.forEach((c) => {
      const input = $('input', c);
      paint(c, !!(input && input.checked));
    });
  }

  cards.forEach((card) => {
    const input = $('input', card);
    if (!input) return;

    // 'change' handles keyboard + programmatic changes.
    input.addEventListener('change', syncFromChecked);
    // Also repaint on click on the card itself, in case focus/selection
    // timing differs across browsers.
    card.addEventListener('click', () => {
      // Let the native radio behavior run first, then repaint.
      requestAnimationFrame(syncFromChecked);
    });
  });

  syncFromChecked();
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
   Collect all wizard data into one payload
   ----------------------------------------------------------- */
function collectRegistrationData(form) {
  const accountType = $('input[name="account_type"]:checked', form);
  const twoFactor = $('input[name="two_factor_method"]:checked', form);

  return {
    account_type: accountType ? accountType.value : null,
    first_name: $('#register-first-name', form).value.trim(),
    last_name: $('#register-last-name', form).value.trim(),
    email: $('#register-email', form).value.trim(),
    date_of_birth: $('#register-dob', form).value,
    phone: $('#register-phone', form).value.trim(),
    country: $('#register-country', form).value,
    nationality: $('#register-nationality', form).value.trim(),
    password: $('#register-password', form).value,
    two_factor_method: twoFactor ? twoFactor.value : null,
    marketing_opt_in: $('#register-marketing', form).checked,
  };
}

/* -----------------------------------------------------------
   Final submit — sends data to the backend
   ----------------------------------------------------------- */

// TODO: point this at your real registration endpoint.
const REGISTER_ENDPOINT = '/api/register';

function initSubmit() {
  const form = $('#register-form');
  if (!form) return;

  const alertBox = $('.auth-form-alert');
  const termsCheckbox = $('#register-terms');
  const submitBtn = $('.auth-submit-btn', form);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    hideAlert(alertBox);

    if (!termsCheckbox.checkValidity()) {
      termsCheckbox.reportValidity();
      return;
    }

    const payload = collectRegistrationData(form);

    if (submitBtn) {
      submitBtn.classList.add('is-loading');
      submitBtn.disabled = true;
    }

    try {
      const response = await fetch(REGISTER_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      let data = null;
      try {
        data = await response.json();
      } catch (_) {
        // Non-JSON response body — ignore, we still have response.ok/status.
      }

      if (!response.ok) {
        const message = (data && (data.message || data.error))
          || `Something went wrong (status ${response.status}). Please try again.`;
        showAlert(alertBox, message, 'error');
        return;
      }

      showAlert(alertBox, 'Account created — check your email to verify your address.', 'success');
      form.reset();
    } catch (err) {
      showAlert(alertBox, 'We could not reach the server. Check your connection and try again.', 'error');
    } finally {
      if (submitBtn) {
        submitBtn.classList.remove('is-loading');
        submitBtn.disabled = false;
      }
    }
  });
}

initWizard();
initAccountTypeCards();
initPasswordToggles();
initPasswordStrength();
initSubmit();
