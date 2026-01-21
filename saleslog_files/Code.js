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
 * Returns { meta, groupTotals, bdcReps, salesRoster, debug }
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
  return `rr_dashboard_data::${spreadsheetId}::v2`;
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
  if (!obj.meta || typeof obj.meta !== 'object') return false;
  if (!obj.groupTotals || typeof obj.groupTotals !== 'object') return false;
  if (!obj.groupTotals.bdc || typeof obj.groupTotals.bdc !== 'object') return false;
  if (!Array.isArray(obj.bdcReps)) return false;
  if (!Array.isArray(obj.salesRoster)) return false;
  if (!obj.debug || typeof obj.debug !== 'object') return false;
  if (!Array.isArray(obj.debug.warnings)) return false;
  if (!Array.isArray(obj.debug.sources)) return false;
  return true;
}

function getAuditActions_() {
  if (typeof AUDIT_ACTIONS !== 'undefined') return AUDIT_ACTIONS;
  return {
    NEW_APPOINTMENT: 'New Appointment',
    REASSIGNMENT: 'Reassignment',
    MANUAL_OVERRIDE: 'Manual Override',
    PHONE_LEAD: 'Phone Lead',
    UNDO: 'Undo',
    POINTER_RESET: 'Pointer Reset',
    POINTER_MANUAL_EDIT: 'Pointer Manual Edit',
  };
}

/**
 * Primary data source read/compute for dashboard.
 * Kept separate from caching for clarity and testability.
 */
