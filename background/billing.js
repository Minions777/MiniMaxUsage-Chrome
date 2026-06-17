// MiniMax Token Monitor - Billing Cache Logic
// Token consumption statistics: caching, expiry, and refresh.

/**
 * Load cached billing records. Returns [] if cache is missing or expired.
 * Callers should check for empty result and trigger a force refresh if needed.
 */
async function loadCachedBilling() {
  const { [BILLING_CACHE_KEY]: cache } =
    await chrome.storage.local.get(BILLING_CACHE_KEY);
  if (!cache || !cache.records) return [];
  if (Date.now() - (cache.fetchedAt || 0) > BILLING_CACHE_TTL_MS) {
    return []; // Expired — caller should force-refresh
  }
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