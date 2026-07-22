/* =============================================================
   MERIDIAN — Login page
   Script: pages/login.js
   Loaded as a module by login.html only. Handles:
     1. Show / hide password
     2. Field validation on submit
     3. Submit spinner + demo alert
     4. Dead-end links (forgot password, verification methods)
   ============================================================= */

const $ = (selector, scope) => (scope || document).querySelector(selector);

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

function initPasswordToggle() {
  const toggle = $('.password-toggle');
  const input = $('#login-password');
  if (!toggle || !input) return;

  toggle.addEventListener('click', () => {
    const isHidden = input.type === 'password';
    input.type = isHidden ? 'text' : 'password';
    toggle.setAttribute('aria-pressed', String(isHidden));
    toggle.setAttribute('aria-label', isHidden ? 'Hide password' : 'Show password');
  });
}

function initLoginForm() {
  const form = $('#login-form');
  if (!form) return;

  const emailField = $('#login-email');
  const passwordField = $('#login-password');
  const alertBox = $('.auth-form-alert');
  const submitBtn = $('.auth-submit-btn', form);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    hideAlert(alertBox);

    // Validate the two visible fields directly rather than form.checkValidity(),
    // so the error points at the field and works the same regardless of layout.
    if (!emailField.checkValidity()) {
      emailField.reportValidity();
      return;
    }
    if (!passwordField.checkValidity()) {
      passwordField.reportValidity();
      return;
    }

    if (submitBtn) submitBtn.classList.add('is-loading');

    // Demo only: this page isn't connected to a real account or backend.
    window.setTimeout(() => {
      if (submitBtn) submitBtn.classList.remove('is-loading');
      showAlert(alertBox, "This is a demo sign-in form and isn't connected to a real Meridian account.");
    }, 900);
  });
}

function initDeadEndLinks() {
  const alertBox = $('.auth-form-alert');
  const forgotLink = $('.auth-forgot-link');
  const methodButtons = document.querySelectorAll('.auth-method-btn');

  if (forgotLink) {
    forgotLink.addEventListener('click', (event) => {
      event.preventDefault();
      showAlert(alertBox, "Password reset isn't available in this demo.");
    });
  }

  methodButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const method = btn.getAttribute('data-method') === 'authenticator' ? 'an authenticator app' : 'an email code';
      showAlert(alertBox, `This demo doesn't send real verification codes via ${method}.`);
    });
  });
}

initPasswordToggle();
initLoginForm();
initDeadEndLinks();
