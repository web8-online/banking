/* =============================================================
   MERIDIAN — International Digital Banking
   Authentication module: supabase/auth.js

   Wraps Supabase Auth for the app and keeps it in sync with the
   custom tables in the schema (user_profiles, login_sessions,
   audit_logs). Import the functions you need into a page script:

     import { signUpUser, signInUser, requireAuth } from '../supabase/auth.js';

   Every exported function returns a plain { data, error } object
   (error is null on success) so page scripts never need to catch
   exceptions to handle expected failures like "wrong password".
   ============================================================= */

import { supabase, ROUTES } from './config.js';

/* -----------------------------------------------------------
   Helpers
   ----------------------------------------------------------- */

/** Very small user-agent reader — good enough for audit/session
 *  logging, not meant to be a full device-detection library. */
function getClientContext() {
  const ua = navigator.userAgent || '';

  let browser = 'Unknown';
  if (ua.includes('Edg/')) browser = 'Edge';
  else if (ua.includes('Chrome/') && !ua.includes('Chromium')) browser = 'Chrome';
  else if (ua.includes('Firefox/')) browser = 'Firefox';
  else if (ua.includes('Safari/') && !ua.includes('Chrome')) browser = 'Safari';

  let os = 'Unknown';
  if (ua.includes('Windows')) os = 'Windows';
  else if (ua.includes('Mac OS')) os = 'macOS';
  else if (ua.includes('Android')) os = 'Android';
  else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';
  else if (ua.includes('Linux')) os = 'Linux';

  const device = /Mobi|Android|iPhone|iPad/.test(ua) ? 'Mobile' : 'Desktop';

  return { browser, operating_system: os, device, user_agent: ua };
}

function friendlyAuthError(error) {
  if (!error) return null;
  const message = error.message || 'Something went wrong. Please try again.';

  // Map a few common Supabase Auth messages to friendlier copy.
  if (message.toLowerCase().includes('invalid login credentials')) {
    return 'That email and password combination doesn\u2019t match our records.';
  }
  if (message.toLowerCase().includes('email not confirmed')) {
    return 'Please verify your email address before logging in.';
  }
  if (message.toLowerCase().includes('user already registered')) {
    return 'An account with this email already exists. Try logging in instead.';
  }
  if (message.toLowerCase().includes('password should be at least')) {
    return 'Your password needs to be at least 8 characters long.';
  }
  return message;
}

/* -----------------------------------------------------------
   Registration
   ----------------------------------------------------------- */

/**
 * Creates an auth user and the matching user_profiles row.
 * @param {Object} form
 * @param {string} form.firstName
 * @param {string} form.lastName
 * @param {string} form.email
 * @param {string} form.password
 * @param {string} [form.phone]
 */
export async function signUpUser({ firstName, lastName, email, password, phone }) {
  const { data: authData, error: authError } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { first_name: firstName, last_name: lastName },
      emailRedirectTo: `${window.location.origin}/pages/login.html`,
    },
  });

  if (authError) {
    return { data: null, error: friendlyAuthError(authError) };
  }

  // signUp() can succeed with no error but no new identity when the
  // email is already registered (Supabase's confirm-email-safe behavior).
  const identities = authData.user?.identities ?? [];
  if (authData.user && identities.length === 0) {
    return { data: null, error: 'An account with this email already exists. Try logging in instead.' };
  }

  const newUserId = authData.user?.id;
  if (newUserId) {
    const { error: profileError } = await supabase.from('user_profiles').insert({
      id: newUserId,
      first_name: firstName,
      last_name: lastName,
      email,
      phone: phone || null,
      account_status: 'Pending',
      email_verified: false,
    });

    if (profileError) {
      // The auth user now exists without a profile row — surface this
      // clearly so it can be retried or reconciled rather than silently lost.
      return {
        data: authData,
        error: `Account created, but your profile could not be saved: ${profileError.message}`,
      };
    }
  }

  return { data: authData, error: null };
}

/* -----------------------------------------------------------
   Login / logout
   ----------------------------------------------------------- */

