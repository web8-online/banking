/* =============================================================
   MERIDIAN — Account profile page
   Script: pages/profile.js
   Loaded as a module by profile.html only. Handles:
     1. Auth guard + header (name, avatar, notification badge)
     2. User menu dropdown (open/close, outside-click, Escape)
     3. Log out
     4. Section navigation (Overview / Personal / Security /
        Notifications / Danger zone) — hash-linked, keyboard
        accessible tabs
     5. Loading the signed-in user's profile into the banner and
        the Personal info form
     6. Avatar upload (via supabase/storage.js)
     7. Personal info form — save to user_profiles
     8. Password change form — client-side match check +
        supabase.auth.updateUser via updateUserPassword()
     9. Two-factor method picker — saved to user_profiles.two_factor_method
     10. Notification preference switches — saved to user_profiles
     11. Session "log out" action (front-end only — see note)
     12. Danger zone actions (data export / close account) — stubs
     13. Toast helper for save feedback
   ============================================================= */

import { requireAuth, signOutUser, updateUserPassword } from '../supabase/auth.js';
import { getMyProfile, updateMyProfile } from '../supabase/database.js';
import { uploadAvatar } from '../supabase/storage.js';

const $ = (selector, scope) => (scope || document).querySelector(selector);
const $$ = (selector, scope) => Array.from((scope || document).querySelectorAll(selector));

let currentUser = null;
let currentProfile = null;

/* -----------------------------------------------------------
   Toasts
   ----------------------------------------------------------- */
function toastRegion() {
  let region = $('.profile-toast-region');
  if (!region) {
    region = document.createElement('div');
    region.className = 'profile-toast-region';
    region.setAttribute('aria-live', 'polite');
    document.body.appendChild(region);
  }
  return region;
}

function showToast(message, type = 'success') {
  const region = toastRegion();
  const toast = document.createElement('div');
  toast.className = `profile-toast profile-toast--${type}`;
  const icon = type === 'success'
    ? '<path d="M2.5 7 5.5 10 11.5 3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>'
    : '<path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>';
  toast.innerHTML = `
    <span class="ic"><svg viewBox="0 0 14 13" fill="none" aria-hidden="true">${icon}</svg></span>
    <span>${message}</span>
  `;
  region.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('is-visible'));

  setTimeout(() => {
    toast.classList.remove('is-visible');
    setTimeout(() => toast.remove(), 250);
  }, 3600);
}

/* -----------------------------------------------------------
   Button loading helper
   ----------------------------------------------------------- */
function setButtonLoading(button, isLoading) {
  if (!button) return;
  button.classList.toggle('is-loading', isLoading);
  button.disabled = isLoading;
}

/* -----------------------------------------------------------
   Initials / avatar rendering
   ----------------------------------------------------------- */
function initials(firstName, lastName) {
  const a = (firstName || '').trim().charAt(0);
  const b = (lastName || '').trim().charAt(0);
  return (a + b).toUpperCase() || 'M';
}

function paintAvatar(url, firstName, lastName) {
  const label = initials(firstName, lastName);

  $$('.avatar-initial--sm, .avatar-initial--lg').forEach((el) => {
    if (url) {
      el.innerHTML = `<img class="avatar-photo" src="${url}" alt="">`;
    } else {
      el.textContent = label;
    }
  });
}

/* -----------------------------------------------------------
   Header: greeting name, avatar, notification badge
   ----------------------------------------------------------- */
function populateHeader(profile) {
  const nameEl = $('.app-user-name');
  if (nameEl) nameEl.textContent = profile?.first_name ? `${profile.first_name} ${profile.last_name || ''}`.trim() : 'Your account';
  paintAvatar(profile?.profile_photo, profile?.first_name, profile?.last_name);
}

function populateNotificationBadge(profile) {
  const badge = $('.app-icon-btn-badge');
  if (!badge) return;
  // Dashboard wires this to getUnreadNotificationCount(); kept static
  // here since the profile page's header badge is decorative until
  // that count is threaded through on this page too.
  if (!badge.textContent) badge.style.display = 'none';
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
    menu.classList.contains('is-open') ? close() : open();
  });
}

/* -----------------------------------------------------------
   Log out
   ----------------------------------------------------------- */
function initLogout() {
  $$('.app-user-dropdown a[href="../index.html"]').forEach((logoutLink) => {
    logoutLink.addEventListener('click', async (event) => {
      event.preventDefault();
      await signOutUser();
      window.location.href = logoutLink.getAttribute('href');
    });
  });
}

/* -----------------------------------------------------------
   Mobile app nav toggle
   ----------------------------------------------------------- */
