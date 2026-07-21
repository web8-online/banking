/* =============================================================
   MERIDIAN — International Digital Banking
   Animations: assets/js/animations.js

   Small, reusable motion helpers built on the Web Animations API
   (element.animate()) rather than one-off CSS classes, so pages can
   trigger them on dynamically-rendered content (a transaction row
   fetched from Supabase, a balance that just changed) without
   needing matching CSS shipped for every case.

   Everything here respects prefers-reduced-motion by skipping
   straight to the animation's end state. main.js's existing
   scroll-reveal/ticker/counter code for the public marketing site
   is untouched — this module is for the logged-in app pages and
   for any page-specific script that wants a quick effect.

     import { animateCount, pulse, fadeSwap } from '../assets/js/animations.js';
   ============================================================= */

export const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* -----------------------------------------------------------
   Scroll reveal — generalized version of main.js's [data-reveal],
   usable on content that wasn't in the DOM at page load (e.g. a
   transaction list rendered after a Supabase fetch).
   ----------------------------------------------------------- */

/**
 * Observes `elements` and adds `visibleClass` (default: 'is-visible')
 * as each one enters the viewport, then stops observing it.
 */
export function initScrollReveal(elements, { visibleClass = 'is-visible', threshold = 0.15 } = {}) {
  const list = elements instanceof Element ? [elements] : Array.from(elements || []);
  if (!list.length) return;

  if (prefersReducedMotion) {
    list.forEach((el) => el.classList.add(visibleClass));
    return;
  }

  const observer = new IntersectionObserver(
    (entries, obs) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add(visibleClass);
          obs.unobserve(entry.target);
        }
      });
    },
    { threshold, rootMargin: '0px 0px -40px 0px' }
  );

  list.forEach((el) => observer.observe(el));
}

/**
 * Fades + slides a group of elements in one after another. Useful for
 * a freshly-rendered list (e.g. transaction rows) where CSS
 * nth-child delays aren't practical because the count is dynamic.
 */
export function staggerIn(elements, { delayStep = 60, duration = 420 } = {}) {
  const list = Array.from(elements || []);
  if (!list.length) return;

  if (prefersReducedMotion) return;

  list.forEach((el, index) => {
    el.animate(
      [
        { opacity: 0, transform: 'translateY(14px)' },
        { opacity: 1, transform: 'translateY(0)' },
      ],
      { duration, delay: index * delayStep, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'both' }
    );
  });
}

/* -----------------------------------------------------------
   Number / value transitions
   ----------------------------------------------------------- */

/**
 * Animates a numeric value inside `el` from its current displayed
 * number (or 0) up to `target`, formatting each frame with
 * `formatFn` (defaults to a plain fixed-decimal string). Used for
 * stat counters and for live balance updates after a transfer.
 */
export function animateCount(el, target, { duration = 1200, decimals = 0, formatFn } = {}) {
  if (!el) return;
  const format = formatFn || ((value) => value.toFixed(decimals));

  if (prefersReducedMotion) {
    el.textContent = format(target);
    return;
  }

  const start = parseFloat((el.textContent || '0').replace(/[^0-9.-]/g, '')) || 0;
  const startTime = performance.now();

  function tick(now) {
    const progress = Math.min((now - startTime) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3); // ease-out-cubic
    const current = start + (target - start) * eased;
    el.textContent = format(current);
    if (progress < 1) requestAnimationFrame(tick);
    else el.textContent = format(target);
  }
  requestAnimationFrame(tick);
}

/** Animates a .spend-bar-fill / .goal-bar-fill style element's width to a target percentage (0–100). */
export function animateProgressBar(el, targetPercent, { duration = 900 } = {}) {
  if (!el) return;
  const clamped = Math.max(0, Math.min(100, targetPercent));

  if (prefersReducedMotion) {
    el.style.width = `${clamped}%`;
    return;
  }

  const startWidth = parseFloat(el.style.width) || 0;
  el.animate(
    [{ width: `${startWidth}%` }, { width: `${clamped}%` }],
    { duration, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'forwards' }
  );
  el.style.width = `${clamped}%`;
}

/**
 * Crossfades an element's content: fades out, swaps in `newHTML`
 * (or runs `updateFn` if given, for cases needing more than
 * innerHTML), fades back in. Good for balance figures or account
 * summaries that update after a Supabase call.
 */
export async function fadeSwap(el, { html, updateFn, duration = 180 } = {}) {
  if (!el) return;

  if (prefersReducedMotion) {
    if (updateFn) updateFn(el);
    else if (html !== undefined) el.innerHTML = html;
    return;
  }

  await el.animate([{ opacity: 1 }, { opacity: 0 }], { duration, easing: 'ease-out', fill: 'forwards' }).finished;
  if (updateFn) updateFn(el);
  else if (html !== undefined) el.innerHTML = html;
  await el.animate([{ opacity: 0 }, { opacity: 1 }], { duration, easing: 'ease-in', fill: 'forwards' }).finished;
  el.style.opacity = '';
}

/* -----------------------------------------------------------
   Feedback micro-interactions
   ----------------------------------------------------------- */

/** Brief scale "pulse" — use for confirming an action landed (e.g. a saved goal contribution). */
export function pulse(el, { scale = 1.05, duration = 260 } = {}) {
  if (!el || prefersReducedMotion) return;
  el.animate(
    [{ transform: 'scale(1)' }, { transform: `scale(${scale})` }, { transform: 'scale(1)' }],
    { duration, easing: 'ease-out' }
  );
}

/** Horizontal shake — use for invalid form fields instead of just adding .has-error. */
export function shake(el, { distance = 6, duration = 380 } = {}) {
  if (!el || prefersReducedMotion) return;
  el.animate(
    [
      { transform: 'translateX(0)' },
      { transform: `translateX(-${distance}px)` },
      { transform: `translateX(${distance}px)` },
      { transform: `translateX(-${distance / 2}px)` },
      { transform: `translateX(${distance / 2}px)` },
      { transform: 'translateX(0)' },
    ],
    { duration, easing: 'ease-in-out' }
  );
}

/**
 * Draws an SVG checkmark's stroke in from 0 to full length. Expects
 * a <path> or <polyline> passed directly — matches the check icons
 * already used in .form-success and .transfer-success-icon.
 */
export function drawCheckmark(pathEl, { duration = 480 } = {}) {
  if (!pathEl) return;
  const length = pathEl.getTotalLength ? pathEl.getTotalLength() : 100;

  if (prefersReducedMotion) {
    pathEl.style.strokeDasharray = '';
    pathEl.style.strokeDashoffset = '';
    return;
  }

  pathEl.style.strokeDasharray = String(length);
  pathEl.animate(
    [{ strokeDashoffset: length }, { strokeDashoffset: 0 }],
    { duration, easing: 'ease-out', fill: 'forwards' }
  );
}

/** Simple fade-in for a whole page/section root — call on DOMContentLoaded for a softer first paint. */
export function fadeInPage(el = document.body, { duration = 260 } = {}) {
  if (!el || prefersReducedMotion) return;
  el.animate([{ opacity: 0 }, { opacity: 1 }], { duration, easing: 'ease-out' });
}
