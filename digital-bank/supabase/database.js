/* =============================================================
   MERIDIAN — International Digital Banking
   Database module: supabase/database.js

   Thin, typed-in-spirit wrappers around the tables defined in the
   project's schema.sql (accounts, transactions, beneficiaries,
   cards, savings_goals, notifications, support_tickets,
   exchange_rates, user_profiles). Same contract as auth.js: every
   exported function returns a plain { data, error } object, so
   callers never need try/catch for expected failures.

     import { getMyAccounts, createTransfer } from '../supabase/database.js';

   Row Level Security is assumed to scope every table to
   `auth.uid()` server-side — the `userId` params below are for
   convenience and readability, not for access control. Never treat
   client-supplied IDs as a security boundary; RLS is what actually
   enforces "you can only see your own rows."
   ============================================================= */

import { supabase } from './config.js';
import { getCurrentUser } from './auth.js';

/* -----------------------------------------------------------
   Helpers
   ----------------------------------------------------------- */

async function resolveUserId(userId) {
  if (userId) return userId;
  const { data: user } = await getCurrentUser();
  return user?.id ?? null;
}

function wrap(promise) {
  return promise.then(({ data, error }) => ({ data: data ?? null, error: error ? error.message : null }));
}

/* -----------------------------------------------------------
   User profile
   ----------------------------------------------------------- */

/** The signed-in (or given) user's profile row. */
export async function getMyProfile(userId) {
  const uid = await resolveUserId(userId);
  if (!uid) return { data: null, error: 'Not signed in.' };
  return wrap(supabase.from('user_profiles').select('*').eq('id', uid).single());
}

/**
 * Updates arbitrary fields on the signed-in (or given) user's profile.
 * Used right after signUpUser() to save fields it doesn't collect
 * (date_of_birth, nationality, country, two_factor_method,
 * marketing_opt_in), and later by profile.html / settings.html.
 */
export async function updateMyProfile(updates, userId) {
  const uid = await resolveUserId(userId);
  if (!uid) return { data: null, error: 'Not signed in.' };
  return wrap(
    supabase
      .from('user_profiles')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', uid)
      .select()
      .single()
  );
}

/* -----------------------------------------------------------
   Accounts
   ----------------------------------------------------------- */

/** All currency accounts belonging to a user (defaults to the signed-in user). */
export async function getMyAccounts(userId) {
  const uid = await resolveUserId(userId);
  if (!uid) return { data: [], error: 'Not signed in.' };
  return wrap(
    supabase.from('accounts').select('*').eq('user_id', uid).order('created_at', { ascending: true })
  );
}

export async function getAccountById(accountId) {
  return wrap(supabase.from('accounts').select('*').eq('id', accountId).single());
}

/** Sum of every account balance, converted to a target currency using exchange_rates. */
export async function getTotalBalance(userId, displayCurrency = 'USD') {
  const { data: accounts, error } = await getMyAccounts(userId);
  if (error) return { data: null, error };

  let total = 0;
  for (const account of accounts) {
    if (account.currency === displayCurrency) {
      total += Number(account.balance);
      continue;
    }
    const { data: rate } = await getExchangeRate(account.currency, displayCurrency);
    total += Number(account.balance) * (rate?.exchange_rate ?? 1);
  }
  return { data: { total, currency: displayCurrency }, error: null };
}

/* -----------------------------------------------------------
   Opening a new account
   ----------------------------------------------------------- */

const SUPPORTED_CURRENCIES = ['USD', 'EUR', 'GBP', 'SGD', 'JPY', 'NGN', 'CAD', 'AUD', 'CHF'];

/**
 * Demo-friendly, client-side detail generator. Real banking details
 * (IBAN, SWIFT/BIC, routing numbers, sort codes) must come from your
 * banking-as-a-service partner or ledger provider in production —
 * never mint them in the browser. This exists so the "Add currency
 * account" flow on accounts.html has something plausible to show.
 */
function generateAccountDetails(currency) {
  const digits = (n) => String(Math.floor(Math.random() * 10 ** n)).padStart(n, '0');
  const swift = `MRDN${currency.slice(0, 2)}${currency === 'GBP' ? 'LN' : currency.slice(0, 2)}`;

  if (currency === 'EUR') {
    return { account_number: null, iban: `DE89 3704 ${digits(4)} ${digits(4)} ${digits(2)}`, swift_code: swift, sort_code: null };
  }
  if (currency === 'GBP') {
    return { account_number: digits(8), iban: null, swift_code: null, sort_code: `${digits(2)}-${digits(2)}-${digits(2)}` };
  }
  return { account_number: digits(10), iban: null, swift_code: swift, sort_code: null };
}