function initMobileNav() {
  const toggle = $('.app-nav-toggle');
  const nav = $('.app-nav');
  if (!toggle || !nav) return;

  toggle.addEventListener('click', () => {
    const isOpen = nav.classList.toggle('is-mobile-open');
    toggle.setAttribute('aria-expanded', String(isOpen));
  });

  nav.addEventListener('click', (event) => {
    if (event.target.tagName === 'A') {
      nav.classList.remove('is-mobile-open');
      toggle.setAttribute('aria-expanded', 'false');
    }
  });

  document.addEventListener('click', (event) => {
    if (!nav.classList.contains('is-mobile-open')) return;
    if (!nav.contains(event.target) && !toggle.contains(event.target)) {
      nav.classList.remove('is-mobile-open');
      toggle.setAttribute('aria-expanded', 'false');
    }
  });
}

/* -----------------------------------------------------------
   Section navigation (tabs)
   ----------------------------------------------------------- */
function initSectionNav() {
  const links = $$('.profile-nav-link');
  const panels = $$('.profile-panel');
  if (!links.length || !panels.length) return;

  function activate(tabName, { focusPanel = false, updateHash = true } = {}) {
    const targetLink = links.find((l) => l.dataset.tab === tabName) || links[0];
    const targetPanel = panels.find((p) => p.dataset.panel === targetLink.dataset.tab);
    if (!targetPanel) return;

    links.forEach((l) => l.classList.toggle('is-active', l === targetLink));
    panels.forEach((p) => p.classList.toggle('is-active', p === targetPanel));

    if (updateHash) {
      history.replaceState(null, '', `#${targetLink.dataset.tab}`);
    }
    if (focusPanel) {
      targetPanel.setAttribute('tabindex', '-1');
      targetPanel.focus({ preventScroll: true });
    }
  }

  links.forEach((link) => {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      activate(link.dataset.tab, { focusPanel: true });
    });
  });

  const initialTab = window.location.hash.replace('#', '');
  activate(initialTab || 'overview', { updateHash: false });
}

/* -----------------------------------------------------------
   Load profile data into banner + summary + form
   ----------------------------------------------------------- */
function populateBanner(profile) {
  const heading = $('.profile-banner-identity h1');
  const meta = $('.profile-banner-meta');
  const statusRegion = $('.profile-banner-status');

  if (heading) heading.textContent = `${profile?.first_name || ''} ${profile?.last_name || ''}`.trim() || 'Your profile';

  if (meta) {
    const since = profile?.created_at
      ? new Date(profile.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
      : null;
    meta.textContent = `Personal account${since ? ` · Member since ${since}` : ''}`;
  }

  if (statusRegion) {
    statusRegion.innerHTML = '';

    const identityPill = document.createElement('span');
    if (profile?.account_status === 'Active') {
      identityPill.className = 'status-pill status-pill--verified';
      identityPill.innerHTML = `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 8.5 6.5 12 13 4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg> Identity verified`;
    } else {
      identityPill.className = 'status-pill status-pill--pending';
      identityPill.textContent = profile?.account_status || 'Pending review';
    }
    statusRegion.appendChild(identityPill);

    const emailPill = document.createElement('span');
    emailPill.className = 'status-pill status-pill--neutral';
    emailPill.textContent = profile?.email_verified ? 'Email confirmed' : 'Email unconfirmed';
    statusRegion.appendChild(emailPill);
  }
}

function populatePersonalForm(profile) {
  const form = $('#personal-info-form');
  if (!form || !profile) return;

  const setValue = (name, value) => {
    const field = form.elements[name];
    if (field && value !== undefined && value !== null) field.value = value;
  };

  setValue('first_name', profile.first_name);
  setValue('last_name', profile.last_name);
  setValue('email', profile.email);
  setValue('phone', profile.phone);
  setValue('date_of_birth', profile.date_of_birth);
  setValue('gender', profile.gender);
  setValue('nationality', profile.nationality);
  setValue('occupation', profile.occupation);
  setValue('address', profile.address);
  setValue('city', profile.city);
  setValue('state', profile.state);
  setValue('postal_code', profile.postal_code);
  setValue('country', profile.country);
}

function populateSummary(profile) {
  const cards = $$('.profile-summary-card .profile-summary-value');
  if (!cards.length) return;
  const [status] = cards;
  if (status) status.textContent = profile?.account_status || 'Pending';
}

function populateTwoFactor(profile) {
  const buttons = $$('.auth-method-btn');
  const label = $('.profile-card-head .status-pill--verified', $('#security'));
  if (!buttons.length) return;

  buttons.forEach((btn) => {
    btn.classList.toggle('is-selected', btn.dataset.method === (profile?.two_factor_method || 'email-code'));
  });

  if (label) {
    const selected = buttons.find((b) => b.classList.contains('is-selected'));
    const name = selected ? selected.textContent.trim() : 'Email code';
    label.textContent = `Enabled — ${name}`;
  }
}

function populateNotificationPreferences(profile) {
  const rows = $$('.preference-row');
  if (!rows.length) return;

  // These map to boolean columns on user_profiles. Security alerts
  // are intentionally always-on and disabled in the markup.
  const keyByIndex = ['notify_transactions', null, 'notify_exchange_rate', 'notify_product_news'];

  rows.forEach((row, i) => {
    const key = keyByIndex[i];
    if (!key) return;
    const input = $('input[type="checkbox"]', row);
    if (input && profile && key in profile) {
      input.checked = Boolean(profile[key]);
    }
  });
}

/* -----------------------------------------------------------
   Avatar upload
   ----------------------------------------------------------- */
function initAvatarUpload() {
  const editBtn = $('.profile-avatar-edit');
  if (!editBtn) return;

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.hidden = true;
  document.body.appendChild(fileInput);

  editBtn.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file || !currentUser) return;

    editBtn.classList.add('is-loading');
    const { data, error } = await uploadAvatar(file, currentUser.id);
    editBtn.classList.remove('is-loading');

    if (error) {
      showToast(error, 'error');
      return;
    }

    paintAvatar(data.url, currentProfile?.first_name, currentProfile?.last_name);
    if (currentProfile) currentProfile.profile_photo = data.url;
    showToast('Profile photo updated.');
  });
}

