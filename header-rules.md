# Header Rules for DASHBOARD sheet

## Location - Rules

### DASHBOARD Headers

Column A, index 0: Date
Column B, index 1: RDR Date
Column C, index 2: Deal #
Column D, index 3: Stock #
Column E, index 4: Customer Name
Column F, index 5: Sales Rep
Column G, index 6: Sales Mgr
Column H, index 7: Punched
Column I, index 8: New/Used
Column J, index 9: Make
Column K, index 10: Model
Column L, index 11: Age
Column M, index 12: Trade in
Column N, index 13: F/C/L
Column O, index 14: Front Gross
Column P, index 15: Back Gross
Column Q, index 16: Total Gross

### CDK_DATA HEADER MAP:

Column A, index 0: Contract Date
Column B, index 1: Deal No.
Column C, index 2: Stock No.
Column D, index 3: Customer
Column E, index 4: Salesperson
Column F, index 5: Sales Manager
Column G, index 6: FI Manager
Column H, index 7: StockType
Column I, index 8: VIN
Column J, index 9: Sale Type
Column K, index 10: PLC
Column L, index 11: Term
Column M, index 12: Front GP$
Column N, index 13: Back GP$
Column O, index 14: GP$
Column P, index 15: Comments
Column Q, index 16: RDR Date

### VSALES Headers

Column A, index 0: Deal No.
Column B, index 1: Stock No.
Column C, index 2: StockType
Column D, index 3: Year
Column E, index 4: Make
Column F, index 5: Model Name
Column G, index 6: Days in Stock
Column H, index 7: Cust Name
Column I, index 8: Sales Person1
Column J, index 9: Sales Person2
Column K, index 10: Sales Manager
Column L, index 11: FI Manager
Column M, index 12: Front Gross
Column N, index 13: Back Gross
Column O, index 14: Total Gross

### CDK_MERGED HEADER MAP

Column A, index 0: Date
Column B, index 1: Type
Column C, index 2: Customer
Column D, index 3: FI
Column E, index 4: Model
Column F, index 5: StockNo
Column G, index 6: Trade
Column H, index 7: Sales Person
Column I, index 8: Contract Date
Column J, index 9: Deal No.
Column K, index 10: Stock No.
Column L, index 11: Customer
Column M, index 12: Salesperson
Column N, index 13: Sales Manager
Column O, index 14: FI Manager
Column P, index 15: StockType
Column Q, index 16: VIN
Column R, index 17: Sale Type
Column S, index 18: PLC
Column T, index 19: Term
Column U, index 20: Front GP$
Column V, index 21: Back GP$
Column W, index 22: GP$
Column X, index 23: Comments
Column Y, index 24: RDR Date
Column Z, index 25: Age

### DASHBOARD Header Mapping Rules (refreshDashboard)

DASHBOARD!A6 Header: Date
Data Rule: Map CDK_MERGED column A (index 0)

DASHBOARD!B6 Header: RDR Date
Data Rule: Map CDK_MERGED column Y (index 24)

DASHBOARD!C6 Header: Deal #
Data Rule: Map CDK_MERGED column J (index 9)

DASHBOARD!D6 Header: Stock #
Data Rule: Map CDK_MERGED column F (index 5)

DASHBOARD!E6 Header: Customer Name
Data Rule: Map CDK_MERGED column C (index 2)

DASHBOARD!F6 Header: Sales Rep
Data Rule: Map CDK_MERGED column H (index 7)

DASHBOARD!G6 Header: Sales Mgr
Data Rule: Map CDK_MERGED column N (index 13)

DASHBOARD!H6 Header: Punched
Data Rule: IF RDR Date is blank THEN "", ELSE "Y"

DASHBOARD!I6: New/Used
Data Rule: Map CDK_MERGED column B (index 1)

DASHBOARD!J6: Make
Data Rule: Map VSALES column E (index 4)

DASHBOARD!K6: Model
Data Rule: Map CDK_MERGED column E (index 4)

DASHBOARD!L6: Age
Data Rule: Map VSALES column G (index 6)

DASHBOARD!M6: Trade in
Data Rule: Map CDK_MERGED column G (index 6)