/**
 * Opens a new currency account for the signed-in (or given) user.
 * Rejects duplicates (same currency + account type already open)
 * and requires a business name for business accounts.
 */
export async function createAccount({ currency, accountType = 'personal', businessName, userId }) {
  const uid = await resolveUserId(userId);
  if (!uid) return { data: null, error: 'Not signed in.' };
  if (!SUPPORTED_CURRENCIES.includes(currency)) return { data: null, error: 'Unsupported currency.' };
  if (accountType === 'business' && !businessName?.trim()) {
    return { data: null, error: 'Business name is required for a business account.' };
  }

  const { data: existing } = await getMyAccounts(uid);
  if (existing.some((a) => a.currency === currency && (a.account_type || 'personal') === accountType)) {
    return { data: null, error: `You already have a ${accountType} ${currency} account.` };
  }

  const details = generateAccountDetails(currency);

  return wrap(
    supabase
      .from('accounts')
      .insert({
        user_id: uid,
        currency,
        balance: 0,
        available_balance: 0,
        account_type: accountType,
        business_name: accountType === 'business' ? businessName.trim() : null,
        ...details,
      })
      .select()
      .single()
  );
}

/* -----------------------------------------------------------
   Beneficiaries
   ----------------------------------------------------------- */

export async function getMyBeneficiaries(userId) {
  const uid = await resolveUserId(userId);
  if (!uid) return { data: [], error: 'Not signed in.' };
  return wrap(
    supabase.from('beneficiaries').select('*').eq('user_id', uid).order('beneficiary_name', { ascending: true })
  );
}

export async function addBeneficiary({ beneficiaryName, bankName, accountNumber, swiftCode, country, userId }) {
  const uid = await resolveUserId(userId);
  if (!uid) return { data: null, error: 'Not signed in.' };
  return wrap(
    supabase
      .from('beneficiaries')
      .insert({
        user_id: uid,
        beneficiary_name: beneficiaryName,
        bank_name: bankName,
        account_number: accountNumber,
        swift_code: swiftCode,
        country,
      })
      .select()
      .single()
  );
}

export async function removeBeneficiary(beneficiaryId) {
  return wrap(supabase.from('beneficiaries').delete().eq('id', beneficiaryId));
}

/* -----------------------------------------------------------
   Recipient lookup (used by transfer.js's new-recipient flow)
   -----------------------------------------------------------
   Tries to auto-identify who an account number/IBAN belongs to,
   without ever exposing another user's full account row:
     1. Check the caller's own saved beneficiaries for a match.
     2. Otherwise check if it belongs to another Meridian user via
        a SECURITY DEFINER RPC (find_account_holder) that returns
        only display_name/bank_name/currency — never an account id.
        (This RPC must exist in your Supabase project; if it
        doesn't yet, this call will resolve to a clean error below
        rather than throwing, so the page still loads.)
   Returns { data: null } (not an error) when nothing matches, so
   the UI can fall back to manual entry.
   ----------------------------------------------------------- */
export async function findRecipient(identifier, { beneficiaries = [] } = {}) {
  const clean = String(identifier || '').replace(/\s+/g, '').toUpperCase();
  if (!clean) return { data: null, error: null };

  const savedMatch = beneficiaries.find(
    (b) => b.account_number && String(b.account_number).replace(/\s+/g, '').toUpperCase() === clean
  );
  if (savedMatch) {
    return { data: { source: 'beneficiary', beneficiary: savedMatch }, error: null };
  }

  const { data, error } = await supabase.rpc('find_account_holder', { p_identifier: clean });
  if (error) return { data: null, error: error.message };
  if (!data) return { data: null, error: null };

  return {
    data: {
      source: 'internal',
      display_name: data.display_name,
      bank_name: data.bank_name || 'Meridian',
      currency: data.currency,
    },
    error: null,
  };
}

/* -----------------------------------------------------------
   Transactions
   ----------------------------------------------------------- */

