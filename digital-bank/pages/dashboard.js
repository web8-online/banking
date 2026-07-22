/* =============================================================
   MERIDIAN — Dashboard / overview page
   Script: pages/dashboard.js
   Loaded as a module by dashboard.html only. Handles:
     1. Auth guard (redirect to login if no session)
     2. Personalized greeting from the signed-in user's profile
     3. Notification badge count
     4. User menu dropdown (open/close, outside-click, Escape)
     5. Log out
   ============================================================= */

import { requireAuth, signOutUser } from '../supabase/auth.js';
import { getMyProfile, getUnreadNotificationCount } from '../supabase/database.js';

const $ = (selector, scope) => (scope || document).querySelector(selector);

/* -----------------------------------------------------------
   Greeting — replaces the static "Good morning, Amara." with
   the signed-in user's actual first name and a time-of-day
   greeting, once their profile has loaded.
   ----------------------------------------------------------- */
function timeOfDayGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

async function populateGreeting() {
  const heading = $('.dashboard-head h1');
  if (!heading) return;

  const { data: profile } = await getMyProfile();
  const firstName = profile?.first_name;
  heading.textContent = `${timeOfDayGreeting()}${firstName ? `, ${firstName}` : ''}.`;
}

/* -----------------------------------------------------------
   Notification badge — reflects the real unread count instead
   of the static "2" in the markup. Hides the badge entirely
   when there's nothing unread.
   ----------------------------------------------------------- */
async function populateNotificationBadge() {
  const badge = $('.app-icon-btn-badge');
  if (!badge) return;

  const { data: count } = await getUnreadNotificationCount();
  if (!count) {
    badge.style.display = 'none';
    return;
  }
  badge.textContent = count > 9 ? '9+' : String(count);
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
    if (menu.classList.contains('is-open')) close();
    else open();
  });
}

/* -----------------------------------------------------------
   Log out — replaces the dropdown's static "Log out" link
   (currently just `href="../index.html"`) with a real sign-out
   call, so the Supabase session actually ends before leaving.
   ----------------------------------------------------------- */
function initLogout() {
  const logoutLink = $('.app-user-dropdown a[href="../index.html"]');
  if (!logoutLink) return;

  logoutLink.addEventListener('click', async (event) => {
    event.preventDefault();
    await signOutUser();
    window.location.href = logoutLink.getAttribute('href');
  });
}

/* -----------------------------------------------------------
   Init
   ----------------------------------------------------------- */
(async function init() {
  const user = await requireAuth();
  if (!user) return; // requireAuth() already redirected to login.html

  populateGreeting();
  populateNotificationBadge();
  initUserMenu();
  initLogout();
})();
