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
  return `rr_dashboard_data::${spreadsheetId}::v3`;
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
  if (!obj.groupTotals.sales || typeof obj.groupTotals.sales !== 'object') return false;
  if (
    !obj.groupTotals.bdc.assignmentsCreated ||
    typeof obj.groupTotals.bdc.assignmentsCreated !== 'object'
  ) {
    return false;
  }
  if (
    !obj.groupTotals.bdc.reassignActions ||
    typeof obj.groupTotals.bdc.reassignActions !== 'object'
  ) {
    return false;
  }
  if (
    !obj.groupTotals.sales.assignmentsReceived ||
    typeof obj.groupTotals.sales.assignmentsReceived !== 'object'
  ) {
    return false;
  }
  if (
    !obj.groupTotals.sales.reassignmentsLost ||
    typeof obj.groupTotals.sales.reassignmentsLost !== 'object'
  ) {
    return false;
  }
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
    const key = normalizeName_(name).toLowerCase();
    if (key) bdcNameMap[key] = name;
  });

  const bdcStats = {};
  bdcRepNames.forEach((name) => {
    bdcStats[name] = {
      name,
      assignmentsCreated: { appointments: 0, phoneLeads: 0, total: 0 },
      reassignActions: { appointments: 0, phoneLeads: 0, total: 0 },
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
      assignmentsReceived: { appointments: 0, phoneLeads: 0, total: 0 },
      reassignmentsLost: { appointments: 0, phoneLeads: 0, total: 0 },
    };
  });

  const apptsSheetName = getAppointmentsSheetName_();
  const apptsSheet = spreadsheet.getSheetByName(apptsSheetName);
  const assignedCol = typeof COL_ASSIGNED !== 'undefined' ? COL_ASSIGNED : 5;
  const modeCol = typeof COL_MODE !== 'undefined' ? COL_MODE : 6;
  const assignedByCol = typeof COL_ASSIGNED_BY !== 'undefined' ? COL_ASSIGNED_BY : 7;
  const dateCol = getAppointmentsCreatedColumnIndex_();
  const dateRangeLabel = dateCol
    ? `${columnIndexToA1Letter_(dateCol)}2:${columnIndexToA1Letter_(dateCol)}`
    : '';
  const assignedRangeLabel = assignedCol
    ? `${columnIndexToA1Letter_(assignedCol)}2:${columnIndexToA1Letter_(assignedCol)}`
    : '';
  const modeRangeLabel = modeCol
    ? `${columnIndexToA1Letter_(modeCol)}2:${columnIndexToA1Letter_(modeCol)}`
    : '';
  const assignedByRangeLabel = assignedByCol
    ? `${columnIndexToA1Letter_(assignedByCol)}2:${columnIndexToA1Letter_(assignedByCol)}`
    : '';
  if (!apptsSheet) {
    addWarning_(warnings, warningSet, `Appointments sheet "${apptsSheetName}" not found.`);
    sources.push({
      metric: 'appointmentsAssignments',
      sheet: apptsSheetName,
      ranges: {
        assigned: assignedRangeLabel,
        mode: modeRangeLabel,
        assignedBy: assignedByRangeLabel,
      },
      dateRange: dateRangeLabel,
      status: 'missing',
    });
  } else {
    const lastRow = apptsSheet.getLastRow();
    const rowCount = Math.max(0, lastRow - 1);
    sources.push({ sheet: apptsSheetName, rows: rowCount });

    let filterByToday = true;
    let dateValues = null;
    if (rowCount > 0) {
      if (dateCol) {
        dateValues = apptsSheet.getRange(2, dateCol, rowCount, 1).getValues();
        let hasDateValues = false;
        for (let i = 0; i < dateValues.length; i++) {
          if (parseSheetDate_(dateValues[i][0], tz)) {
            hasDateValues = true;
            break;
          }
        }
        if (!hasDateValues) {
          filterByToday = false;
          addWarning_(
            warnings,
            warningSet,
            `Appointments created timestamp column ${dateRangeLabel || dateCol} has no valid dates; counting all-time.`
          );
        }
      } else {
        filterByToday = false;
        addWarning_(
          warnings,
          warningSet,
          'Appointments created timestamp column not found; counting all-time.'
        );
      }
    }

    sources.push({
      metric: 'appointmentsAssignments',
      sheet: apptsSheetName,
      ranges: {
        assigned: assignedRangeLabel,
        mode: modeRangeLabel,
        assignedBy: assignedByRangeLabel,
      },
      dateRange: dateRangeLabel,
      window: filterByToday ? 'today' : 'all-time',
    });

    if (rowCount > 0) {
      const assignedRange = apptsSheet.getRange(2, assignedCol, rowCount, 1).getValues();
      const modeRange = apptsSheet.getRange(2, modeCol, rowCount, 1).getValues();
      const assignedByRange = apptsSheet.getRange(2, assignedByCol, rowCount, 1).getValues();
      for (let i = 0; i < assignedRange.length; i++) {
        if (filterByToday) {
          const dateObj = parseSheetDate_(dateValues[i][0], tz);
          if (!isWithinWindow_(dateObj, windowStart, windowEnd)) continue;
        }

        const method = normalizeAssignmentMethod_(modeRange[i][0]);
        const isAuto = method === 'auto';
        const isManualReassign = method === 'manual reassign';
        const shouldCountAssignment = isAuto || isManualReassign;
        if (!shouldCountAssignment) continue;

        const assignedByRaw = assignedByRange[i][0];
        const assignedByKey = normalizeName_(assignedByRaw).toLowerCase();
        const bdcName = bdcNameMap[assignedByKey];
        if (bdcName && bdcStats[bdcName]) {
          bdcStats[bdcName].assignmentsCreated.appointments++;
          if (isManualReassign) {
            bdcStats[bdcName].reassignActions.appointments++;
          }
        }

        const salesAssigneeRaw = assignedRange[i][0];
        const salesAssigneeKey = normalizeName_(salesAssigneeRaw).toLowerCase();
        const salesName = rosterData.nameMap[salesAssigneeKey];
        if (salesName && rosterStats[salesName]) {
          rosterStats[salesName].assignmentsReceived.appointments++;
        }
      }
    }
  }

  let reassignmentKeyMissing = false;
  let reassignmentFromMissing = false;
  let phoneLeadAssigneeMissing = false;
  const auditSheetName = getAuditSheetName_();
  const auditSheet = spreadsheet.getSheetByName(auditSheetName);
  if (!auditSheet) {
    addWarning_(warnings, warningSet, `Audit sheet "${auditSheetName}" not found.`);
    sources.push({
      metric: 'phoneLeadsAssignments',
      sheet: auditSheetName,
      range: 'A2:C',
      action: actions.PHONE_LEAD,
      window: 'today',
      status: 'missing',
    });
    sources.push({
      metric: 'appointmentsReassignmentsLost',
      sheet: auditSheetName,
      range: 'A2:E',
      action: actions.REASSIGNMENT,
      window: 'today',
      status: 'missing',
    });
  } else {
    const lastAuditRow = auditSheet.getLastRow();
    const auditRowCount = Math.max(0, lastAuditRow - 1);
    sources.push({ sheet: auditSheetName, rows: auditRowCount });
    sources.push({
      metric: 'phoneLeadsAssignments',
      sheet: auditSheetName,
      range: 'A2:C',
      action: actions.PHONE_LEAD,
      window: 'today',
    });
    sources.push({
      metric: 'appointmentsReassignmentsLost',
      sheet: auditSheetName,
      range: 'A2:E',
      action: actions.REASSIGNMENT,
      window: 'today',
      note: 'Uses details.fromAssignee, then from/oldAssignee, then lastAssignedNameBefore, then reference.',
    });

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
        const referenceRaw = String(row[3] || '').trim();
        const detailsRaw = String(row[4] || '').trim();
        const action = normalizeAuditActionForDashboard_(actionRaw);
        const details = parseDetailsString_(detailsRaw);
        const actionLower = String(actionRaw || '').trim().toLowerCase();
        const isPhoneLeadAction =
          action === actions.PHONE_LEAD || actionLower === 'phone lead';
        const isReassignmentAction =
          action === actions.REASSIGNMENT || actionLower === 'reassignment';
        const isManualOverrideAction =
          action === actions.MANUAL_OVERRIDE || actionLower === 'manual override';
        const isReassignmentLike = isReassignmentAction || isManualOverrideAction;
        const recordKey = getAuditRecordKey_(details, referenceRaw);
        const isPhoneLeadTarget =
          isReassignmentLike && isPhoneLeadTarget_(details, actions);

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

        if (isPhoneLeadAction) {
          if (bdcName && bdcStats[bdcName]) {
            bdcStats[bdcName].assignmentsCreated.phoneLeads++;
          }

          const toNameRaw = getPhoneLeadToName_(details);
          if (!toNameRaw) {
            phoneLeadAssigneeMissing = true;
          } else {
            const toKey = normalizeName_(toNameRaw).toLowerCase();
            const salesName = rosterData.nameMap[toKey];
            if (salesName && rosterStats[salesName]) {
              rosterStats[salesName].assignmentsReceived.phoneLeads++;
            } else {
              phoneLeadAssigneeMissing = true;
            }
          }
        }

        if (isReassignmentLike && !isPhoneLeadTarget) {
          if (!recordKey) {
            reassignmentKeyMissing = true;
          }

          const hasFromAssignee = Boolean(
            details && String(details.fromAssignee || '').trim()
          );
          const hasLastAssigned = Boolean(
            details && String(details.lastAssignedNameBefore || '').trim()
          );
          if (!hasFromAssignee && !hasLastAssigned) {
            reassignmentFromMissing = true;
          }

          const fromNameRaw = getReassignmentFromName_(details, referenceRaw);

          if (fromNameRaw) {
            const fromKey = normalizeName_(fromNameRaw).toLowerCase();
            const salesName = rosterData.nameMap[fromKey];
            if (salesName && rosterStats[salesName]) {
              rosterStats[salesName].reassignmentsLost.appointments++;
            }
          }
        }
      }
    }
  }

  if (reassignmentKeyMissing) {
    addWarning_(
      warnings,
      warningSet,
      'Reassignment audit entries missing appointmentId/reference; reassignment attribution may be incomplete.'
    );
  }

  if (reassignmentFromMissing) {
    addWarning_(
      warnings,
      warningSet,
      'Reassignment entries missing fromAssignee; cannot count reassigned-from reliably.'
    );
  }

  if (phoneLeadAssigneeMissing) {
    addWarning_(
      warnings,
      warningSet,
      'Phone Lead audit entries missing assignee or not in roster; cannot count sales recipients.'
    );
  }

  const groupTotals = {
    bdc: {
      assignmentsCreated: { appointments: 0, phoneLeads: 0, total: 0 },
      reassignActions: { appointments: 0, phoneLeads: 0, total: 0 },
    },
    sales: {
      assignmentsReceived: { appointments: 0, phoneLeads: 0, total: 0 },
      reassignmentsLost: { appointments: 0, phoneLeads: 0, total: 0 },
    },
  };

  bdcRepNames.forEach((name) => {
    const rep = bdcStats[name];
    if (!rep) return;
    rep.assignmentsCreated.total =
      rep.assignmentsCreated.appointments + rep.assignmentsCreated.phoneLeads;
    rep.reassignActions.total =
      rep.reassignActions.appointments + rep.reassignActions.phoneLeads;

    groupTotals.bdc.assignmentsCreated.appointments +=
      rep.assignmentsCreated.appointments;
    groupTotals.bdc.assignmentsCreated.phoneLeads +=
      rep.assignmentsCreated.phoneLeads;
    groupTotals.bdc.reassignActions.appointments +=
      rep.reassignActions.appointments;
    groupTotals.bdc.reassignActions.phoneLeads +=
      rep.reassignActions.phoneLeads;
  });

  rosterData.roster.forEach((rep) => {
    const stats = rosterStats[rep.name];
    if (!stats) return;
    stats.assignmentsReceived.total =
      stats.assignmentsReceived.appointments + stats.assignmentsReceived.phoneLeads;
    stats.reassignmentsLost.total =
      stats.reassignmentsLost.appointments + stats.reassignmentsLost.phoneLeads;

    groupTotals.sales.assignmentsReceived.appointments +=
      stats.assignmentsReceived.appointments;
    groupTotals.sales.assignmentsReceived.phoneLeads +=
      stats.assignmentsReceived.phoneLeads;
    groupTotals.sales.reassignmentsLost.appointments +=
      stats.reassignmentsLost.appointments;
    groupTotals.sales.reassignmentsLost.phoneLeads +=
      stats.reassignmentsLost.phoneLeads;
  });

  groupTotals.bdc.assignmentsCreated.total =
    groupTotals.bdc.assignmentsCreated.appointments +
    groupTotals.bdc.assignmentsCreated.phoneLeads;
  groupTotals.bdc.reassignActions.total =
    groupTotals.bdc.reassignActions.appointments +
    groupTotals.bdc.reassignActions.phoneLeads;
  groupTotals.sales.assignmentsReceived.total =
    groupTotals.sales.assignmentsReceived.appointments +
    groupTotals.sales.assignmentsReceived.phoneLeads;
  groupTotals.sales.reassignmentsLost.total =
    groupTotals.sales.reassignmentsLost.appointments +
    groupTotals.sales.reassignmentsLost.phoneLeads;

  const startIso = Utilities.formatDate(windowStart, tz, 'yyyy-MM-dd');

  const bdcReps = bdcRepNames.map((name) => bdcStats[name]);
  bdcReps.sort((a, b) => {
    if (b.assignmentsCreated.total !== a.assignmentsCreated.total) {
      return b.assignmentsCreated.total - a.assignmentsCreated.total;
    }
    return a.name.localeCompare(b.name);
  });

  return {
    meta: {
      generatedAt: Utilities.formatDate(now, tz, 'yyyy-MM-dd HH:mm:ss'),
      timezone: tz,
      window: { mode: 'today', startIso: startIso, endIso: startIso },
    },
    groupTotals: groupTotals,
    bdcReps: bdcReps,
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

function getAppointmentsCreatedColumnIndex_() {
  if (typeof COL_CREATED_TS !== 'undefined') return COL_CREATED_TS;
  return 1;
}

function columnIndexToA1Letter_(index) {
  let n = Number(index);
  if (!Number.isFinite(n) || n < 1) return '';
  let letters = '';
  while (n > 0) {
    const mod = (n - 1) % 26;
    letters = String.fromCharCode(65 + mod) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

function normalizeName_(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function normalizeAssignmentMethod_(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const normalized = raw
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  if (normalized === 'auto') return 'auto';
  if (
    normalized === 'manual reassign' ||
    normalized === 'manual re assign' ||
    normalized === 'manual reassignment'
  ) {
    return 'manual reassign';
  }
  return normalized;
}

function getReassignmentFromName_(details, reference) {
  if (details && details.fromAssignee) return details.fromAssignee;
  if (details && details.from) return details.from;
  if (details && details.oldAssignee) return details.oldAssignee;
  if (details && details.lastAssignedNameBefore) return details.lastAssignedNameBefore;
  return parseFromReference_(reference);
}

function getPhoneLeadToName_(details) {
  return getAssigneeFromDetails_(details);
}

function parseFromReference_(reference) {
  const raw = String(reference || '').trim();
  if (!raw) return '';
  const match = raw.match(/\bfrom\b[:\s]+([^|,]+)/i);
  return match ? match[1].trim() : '';
}

function addWarning_(warnings, warningSet, message) {
  if (!message) return;
  if (warningSet && warningSet.has(message)) return;
  if (warningSet) warningSet.add(message);
  warnings.push(message);
}

function resolveNameAlias_(raw, aliasMap) {
  const key = normalizeName_(raw).toLowerCase();
  if (!key) return '';
  if (aliasMap && aliasMap[key]) return aliasMap[key];
  return '';
}

function resolveBdcName_(raw, aliasMap, bdcNameMap) {
  const rawName = normalizeName_(raw);
  if (!rawName) return '';
  const alias = resolveNameAlias_(rawName, aliasMap);
  if (alias) {
    const aliasKey = normalizeName_(alias).toLowerCase();
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
    people: [],
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
    const name = normalizeName_(row[0]);
    const active = row[1] === true;
    const role = String(row[2] || '').trim().toLowerCase();
    const auditName = normalizeName_(row[4]);
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

    if (displayName) {
      result.people.push({
        name: displayName,
        role: role,
        active: active,
      });
    }
  });

  return result;
}

function getBdcRepNames_(ss, userData) {
  const data = userData && Array.isArray(userData.bdcNames) ? userData : getUsersData_(ss);
  return data.bdcNames.slice();
}

function getSalesRepData_(ss, userData) {
  const data = userData && Array.isArray(userData.people) ? userData : getUsersData_(ss);
  const result = {
    sheetName: data.sheetName,
    rows: data.rows,
    sheetFound: data.sheetFound,
    reps: [],
    nameMap: {},
    usedExplicitSales: false,
  };

  if (!data.sheetFound) return result;

  const salesCandidates = [];
  const explicitSales = [];
  (data.people || []).forEach((person) => {
    if (!person || !person.name) return;
    const role = person.role;
    if (role === 'bdc') return;
    const entry = { name: person.name, active: person.active };
    salesCandidates.push(entry);
    if (role === 'sales') {
      explicitSales.push(entry);
    }
  });

  const selected = explicitSales.length > 0 ? explicitSales : salesCandidates;
  result.usedExplicitSales = explicitSales.length > 0;

  const seen = new Set();
  selected.forEach((rep) => {
    const key = normalizeName_(rep.name).toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    result.reps.push({ name: rep.name, active: rep.active });
    result.nameMap[key] = rep.name;
  });

  return result;
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
    const name = normalizeName_(row[0]);
    if (!name) return;
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    const active = row[1] === true && row[2] === true;
    result.roster.push({ name: name, active: active });
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

function normalizeDetailsKey_(key) {
  const trimmed = String(key || '').trim();
  if (!trimmed) return '';
  const compact = trimmed.replace(/[\s_-]+/g, '').toLowerCase();

  switch (compact) {
    case 'appointmentid':
      return 'appointmentId';
    case 'assignee':
    case 'assigned':
    case 'assignedto':
    case 'salesperson':
    case 'salesrep':
    case 'rep':
      return 'assignee';
    case 'toassignee':
    case 'to':
    case 'newassignee':
    case 'tosalesperson':
      return 'toAssignee';
    case 'fromassignee':
    case 'from':
    case 'oldassignee':
    case 'previousassignee':
    case 'reassignedfrom':
    case 'reassignedfromassignee':
      return 'fromAssignee';
    case 'lastassignednamebefore':
    case 'lastassignedbefore':
    case 'lastassigned':
      return 'lastAssignedNameBefore';
    case 'method':
      return 'method';
    case 'reason':
      return 'reason';
    case 'target':
      return 'target';
    case 'row':
      return 'row';
    case 'user':
      return 'user';
    default:
      return trimmed;
  }
}

function normalizeDetailsObject_(obj) {
  if (!obj || typeof obj !== 'object') return {};
  const normalized = {};
  Object.keys(obj).forEach((key) => {
    const normalizedKey = normalizeDetailsKey_(key);
    if (!normalizedKey) return;
    const value = obj[key];
    const existing = Object.prototype.hasOwnProperty.call(normalized, normalizedKey)
      ? String(normalized[normalizedKey] || '').trim()
      : '';
    if (!existing) {
      normalized[normalizedKey] = value;
    }
  });
  return normalized;
}

function getAssigneeFromDetails_(details) {
  if (!details) return '';
  if (details.toAssignee) return details.toAssignee;
  if (details.assignee) return details.assignee;
  if (details.newAssignee) return details.newAssignee;
  if (details.to) return details.to;
  if (details.salesperson) return details.salesperson;
  return '';
}

function getAuditRecordKey_(details, reference) {
  const appointmentId = details && details.appointmentId
    ? String(details.appointmentId).trim()
    : '';
  if (appointmentId) return appointmentId;
  const ref = String(reference || '').trim();
  return ref ? ref : '';
}

function isPhoneLeadTarget_(details, actions) {
  if (!details || !details.target) return false;
  const targetRaw = String(details.target || '').trim();
  if (!targetRaw) return false;
  const normalized = normalizeAuditActionForDashboard_(targetRaw);
  if (normalized === actions.PHONE_LEAD) return true;
  return targetRaw.toLowerCase().includes('phone');
}

/**
 * Parses "key=value | key2=value2" into an object.
 */
function parseDetailsString_(str) {
  if (!str) return {};
  const trimmed = String(str).trim();
  if (!trimmed) return {};
  if (trimmed[0] === '{' && trimmed[trimmed.length - 1] === '}') {
    try {
      const parsed = JSON.parse(trimmed);
      return parsed && typeof parsed === 'object'
        ? normalizeDetailsObject_(parsed)
        : { raw: str };
    } catch (_) {
      // fall through to key/value parsing
    }
  }
  if (!trimmed.includes('=')) return { raw: str };

  const obj = {};
  const parts = trimmed.split('|');

  parts.forEach((part) => {
    const eqIndex = part.indexOf('=');
    if (eqIndex === -1) return;
    const keyRaw = part.slice(0, eqIndex).trim();
    const val = part.slice(eqIndex + 1).trim();
    if (!keyRaw) return;
    const normalizedKey = normalizeDetailsKey_(keyRaw);
    if (!normalizedKey) return;
    const existing = Object.prototype.hasOwnProperty.call(obj, normalizedKey)
      ? String(obj[normalizedKey] || '').trim()
      : '';
    if (!existing) {
      obj[normalizedKey] = val;
    }
  });
  return Object.keys(obj).length ? obj : { raw: str };
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
  const assignee = getAssigneeFromDetails_(details);
  if (action === actions.NEW_APPOINTMENT || action === 'Assignment') {
    return `${assignee || 'Someone'} received a lead.`;
  }
  if (action === actions.PHONE_LEAD) {
    return `${assignee || 'Someone'} received a phone lead.`;
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
    const target = assignee || details.newAssignee || details.assignee || 'someone';
    return `Manual action affecting ${target}.`;
  }
  // Default
  const raw = details.raw || Object.keys(details).map(k => `${k}:${details[k]}`).join(' ');
  return `${reference ? reference + ' - ' : ''}${raw}`;
}

// Dev-only: run manually to sanity check dashboard data + backfill removal.
function devSanityCheckDashboard_() {
  const backfillChecks = [
    ['menuBackfillAppointmentIds', typeof menuBackfillAppointmentIds === 'function'],
    ['menuBackfillAuditAppointmentIds', typeof menuBackfillAuditAppointmentIds === 'function'],
    ['backfillAppointmentIds_', typeof backfillAppointmentIds_ === 'function'],
    ['backfillAuditAppointmentIds_', typeof backfillAuditAppointmentIds_ === 'function'],
    ['menuBackfillReconKeys', typeof menuBackfillReconKeys === 'function'],
    ['backfillReconSourceKeys_', typeof backfillReconSourceKeys_ === 'function'],
  ];
  const stillDefined = backfillChecks
    .filter((entry) => entry[1])
    .map((entry) => entry[0]);

  if (stillDefined.length) {
    Logger.log(
      'Sanity check: unexpected backfill functions still defined: ' +
      stillDefined.join(', ')
    );
  } else {
    Logger.log('Sanity check: backfill functions removed (expected).');
  }

  try {
    const data = getDashboardData();
    if (data && data.error) {
      Logger.log('Sanity check: getDashboardData error: ' + data.error);
      return;
    }
    const bdcName =
      data && Array.isArray(data.bdcReps) && data.bdcReps.length
        ? data.bdcReps[0].name
        : '';
    const salesName =
      data && Array.isArray(data.salesRoster) && data.salesRoster.length
        ? data.salesRoster[0].name
        : '';
    if (bdcName && salesName) {
      Logger.log(
        'Sanity check: dashboard data loaded. Sample BDC=' +
        bdcName +
        ', Sales=' +
        salesName
      );
    } else {
      Logger.log('Sanity check: dashboard data loaded but BDC/Sales missing.');
    }
  } catch (e) {
    Logger.log('Sanity check: getDashboardData threw: ' + e);
  }
}
