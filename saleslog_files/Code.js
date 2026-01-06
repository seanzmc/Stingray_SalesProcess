/**
 * Code.js
 * Backend logic for the "Round Robin Analytics Dashboard".
 * Serves the HTML and processes audit data.
 */

// -----------------------------------------------------------------------------
// WEB APP SERVING
// -----------------------------------------------------------------------------

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
 */
function getDashboardData() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    // ---------------------------------------------------------
    // ---------------------------------------------------------
    // STEP 1: USER MAP (Strict Sheet Access)
    // Source: Sheet 'RR_USERS' (Direct access, no named ranges)
    // ---------------------------------------------------------
    const userMap = {};
    const usersSheet = ss.getSheetByName('RR_USERS'); // Access tab directly

    if (usersSheet) {
      // Grab all data on the sheet regardless of range definitions
      const data = usersSheet.getDataRange().getValues();

      // Loop through all rows (skipping header if necessary, usually safe to check all)
      for (let i = 0; i < data.length; i++) {
        const row = data[i];

        // Safety: Ensure row has at least 4 columns (Indices 0-3)
        if (row.length >= 4) {
          const name = String(row[0]).trim();        // Column A (Index 0)
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
      if (lastRow > 1) { // Assuming Row 1 is header
        const rosterData = rosterSheet.getRange(2, 1, lastRow - 1, 1).getValues();
        rosterData.forEach(r => {
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
      return { stats: { totalAssignments: 0, manualOverrides: 0, activeUsersCount: 0 }, feed: [], leaderboard: [] };
    }

    const lastAuditRow = auditSheet.getLastRow();
    // Optimization: Grab the last 1000 rows
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
      activeUsersCount: 0
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

      // 1. Resolve Actor Name using USER_MAP
      //    (Use map if found, else fallback/formatter)
      const actorName = userMap[userEmail] || mapEmailFallback_(userEmail);

      // 2. Parse Details
      const details = parseDetailsString_(detailsRaw);

      if (isToday) {
        // --- Today's Stats ---

        // Manual Actions
        if (action.toLowerCase().includes('reassign') || action.toLowerCase().includes('override')) {
          stats.manualOverrides++;
        }

        // Assignments & Leaderboard
        if (action === 'Assignment') {
          stats.totalAssignments++;

          // Use assignee value directly from details
          const assignee = details['assignee'];
          if (assignee) {
             // If not in roster (e.g. removed user), init them to 0 so we can increment
             if (repStats[assignee] === undefined) {
               repStats[assignee] = 0;
             }
             repStats[assignee]++;
          }
        }

        // Active Users (Actors)
        if (userEmail) activeActors.add(userEmail);
      }

      // --- Feed Construction (Limit 50) ---
      if (feed.length < 50) {
        feed.push({
          time: formatTime_(ts),
          actor: actorName,
          action: action,
          details: details,
          message: buildFeedMessage_(actorName, action, details, reference),
          isToday: isToday
        });
      }
    }

    // ---------------------------------------------------------
    // STEP 4: RESULT OBJECT
    // ---------------------------------------------------------
    const leaderboard = Object.keys(repStats).map(name => ({
      name: name,
      count: repStats[name]
    }));

    // Sort High -> Low
    leaderboard.sort((a, b) => b.count - a.count);

    stats.activeUsersCount = activeActors.size;

    return {
      stats: stats,
      feed: feed,
      leaderboard: leaderboard,
      lastUpdated: new Date().toLocaleTimeString()
    };

  } catch (err) {
    return { error: err.toString() };
  }
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
  if (action === 'Assignment') {
    return `${details.assignee || 'Someone'} received a lead.`;
  }
  if (action.includes('Override') || action.includes('Reassign')) {
    const target = details.newAssignee || details.assignee || 'someone';
    return `Manual action affecting ${target}.`;
  }
  // Default
  const raw = details.raw || Object.keys(details).map(k => `${k}:${details[k]}`).join(' ');
  return `${reference ? reference + ' - ' : ''}${raw}`;
}
