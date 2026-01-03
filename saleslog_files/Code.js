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
    // STEP 1: DYNAMIC USER MAP & ROSTER INIT
    // ---------------------------------------------------------
    const userMap = {};  // Email (lowercase) -> Name
    const repStats = {}; // Name -> Count (Initialized to 0)

    try {
      // Try to get the named range "RR_USERS"
      // Expected Format: Col A = Name, Col D = Email (Indices 0 and 3)
      const usersRange = ss.getRangeByName('RR_USERS');
      if (usersRange) {
        const usersData = usersRange.getValues();
        usersData.forEach(row => {
          const name = String(row[0]).trim();
          const email = String(row[3]).trim().toLowerCase();

          if (name) {
            // Build Map
            if (email) {
              userMap[email] = name;
            }
            // Initialize Rep Stats (Leaderboard) for everyone in this list
            repStats[name] = 0;
          }
        });
      } else {
        // FALLBACK: If RR_USERS not defined, try RR_ROSTER for Reps at least
        console.warn('Named range RR_USERS not found. Falling back to RR_ROSTER.');
        const rosterSheet = ss.getSheetByName('RR_ROSTER');
        if (rosterSheet && rosterSheet.getLastRow() > 1) {
          const rosterData = rosterSheet.getRange(2, 1, rosterSheet.getLastRow()-1, 1).getValues();
          rosterData.forEach(r => {
             const name = String(r[0]).trim();
             if(name) repStats[name] = 0;
          });
        }
      }
    } catch (e) {
      console.warn('Error building user map/roster: ' + e.message);
    }

    // ---------------------------------------------------------
    // STEP 2: FETCH LOGS
    // ---------------------------------------------------------
    const auditSheet = ss.getSheetByName('RR_AUDIT');
    if (!auditSheet) {
      // Return safe defaults if audit sheet is missing
      return { stats: { totalAssignments: 0, manualOverrides: 0, activeUsersCount: 0 }, feed: [], leaderboard: [] };
    }

    const lastRow = auditSheet.getLastRow();
    const headersRaw = auditSheet.getRange(1, 1, 1, 5).getValues()[0]; // Just to confirm structure if needed

    // Optimization: Grab the last 500-1000 rows or filtering for Today
    // If today is empty, we still likely want to scan to check.
    const MAX_ROWS = 1000;
    let startRow = 2;
    if (lastRow > MAX_ROWS) {
      startRow = lastRow - MAX_ROWS + 1;
    }

    let data = [];
    if (lastRow >= 2) {
      const numRows = lastRow - startRow + 1;
      // Col A=Timestamp, B=User, C=Action, D=Reference, E=Details
      data = auditSheet.getRange(startRow, 1, numRows, 5).getValues();
    }

    // ---------------------------------------------------------
    // STEP 3: PARSE & AGGREGATE
    // ---------------------------------------------------------
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const stats = {
      totalAssignments: 0,
      manualOverrides: 0,
      activeUsersCount: 0
    };

    const feed = [];
    const activeActors = new Set(); // For "Active Users" count (users acting on the system)

    // Process loops in reverse to build feed naturally
    for (let i = data.length - 1; i >= 0; i--) {
      const row = data[i];
      const ts = new Date(row[0]);
      const userEmail = String(row[1]).toLowerCase();
      const action = String(row[2]);
      const reference = String(row[3]);
      const detailsRaw = String(row[4]);

      const isToday = ts >= today;

      // Map Actor Name
      const actorName = userMap[userEmail] || mapEmailFallback_(userEmail);

      // Parse Details
      const details = parseDetailsString_(detailsRaw);

      // --- LOGIC FOR TODAY'S STATS ---
      if (isToday) {
        // 1. Manual Overrides
        if (action.toLowerCase().includes('reassign') || action.toLowerCase().includes('override')) {
          stats.manualOverrides++;
        }

        // 2. Assignments & Leaderboard
        if (action === 'Assignment') {
          stats.totalAssignments++;

          const assigneeRaw = details['assignee'];
          if (assigneeRaw) {
             // Only increment if we have a name.
             // If this person wasn't in RR_USERS, add them now to stats
             if (!repStats.hasOwnProperty(assigneeRaw)) {
               repStats[assigneeRaw] = 0;
             }
             repStats[assigneeRaw]++;
          }
        }

        // 3. Active Users (Actors)
        activeActors.add(userEmail);
      }

      // --- FEED CONSTRUCTION (Last 50) ---
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
    // STEP 4: FINALIZE RETURN
    // ---------------------------------------------------------

    // Leaderboard Array
    const leaderboard = Object.keys(repStats).map(name => ({
      name: name,
      count: repStats[name]
    }));

    // Sort: High to Low
    leaderboard.sort((a, b) => b.count - a.count);

    stats.activeUsersCount = activeActors.size;

    return {
      stats: stats,
      feed: feed,
      leaderboard: leaderboard,
      lastUpdated: new Date().toLocaleTimeString()
    };

  } catch (err) {
    // Error handling
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
