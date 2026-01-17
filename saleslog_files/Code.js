/**
 * Code.js
 * Backend logic for the "Round Robin Analytics Dashboard".
 * Serves the HTML and processes audit data.
 */

// -----------------------------------------------------------------------------
// WEB APP SERVING
// -----------------------------------------------------------------------------

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * Serves the dashboard HTML.
 */
function doGet(e) {
  return HtmlService.createTemplateFromFile('dashboard')
    .evaluate()
    .setTitle('Live Round Robin Dashboard')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL) // Crucial for embedding
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// -----------------------------------------------------------------------------
// API / DATA FETCHING
// -----------------------------------------------------------------------------

/**
 * Main API called by the frontend to get fresh dashboard data.
 * Returns { stats: {}, feed: [], leaderboard: [] }
 *
 * Caching Strategy (Cache-Aside):
 * 1) Attempt to read a previously computed payload from CacheService.
 * 2) On cache miss (or cache read/parse error), compute from Spreadsheet data.
 * 3) Store the computed payload back into cache with a configurable TTL.
 *
 * Notes on "async":
 * - Google Apps Script executes server-side code synchronously.
 * - Multiple executions can run concurrently (e.g., multiple viewers refreshing).
 *   We use LockService on cache-miss to reduce duplicate recomputation.
 */
function getDashboardData() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const cache = CacheService.getScriptCache();
    const cacheKey = getDashboardCacheKey_(ss);
    const ttlSeconds = getDashboardCacheTtlSeconds_();

    // 1) Cache read (best-effort). Any cache error should fall back to sheet reads.
    const cachedPayload = getCachedDashboardData_(cache, cacheKey);
    if (cachedPayload) {
      return cachedPayload;
    }

    // 2) Cache miss: use a lock to reduce duplicate recomputation across concurrent executions.
    //    This is especially useful when multiple users have the dashboard open.
    const lock = LockService.getScriptLock();
    const lockAcquired = tryAcquireDashboardLock_(lock);

    if (lockAcquired) {
      try {
        // Double-check cache after acquiring lock (another execution may have populated it).
        const cachedAfterLock = getCachedDashboardData_(cache, cacheKey);
        if (cachedAfterLock) {
          return cachedAfterLock;
        }

        const fresh = computeDashboardDataFromSpreadsheet_(ss);
        setCachedDashboardData_(cache, cacheKey, fresh, ttlSeconds);
        return fresh;
      } finally {
        releaseDashboardLock_(lock);
      }
    }

    // 3) If lock is busy, another execution is likely computing. Do a short wait and re-check.
    //    If still missing, compute without lock so we can still respond quickly.
    Utilities.sleep(150);
    const cachedAfterWait = getCachedDashboardData_(cache, cacheKey);
    if (cachedAfterWait) {
      return cachedAfterWait;
    }

    const fresh = computeDashboardDataFromSpreadsheet_(ss);
    setCachedDashboardData_(cache, cacheKey, fresh, ttlSeconds);
    return fresh;
  } catch (err) {
    return { error: err.toString() };
  }
}

/** Returns a stable cache key for the current spreadsheet context. */
function getDashboardCacheKey_(ss) {
  // Include Spreadsheet ID for safety in case this code is reused in multiple containers.
  const spreadsheetId = ss && typeof ss.getId === 'function' ? ss.getId() : 'unknown';
  return `rr_dashboard_data::${spreadsheetId}::v1`;
}

