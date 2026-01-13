# Required Installable Triggers

The following triggers must be set up manually in the Apps Script project (Triggers > Add Trigger):

## 1. Appointment Form Submission

- **Function**: `handleFormSubmit`
- **Deployment**: Head
- **Event Source**: From spreadsheet
- **Event Type**: On form submit

## 2. Appointment Manual Edits

- **Function**: `handleAppointmentEdit`
- **Deployment**: Head
- **Event Source**: From spreadsheet
- **Event Type**: On edit

## 3. Round Robin Pointer Audit

- **Function**: `handleRRStateEdit`
- **Deployment**: Head
- **Event Source**: From spreadsheet
- **Event Type**: On edit
- **Purpose**: Detects manual changes to `RR_STATE!B2` (legacy numeric index) or `RR_STATE!D2` (name-based appointment pointer) and logs them. Both cells are protected by [`ensureRRStatePointerProtection_()`](saleslog_files/round_robin.js:1134).
- **Migration Note**: If upgrading from an older version, run [`migrateAppointmentPointerToName()`](saleslog_files/round_robin.js:1060) once to initialize the name-based state in `D2`.

## 4. Roster Audit

- **Function**: `handleRosterEdit`
- **Deployment**: Head
- **Event Source**: From spreadsheet
- **Event Type**: On edit
- *Purpose*: Detects changes to Rep Active/Eligible status and logs them.
