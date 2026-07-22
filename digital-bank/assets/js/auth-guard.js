/* =============================================================
   MERIDIAN — International Digital Banking
   assets/js/auth-guard.js

   PURPOSE
   -------
   A classic (non-module, non-deferred) script that must be the
   very first <script> in <head> on every authenticated page
   (dashboard.html, accounts.html, transactions.html, transfer.html,
   cards.html, profile.html, settings.html...). It runs before the
   rest of the page parses and:

     1. Looks for the Supabase session Supabase Auth persists in
        localStorage under the key configured in supabase/config.js
        (storageKey: 'meridian-auth').
     2. If there's no session object, or its access token is
        already expired, redirects to login.html immediately via
        location.replace() — before any account data, balances, or
        markup have a chance to paint.
     3. If a session looks present, it lets the page continue to
        load. The page's own module script then calls requireAuth()
        from supabase/auth.js, which asks Supabase Auth for the
        real, server-validated session (refreshing the token if
        needed) and redirects if that check fails too. This file is
        a fast, offline first pass to kill the "flash of protected
        content" — requireAuth() is still what's actually trusted.

   USAGE
   -----
   In <head>, before the stylesheet and before anything else:

     <script src="../assets/js/auth-guard.js"></script>

   Pair it with this on <body> so content stays hidden until the
   page's module script confirms auth and removes the class:

     <body class="app-body auth-pending">

   And, at the end of the module script's init():

     document.body.classList.remove('auth-pending');

   If init() never runs (e.g. requireAuth() redirected), the class
   simply stays — irrelevant, since the browser is navigating away.
   ============================================================= */

(function () {
  var STORAGE_KEY = 'meridian-auth';
  var LOGIN_PATH = 'login.html';

  function redirectToLogin() {
    // Preserve where the visitor was headed so login.html can
    // send them back after a successful sign-in.
    var next = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.replace(LOGIN_PATH + '?next=' + next);
  }

  var raw;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch (e) {
    // Storage blocked (private browsing, disabled cookies, etc.) —
    // fall through to requireAuth()'s server-side check instead of
    // guessing; don't bounce a user who might still have a valid
    // session the network check would confirm.
    return;
  }

  if (!raw) {
    redirectToLogin();
    return;
  }

  var session;
  try {
    session = JSON.parse(raw);
  } catch (e) {
    redirectToLogin();
    return;
  }

  var expiresAt = session && session.expires_at; // unix seconds, set by supabase-js
  var hasToken = session && session.access_token;

  if (!hasToken) {
    redirectToLogin();
    return;
  }

  if (typeof expiresAt === 'number' && expiresAt * 1000 < Date.now()) {
    // Expired past the point supabase-js would silently refresh it
    // (it refreshes ~60s ahead of expiry on its own once the SDK
    // loads). Let requireAuth() attempt a refresh rather than
    // bouncing here — a still-valid refresh token can recover this.
    return;
  }
  // Looks like a live session — let the page continue loading.
})();
