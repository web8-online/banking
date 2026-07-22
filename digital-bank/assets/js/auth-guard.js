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

     1. Scans localStorage for a key whose name starts with
        'meridian-auth' — the storageKey supabase/config.js gives
        supabase-js. A prefix scan (rather than an exact
        localStorage.getItem('meridian-auth')) is used deliberately:
        supabase-js has, across versions, appended suffixes to a
        custom storageKey in some storage adapters, and scanning
        for a prefix is resilient to that without needing to know
        the exact suffix in advance.
     2. For whichever matching key it finds, tries to parse it as
        the session object supabase-js stores and checks it has an
        access_token that isn't already past its expires_at. If
        nothing matching and valid turns up, redirects to
        login.html immediately via location.replace() — before any
        account data, balances, or markup have a chance to paint.
     3. If a session looks present and unexpired, it lets the page
        continue to load. The page's own module script then calls
        its real auth check against Supabase (requireAuth() in
        supabase/auth.js, or guardPage() in supabase/page-guard.js
        — see the note below about those two) which asks Supabase
        Auth for the real, server-validated session (refreshing the
        token if needed) and redirects if that check fails too.
        This file is a fast, offline first pass to kill the "flash
        of protected content" — the module-level check is still
        what's actually trusted.

   USAGE
   -----
   In <head>, before the stylesheet and before anything else:

     <script src="../assets/js/auth-guard.js"></script>

   Pair it with this on <body> so content stays hidden until the
   page's module script confirms auth:

     <body class="app-body auth-pending">
       ...
     </body>

   or, on pages using the data-attribute + loader-overlay pattern
   (see settings.html):

     <body class="app-body" data-auth="pending">
       <div class="auth-loader" aria-hidden="true"><span class="auth-loader-mark"></span></div>
       ...
     </body>

   Either way, this script does not touch <body> itself — it can't;
   it runs before <body> exists in the DOM. It only performs the
   redirect-if-clearly-logged-out check. Revealing the page is the
   job of whatever your module script's guard function does once it
   confirms a real session — e.g. at the end of init():

     document.body.classList.remove('auth-pending');
     // or, for the data-auth pattern:
     document.body.dataset.auth = 'ready';

   If the redirect above fires, none of that matters — the browser
   is already navigating to login.html before init() would run.

   ONE THING WORTH FIXING IN YOUR CODEBASE
   ----------------------------------------
   settings.html currently has its own inline copy of this script
   instead of linking to this file, which is how it ended up
   slightly different (prefix scan, no expiry check, no ?next=)
   from what accounts.html was using. Now that this file matches
   settings.html's behavior, swap that inline <script> block out for:

     <script src="../assets/js/auth-guard.js"></script>

   so every page shares one implementation instead of quietly
   drifting apart again the next time someone tweaks one of them.

   Also worth reconciling on your end: accounts.js calls
   requireAuth() from supabase/auth.js, while settings.js calls
   guardPage() from supabase/page-guard.js. Both are presumably
   doing the same server-side session check under different names
   in different files — worth picking one and having the other
   re-export it, so there's a single source of truth for the real
   (server-validated) auth check the way there now is for this
   fast pre-check.
   ============================================================= */

(function () {
  var STORAGE_KEY_PREFIX = 'meridian-auth';
  var LOGIN_PATH = 'login.html';

  function redirectToLogin() {
    // Preserve where the visitor was headed so login.html can
    // send them back after a successful sign-in.
    var next = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.replace(LOGIN_PATH + '?next=' + next);
  }

  function findSessionValue() {
    try {
      for (var i = 0; i < window.localStorage.length; i++) {
        var key = window.localStorage.key(i);
        if (key && key.indexOf(STORAGE_KEY_PREFIX) === 0) {
          return window.localStorage.getItem(key);
        }
      }
    } catch (e) {
      // Storage blocked (private browsing, disabled cookies, etc.) —
      // return undefined so the caller falls through to the
      // module-level check instead of guessing.
      return undefined;
    }
    return null;
  }

  var raw = findSessionValue();

  if (raw === undefined) {
    // localStorage itself wasn't readable — don't bounce a user who
    // might still have a valid session the network check would
    // confirm; let the page's real guard decide.
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
    // Found a matching key but couldn't parse it — treat this the
    // same as "no session" rather than letting a corrupted value
    // silently pass the guard.
    redirectToLogin();
    return;
  }

  var hasToken = session && session.access_token;
  var expiresAt = session && session.expires_at; // unix seconds, set by supabase-js

  if (!hasToken) {
    redirectToLogin();
    return;
  }

  if (typeof expiresAt === 'number' && expiresAt * 1000 < Date.now()) {
    // Expired past the point supabase-js would silently refresh it
    // on its own once the SDK loads. Let the module-level check
    // attempt a refresh rather than bouncing here — a still-valid
    // refresh token can recover this.
    return;
  }

  // Looks like a live session — let the page continue loading.
})();
