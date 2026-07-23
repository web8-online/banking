// =============================================================
// MERIDIAN — supabase/functions/refresh-crypto-prices/index.ts
//
// Called by database.js's getMarketPrices() whenever the browser
// finds market_prices_cache is empty or stale (>2 min old). Fetches
// current prices from CoinGecko's public /coins/markets endpoint
// and upserts them into market_prices_cache using the service_role
// key — the ONLY writer this table's RLS policy allows.
//
// IMPORTANT — CORS:
// Every response path (including errors, and the OPTIONS preflight
// itself) must include the CORS headers below. A function that only
// adds CORS headers on the "happy path" will look like a CORS error
// in the browser the moment it throws — the browser reports the
// missing headers, not your actual error, which is exactly the
// "preflight doesn't have HTTP ok status" symptom.
//
// DEPLOY:
//   supabase functions deploy refresh-crypto-prices --no-verify-jwt
//
// The --no-verify-jwt flag matters. By default Supabase Edge
// Functions require a valid Authorization header, and the runtime
// enforces this on the OPTIONS preflight too — before your code
// runs — which rejects the preflight with 401 and shows up in the
// browser as a CORS failure. Since this function only ever reads
// public market data and writes with its own service_role key (not
// the caller's), it doesn't need to verify the caller's JWT at all.
// If you'd rather keep verify_jwt on, that's fine too — just know
// the client call must then include the user's access token, which
// supabase.functions.invoke() does automatically when the user is
// signed in; the risk is purely with the preflight step described
// above depending on your CLI/project version.
// =============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Top N coins by market cap. Adjust as needed — CoinGecko's public
// tier rate-limits around 10-30 req/min, so keep this to one call.
const COINGECKO_URL =
  'https://api.coingecko.com/api/v3/coins/markets' +
  '?vs_currency=usd&order=market_cap_desc&per_page=100&page=1' +
  '&price_change_percentage=24h&sparkline=false';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  // Preflight — must return 2xx with the CORS headers, nothing else.
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: CORS_HEADERS });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in function env.' }, 500);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const cgRes = await fetch(COINGECKO_URL, {
      headers: { Accept: 'application/json' },
    });

    if (!cgRes.ok) {
      const detail = await cgRes.text().catch(() => '');
      return jsonResponse(
        { error: `CoinGecko request failed (${cgRes.status}). ${detail.slice(0, 200)}` },
        502
      );
    }

    const coins = await cgRes.json();
    if (!Array.isArray(coins)) {
      return jsonResponse({ error: 'Unexpected CoinGecko response shape.' }, 502);
    }

    const rows = coins.map((c: Record<string, unknown>) => ({
      symbol: String(c.symbol).toUpperCase(),
      name: c.name,
      current_price: c.current_price,
      price_change_percentage_24h: c.price_change_percentage_24h,
      market_cap: c.market_cap,
      image_url: c.image,
      updated_at: new Date().toISOString(),
    }));

    const { error: upsertError } = await supabase
      .from('market_prices_cache')
      .upsert(rows, { onConflict: 'symbol' });

    if (upsertError) {
      return jsonResponse({ error: upsertError.message }, 500);
    }

    return jsonResponse({ ok: true, updated: rows.length });
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : 'Unknown error' }, 500);
  }
});
