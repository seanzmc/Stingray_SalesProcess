# Pace Report Layout

Sheet Name: MONTHLY

Title Row: S1:X1 - Merged range

Current layout:
S2:V6 Team Stats
  S2: Metric [Header]  T2: Value [Header]  U2: Metric [Header]  V2: Value [Header]
  S3: Total Delivered [Static Label]  T3: 53 [Value] U3: Selling Days [Static Label]  V3: 4 [Value]
  S4: New Delivered [Static Label]  T4: 30 [Value] U4: New Sold per Day [Static Label]  V4: 7.5 [Value]
  S5: Used Delivered [Static Label]  T5: 23 [Value] U5: Used Sold per Day [Static Label]  V5: 5.75 [Value]
  S6: Last Updated [Static Label]  T6: 1/7/2026 7:27:59 AM [Value]

New Layout:
*Changed* S2:V7 Team Stats
  S2: Performance	[Header] T2: MTD [Header] U2: Daily Rate [Header] V2: Projected EOM [Header]
  S3: New Sales [Static Label] T3: 28 [Value] U3: 9.33 [Value] V3: 243 [Value]
  S4: Used Sales [Static Label] T4: 19 [Value] U4: 6.33 [Value] V4: 165 [Value]
  S5: Total Sales [Static Label] T5: 47 [Value] U5: 15.66 [Value] V5: 407 [Value]

  S6: Selling Days Passed [Static Label] T6: 3 [Value] U6: Total Selling Days [Static Label] V6: 26 [Value]
  S7: Last Updated [Static Label] T7: 1/6/2026 7:27:59 AM [Value]

Total Selling Days Value [V6] is calculated using this exact formula:
=NETWORKDAYS.INTL(EOMONTH(A2, -1) + 1, EOMONTH(A2, 0), 11)
*Optional*: The holiday list can be printed as a spill down range in cell X2:X6, formatted with white text color to be invisible and called as a range reference in the formula instead of the date list for easier front end management, e.g. "=NETWORKDAYS.INTL(EOMONTH(A2, -1) + 1, EOMONTH(A2, 0), 11, X2:X6)"

Prompt 1:
You are modifying an existing Google Apps Script project that builds a Monthly Analytics table area in a Google Sheet.

Hard rules:
- DO NOT change any existing calculation logic, query logic, data pull logic, or business rules.
- DO NOT rename any existing functions unless strictly required for compilation.
- DO NOT alter how the underlying metric values are computed.
- Only modify: (1) where outputs are placed (cell locations/merged ranges/formatting), and (2) add the new “pacing” formulas (or their scripted equivalent) to populate the new layout.

Task:
1) Find the function(s) responsible for building/rendering the KPI table area (header row, labels, values, merges, formatting).
2) Identify the current output map: which metrics are written where (A1 notation or row/col indices).
3) Propose a minimal diff plan: a new output map that matches the new 4-column layout:
   - Column headers: Performance | MTD | Per Day Sales | EOM Pace
   - Rows: New Sales, Used Sales, Total Sales
   - Context rows: Selling Days Passed + Total Selling Days on same row
   - Last Updated on its own row
4) Do not implement yet. Return:
   - File + function names to edit
   - Current cell map
   - Proposed new cell map
   - Exactly what lines will change (high-level)
