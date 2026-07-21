/* =============================================================
   MERIDIAN — International Digital Banking
   Utilities: assets/js/utils.js

   Small, dependency-free helper functions used across the app —
   formatting, DOM shortcuts, debouncing, and simple client-side
   validation. Nothing here talks to Supabase; that's auth.js /
   database.js. Import only what you need:

     import { formatCurrency, $, debounce } from './utils.js';
   ============================================================= */

/* -----------------------------------------------------------
   DOM shortcuts
   ----------------------------------------------------------- */

/** querySelector, optionally scoped to an element instead of document. */
export function $(selector, scope) {
  return (scope || document).querySelector(selector);
}

/** querySelectorAll, returned as a real array so you can .map/.filter it. */
export function $$(selector, scope) {
  return Array.from((scope || document).querySelectorAll(selector));
}

/** Shorthand for document.createElement + assigning className/text/attrs. */
export function createEl(tag, { className, text, attrs } = {}) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  if (attrs) {
    Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, value));
  }
  return el;
}

/* -----------------------------------------------------------
   Formatting — currency, numbers, dates
   ----------------------------------------------------------- */

const CURRENCY_LOCALE = {
  USD: 'en-US',
  EUR: 'de-DE',
  GBP: 'en-GB',
  JPY: 'ja-JP',
  SGD: 'en-SG',
  NGN: 'en-NG',
  AED: 'ar-AE',
  INR: 'en-IN',
  CHF: 'de-CH',
  CNY: 'zh-CN',
  AUD: 'en-AU',
  CAD: 'en-CA',
};

/**
 * Formats a numeric amount as a currency string, e.g. formatCurrency(48204.6, 'USD') → "$48,204.60".
 * Falls back to a generic "en-US" formatter for currencies not in the locale map.
 */
export function formatCurrency(amount, currencyCode = 'USD') {
  const locale = CURRENCY_LOCALE[currencyCode] || 'en-US';
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currencyCode,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount || 0);
  } catch (err) {
    // Unknown/unsupported currency code — degrade gracefully instead of throwing.
    return `${currencyCode} ${Number(amount || 0).toFixed(2)}`;
  }
}

/** Formats a plain number with thousands separators, no currency symbol. */
export function formatNumber(value, decimals = 2) {
  return Number(value || 0).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Formats an ISO timestamp/date string as relative-ish, human copy:
 * "Today, 9:12 AM" / "Yesterday, 6:03 PM" / "Jul 14, 2026".
 */
export function formatTimestamp(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  const now = new Date();

  const isSameDay = (a, b) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  const timePart = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  if (isSameDay(date, now)) return `Today, ${timePart}`;
  if (isSameDay(date, yesterday)) return `Yesterday, ${timePart}`;

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Masks all but the last N characters of an account/card number: "····4821" */
export function maskAccountNumber(value, visibleDigits = 4) {
  if (!value) return '';
  const digits = String(value).replace(/\s+/g, '');
  const tail = digits.slice(-visibleDigits);
  return `···· ${tail}`;
}

/** Builds a two-letter initials string from a full name, e.g. "Amara Okafor" → "AO". */
export function getInitials(fullName) {
  if (!fullName) return '?';
  const parts = fullName.trim().split(/\s+/);
  const first = parts[0]?.[0] || '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}

/* -----------------------------------------------------------
   Timing helpers
   ----------------------------------------------------------- */

/** Standard debounce: delays invoking fn until `wait` ms after the last call. */
export function debounce(fn, wait = 250) {
  let timer;
  return function debounced(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), wait);
  };
}

/** Standard throttle: invokes fn at most once every `wait` ms. */
export function throttle(fn, wait = 250) {
  let isReady = true;
  return function throttled(...args) {
    if (!isReady) return;
    isReady = false;
    fn.apply(this, args);
    setTimeout(() => { isReady = true; }, wait);
  };
}

/* -----------------------------------------------------------
   Validation
   ----------------------------------------------------------- */

export function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

/** Basic phone check — accepts an optional leading + and 7–15 digits. */
export function isValidPhone(value) {
  return /^\+?[0-9\s\-().]{7,20}$/.test(String(value || '').trim());
}

/** Very loose IBAN shape check (2 letters, 2 digits, 11–30 alphanumerics). Not a checksum validator. */
export function isPlausibleIban(value) {
  return /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(String(value || '').replace(/\s+/g, '').toUpperCase());
}

/**
 * Scores password strength 0–4 based on length and character variety.
 * Mirrors the 4-bar meter in register.html (.password-strength-bar).
 */
export function getPasswordStrength(password) {
  if (!password) return 0;
  let score = 0;
  if (password.length >= 10) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;
  return Math.min(score, 4);
}

/* -----------------------------------------------------------
   Misc
   ----------------------------------------------------------- */

/** Generates a Meridian-style transaction reference, e.g. "MN-004821". */
export function generateReference(prefix = 'MN') {
  const random = Math.floor(100000 + Math.random() * 899999);
  return `${prefix}-${random}`;
}

/** Reads a query-string param from the current URL, or a supplied URL string. */
export function getQueryParam(name, url = window.location.href) {
  return new URL(url).searchParams.get(name);
}

/** Simple in-memory + sessionStorage-free sleep helper for staged UI transitions. */
export function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