export async function signInUser(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { data: null, error: friendlyAuthError(error) };
  }

  if (data.user) {
    await logLoginSession(data.user.id);
    await logAuditAction(data.user.id, 'User logged in');
  }

  return { data, error: null };
}

export async function signOutUser() {
  const { data: { user } } = await supabase.auth.getUser();

  if (user) {
    await closeOpenLoginSession(user.id);
    await logAuditAction(user.id, 'User logged out');
  }

  const { error } = await supabase.auth.signOut();
  return { data: !error, error: error ? friendlyAuthError(error) : null };
}

/* -----------------------------------------------------------
   Session / user access
   ----------------------------------------------------------- */

export async function getCurrentSession() {
  const { data, error } = await supabase.auth.getSession();
  return { data: data?.session ?? null, error: error ? error.message : null };
}

export async function getCurrentUser() {
  const { data, error } = await supabase.auth.getUser();
  return { data: data?.user ?? null, error: error ? error.message : null };
}

/**
 * Subscribes to auth state changes (sign in, sign out, token refresh).
 * Returns the subscription so the caller can unsubscribe if needed:
 *   const sub = onAuthStateChange((event, session) => {...});
 *   sub.unsubscribe();
 */
export function onAuthStateChange(callback) {
  const { data } = supabase.auth.onAuthStateChange(callback);
  return data.subscription;
}

/* -----------------------------------------------------------
   Route guards — call at the top of a page script
   ----------------------------------------------------------- */

/**
 * Use on protected pages (dashboard, accounts, transfers, etc.).
 * Redirects to login.html if there's no active session.
 * Returns the current user on success, or null after redirecting.
 */
export async function requireAuth() {
  const { data: session } = await getCurrentSession();
  if (!session) {
    window.location.href = ROUTES.login;
    return null;
  }
  const { data: user } = await getCurrentUser();
  return user;
}

/**
 * Use on login.html / register.html so an already-logged-in
 * visitor is sent straight to their dashboard.
 */
export async function redirectIfAuthenticated() {
  const { data: session } = await getCurrentSession();
  if (session) {
    window.location.href = ROUTES.dashboard;
  }
}

/* -----------------------------------------------------------
   Password management
   ----------------------------------------------------------- */

export async function requestPasswordReset(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/pages/login.html`,
  });
  return { data: !error, error: error ? friendlyAuthError(error) : null };
}

export async function updateUserPassword(newPassword) {
  const { data, error } = await supabase.auth.updateUser({ password: newPassword });
  return { data: data?.user ?? null, error: error ? friendlyAuthError(error) : null };
}

export async function resendVerificationEmail(email) {
  const { error } = await supabase.auth.resend({ type: 'signup', email });
  return { data: !error, error: error ? friendlyAuthError(error) : null };
}

/* -----------------------------------------------------------
   Session & audit logging (login_sessions / audit_logs)
   ----------------------------------------------------------- */

async function logLoginSession(userId) {
  const ctx = getClientContext();
  const { error } = await supabase.from('login_sessions').insert({
    user_id: userId,
    browser: ctx.browser,
    device: ctx.device,
    login_time: new Date().toISOString(),
  });
  if (error) console.error('[Meridian] Failed to log login session:', error.message);
}

async function closeOpenLoginSession(userId) {
  const { data: openSessions, error: fetchError } = await supabase
    .from('login_sessions')
    .select('id')
    .eq('user_id', userId)
    .is('logout_time', null)
    .order('login_time', { ascending: false })
    .limit(1);

  if (fetchError || !openSessions?.length) return;

  const { error: updateError } = await supabase
    .from('login_sessions')
    .update({ logout_time: new Date().toISOString() })
    .eq('id', openSessions[0].id);

  if (updateError) console.error('[Meridian] Failed to close login session:', updateError.message);
}

async function logAuditAction(userId, action) {
  const ctx = getClientContext();
  const { error } = await supabase.from('audit_logs').insert({
    user_id: userId,
    action,
    browser: ctx.browser,
    operating_system: ctx.operating_system,
    device: ctx.device,
  });
  if (error) console.error('[Meridian] Failed to write audit log:', error.message);
}
