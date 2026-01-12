# PROBLEMS

## Audit Log User Capture Issue - Analysis

**Yes, there is a critical bug**: The Audit Log is **NOT reliably capturing the current active user** for "Manual Edit" and "Manual Override" actions.

### Root Cause

The [`getEventUserEmail_(e)`](saleslog_files/round_robin.js:1083-1092) function has a fundamental flaw when used with **installable triggers**:

```javascript
function getEventUserEmail_(e) {
  if (e && e.user && e.user.email) return e.user.email;  // ❌ Rarely populated
  try {
    const active = Session.getActiveUser().getEmail();   // ❌ Often empty/wrong
    if (active) return active;
  } catch (_) {}
  return safeUserEmail_();  // ❌ Returns script owner, not editor
}
```

**Google Apps Script Limitation**: Installable "On edit" triggers do NOT reliably provide the editing user's email in `e.user`, and `Session.getActiveUser()` often returns empty or incorrect values in trigger context. The fallback `Session.getEffectiveUser()` returns the **script owner/service account**, not the actual editor.

### Affected Locations

1. **Manual Edit** - Line 237 in [`handleAppointmentEdit`](saleslog_files/round_robin.js:237):
   - Logs every edit with incorrect user

2. **Manual Override** - Line 302-308 in [`handleAppointmentEdit`](saleslog_files/round_robin.js:302-308):
   - Logs assignment changes with incorrect user

3. **Roster Changes** - Line 409 in [`handleRosterEdit`](saleslog_files/round_robin.js:409)

4. **Pointer Edits** - Line 363 in [`handleRRStateEdit`](saleslog_files/round_robin.js:363)

### Why Other Actions Work

Actions like "New Appointment", "Reassignment", and "Phone Lead" capture users correctly because they:
- Run from **custom menus** or **sidebars** (not installable triggers)
- Use [`safeUserEmail_()`](saleslog_files/round_robin.js:1074) in contexts where `Session.getEffectiveUser()` returns the actual logged-in user
- Have the audit user explicitly passed via `opts.auditUser` parameter

### Recommended Solution

This is a **known Google Apps Script platform limitation** with no perfect solution. Options:

1. **Document the limitation** - Add a note that manual sheet edits may show the script owner's email
2. **Add a warning marker** - Modify `safeUserEmail_()` to return `"[System/Owner]"` when used in trigger context
3. **Require UI-based edits** - Force users to use custom dialogs/sidebars that can capture user identity before writing to sheets
4. **Track last known user** - Cache the last authenticated user in UserProperties (imperfect but better than nothing)

The audit log IS working as designed within Apps Script constraints, but the platform itself prevents accurate user identification for direct sheet edits via installable triggers.
