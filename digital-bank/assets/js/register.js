/* =============================================================
   MERIDIAN — International Digital Banking
   Page script: pages/register.js

   Wires up register.html end to end:
     1. Starts the 4-step wizard (account type → details →
        security → review) via initRegisterWizard() in app-ui.js.
     2. Handles the real form submit on the final step — validates
        the terms checkbox and password match, then calls
        signUpUser() in supabase/auth.js.

   signUpUser() creates the Supabase Auth user AND inserts the
   matching row into the public.user_profiles table — that insert
   is what makes the new account visible in your database (Table
   Editor → user_profiles) after a successful signup.

   Import path: this file lives in /pages/, so ../assets/js/app-ui.js
   and ../supabase/*.js resolve correctly from here.
   ============================================================= */

import { initRegisterWizard } from '../assets/js/app-ui.js';
import { signUpUser } from '../supabase/auth.js';
import { ROUTES } from '../supabase/config.js';

document.addEventListener('DOMContentLoaded', () => {
  // Sets up account-type cards, password show/hide + strength meter,
  // and the step indicator/panel switching.
  initRegisterWizard();

  const form = document.getElementById('register-form');
  if (!form) return;

  const alertBox = document.querySelector('.auth-form-alert');
  const alertText = document.querySelector('.auth-form-alert-text');
  const submitBtn = form.querySelector('.auth-submit-btn');

  function showError(message) {
    alertText.textContent = message;
    alertBox.hidden = false;
    alertBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function clearError() {
    alertBox.hidden = true;
  }

  function setLoading(isLoading) {
    if (!submitBtn) return;
    submitBtn.classList.toggle('is-loading', isLoading);
    submitBtn.disabled = isLoading;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearError();

    // This submit only fires from step 4 (the button there is the
    // form's only type="submit" control — every earlier "Continue"
    // is type="button" and handled by the wizard instead).

    const termsChecked = document.getElementById('register-terms').checked;
    if (!termsChecked) {
      showError('Please agree to the Terms of service and Privacy policy to continue.');
      return;
    }

    const firstName = document.getElementById('register-first-name').value.trim();
    const lastName = document.getElementById('register-last-name').value.trim();
    const email = document.getElementById('register-email').value.trim();
    const phone = document.getElementById('register-phone').value.trim();
    const password = document.getElementById('register-password').value;
    const passwordConfirm = document.getElementById('register-password-confirm').value;

    if (!firstName || !lastName || !email || !password) {
      showError('Please go back and complete all required fields.');
      return;
    }

    if (password !== passwordConfirm) {
      showError("Passwords don't match.");
      return;
    }

    if (password.length < 10) {
      showError('Your password needs to be at least 10 characters long.');
      return;
    }

    setLoading(true);
    const { data, error } = await signUpUser({ firstName, lastName, email, password, phone });
    setLoading(false);

    if (error) {
      showError(error);
      return;
    }

    // Account + user_profiles row created. Supabase's default project
    // settings require email confirmation before login, so send the
    // person to login.html rather than straight into the dashboard.
    window.location.href = ROUTES.login;
  });
});