/** Returns the cache TTL in seconds (configurable via Script Properties). */
function getDashboardCacheTtlSeconds_() {
  // Script Property name: RR_DASHBOARD_CACHE_TTL_SECONDS
  // Default: 30 seconds (aligned with frontend refresh interval)
  // Clamp: 5s..600s to avoid extreme values.
  const DEFAULT_TTL = 30;
  const MIN_TTL = 5;
  const MAX_TTL = 600;

  try {
    const raw = PropertiesService.getScriptProperties().getProperty(
      'RR_DASHBOARD_CACHE_TTL_SECONDS'
    );
    if (!raw) return DEFAULT_TTL;

    const parsed = Number(raw);
    if (!isFinite(parsed)) return DEFAULT_TTL;
    return Math.min(MAX_TTL, Math.max(MIN_TTL, Math.floor(parsed)));
  } catch (e) {
    // If Script Properties isn't available for any reason, fall back safely.
    try {
      logWarning('getDashboardCacheTtlSeconds_', 'Failed to read TTL property', {
        error: e.toString(),
      });
    } catch (_) {
      Logger.log('getDashboardCacheTtlSeconds_ warning: ' + e);
    }
    return DEFAULT_TTL;
  }
}

/** Best-effort cache read + parse + validation. Returns null on miss/error. */
function getCachedDashboardData_(cache, cacheKey) {
  let cachedStr = null;
  try {
    cachedStr = cache.get(cacheKey);
  } catch (e) {
    // Cache read errors must NOT fail the request.
    try {
      logWarning('getDashboardData', 'Cache get failed; falling back to sheets', {
        cacheKey,
        error: e.toString(),
      });
    } catch (_) {
      Logger.log('Dashboard cache get failed: ' + e);
    }
    return null;
  }

  if (!cachedStr) return null;

  const parsed = safeJsonParse_(cachedStr);
  if (!isValidDashboardData_(parsed)) {
    // Treat as miss if shape is wrong.
    return null;
  }

  return parsed;
}

/** Best-effort cache write. Never throws. */
function setCachedDashboardData_(cache, cacheKey, payload, ttlSeconds) {
  try {
    const json = JSON.stringify(payload);

    // Script cache values have size limits. If too large, skip caching (non-fatal).
    // Keep conservative headroom to avoid errors.
    const MAX_CHARS = 90000;
    if (json.length > MAX_CHARS) {
      try {
        logWarning('getDashboardData', 'Dashboard payload too large for cache; skipping cache put', {
          cacheKey,
          sizeChars: json.length,
          maxChars: MAX_CHARS,
        });
      } catch (_) {
        Logger.log('Dashboard payload too large for cache: ' + json.length);
      }
      return;
    }

    cache.put(cacheKey, json, ttlSeconds);
  } catch (e) {
    // Cache write errors are non-fatal.
    try {
      logWarning('getDashboardData', 'Cache put failed; continuing without cache', {
        cacheKey,
        ttlSeconds,
        error: e.toString(),
      });
    } catch (_) {
      Logger.log('Dashboard cache put failed: ' + e);
    }
  }
}

/** Returns true if the lock is acquired; false if busy/error. */
function tryAcquireDashboardLock_(lock) {
  try {
    // Keep lock wait short so UI stays responsive.
    return lock.tryLock(2000);
  } catch (e) {
    try {
      logWarning('getDashboardData', 'Lock acquisition failed; proceeding without lock', {
        error: e.toString(),
      });
    } catch (_) {
      Logger.log('Dashboard lock acquisition failed: ' + e);
    }
    return false;
  }
}

/** Releases lock best-effort; never throws. */
function releaseDashboardLock_(lock) {
  try {
    lock.releaseLock();
  } catch (e) {
    try {
      logWarning('getDashboardData', 'Lock release failed', { error: e.toString() });
    } catch (_) {
      Logger.log('Dashboard lock release failed: ' + e);
    }
  }
}

/** Safe JSON.parse that never throws. */
function safeJsonParse_(str) {
  try {
    return JSON.parse(str);
  } catch (e) {
    try {
      logWarning('getDashboardData', 'Cache JSON parse failed; treating as miss', {
        error: e.toString(),
      });
    } catch (_) {
      Logger.log('Dashboard cache JSON parse failed: ' + e);
    }
    return null;
  }
}

