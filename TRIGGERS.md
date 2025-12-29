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
- *Purpose*: Detects manual changes to `RR_STATE!B2` and logs them.

## 4. Roster Audit
- **Function**: `handleRosterEdit`
- **Deployment**: Head
- **Event Source**: From spreadsheet
- **Event Type**: On edit
- *Purpose*: Detects changes to Rep Active/Eligible status and logs them.