/**
 * Paginated, filterable transaction history for a single account —
 * mirrors the filter bar on transactions.html (type / status / date range).
 */
export async function getTransactions(accountId, { type, status, from, to, limit = 25, offset = 0 } = {}) {
  let query = supabase
    .from('transactions')
    .select('*', { count: 'exact' })
    .or(`sender_account.eq.${accountId},receiver_account.eq.${accountId}`)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (type && type !== 'all') query = query.eq('transaction_type', type);
  if (status && status !== 'all') query = query.eq('status', status);
  if (from) query = query.gte('created_at', from);
  if (to) query = query.lte('created_at', to);

  const { data, error, count } = await query;
  return { data: data ?? [], error: error ? error.message : null, count: count ?? 0 };
}

export async function getTransactionByReference(reference) {
  return wrap(supabase.from('transactions').select('*').eq('transaction_reference', reference).single());
}

/**
 * Creates an international/internal transfer.
 *
 * IMPORTANT — this is a demo-friendly client-side implementation
 * (insert transaction row, then two balance updates). It is NOT
 * atomic: a failure between the two `accounts` updates can leave
 * balances inconsistent, and concurrent transfers can race each
 * other. For production, replace the balance-update calls below
 * with a single `supabase.rpc('process_transfer', {...})` call to
 * a Postgres function that does the debit, credit, and transaction
 * insert inside one transaction block.
 */
export async function createTransfer({ senderAccountId, receiverAccountId, amount, fee = 0, currency, description }) {
  const reference = `MN-${Math.floor(100000 + Math.random() * 899999)}`;

  const { data: sender, error: senderError } = await getAccountById(senderAccountId);
  if (senderError || !sender) return { data: null, error: senderError || 'Sender account not found.' };

  const totalDebit = Number(amount) + Number(fee);
  if (Number(sender.available_balance) < totalDebit) {
    return { data: null, error: 'Insufficient funds for this transfer.' };
  }

  const { data: transaction, error: txError } = await wrap(
    supabase
      .from('transactions')
      .insert({
        sender_account: senderAccountId,
        receiver_account: receiverAccountId,
        transaction_reference: reference,
        transaction_type: 'transfer',
        amount,
        fee,
        currency,
        description,
        status: 'Processing',
      })
      .select()
      .single()
  );
  if (txError) return { data: null, error: txError };

  await supabase
    .from('accounts')
    .update({ balance: Number(sender.balance) - totalDebit, available_balance: Number(sender.available_balance) - totalDebit })
    .eq('id', senderAccountId);

  if (receiverAccountId) {
    const { data: receiver } = await getAccountById(receiverAccountId);
    if (receiver) {
      await supabase
        .from('accounts')
        .update({ balance: Number(receiver.balance) + Number(amount), available_balance: Number(receiver.available_balance) + Number(amount) })
        .eq('id', receiverAccountId);
    }
  }

  return { data: transaction, error: null };
}

/* -----------------------------------------------------------
   Cards
   ----------------------------------------------------------- */

export async function getCardsForAccount(accountId) {
  return wrap(supabase.from('cards').select('*').eq('account_id', accountId).order('created_at', { ascending: true }));
}

export async function setCardStatus(cardId, status) {
  return wrap(supabase.from('cards').update({ card_status: status }).eq('id', cardId).select().single());
}

export async function setCardDailyLimit(cardId, dailyLimit) {
  return wrap(supabase.from('cards').update({ daily_limit: dailyLimit }).eq('id', cardId).select().single());
}

/* -----------------------------------------------------------
   Card issuance (demo-friendly, client-side — see the note on
   generateAccountDetails() above createAccount() for why this
   isn't how you'd do it in production)
   ----------------------------------------------------------- */
function generateCardNumber(cardType) {
  const prefix = cardType === 'credit' ? '5' : '4'; // Mastercard-ish vs Visa-ish, cosmetic only
  const digits = (n) => String(Math.floor(Math.random() * 10 ** n)).padStart(n, '0');
  return `${prefix}${digits(15)}`;
}