function computeDashboardDataFromSpreadsheet_(ss) {
  const spreadsheet = ss || SpreadsheetApp.getActiveSpreadsheet();
  const actions = getAuditActions_();
  const tz = Session.getScriptTimeZone();
  const now = new Date();
  const windowStart = new Date(now);
  windowStart.setHours(0, 0, 0, 0);
  const windowEnd = new Date(windowStart);
  windowEnd.setDate(windowEnd.getDate() + 1);

  const warnings = [];
  const warningSet = new Set();
  const sources = [];

  const userData = getUsersData_(spreadsheet);
  if (!userData.sheetFound) {
    addWarning_(warnings, warningSet, `Users sheet "${userData.sheetName}" not found.`);
  } else {
    sources.push({ sheet: userData.sheetName, rows: userData.rows });
  }

  const bdcRepNames = getBdcRepNames_(spreadsheet, userData);
  const bdcNameMap = {};
  bdcRepNames.forEach((name) => {
    bdcNameMap[name.toLowerCase()] = name;
  });

  const bdcStats = {};
  bdcRepNames.forEach((name) => {
    bdcStats[name] = {
      name,
      appointmentsAssigned: 0,
      appointmentsReassigned: 0,
      phoneLeadsAssigned: 0,
    };
  });

  const rosterData = getRosterData_(spreadsheet);
  if (!rosterData.sheetFound) {
    addWarning_(warnings, warningSet, `Roster sheet "${rosterData.sheetName}" not found.`);
  } else {
    sources.push({ sheet: rosterData.sheetName, rows: rosterData.rows });
  }

  const rosterStats = {};
  rosterData.roster.forEach((rep) => {
    rosterStats[rep.name] = {
      name: rep.name,
      active: rep.active,
      appointmentsAssigned: 0,
      appointmentsReassignedFrom: 0,
    };
  });

  const apptsSheetName = getAppointmentsSheetName_();
  const apptsSheet = spreadsheet.getSheetByName(apptsSheetName);
  if (!apptsSheet) {
    addWarning_(warnings, warningSet, `Appointments sheet "${apptsSheetName}" not found.`);
  } else {
    const lastRow = apptsSheet.getLastRow();
    const rowCount = Math.max(0, lastRow - 1);
    sources.push({ sheet: apptsSheetName, rows: rowCount });
    if (rowCount > 0) {
      const createdCol = typeof COL_CREATED_TS !== 'undefined' ? COL_CREATED_TS : 1;
      const assignedCol = typeof COL_ASSIGNED !== 'undefined' ? COL_ASSIGNED : 5;
      const assignedByCol = typeof COL_ASSIGNED_BY !== 'undefined' ? COL_ASSIGNED_BY : 7;
      const maxCol = Math.max(createdCol, assignedCol, assignedByCol);
      const data = apptsSheet.getRange(2, 1, rowCount, maxCol).getValues();

      for (let i = 0; i < data.length; i++) {
        const row = data[i];
        const createdDate = parseSheetDate_(row[createdCol - 1], tz);
        if (!isWithinWindow_(createdDate, windowStart, windowEnd)) continue;

        const assignedByRaw = String(row[assignedByCol - 1] || '').trim();
        const bdcName = resolveBdcName_(assignedByRaw, userData.aliasToName, bdcNameMap);
        if (bdcName && bdcStats[bdcName]) {
          bdcStats[bdcName].appointmentsAssigned++;
        }

        const assignedToRaw = String(row[assignedCol - 1] || '').trim();
        const rosterName = resolveNameAlias_(assignedToRaw, rosterData.nameMap);
        if (rosterName && rosterStats[rosterName]) {
          rosterStats[rosterName].appointmentsAssigned++;
        }
      }
    }
  }

  const auditSheetName = getAuditSheetName_();
  const auditSheet = spreadsheet.getSheetByName(auditSheetName);
  if (!auditSheet) {
    addWarning_(warnings, warningSet, `Audit sheet "${auditSheetName}" not found.`);
  } else {
    const lastAuditRow = auditSheet.getLastRow();
    const auditRowCount = Math.max(0, lastAuditRow - 1);
    sources.push({ sheet: auditSheetName, rows: auditRowCount });
    if (auditRowCount > 0) {
      const MAX_ROWS = 2000;
      let startRow = 2;
      if (lastAuditRow > MAX_ROWS + 1) {
        startRow = lastAuditRow - MAX_ROWS + 1;
      }

      const numRows = lastAuditRow - startRow + 1;
      const logData = auditSheet.getRange(startRow, 1, numRows, 5).getValues();

      for (let i = 0; i < logData.length; i++) {
        const row = logData[i];
        const ts = parseSheetDate_(row[0], tz);
        if (!isWithinWindow_(ts, windowStart, windowEnd)) continue;

        const actorRaw = String(row[1] || '').trim();
        const actionRaw = String(row[2] || '').trim();
        const detailsRaw = String(row[4] || '').trim();
        const action = normalizeAuditActionForDashboard_(actionRaw);
        const details = parseDetailsString_(detailsRaw);

        if (actorRaw && userData.sheetFound) {
          const actorName = resolveNameAlias_(actorRaw, userData.aliasToName);
          if (!actorName) {
            addWarning_(
              warnings,
              warningSet,
              `Audit actor "${actorRaw}" not found in ${userData.sheetName} list.`
            );
          }
        }

        const bdcName = resolveBdcName_(actorRaw, userData.aliasToName, bdcNameMap);
        const isReassignmentAction = action === actions.REASSIGNMENT;
        const isManualOverrideAssignment =
          action === actions.MANUAL_OVERRIDE &&
          (details.oldAssignee || details.newAssignee || details.assignee);

        if (bdcName && bdcStats[bdcName]) {
          if (action === actions.PHONE_LEAD) {
            bdcStats[bdcName].phoneLeadsAssigned++;
          }
          if (isReassignmentAction || isManualOverrideAssignment) {
            bdcStats[bdcName].appointmentsReassigned++;
          }
        }

        if (isReassignmentAction || isManualOverrideAssignment) {
          const oldAssignee = String(details.oldAssignee || '').trim();
          if (oldAssignee) {
            const rosterName = resolveNameAlias_(oldAssignee, rosterData.nameMap);
            if (rosterName && rosterStats[rosterName]) {
              rosterStats[rosterName].appointmentsReassignedFrom++;
            }
          }
        }
      }
    }
  }

  const groupTotals = {
    bdc: {
      appointmentsAssigned: 0,
      phoneLeadsAssigned: 0,
    },
  };

  bdcRepNames.forEach((name) => {
    const rep = bdcStats[name];
    if (rep) {
      groupTotals.bdc.appointmentsAssigned += rep.appointmentsAssigned;
      groupTotals.bdc.phoneLeadsAssigned += rep.phoneLeadsAssigned;
    }
  });

  const startIso = Utilities.formatDate(windowStart, tz, 'yyyy-MM-dd');

  return {
    meta: {
      generatedAt: Utilities.formatDate(now, tz, 'yyyy-MM-dd HH:mm:ss'),
      timezone: tz,
      window: { mode: 'today', startIso: startIso, endIso: startIso },
    },
    groupTotals: groupTotals,
    bdcReps: bdcRepNames.map((name) => bdcStats[name]),
    salesRoster: rosterData.roster.map((rep) => rosterStats[rep.name]),
    debug: { warnings: warnings, sources: sources },
  };
}

// -----------------------------------------------------------------------------
// HELPERS
// -----------------------------------------------------------------------------

function getUsersSheetName_() {
  if (typeof SHEET_USERS !== 'undefined') return SHEET_USERS;
  return 'RR_USERS';
}

function getAuditSheetName_() {
  if (typeof SHEET_AUDIT !== 'undefined') return SHEET_AUDIT;
  return 'RR_AUDIT';
}

function getAppointmentsSheetName_() {
  if (typeof SHEET_APPOINTMENTS !== 'undefined') return SHEET_APPOINTMENTS;
  if (typeof SHEET_APPTS !== 'undefined') return SHEET_APPTS;
  return 'APPOINTMENTS';
}

function getRosterSheetName_() {
  if (typeof SHEET_ROSTER !== 'undefined') return SHEET_ROSTER;
  return 'RR_ROSTER';
}

function addWarning_(warnings, warningSet, message) {
  if (!message) return;
  if (warningSet && warningSet.has(message)) return;
  if (warningSet) warningSet.add(message);
  warnings.push(message);
}

function resolveNameAlias_(raw, aliasMap) {
  const key = String(raw || '').trim().toLowerCase();
  if (!key) return '';
  if (aliasMap && aliasMap[key]) return aliasMap[key];
  return '';
}

