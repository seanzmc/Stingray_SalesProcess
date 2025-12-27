# Round Robin System: User Guide

**Target Audience:** BDC Reps & Desk Managers

**Purpose:** Ensure fair, automatic assignment of appointments to the sales team.

---

## The "Next Up" Display (TODAY Sheet)
Before assigning anything, you can see the current status on the **TODAY** sheet.

-   **Next Up:** Shows the name of the salesperson who is currently at the *top of the rotation*.
-   **Appointment Tally:** Displays how many round-robin appointments each rep has received this month. Use this to verify *fairness*.

---

## Adding a New Appointment (Normal Operation)
This is your daily workflow for assigning a new appointment.

### 1. Open the Sidebar
Click the **"New Appointment"** menu item (**BDC Appts > New Appointment**) to open the side panel.

### 2. Enter Appointment Details
-   **Date/Time:** When is the customer coming in?
-   **Customer Name:** First and Last (e.g., *"John Doe"*).
-   **Phone:** Best contact number. For looking up in the CRM. Formatting is automatically applied (e.g., *"8135551234"*).
-   **Notes (Optional):** Any relevant info, but keep in mind notes should primarily be in the CRM (e.g., *"Looking for Tundra"*).

-   **Assigned By (Critical):**
    Select **YOUR NAME** from the dropdown. This logs who distributed the lead (for audit purposes).

### 3. Click "Create & Assign"
-   The system will automatically pick the **"Next Up"** salesperson.
-   You will see a **Green Checkmark** confirmation showing the name of the salesperson who was assigned and who is next in the rotation.
-   The appointment is added to the log, and the "Next Up" pointer *moves to the next person*.

---

## Managing the Roster (Who Gets Appointments?)
If a salesperson is on vacation, sick, or ineligible, you **must** update the `RR_ROSTER` sheet (hidden by default) to prevent them from receiving appointments.

**Go to the `RR_ROSTER` sheet:**

1.  **Column A (Name):** The salesperson's name.
2.  **Column B (Active):** Check this **ON** if they are working today. Uncheck if they are **OFF** or **SICK**.
3.  **Column C (Eligible):** Check this **ON** if they are qualified to receive Round Robin appointments (e.g., Trainees might be Active but *not* Eligible).

> IMPORTANT:
> A salesperson must have **BOTH** checkboxes marked to receive an appointment.

---

## Edge Cases & Corrections
Sometimes things don't go as planned. Here is how to handle exceptions using the **Round Robin** menu.

### Scenario A: Reassigning an Appointment (Skip & Reassign)
*If the assigned rep is busy with another customer or has an appointment at the same time, you can reassign the appointment.*

1.  Assign the appointment to the **Next Up** salesperson.
2.  Go to the **APPOINTMENTS** sheet.
3.  Select a cell in the row of the appointment you need to change.
4.  In the `BDC Appts` menu, go to **Round Robin > Skip & Reassign**.
5.  **Result:** The system assigns the appointment to the **Next Up** salesperson, logs the change, and simply advances the rotation pointer.

### Scenario B: "I made a mistake, go back!" (Rewind)
*You accidentally skipped someone, advanced the rotation incorrectly, or logged a duplicate appointment.*

1.  In the menu, go to **Round Robin > Rewind Pointer (Undo)**.
2.  **Result:** The "Next Up" indicator moves **BACK** one step to the previous salesperson.

### Scenario C: Manual Override
*You can type in a name manually.*

1.  You can manually type a name into the **Assigned Salesperson** column on the **APPOINTMENTS** sheet.
2.  **Result:** The system tracks this as a "Manual Override" in the audit log but does **NOT** move the rotation pointer. This is useful for "specific request" appointments that shouldn't affect the round robin count.

---

## Audit Log (RR_AUDIT)
The **RR_AUDIT** sheet tracks *every single action* taken by the Round Robin system for accountability and troubleshooting.

**What it shows:**
-   **Timestamp:** Exact time the action occurred.
-   **User:** Who performed the action (BDC Rep, Manager, or System).
-   **Action:** What happened (e.g., *"Assignment"*, *"Manual Override"*, *"Skip"*).
-   **Reference:** Which row or appointment was affected.
-   **Details:** Specifics like the customer name, previous pointer position, and reason for the action.

**Use this sheet to:**
-   Verify who assigned a specific appointment.
-   Check if a salesperson was skipped correctly.
-   Audit why the rotation pointer moved (or didn't move).
