# Required Installable Triggers

The following triggers must be set up manually in the Apps Script project (Triggers > Add Trigger):

## 1. Appointment Manual Edits

- **Function**: `handleAppointmentEdit`
- **Deployment**: Head
- **Event Source**: From spreadsheet
- **Event Type**: On edit

## 2. Round Robin Pointer Audit

- **Function**: `handleRRStateEdit`
- **Deployment**: Head
- **Event Source**: From spreadsheet
- **Event Type**: On edit
- **Purpose**: Detects manual changes to `RR_STATE!B2` (legacy numeric index) or `RR_STATE!D2` (name-based appointment pointer) and logs them. Both cells are protected by [`ensureRRStatePointerProtection_()`](saleslog_files/round_robin.js:1134).

## 3. Roster Audit

- **Function**: `handleRosterEdit`
- **Deployment**: Head
- **Event Source**: From spreadsheet
- **Event Type**: On edit
- *Purpose*: Detects changes to Rep Active/Eligible status and logs them.

## 4. Appointment Structure Changes

- **Function**: `handleAppointmentStructureChange`
- **Deployment**: Head
- **Event Source**: From spreadsheet
- **Event Type**: On change
- **Purpose**: Detects insert/delete row operations on `APPOINTMENTS` and logs them.

## 5. Daily Processing

- **Function**: `processDaily`
- **Deployment**: Head
- **Event Source**: Time-driven
