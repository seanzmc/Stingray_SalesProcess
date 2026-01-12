# Dashboard Plan

Role: You are an expert Google Apps Script developer.

Goal: Create a backend script (Code.gs) for a Web App that pulls data from my Google Spreadsheet for a dashboard.

The Data: I have a Google Sheet with the following tabs:

Sheet Name: [TODAY]

Columns: [Line Number, Customer (ignore for display), FI Initial, New Model, Stock #, Trade Stk#, Sales Person, empty, Customer (ignore for display), FI Initial, Used Model, Stock #, Trade Stk#, Sales Person, Ignore the rest of the columns]

Processing Needed: [Process Data in B:G as New Vehicle Sales, I:N as Used Vehicle Sales. Only count rows where the FI initial has a single letter value. Invalidate any rows where the FI initial is not a single letter value.]

Sheet Name: [MONTHLY]

Columns: [Line Number, Customer, FI Initial, New Model, Stock #, Trade Stk#, Sales Person, empty, Customer, FI Initial, Used Model, Stock #, Trade Stk#, Sales Person, empty, empty leaderboard columns x3, Monthly Analytics- S:X ]

Monthly Analytics Structure: [S2=Metric, T2=Value, U2=Metric, V2=Value, S8=Salesperson, T8=New, U8=Used, V8=Total, W8=% of team, X8=Rank]

Processing Needed: [Contains same data structure as TODAY sheet, just for the passed days of the month. Monthly Analytics is unique and calculated based on the data in the sheet. Mirror the data in S3:T6 for total sales monthly metrics through the previous day.]

Sheet Name: [SALESPEOPLE]

Columns: [Full Name, Acceptable Input Aliases, Preferred Display Code]

Processing Needed: [Acceptable Input Aliases is a comma separated list of aliases that can be used to identify the salesperson. Must be referenced in the data processing for the DASHBOARD JAN 2026 sheet. Preferred Display Code is the code that will be used to display the salesperson in the dashboard.]

Sheet Name: [RR_ROSTER]

Columns: [Salesperson (name), Active (checkbox), Eligible for Leads (checkbox), Role/Notes (text), Pointer Key (number)]

Purpose: [Source of truth for salesperson eligibility for leads and phone-up round-robin assignments.]

Sheet Name: [RR_STATE]

Columns: [RoundRobin Cycle, Appointment NextUp PhoneUp Last Assigned]

Purpose: [RoundRobin function uses this sheet to track state.]

Sheet Name: [APPOINTMENTS]

Columns: [Created Timestamp, Appt Date/Time, Customer Name, Phone, Assigned Salesperson, Assignment Mode, Assigned By, Notes]

Processing Needed: [This sheet is used to track appointments assigned via the Round Robin function. ]

Sheet Name: [RR_AUDIT]

Columns: [Timestamp, User, Action, Reference, Details]

Purpose: [Logs all Round Robin function calls, manual reassignments, pointer resets, Phone Up Assignments.]

Processing Needed: [Depending on the action, the Reference column shows different information. ]

Sheet Name: ['DASHBOARD JAN 2026']

Columns: [Rows 1-5 contain dashboard calculated metrics from the sheet. Data headers are in row 6.
Headers:
A Date, B RDR Date(ignore), C Deal # (ignore), D Stock #, E Customer Name(ignore), F Sales Rep, G Sales Mgr (ignore), H Punched (ignore), I New/Used, J Make, K Model, L Age, M Trade-In, N F/C/L, O Front Gross, P Back Gross, Q Total Gross]

Processing Needed: [Sales Rep should be matched from the SALESPEOPLE sheet using the acceptable input aliases and converted to the preferred display code which matches the RR_ROSTER sheet. Cells with two sales listed separated by a slash should be counted as a half deal for each salesperson. Column I determines New or Used for filtering. Column N is F=Finance, C=Cash, L=Lease.]

Requirements:

Write a doGet() function to serve an HTML template.

Write a public function named getDataForDashboard() that returns a JSON object containing the processed data from all sheets.

Use SpreadsheetApp.getActiveSpreadsheet() so I don't need to hardcode IDs.

Important: Ensure dates are formatted as strings to avoid JSON serialization errors.
I already have a sidebar in this script. Please write a doGet function that serves a file named dashboard.html without breaking my existing sidebar code. Ensure you include setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL) so I can embed this in a Google Site.
