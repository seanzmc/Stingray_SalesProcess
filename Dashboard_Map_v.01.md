# Dashboard Wiring Map-v.01

## FILES

1. **dashboard.html** : Dashboard UI (Vue/Tailwind); polls [getDashboardData].
2. **Code.js** : Web app entry ([doGet]) + payload builder ([getDashboardData], [computeDashboardDataFromSpreadsheet_], [cache]).
3. **Stylesheet.html** : Shared CSS [include] injected by [include('Stylesheet')].
4. **round_robin.js** : Defines AUDIT_ACTIONS and writes RR_AUDIT rows consumed by dashboard.
5. **PhoneUp.js** : Logs phone lead actions to RR_AUDIT (appears in feed and counts).

## SERVER -> UI PAYLOAD

- key:
  - **stats** ([totalAssignments], [manualOverrides], [activeUsersCount])
  - source:
    - [computeDashboardDataFromSpreadsheet_] in Code.js; reads RR_AUDIT A2:E (last 1000 rows) with today filter;
    - [totalAssignments] counts col C where action == [AUDIT_ACTIONS.NEW_APPOINTMENT] or 'Assignment';
    - [manualOverrides] counts col C where action == [AUDIT_ACTIONS.REASSIGNMENT]/[AUDIT_ACTIONS.MANUAL_OVERRIDE] or contains 'reassign'/'override';
    - [activeUsersCount] counts unique col B values today;
    - action names come from [getAuditActions_] (uses [AUDIT_ACTIONS] from round_robin.js or fallback).
  - usedByUI: yes
  - notes: limited to last 1000 rows; col B is audit log name (not email), so [activeUsersCount] is by display name and can collide.
- key: **feed** (time, actor, action, details, message, isToday)
  - source:
    - [computeDashboardDataFromSpreadsheet_] reads RR_AUDIT A2:E;
    - [time] via [formatTime_](col A),
    - [actor] via [userMap] from RR_USERS A/D + [mapEmailFallback_] using col B,
    - [action] from col C,
    - [details] via [parseDetailsString_] (col E, written by [formatAuditDetails_]),
    - [message] via [buildFeedMessage_] (uses col D reference),
    - [isToday] from timestamp.
  - usedByUI: partial
  - notes: [message] and [isToday] are unused; [actor] mapping is off because col B already contains audit log names (not emails), so names are lowercased by fallback; UI pill styling looks for “assign” so “New Appointment” won’t be green; [details.raw] is hidden so rows without key/value details show no chips.
- key: **leaderboard** (name, count)
  - source:
    - [computeDashboardDataFromSpreadsheet_] initializes from RR_ROSTER A2:A;
    - increments on today’s assignment actions using [details.assignee] parsed from RR_AUDIT col E;
    - sorted by count desc.
  - usedByUI: yes
  - notes: counts only within last 1000 audit rows; assignee name mismatches split counts; phone leads are excluded.
- key: **lastUpdated**
  - source: [computeDashboardDataFromSpreadsheet_] uses new [Date().toLocaleTimeString()].
  - usedByUI: yes
  - notes: cache validation doesn’t require this key, so older cached payloads could omit it.
- key: **error**
  - source: [getDashboardData] catch block.
  - usedByUI: no
  - notes: UI suppresses error display; no user-visible failure state.

## UI ELEMENTS

- element: Header “Updated”
  reads keys: [lastUpdated]
  issues: no visible error state if payload contains error.
- element: Card “Total Leads Today”
  reads keys: [stats.totalAssignments]
  issues: only counts actions labeled “New Appointment” or “Assignment” in last 1000 rows today.
- element: Card “Manual Overrides”
  reads keys: [stats.manualOverrides]
  issues: manual edits/pointer edits excluded; last-1000-row cap applies.
- element: Card “Active Actors”
  reads keys: [stats.activeUsersCount]
  issues: counts unique display names from RR_AUDIT col B, not emails; name collisions or case changes skew count.
- element: Leaderboard table
  reads keys: [leaderboard[].name, leaderboard[].count]
  issues: based on today-only assignments within last 1000 rows; assignee spelling mismatches split totals.
- element: Activity Feed list
  reads keys: [feed[].action, feed[].time, feed[].actor, feed[].details]
  issues: feed[].message/feed[].isToday unused; “New Appointment” doesn’t hit “assign” styling; entries with only [details.raw] render no chips.
