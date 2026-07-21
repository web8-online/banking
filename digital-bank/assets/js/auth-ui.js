/* =============================================================
   MERIDIAN — International Digital Banking
   Auth UI: assets/js/auth-ui.js

   Bridges supabase/auth.js to the DOM. This module doesn't talk to
   Supabase directly — it imports the wrapped functions from
   supabase/auth.js and uses them to:

     1. Guard app pages (dashboard, accounts, transfer, transactions,
        profile, settings) — bounce to login.html if there's no session.
     2. Bounce an already-logged-in visitor away from login/register.
     3. Populate the header's user menu (name, initials) from the
        real session instead of the hard-coded "Amara Okafor" markup.
     4. Wire up every "Log out" control so it actually signs out.

   Import path to supabase/auth.js is resolved at runtime with a
   dynamic import() (see resolveSupabaseBase below) so this single
   file works unmodified whether it's loaded from index.html at the
   site root or from a page under /pages/.

   Usage — add to any page, after component markup exists:

     <script type="module">
       import { initAuthUI } from './assets/js/auth-ui.js'; // or ../assets/js/... under /pages/
       initAuthUI();
     </script>

   If the page also uses components.js to inject the header, call
   initAuthUI() after `document` fires 'component:loaded' instead of
   on DOMContentLoaded — see the bottom of this file.
   ============================================================= */

import { $, $$, getInitials } from './utils.js';

/* -----------------------------------------------------------
   Resolve supabase/auth.js relative to whichever page loaded us
   ----------------------------------------------------------- */
function resolveSupabaseBase() {
  const inPagesDir = window.location.pathname.includes('/pages/');
  return inPagesDir ? '../supabase/' : 'supabase/';
}

let authModulePromise = null;
function loadAuthModule() {
  if (!authModulePromise) {
    authModulePromise = import(`${resolveSupabaseBase()}auth.js`);
  }
  return authModulePromise;
}

/* -----------------------------------------------------------
   Page classification
   ----------------------------------------------------------- */

/** Logged-in app pages all render <body class="app-body">. */
function isAppPage() {
  return document.body.classList.contains('app-body');
}

/** Pages a logged-in visitor shouldn't see again (they already have a session). */
function isGuestOnlyPage() {
  const file = window.location.pathname.split('/').pop();
  return file === 'login.html' || file === 'register.html';
}

/* -----------------------------------------------------------
   Header population
   ----------------------------------------------------------- */

/**
 * Fills in every element that displays the current user across the
 * header/dropdown — matches the markup already used in dashboard.html,
 * profile.html, settings.html, transactions.html, transfer.html:
 *   .app-user-name          → full name
 *   .app-user-menu .avatar-initial, .profile-avatar-wrap .avatar-initial → initials
 *   [data-user-email]       → email, where a page opts in
 */
function populateUserChrome(user) {
  const meta = user.user_metadata || {};
  const firstName = meta.first_name || '';
  const lastName = meta.last_name || '';
  const fullName = [firstName, lastName].filter(Boolean).join(' ') || user.email || 'Meridian customer';
  const initials = getInitials(fullName);

  $$('.app-user-name').forEach((el) => { el.textContent = fullName; });
  $$('.app-user-menu .avatar-initial, .profile-avatar-wrap .avatar-initial').forEach((el) => {
    el.textContent = initials;
  });
  $$('[data-user-email]').forEach((el) => { el.textContent = user.email; });
  $$('[data-user-first-name]').forEach((el) => { el.textContent = firstName; });
}

/* -----------------------------------------------------------
   Logout wiring
   ----------------------------------------------------------- */

/**
 * Any link/button whose visible text is "Log out" (the dropdown item
 * used in dashboard.html, profile.html, settings.html, transactions.html,
 * transfer.html) or that carries [data-logout] gets intercepted so it
 * signs out through Supabase before navigating, instead of just linking
 * straight to index.html.
 */
function wireLogoutControls(signOutUser) {
  const candidates = $$('.app-user-dropdown a, [data-logout]').filter((el) => {
    if (el.hasAttribute('data-logout')) return true;
    return el.textContent.trim().toLowerCase() === 'log out';
  });

  candidates.forEach((el) => {
    el.addEventListener('click', async (event) => {
      event.preventDefault();
      el.setAttribute('aria-disabled', 'true');
      const target = el.getAttribute('href') || resolveHomeHref();
      const { error } = await signOutUser();
      if (error) {
        console.error('[Meridian] Sign out failed:', error);
      }
      window.location.href = target;
    });
  });
}

function resolveHomeHref() {
  return window.location.pathname.includes('/pages/') ? '../index.html' : 'index.html';
}

function resolveLoginHref() {
  return window.location.pathname.includes('/pages/') ? 'login.html' : 'pages/login.html';
}

/* -----------------------------------------------------------
   Public entry point
   ----------------------------------------------------------- */

/**
 * Call once per page, after any header partial has been injected
 * (see components.js). Safe to call on every page — it figures out
 * what that page needs from its <body> class and filename.
 */
export async function initAuthUI() {
  const { getCurrentUser, requireAuth, redirectIfAuthenticated, signOutUser, onAuthStateChange } =
    await loadAuthModule();

  if (isGuestOnlyPage()) {
    await redirectIfAuthenticated();
    return; // nothing else to wire up on login/register
  }

  if (isAppPage()) {
    const user = await requireAuth(); // redirects to login.html internally if no session
    if (!user) return;

    populateUserChrome(user);
    wireLogoutControls(signOutUser);

    // If the session ends elsewhere (another tab, token expiry), bounce here too.
    onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        window.location.href = resolveLoginHref();
      }
    });
    return;
  }

  // Public marketing pages (index.html): no guard needed, but if a session
  // exists, swap "Log in / Open an account" for a straight link to the
  // dashboard so a returning, already-signed-in visitor isn't asked to log in again.
  const { data: user } = await getCurrentUser();
  if (user) {
    $$('a[href$="login.html"], a[href$="register.html"]').forEach((el) => {
      el.textContent = 'Go to dashboard';
      el.setAttribute('href', 'pages/dashboard.html');
    });
  }
}

/* -----------------------------------------------------------
   Auto-init
   ----------------------------------------------------------- */
// If the page uses components.js to inject the header, initAuthUI runs
// after that markup exists. Otherwise it runs on DOMContentLoaded like
// any other page script. Both are safe to leave in place at once.
if (document.querySelector('[data-component]')) {
  document.addEventListener('component:loaded', initAuthUI, { once: true });
} else {
  document.addEventListener('DOMContentLoaded', initAuthUI, { once: true });
}