/* -----------------------------------------------------------
   Personal info form
   ----------------------------------------------------------- */
function clearFieldErrors(form) {
  $$('.field', form).forEach((field) => {
    field.classList.remove('has-error');
    const err = $('.field-error', field);
    if (err) err.textContent = '';
  });
}

function setFieldError(form, name, message) {
  const input = form.elements[name];
  if (!input) return;
  const field = input.closest('.field');
  if (!field) return;
  field.classList.add('has-error');
  const err = $('.field-error', field);
  if (err) err.textContent = message;
}

function initPersonalForm() {
  const form = $('#personal-info-form');
  if (!form) return;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFieldErrors(form);

    const values = Object.fromEntries(new FormData(form).entries());

    if (!values.first_name.trim()) {
      setFieldError(form, 'first_name', 'First name is required.');
      return;
    }
    if (!values.last_name.trim()) {
      setFieldError(form, 'last_name', 'Last name is required.');
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(values.email)) {
      setFieldError(form, 'email', 'Enter a valid email address.');
      return;
    }

    const emailChanged = currentProfile && values.email !== currentProfile.email;
    const submitBtn = $('button[type="submit"]', form);
    setButtonLoading(submitBtn, true);

    const { data, error } = await updateMyProfile(values, currentUser?.id);

    setButtonLoading(submitBtn, false);

    if (error) {
      showToast(error, 'error');
      return;
    }

    currentProfile = { ...currentProfile, ...data };
    populateBanner(currentProfile);
    populateHeader(currentProfile);

    showToast(emailChanged
      ? 'Saved. Check your inbox to confirm your new email address.'
      : 'Your changes have been saved.');
  });

  const cancelBtn = $('button[type="button"]', form);
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => populatePersonalForm(currentProfile));
  }
}

/* -----------------------------------------------------------
   Password change form
   ----------------------------------------------------------- */
function passwordStrength(password) {
  let score = 0;
  if (password.length >= 10) score += 1;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score += 1;
  if (/\d/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;
  return score;
}

function initPasswordForm() {
  const form = $('#password-change-form');
  if (!form) return;

  const newPasswordInput = form.elements['new_password'];
  let strengthMeter = $('.password-strength', form);
  if (!strengthMeter && newPasswordInput) {
    strengthMeter = document.createElement('div');
    strengthMeter.className = 'password-strength';
    strengthMeter.innerHTML = '<span></span><span></span><span></span><span></span>';
    newPasswordInput.closest('.field').appendChild(strengthMeter);
  }

  if (newPasswordInput) {
    newPasswordInput.addEventListener('input', () => {
      strengthMeter.dataset.strength = String(passwordStrength(newPasswordInput.value));
    });
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFieldErrors(form);

    const { current_password, new_password, new_password_confirm } = Object.fromEntries(new FormData(form).entries());

    if (!current_password) {
      setFieldError(form, 'current_password', 'Enter your current password.');
      return;
    }
    if (new_password.length < 10) {
      setFieldError(form, 'new_password', 'Use at least 10 characters.');
      return;
    }
    if (new_password !== new_password_confirm) {
      setFieldError(form, 'new_password_confirm', 'Passwords don\u2019t match.');
      return;
    }

    const submitBtn = $('button[type="submit"]', form);
    setButtonLoading(submitBtn, true);

    const { error } = await updateUserPassword(new_password);

    setButtonLoading(submitBtn, false);

    if (error) {
      showToast(error, 'error');
      return;
    }

    form.reset();
    if (strengthMeter) strengthMeter.removeAttribute('data-strength');
    showToast('Your password has been updated.');
  });
}

