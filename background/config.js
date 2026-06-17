// MiniMax Token Monitor - Configuration Constants
// Shared constants used across all background modules.

const STORAGE_KEYS = {
  API_KEY: 'minimax_api_key',
  ENDPOINT: 'minimax_endpoint',
  AUTO_REFRESH_INTERVAL: 'minimax_auto_refresh_interval',
  AUTO_REFRESH_ENABLED: 'minimax_auto_refresh_enabled',
  NOTIFICATIONS_ENABLED: 'minimax_notifications_enabled',
  NOTIFY_THRESHOLD: 'minimax_notify_threshold',
  NOTIFIED_WINDOW_KEYS: 'minimax_notified_window_keys',
  HISTORY: 'minimax_usage_history',
  LAST_USAGE: 'minimax_last_usage',
  LAST_FETCH_AT: 'minimax_last_fetch_at',
  LOGS: 'minimax_logs',
  // [Task-6] Dedicated key for history dedup — decoupled from LAST_USAGE
  LAST_WINDOW_KEY: 'minimax_last_window_key',
};

// Desktop notification default threshold (notify when remaining% < this value)
const DEFAULT_NOTIFY_THRESHOLD = 10;
// Max number of recent notified window keys to keep (prevents notification spam)
const NOTIFIED_KEYS_LIMIT = 10;

// Throttle window for main usage fetch (ms). If a fetch was done within this
// interval, return cached data instead of hitting the API again.
const USAGE_REFRESH_THROTTLE_MS = 60_000;
// Billing (Token consumption) cache TTL — 30 minutes.
// Billing changes slowly; no need to refresh it as frequently as quota data.
const BILLING_CACHE_TTL_MS = 30 * 60 * 1000;
const BILLING_CACHE_KEY = 'minimax_billing_cache';

const ENDPOINTS = {
  china: {
    name: '🇨🇳 China',
    baseURL: 'https://www.minimaxi.com',
    remainsPath: '/v1/api/openplatform/coding_plan/remains',
    subscriptionPath: '/v1/api/openplatform/charge/combo/cycle_audio_resource_package?biz_line=2&cycle_type=1&resource_package_type=7',
    billingPath: '/account/amount',
  },
  international: {
    name: '🌏 International',
    baseURL: 'https://api.minimax.io',
    remainsPath: '/v1/api/openplatform/coding_plan/remains',
    subscriptionPath: '/v1/api/openplatform/charge/combo/cycle_audio_resource_package?biz_line=2&cycle_type=1&resource_package_type=7',
    billingPath: '/account/amount',
  },
};