# Round Robin System: User Guide

**Target Audience:** BDC Reps & Desk Managers

**Purpose:** Ensure fair, automatic assignment of appointments to the sales team.

---

## The "Next Up" Display (TODAY Sheet)

Before assigning anything, you can see the current status on the **TODAY** sheet.

- **Next Up:** Shows the name of the salesperson who is currently at the *top of the rotation*.
- **Appointment Tally:** Displays how many round-robin appointments each rep has received this month. Use this to verify *fairness*.

---

## Adding a New Appointment (Normal Operation)

This is your daily workflow for assigning a new appointment.

### 1. Open the Sidebar

Click the **"New Appointment"** menu item (**BDC Appts > New Appointment**) to open the side panel.

### 2. Enter Appointment Details

- **Date/Time:** When is the customer coming in?
- **Customer Name:** First and Last (e.g., *"John Doe"*).
- **Phone:** Best contact number. For looking up in the CRM. Formatting is automatically applied (e.g., *"8135551234"*).
- **Notes (Optional):** Any relevant info, but keep in mind notes should primarily be in the CRM (e.g., *"Looking for Tundra"*).

- **Assigned By (Critical):**
    Select **YOUR NAME** from the dropdown. This logs who distributed the lead (for audit purposes).

### 3. Click "Create & Assign"

- The system will automatically pick the **"Next Up"** salesperson.
- You will see a **Green Checkmark** confirmation showing the name of the salesperson who was assigned and who is next in the rotation.
- The appointment is added to the log, and the "Next Up" pointer *moves to the next person*.

---

## Managing the Roster (Who Gets Appointments?)

If a salesperson is on vacation, sick, or ineligible, you **must** update the `RR_ROSTER` sheet (hidden by default) to prevent them from receiving appointments.

**Go to the `RR_ROSTER` sheet:**

1. **Column A (Name):** The salesperson's name.
2. **Column B (Active):** Check this **ON** if they are working today. Uncheck if they are **OFF** or **SICK**.
3. **Column C (Eligible):** Check this **ON** if they are qualified to receive Round Robin appointments (e.g., Trainees might be Active but *not* Eligible).

> IMPORTANT:
> A salesperson must have **BOTH** checkboxes marked to receive an appointment.

---

## Edge Cases & Corrections

Sometimes things don't go as planned. Here is how to handle exceptions using the **Round Robin** menu.

### Scenario A: Reassigning an Appointment (Skip & Reassign)

*If the assigned rep is busy with another customer or has an appointment at the same time, you can reassign the appointment.*

1. Assign the appointment to the **Next Up** salesperson.
2. Go to the **APPOINTMENTS** sheet.
3. Select a cell in the row of the appointment you need to change.
4. In the `BDC Appts` menu, go to **Round Robin > Skip & Reassign**.
5. **Result:** The system assigns the appointment to the **Next Up** salesperson, logs the change, and simply advances the rotation pointer.

### Scenario B: "I made a mistake, go back!" (Rewind)

*You accidentally skipped someone, advanced the rotation incorrectly, or logged a duplicate appointment.*

1. In the menu, go to **Round Robin > Rewind Pointer (Undo)**.
2. **Result:** The appointment pointer moves **BACK** to the previous salesperson in the rotation. Both the legacy "Next Up" index and the name-based state are adjusted.

### Scenario C: Manual Override

*You can type in a name manually.*

1. You can manually type a name into the **Assigned Salesperson** column on the **APPOINTMENTS** sheet.
2. **Result:** The system tracks this as a "Manual Override" in the audit log but does **NOT** move the rotation pointer. This is useful for "specific request" appointments that shouldn't affect the round robin count.

---

## Audit Log (RR_AUDIT)

The **RR_AUDIT** sheet tracks *every single action* taken by the Round Robin system for accountability and troubleshooting.

**What it shows:**

