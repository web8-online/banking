/* =============================================================
   MERIDIAN — International Digital Banking
   Page script: pages/login.js

   Wires up login.html's #login-form to real Supabase auth. This
   is the piece that was missing — login.html only ever loaded
   ../assets/js/main.js (the public marketing page script), so
   submitting the form did nothing but a native page reload.

   Import path: this file lives in /pages/, so ../supabase/auth.js
   and ../supabase/config.js resolve correctly from here.
   ============================================================= */

import { signInUser, redirectIfAuthenticated } from '../supabase/auth.js';
import { ROUTES } from '../supabase/config.js';

document.addEventListener('DOMContentLoaded', async () => {
  // If there's already a valid session, skip the form entirely.
  await redirectIfAuthenticated();

  const form = document.getElementById('login-form');
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

    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;

    if (!email || !password) {
      showError('Please enter both your email and password.');
      return;
    }

    setLoading(true);
    const { data, error } = await signInUser(email, password);
    setLoading(false);

    if (error) {
      showError(error);
      return;
    }

    // signInUser() already logged the session + audit entry internally.
    window.location.href = ROUTES.dashboard;
  });
});