function resolveBdcName_(raw, aliasMap, bdcNameMap) {
  const rawName = String(raw || '').trim();
  if (!rawName) return '';
  const alias = resolveNameAlias_(rawName, aliasMap);
  if (alias) {
    const aliasKey = alias.toLowerCase();
    if (bdcNameMap && bdcNameMap[aliasKey]) return bdcNameMap[aliasKey];
  }
  const rawKey = rawName.toLowerCase();
  if (bdcNameMap && bdcNameMap[rawKey]) return bdcNameMap[rawKey];
  return '';
}

function getUsersData_(ss) {
  const sheetName = getUsersSheetName_();
  const result = {
    sheetName,
    rows: 0,
    sheetFound: false,
    bdcNames: [],
    allNames: [],
    aliasToName: {},
  };

  const spreadsheet = ss || SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) return result;

  result.sheetFound = true;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return result;

  result.rows = lastRow - 1;
  const data = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
  const bdcSet = new Set();
  const allSet = new Set();

  data.forEach((row) => {
    const name = String(row[0] || '').trim();
    const role = String(row[2] || '').trim().toLowerCase();
    const auditName = String(row[4] || '').trim();
    const displayName = auditName || name;

    if (displayName) {
      const key = displayName.toLowerCase();
      if (!allSet.has(key)) {
        result.allNames.push(displayName);
        allSet.add(key);
      }
    }

    if (name) {
      result.aliasToName[name.toLowerCase()] = displayName;
    }

    if (auditName) {
      result.aliasToName[auditName.toLowerCase()] = displayName;
    }

    if (displayName && role === 'bdc') {
      const key = displayName.toLowerCase();
      if (!bdcSet.has(key)) {
        result.bdcNames.push(displayName);
        bdcSet.add(key);
      }
    }
  });

  return result;
}

function getBdcRepNames_(ss, userData) {
  const data = userData && Array.isArray(userData.bdcNames) ? userData : getUsersData_(ss);
  return data.bdcNames.slice();
}

function getRosterData_(ss) {
  const sheetName = getRosterSheetName_();
  const result = {
    sheetName,
    rows: 0,
    sheetFound: false,
    roster: [],
    nameMap: {},
  };

  const spreadsheet = ss || SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) return result;

  result.sheetFound = true;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return result;

  result.rows = lastRow - 1;
  const data = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
  const seen = new Set();

  data.forEach((row) => {
    const name = String(row[0] || '').trim();
    if (!name) return;
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    result.roster.push({ name: name, active: row[1] === true });
    result.nameMap[key] = name;
  });

  return result;
}

function parseSheetDate_(value, tz) {
  if (value instanceof Date && !isNaN(value.getTime())) return value;

  const raw = String(value || '').trim();
  if (!raw) return null;

  const normalized =
    raw.indexOf('T') === -1 && raw.indexOf(' ') !== -1 ? raw.replace(' ', 'T') : raw;
  const parsed = new Date(normalized);
  if (!isNaN(parsed.getTime())) return parsed;

  const zone = tz || Session.getScriptTimeZone();
  try {
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/.test(raw)) {
      return Utilities.parseDate(raw, zone, 'yyyy-MM-dd HH:mm:ss.SSS');
    }
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)) {
      return Utilities.parseDate(raw, zone, 'yyyy-MM-dd HH:mm:ss');
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      return Utilities.parseDate(raw, zone, 'yyyy-MM-dd');
    }
  } catch (_) {
    // ignore parse errors and fall through
  }

  return null;
}

function isWithinWindow_(dateObj, windowStart, windowEnd) {
  if (!(dateObj instanceof Date) || isNaN(dateObj.getTime())) return false;
  return dateObj >= windowStart && dateObj < windowEnd;
}

function normalizeAuditActionForDashboard_(action) {
  const raw = String(action || '').trim();
  if (!raw) return '';

  if (typeof normalizeAuditAction_ === 'function') {
    const normalized = normalizeAuditAction_(raw);
    return normalized || raw;
  }

  const lower = raw.toLowerCase();
  const actions = getAuditActions_();
  if (lower === 'assignment' || lower === 'new appointment' || lower === 'assigned' ||
      lower === 'auto-assigned') {
    return actions.NEW_APPOINTMENT || 'New Appointment';
  }
  if (lower === 'reassignment' || lower === 'reassigned') {
    return actions.REASSIGNMENT || 'Reassignment';
  }
  if (lower === 'manual override' || lower.includes('override')) {
    return actions.MANUAL_OVERRIDE || 'Manual Override';
  }
  if (lower === 'phone lead' || lower === 'phone up' || lower.includes('phone')) {
    return actions.PHONE_LEAD || 'Phone Lead';
  }
  if (lower === 'undo') {
    return actions.UNDO || 'Undo';
  }
  if (lower === 'pointer reset' || lower === 'reset pointer') {
    return actions.POINTER_RESET || 'Pointer Reset';
  }
  if (lower === 'pointer manual edit' || lower === 'pointer_manual_edit') {
    return actions.POINTER_MANUAL_EDIT || 'Pointer Manual Edit';
  }
  return raw;
}

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
