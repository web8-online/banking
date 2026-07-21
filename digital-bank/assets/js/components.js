/* =============================================================
   MERIDIAN — International Digital Banking
   Components loader: components/components.js (imported by
   assets/js/main.js on every page)

   Public marketing pages and logged-in app pages currently repeat
   the header/footer markup by hand in every .html file. This module
   lets a page opt into loading it from a shared partial instead:

     <div data-component="navbar"></div>
     ...
     <div data-component="footer"></div>

     <script type="module">
       import { loadComponents } from '../components/components.js';
       loadComponents();
     </script>

   It fetches the partial's HTML, injects it in place of the
   placeholder, marks the current page's nav link active, and fires
   a `component:loaded` event so other modules (auth-ui.js) can hook
   in once the real DOM exists.
   ============================================================= */

/* -----------------------------------------------------------
   Manifest — which placeholder loads which partial.
   Paths are relative to the page importing this module, so pages
   under /pages/ and the root index.html both resolve correctly
   because each page's own <script> passes its own base if needed.
   ----------------------------------------------------------- */
const COMPONENT_MAP = {
  navbar: 'navbar.html',       // public marketing header (index.html)
  footer: 'footer.html',       // public marketing footer (index.html)
  'app-navbar': 'app-navbar.html', // logged-in app header (dashboard.html, etc.)
};

/**
 * Resolves the components/ directory relative to the current page,
 * so this one file works whether it's imported from / or /pages/.
 */
function resolveComponentsBase() {
  const path = window.location.pathname;
  const inPagesDir = path.includes('/pages/');
  return inPagesDir ? '../components/' : 'components/';
}

/**
 * Fetches a single partial and injects it into the matching
 * [data-component] placeholder. Leaves the placeholder untouched
 * (with a console warning) if the fetch fails, rather than
 * breaking the rest of the page.
 */
async function injectComponent(el, name, base) {
  const file = COMPONENT_MAP[name];
  if (!file) {
    console.warn(`[Meridian] Unknown component "${name}" — skipping.`);
    return;
  }

  try {
    const response = await fetch(`${base}${file}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html = await response.text();

    const wrapper = document.createElement('div');
    wrapper.innerHTML = html.trim();

    // Replace the placeholder with the partial's real top-level element(s)
    // so the injected markup isn't nested inside an extra <div>.
    const fragment = document.createDocumentFragment();
    Array.from(wrapper.childNodes).forEach((node) => fragment.appendChild(node));

    el.replaceWith(fragment);
  } catch (err) {
    console.warn(`[Meridian] Failed to load component "${name}" (${file}):`, err.message);
  }
}

/** Adds `.is-active` / `aria-current="page"` to whichever nav link matches the current page. */
function markActiveNavLink() {
  const currentFile = window.location.pathname.split('/').pop() || 'index.html';

  document.querySelectorAll('.nav-links a, .app-nav a, .mobile-drawer-links a').forEach((link) => {
    const href = link.getAttribute('href') || '';
    const linkFile = href.split('/').pop().split('#')[0];

    if (linkFile && linkFile === currentFile) {
      link.classList.add('is-active');
      link.setAttribute('aria-current', 'page');
    } else {
      link.classList.remove('is-active');
      link.removeAttribute('aria-current');
    }
  });
}

/**
 * Finds every [data-component] placeholder on the page, loads its
 * partial, then marks the active nav link and dispatches
 * `component:loaded` on `document` once everything has settled —
 * auth-ui.js listens for this before touching header elements.
 */
export async function loadComponents() {
  const placeholders = Array.from(document.querySelectorAll('[data-component]'));
  if (!placeholders.length) return;

  const base = resolveComponentsBase();

  await Promise.all(
    placeholders.map((el) => injectComponent(el, el.getAttribute('data-component'), base))
  );

  markActiveNavLink();
  document.dispatchEvent(new CustomEvent('component:loaded'));
}

/** Re-runs active-link detection — handy if a page changes hash/history without a full reload. */
export function refreshActiveNavLink() {
  markActiveNavLink();
}
