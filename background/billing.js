// MiniMax Token Monitor - Billing Cache Logic
// Token consumption statistics: caching, expiry, and refresh.
// Freshness decision delegated to pure isBillingCacheFresh (lib/utils.js) so
// tests exercise the real TTL logic instead of re-deriving it.

/**
 * Load cached billing records. Returns [] if cache is missing, has no records,
 * or is expired (per BILLING_CACHE_TTL_MS). Callers should check for empty
 * result and trigger a force refresh if needed.
 */
async function loadCachedBilling() {
  const { [BILLING_CACHE_KEY]: cache } =
    await chrome.storage.local.get(BILLING_CACHE_KEY);
  if (!isBillingCacheFresh(cache, BILLING_CACHE_TTL_MS)) return [];
  return cache.records;
}

/**
 * Fetch billing records from API and cache them with a timestamp.
 * Returns the fresh records array.
 */
async function fetchAndCacheBilling(apiKey, endpoint) {
  const records = await fetchAllBillingRecords(apiKey, endpoint);
  await chrome.storage.local.set({
    [BILLING_CACHE_KEY]: { records, fetchedAt: Date.now() },
  });
  return records;
}