/** Shape validation to avoid returning corrupted/partial cache entries. */
function isValidDashboardData_(obj) {
  if (!obj || typeof obj !== 'object') return false;
  if (!obj.stats || typeof obj.stats !== 'object') return false;
  if (!Array.isArray(obj.feed)) return false;
  if (!Array.isArray(obj.leaderboard)) return false;
  return true;
}

function getAuditActions_() {
  if (typeof AUDIT_ACTIONS !== 'undefined') return AUDIT_ACTIONS;
  return {
    NEW_APPOINTMENT: 'Assignment',
    REASSIGNMENT: 'Reassignment',
    MANUAL_OVERRIDE: 'Manual Override',
    PHONE_LEAD: 'Phone Lead',
    UNDO: 'Undo',
    POINTER_RESET: 'Pointer Reset',
  };
}

/**
 * Primary data source read/compute for dashboard.
 * Kept separate from caching for clarity and testability.
 */
function computeDashboardDataFromSpreadsheet_(ss) {
  const actions = getAuditActions_();

  // ---------------------------------------------------------
  // STEP 1: USER MAP (Strict Sheet Access)
  // Source: Sheet 'RR_USERS' (Direct access, no named ranges)
  // ---------------------------------------------------------
  const userMap = {};
  const usersSheet = ss.getSheetByName('RR_USERS');

  if (usersSheet) {
    const data = usersSheet.getDataRange().getValues();

    // Loop through all rows (safe to check all; sheet is expected to be small).
    for (let i = 0; i < data.length; i++) {
      const row = data[i];

      // Safety: Ensure row has at least 4 columns (Indices 0-3)
      if (row.length >= 4) {
        const name = String(row[0]).trim(); // Column A (Index 0)
        const email = String(row[3]).trim().toLowerCase(); // Column D (Index 3)

        if (email && name && email.includes('@')) {
          userMap[email] = name;
        }
      }
    }
  }

  // ---------------------------------------------------------
  // STEP 2: INITIALIZE LEADERBOARD (repStats)
  // Source: RR_ROSTER (Col A=Name) - Initialize everyone to 0
  // ---------------------------------------------------------
  const repStats = {};
  const rosterSheet = ss.getSheetByName('RR_ROSTER');
  if (rosterSheet) {
    const lastRow = rosterSheet.getLastRow();
    if (lastRow > 1) {
      const rosterData = rosterSheet.getRange(2, 1, lastRow - 1, 1).getValues();
      rosterData.forEach((r) => {
        const name = String(r[0]).trim();
        if (name) {
          repStats[name] = 0;
        }
      });
    }
  }

  // ---------------------------------------------------------
  // STEP 3: FETCH & PROCESS LOGS
  // ---------------------------------------------------------
  const auditSheet = ss.getSheetByName('RR_AUDIT');
  if (!auditSheet) {
    return {
      stats: { totalAssignments: 0, manualOverrides: 0, activeUsersCount: 0 },
      feed: [],
      leaderboard: [],
      lastUpdated: new Date().toLocaleTimeString(),
    };
  }

  const lastAuditRow = auditSheet.getLastRow();
  const MAX_ROWS = 1000;
  let startRow = 2;
  if (lastAuditRow > MAX_ROWS) {
    startRow = lastAuditRow - MAX_ROWS + 1;
  }

  let logData = [];
  if (lastAuditRow >= 2) {
    const numRows = lastAuditRow - startRow + 1;
    // Col A=Timestamp, B=User, C=Action, D=Reference, E=Details
    logData = auditSheet.getRange(startRow, 1, numRows, 5).getValues();
  }

  // Setup for aggregation
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const stats = {
    totalAssignments: 0,
    manualOverrides: 0,
    activeUsersCount: 0,
  };

  const feed = [];
  const activeActors = new Set();

  // Process logs in reverse (Newest First)
  for (let i = logData.length - 1; i >= 0; i--) {
    const row = logData[i];
    const ts = new Date(row[0]);
    const userEmail = String(row[1]).trim().toLowerCase();
    const action = String(row[2]);
    const reference = String(row[3]);
    const detailsRaw = String(row[4]);

    const isToday = ts >= today;

    // 1) Resolve Actor Name using USER_MAP (fallback if unknown)
    const actorName = userMap[userEmail] || mapEmailFallback_(userEmail);

    // 2) Parse Details
    const details = parseDetailsString_(detailsRaw);

    if (isToday) {
      // Manual Actions
      const lowerAction = action.toLowerCase();
      if (
        action === actions.REASSIGNMENT ||
        action === actions.MANUAL_OVERRIDE ||
        lowerAction.includes('reassign') ||
        lowerAction.includes('override')
      ) {
        stats.manualOverrides++;
      }

      // Assignments & Leaderboard
      if (action === actions.NEW_APPOINTMENT || action === 'Assignment') {
        stats.totalAssignments++;
        const assignee = details['assignee'];
        if (assignee) {
          if (repStats[assignee] === undefined) {
            repStats[assignee] = 0;
          }
          repStats[assignee]++;
        }
      }

      // Active Users (Actors)
      if (userEmail) activeActors.add(userEmail);
    }

    // Feed Construction (Limit 50)
    if (feed.length < 50) {
      feed.push({
        time: formatTime_(ts),
        actor: actorName,
        action: action,
        details: details,
        message: buildFeedMessage_(actorName, action, details, reference),
        isToday: isToday,
      });
    }
  }

  // ---------------------------------------------------------
  // STEP 4: RESULT OBJECT
  // ---------------------------------------------------------
  const leaderboard = Object.keys(repStats).map((name) => ({
    name: name,
    count: repStats[name],
  }));

  leaderboard.sort((a, b) => b.count - a.count);
  stats.activeUsersCount = activeActors.size;

  return {
    stats: stats,
    feed: feed,
    leaderboard: leaderboard,
    lastUpdated: new Date().toLocaleTimeString(),
  };
}