DASHBOARD!N6: F/C/L
Data Rule: IF CDK_MERGED column S (index 18) = "L" THEN RETURN "L", ELSE IF CDK_MERGED column T (index 19) = "Cash" THEN RETURN "C", ELSE RETURN "F"

DASHBOARD!O6: Front Gross
Data Rule: Map CDK_MERGED column U (index 20)

DASHBOARD!P6: Back Gross
Data Rule: Map CDK_MERGED column V (index 21)

DASHBOARD!Q6: Total Gross
Data Rule: Map CDK_MERGED column W (index 22)

### V-SALESLOG Headers

Column A, index 0: Date - Source: CDK_DATA A (index 0)
Column B, index 1: RDR Date - Source: CDK_DATA Q (index 16)
Column C, index 2: Deal # - Source: CDK_DATA B (index 1)
Column D, index 3: Stock # - Source: CDK_DATA C (index 2)
Column E, index 4: Customer Name - Source: CDK_DATA D (index 3)
Column F, index 5: Sales Rep - Source: VSALES I (index 8)
Column G, index 6: Sales Mgr - Source: VSALES K (index 10)
Column H, index 7: Punched - Formula: =IF(CDK_DATA!Q="", "", "Y")
Column I, index 8: New/Used - Source: CDK_DATA H (index 7)
Column J, index 9: Make - Source: VSALES E (index 4)
Column K, index 10: Model - Source: VSALES F (index 5)
Column L, index 11: Age - Source: VSALES G (index 6)
Column M, index 12: Trade in - Source: TODAY - Formula: Lookup Stock No in TODAY sheet, if NEW, match col E and return value in col F, if USED, match col L and return value in col M.
Column N, index 13: F/C/L - Formula: IF CDK_DATA column K (index 10) = "L" THEN RETURN "L", ELSE IF CDK_DATA column L (index 11) = "Cash" THEN RETURN "C", ELSE RETURN "F"
Column O, index 14: Front Gross - Source: CDK_DATA M (index 12)
Column P, index 15: Back Gross - Source: CDK_DATA N (index 13)
Column Q, index 16: Total Gross - Source: CDK_DATA O (index 14)

### DASHBOARD Header Mapping Rules (vSalesLogRefresh)

DASHBOARD!A6 Header: Date
Data Rule: Map V-SALESLOG column A (index 0)

DASHBOARD!B6 Header: RDR Date
Data Rule: Map V-SALESLOG column B (index 1)

DASHBOARD!C6 Header: Deal #
Data Rule: Map V-SALESLOG column C (index 2)

DASHBOARD!D6 Header: Stock #
Data Rule: Map V-SALESLOG column D (index 3)

DASHBOARD!E6 Header: Customer Name
Data Rule: Map V-SALESLOG column E (index 4)

DASHBOARD!F6 Header: Sales Rep
Data Rule: Map V-SALESLOG column F (index 5)

DASHBOARD!G6 Header: Sales Mgr
Data Rule: Map V-SALESLOG column G (index 6)

DASHBOARD!H6 Header: Punched
Data Rule: IF RDR Date is blank THEN "", ELSE "Y"

DASHBOARD!I6: New/Used
Data Rule: Map V-SALESLOG column I (index 8)

DASHBOARD!J6: Make
Data Rule: Map V-SALESLOG column J (index 9)

DASHBOARD!K6: Model
Data Rule: Map V-SALESLOG column K (index 10)

DASHBOARD!L6: Age
Data Rule: Map V-SALESLOG column L (index 11)

DASHBOARD!M6: Trade in
Data Rule: Map V-SALESLOG column M (index 12)

DASHBOARD!N6: F/C/L
Data Rule: IF CDK_DATA column K (index 10) = "L" THEN RETURN "L", ELSE IF CDK_DATA column L (index 11) = "Cash" THEN RETURN "C", ELSE RETURN "F"

DASHBOARD!O6: Front Gross
Data Rule: Map V-SALESLOG column O (index 14)

DASHBOARD!P6: Back Gross
Data Rule: Map V-SALESLOG column P (index 15)

DASHBOARD!Q6: Total Gross
Data Rule: Map V-SALESLOG column Q (index 16)
