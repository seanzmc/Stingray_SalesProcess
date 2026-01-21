# Rewind Pointer (Undo) — Manual Test Plan

> Automated runner available: run [`runAllTests_RewindPointerUndo()`](saleslog_files/rewind_pointer_undo_tests.js:84)
> from the Apps Script editor to execute a safe, isolated suite (uses temporary sheets).

These tests validate the new **Rewind Pointer (Undo)** dialog + backend persistence:

- The action rewinds the Round Robin pointer (`RR_STATE!B2` + `RR_STATE!D2`).
- The appointment row is **not deleted**.
- A **required reason** is recorded in:
  - `RR_AUDIT` (as an `Undo` entry)
  - `APPOINTMENTS` column H (Notes) for the “last appointment” tied to the undo

## Safety / Where to run

These tests can change production pointer state and appointment notes.

Recommended: run them on a **copy** of the spreadsheet (or during a quiet window).

## Preconditions

1. `RR_ROSTER` has at least one row where **Active = TRUE** and **Eligible = TRUE**.
2. `APPOINTMENTS` has at least one data row (row 2+) with an **Assigned** rep in column E.
3. You have access to the menu **BDC Appts → Round Robin → Rewind Pointer (Undo)**.

## Test 1 — Dialog opens + shows context

1. In the spreadsheet UI, click:
   **BDC Appts → Round Robin → Rewind Pointer (Undo)**.
2. Verify a modal dialog opens titled “Rewind Pointer (Undo)”.
3. Verify it displays:
   - Pointer state (Roster Count, Next Up Before/After, Last Assigned Before/After)
   - Last appointment identifiers (Sheet Row, Appt Date/Time, Customer, Phone, Assigned Rep, Assigned By)
4. Verify the **Reason** dropdown contains the configured choices and starts with a blank “Select a reason” option.

Expected:

- Dialog opens successfully.
- Confirm button is enabled (unless no appointment context is available).

## Test 2 — Client-side validation (reason required)

1. Open the dialog.
2. Leave **Reason** unselected.
3. Click **Confirm Undo**.

Expected:

- Dialog stays open.
- An inline error appears (e.g., “Please select a reason.”).
- No pointer change is performed.

## Test 3 — Cancel behavior (no changes)

1. Before opening the dialog, record:
   - `RR_STATE!B2` (numeric pointer)
   - `RR_STATE!D2` (last assigned name)
2. Open the dialog.
3. Click **Cancel**.

Expected:

- Dialog closes.
- `RR_STATE!B2` and `RR_STATE!D2` are unchanged.
- No new `RR_AUDIT` entry and no Notes append.

## Test 4 — Successful undo rewinds pointer + persists reason

1. Record current values:
   - `RR_STATE!B2`
   - `RR_STATE!D2`
2. Open the Undo dialog.
3. Choose a reason from the dropdown.
4. Click **Confirm Undo**.

Expected:

- Dialog closes and a toast appears indicating success.
- `RR_STATE!B2` is rewound by 1 (wrapping around roster length).
- `RR_STATE!D2` is updated to match the “Last Assigned (After)” shown in the dialog.

Also verify persistence:

### 4a) Audit log contains the reason

1. Open sheet `RR_AUDIT`.
2. Check the newest row.

Expected:

- Action column is `Undo`.
- Details contain `reason=<your selected reason>`.
- Details include appointment context + pointer state, and a unique `requestId=<uuid>`.

### 4b) Appointment notes append contains the reason (and marker)

1. Open sheet `APPOINTMENTS`.
2. Go to the row number displayed in the dialog under “Last Appointment (Notes Target)”.
3. Check column H (Notes).

Expected:

- A new line is appended in the format:
  - `YYYY-MM-DD HH:mm:ss - REWIND POINTER (UNDO) by <user>: <reason> [[RR_UNDO:<uuid>]]`

## Automated Coverage

The automated test runner (`runAllTests_RewindPointerUndo()`) covers:

- Invalid reason rejection
- Retry dedupe behavior (no duplicate notes/audit)
- Rollback correctness on simulated failures
