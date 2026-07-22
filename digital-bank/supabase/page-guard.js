/* =============================================================
   MERIDIAN — International Digital Banking
   supabase/page-guard.js

   This file used to contain its own implementation of the "is this
   visitor actually signed in" check, separate from requireAuth() in
   supabase/auth.js. That's why accounts.js and settings.js ended up
   trusting two different auth checks that could silently drift
   apart — exactly what happened with assets/js/auth-guard.js's
   pre-check earlier.

   There is now exactly one implementation: requireAuth() in
   supabase/auth.js. This file is kept only so that pages already
   written against guardPage() — like settings.js — don't need to
   change their import. New pages should just import requireAuth()
   from supabase/auth.js directly instead of adding a new name here.

     import { guardPage } from '../supabase/page-guard.js';
     const user = await guardPage();
     if (!user) return; // already redirected to login.html

   guardPage() and requireAuth() are the same function — same
   behavior, same redirect, same page-reveal handling. If you ever
   need to change what "signed in" means (session checks, MFA
   requirements, etc.), change it once in auth.js; both names pick
   it up automatically.
   ============================================================= */

export { requireAuth as guardPage } from './auth.js';