- **Timestamp:** Exact time the action occurred.
- **User:** Who performed the action (BDC Rep, Manager, or System).
- **Action:** What happened (e.g., *"Assignment"*, *"Manual Override"*, *"Skip"*).
- **Reference:** Which row or appointment was affected.
- **Details:** Specifics like the customer name, previous pointer position, and reason for the action.

**Use this sheet to:**

- Verify who assigned a specific appointment.
- Check if a salesperson was skipped correctly.
- Audit why the rotation pointer moved (or didn't move).

---

## How Round Robin State Works (Technical Overview)

The appointment round-robin system maintains its state in the **RR_STATE** sheet using two cells:

- **`RR_STATE!B2` (Legacy):** Numeric index (1-based) pointing to the "next up" position. This is kept for backward compatibility and debugging but is **not used** for appointment assignments.
- **`RR_STATE!D2` (Source of Truth):** The **name** of the last salesperson who was assigned an appointment via round-robin (e.g., *"Jane Smith"*). This is the **primary state** used by [`advanceRoundRobinPointerByName_()`](saleslog_files/round_robin.js:807).

**Why Name-Based?**

Name-based tracking is **resilient to roster changes**. If you remove a salesperson from the roster or reorder the list, the system can recover the correct "next up" position by finding the last-assigned name in the current roster and advancing from there.

**Implementation Details:**

- Assignments via sidebar ([`createAppointmentFromSidebar()`](saleslog_files/rr_sidebar.js:12)) and auto-assignment ([`assignRowAuto_()`](saleslog_files/round_robin.js:629)) both update **`RR_STATE!D2`** with the assigned name.
- Rewind ([`menuRewindPointer()`](saleslog_files/round_robin.js:499)) and reset ([`menuResetPointer()`](saleslog_files/round_robin.js:555)) operations update **both** `B2` and `D2` to keep them in sync.
- The name-based cell is **protected** along with the numeric index by [`ensureRRStatePointerProtection_()`](saleslog_files/round_robin.js:1134) to prevent accidental manual edits.

---

## Roster Changes & Resilience

**What happens if you remove or reorder salespeople in `RR_ROSTER`?**

The name-based pointer system handles this gracefully:

1. **Removal:** If the last-assigned person is no longer in the roster, the system starts from the beginning of the current roster.
2. **Reordering:** The system finds the last-assigned name in the **current** roster order and advances to the next eligible person, preserving fairness even after changes.
3. **Additions:** New salespeople are added to the end of the roster and will naturally enter the rotation.

**Example:**

- Roster before: Alice, Bob, Charlie, Dana
- Last assigned: Bob (stored in `D2`)
- You remove Bob from the roster: Alice, Charlie, Dana
- **Next assignment:** Charlie (the system continues from where Bob was in the sequence)

This resilience ensures the round-robin system continues working even during roster transitions (e.g., temporary staff, seasonal changes).

---

## One-Time Migration (For Existing Installations)

If you are upgrading from an older version that only used the numeric pointer (`RR_STATE!B2`), you must run a **one-time migration** to populate the name-based state cell (`D2`).

### Migration Instructions

1. Open **Google Apps Script** editor (Extensions > Apps Script).
2. In the script editor, open the **round_robin.js** file.
3. Locate the function [`migrateAppointmentPointerToName()`](saleslog_files/round_robin.js:1060).
4. Run the function once (click the function name in the dropdown, then click the ▶ Run button).
5. **What it does:**
   - Reads the current numeric pointer from `B2`.
   - Looks up the corresponding salesperson name in `RR_ROSTER`.
   - **Writes the *previous* person's name** to `D2` (this preserves the current "next up" assignment).
   - Logs the migration to the audit log.
6. **Result:** The name-based pointer is now initialized, and future assignments will use it.

**Important:** Run this **only once**. The migration is idempotent (safe to run multiple times), but it's designed as a one-time setup step.

**Why preserve "next up"?**

The migration writes the *previous* person's name so that the current "next up" person remains unchanged. This ensures no disruption to your existing rotation schedule.