// -----------------------------------------------------------------------------
// HELPERS
// -----------------------------------------------------------------------------

/**
 * Parses "key=value | key2=value2" into an object.
 */
function parseDetailsString_(str) {
  if (!str) return {};
  if (!str.includes('=')) return { raw: str };

  const obj = {};
  const parts = str.split('|');

  parts.forEach(part => {
    const split = part.split('=');
    if (split.length >= 2) {
      const key = split[0].trim();
      // Join rest in case value has = in it, though unlikely with our sanitizer
      const val = split.slice(1).join('=').trim();
      obj[key] = val;
    }
  });
  return obj;
}

/**
 * Backup mapper if email not in named range
 */
function mapEmailFallback_(email) {
  if (!email) return 'Unknown';
  if (email.includes('@')) {
    // rbianco@stingray... -> rbianco -> Ryan B? No just capitalize first letter maybe
    const local = email.split('@')[0];
    return local.charAt(0).toUpperCase() + local.slice(1);
  }
  return email;
}

function formatTime_(dateObj) {
  if (!dateObj || isNaN(dateObj.getTime())) return '';
  return dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function buildFeedMessage_(actor, action, details, reference) {
  const actions = getAuditActions_();
  if (action === actions.NEW_APPOINTMENT || action === 'Assignment') {
    return `${details.assignee || 'Someone'} received a lead.`;
  }
  if (action === actions.PHONE_LEAD) {
    return `${details.assignee || 'Someone'} received a phone lead.`;
  }
  if (action === actions.UNDO) {
    const target = details.target || details.type || 'action';
    return `Undo performed on ${target}.`;
  }
  if (
    action === actions.REASSIGNMENT ||
    action === actions.MANUAL_OVERRIDE ||
    action.includes('Override') ||
    action.includes('Reassign')
  ) {
    const target = details.newAssignee || details.assignee || 'someone';
    return `Manual action affecting ${target}.`;
  }
  // Default
  const raw = details.raw || Object.keys(details).map(k => `${k}:${details[k]}`).join(' ');
  return `${reference ? reference + ' - ' : ''}${raw}`;
}