/* -----------------------------------------------------------
   Password visibility toggle
   ----------------------------------------------------------- */
function initPasswordToggle() {
  $$('.password-toggle').forEach((btn) => {
    const input = btn.closest('.password-field-wrap')?.querySelector('input');
    if (!input) return;
    btn.addEventListener('click', () => {
      const showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      btn.setAttribute('aria-pressed', String(!showing));
      btn.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
    });
  });
}

/* -----------------------------------------------------------
   Two-factor method picker
   ----------------------------------------------------------- */
function initTwoFactorPicker() {
  const buttons = $$('.auth-method-btn');
  if (!buttons.length) return;

  buttons.forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (btn.classList.contains('is-selected')) return;

      buttons.forEach((b) => b.classList.remove('is-selected'));
      btn.classList.add('is-selected');

      const label = $('.profile-card-head .status-pill--verified', btn.closest('.profile-card'));
      if (label) label.textContent = `Enabled — ${btn.textContent.trim()}`;

      const { error } = await updateMyProfile({ two_factor_method: btn.dataset.method }, currentUser?.id);
      if (error) {
        showToast(error, 'error');
        return;
      }
      showToast('Two-factor method updated.');
    });
  });
}

/* -----------------------------------------------------------
   Notification preference switches
   ----------------------------------------------------------- */
function initNotificationSwitches() {
  const rows = $$('.preference-row');
  if (!rows.length) return;

  const keyByIndex = ['notify_transactions', null, 'notify_exchange_rate', 'notify_product_news'];

  rows.forEach((row, i) => {
    const key = keyByIndex[i];
    const input = $('input[type="checkbox"]', row);
    if (!key || !input || input.disabled) return;

    input.addEventListener('change', async () => {
      const { error } = await updateMyProfile({ [key]: input.checked }, currentUser?.id);
      if (error) {
        input.checked = !input.checked; // revert on failure
        showToast(error, 'error');
        return;
      }
      showToast('Notification preferences saved.');
    });
  });
}

/* -----------------------------------------------------------
   Sessions — front-end only for now.
   auth.js closes the *current* session's login_sessions row on
   sign-out, but doesn't yet expose a way to close a specific
   *other* session by id. Wire this up to a real revoke once
   that's added (e.g. a `revokeLoginSession(sessionId)` export);
   for now this just removes the row from view.
   ----------------------------------------------------------- */
function initSessions() {
  $$('.session-item .wizard-edit-link').forEach((btn) => {
    btn.addEventListener('click', () => {
      const item = btn.closest('.session-item');
      btn.disabled = true;
      item.style.opacity = '0.5';
      setTimeout(() => {
        item.remove();
        showToast('Signed out of that device.');
      }, 200);
    });
  });
}

/* -----------------------------------------------------------
   Danger zone
   ----------------------------------------------------------- */
function initDangerZone() {
  const exportBtn = $('#danger .profile-card:nth-of-type(1) .btn');
  const closeBtn = $('#danger .profile-card:nth-of-type(2) .btn-danger');

  if (exportBtn) {
    exportBtn.addEventListener('click', async () => {
      setButtonLoading(exportBtn, true);
      // Placeholder: no data-export endpoint exists yet server-side.
      await new Promise((resolve) => setTimeout(resolve, 600));
      setButtonLoading(exportBtn, false);
      showToast("We'll email your data export within 24 hours.");
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      const confirmed = window.confirm(
        'Close your Meridian account? This can\u2019t be undone, and every account must already be at a zero balance.'
      );
      if (!confirmed) return;
      showToast('Account closure requires a zero balance on every currency account.', 'error');
    });
  }
}

/* -----------------------------------------------------------
   Init
   ----------------------------------------------------------- */
(async function init() {
  const user = await requireAuth();
  if (!user) return; // requireAuth() already redirected to login.html
  currentUser = user;

  initUserMenu();
  initLogout();
  initMobileNav();
  initSectionNav();
  initAvatarUpload();
  initPersonalForm();
  initPasswordForm();
  initPasswordToggle();
  initTwoFactorPicker();
  initNotificationSwitches();
  initSessions();
  initDangerZone();

  const { data: profile, error } = await getMyProfile(user.id);
  if (error || !profile) {
    showToast('Couldn\u2019t load your profile. Try refreshing the page.', 'error');
    return;
  }

  currentProfile = profile;
  populateHeader(profile);
  populateNotificationBadge(profile);
  populateBanner(profile);
  populateSummary(profile);
  populatePersonalForm(profile);
  populateTwoFactor(profile);
  populateNotificationPreferences(profile);
})();