export async function createCard({ accountId, cardType = 'debit', cardHolder, dailyLimit = 1000 }) {
  if (!accountId) return { data: null, error: 'Choose an account for this card.' };
  if (!cardHolder?.trim()) return { data: null, error: 'Cardholder name is required.' };

  const now = new Date();
  const expiry = new Date(now.getFullYear() + 4, now.getMonth());

  return wrap(
    supabase
      .from('cards')
      .insert({
        account_id: accountId,
        card_number: generateCardNumber(cardType),
        card_type: cardType,
        card_holder: cardHolder.trim(),
        expiry_month: expiry.getMonth() + 1,
        expiry_year: expiry.getFullYear(),
        card_status: 'Pending',
        daily_limit: dailyLimit,
      })
      .select()
      .single()
  );
}

/* -----------------------------------------------------------
   Savings goals
   ----------------------------------------------------------- */

export async function getSavingsGoals(accountId) {
  return wrap(supabase.from('savings_goals').select('*').eq('account_id', accountId).order('created_at', { ascending: true }));
}

export async function createSavingsGoal({ accountId, goalName, targetAmount, targetDate }) {
  return wrap(
    supabase
      .from('savings_goals')
      .insert({ account_id: accountId, goal_name: goalName, target_amount: targetAmount, current_amount: 0, target_date: targetDate })
      .select()
      .single()
  );
}

/** Adds to (or, with a negative amount, withdraws from) a goal's saved total. */
export async function contributeToGoal(goalId, amount) {
  const { data: goal, error } = await wrap(supabase.from('savings_goals').select('current_amount').eq('id', goalId).single());
  if (error || !goal) return { data: null, error: error || 'Goal not found.' };

  const newAmount = Math.max(0, Number(goal.current_amount) + Number(amount));
  return wrap(supabase.from('savings_goals').update({ current_amount: newAmount }).eq('id', goalId).select().single());
}

/* -----------------------------------------------------------
   Notifications
   ----------------------------------------------------------- */

export async function getNotifications(userId, { limit = 20 } = {}) {
  const uid = await resolveUserId(userId);
  if (!uid) return { data: [], error: 'Not signed in.' };
  return wrap(
    supabase
      .from('notifications')
      .select('*')
      .eq('user_id', uid)
      .order('created_at', { ascending: false })
      .limit(limit)
  );
}

export async function getUnreadNotificationCount(userId) {
  const uid = await resolveUserId(userId);
  if (!uid) return { data: 0, error: 'Not signed in.' };
  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', uid)
    .eq('is_read', false);
  return { data: count ?? 0, error: error ? error.message : null };
}

export async function markNotificationRead(notificationId) {
  return wrap(supabase.from('notifications').update({ is_read: true }).eq('id', notificationId).select().single());
}

export async function markAllNotificationsRead(userId) {
  const uid = await resolveUserId(userId);
  if (!uid) return { data: null, error: 'Not signed in.' };
  return wrap(supabase.from('notifications').update({ is_read: true }).eq('user_id', uid).eq('is_read', false));
}

/* -----------------------------------------------------------
   Support tickets
   ----------------------------------------------------------- */

export async function createSupportTicket({ subject, message, priority = 'Normal', userId }) {
  const uid = await resolveUserId(userId);
  if (!uid) return { data: null, error: 'Not signed in.' };
  return wrap(
    supabase
      .from('support_tickets')
      .insert({ user_id: uid, subject, message, priority, status: 'Open' })
      .select()
      .single()
  );
}

export async function getMySupportTickets(userId) {
  const uid = await resolveUserId(userId);
  if (!uid) return { data: [], error: 'Not signed in.' };
  return wrap(
    supabase.from('support_tickets').select('*').eq('user_id', uid).order('created_at', { ascending: false })
  );
}

/* -----------------------------------------------------------
   Exchange rates
   ----------------------------------------------------------- */

/** Latest stored rate for a currency pair. Returns { exchange_rate: 1 } if the pair isn't found. */
export async function getExchangeRate(baseCurrency, targetCurrency) {
  if (baseCurrency === targetCurrency) return { data: { exchange_rate: 1 }, error: null };

  const { data, error } = await supabase
    .from('exchange_rates')
    .select('*')
    .eq('base_currency', baseCurrency)
    .eq('target_currency', targetCurrency)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return { data: { exchange_rate: 1 }, error: error.message };
  return { data: data || { exchange_rate: 1 }, error: null };
}

export async function getAllExchangeRates(baseCurrency = 'USD') {
  return wrap(supabase.from('exchange_rates').select('*').eq('base_currency', baseCurrency));
}
