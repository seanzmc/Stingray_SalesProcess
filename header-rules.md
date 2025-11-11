# Header Rules for DASHBOARD sheet

## Location - Rules

### DASHBOARD Headers

A: Date
B: RDR Date
C: Deal #
D: Stock #
E: Customer Name
F: Sales Rep
G: Sales Mgr
H: Punched
I: New/Used
J: Make
K: Model
L: Age
M: Trade in
N: F/C/L
O: Front Gross
P: Back Gross
Q: Total Gross

### CDK_DATA HEADER MAP:

A: Contract Date
B: Deal No.
C: Stock No.
D: Customer
E: Salesperson
F: Sales Manager
G: FI Manager
H: StockType
I: VIN
J: Sale Type
K: PLC
L: Term
M: Front GP$
N: Back GP$
O: GP$
P: Comments
Q: RDR Date

### VSALES Headers

A: Deal No.
B: Stock No.
C: StockType
D: Year
E: Make
F: Model Name
G: Days in Stock
H: Cust Name
I: Sales Person1
J: Sales Person2
K: Sales Manager
L: FI Manager
M: Front Gross
N: Back Gross
O: Total Gross

### V-SALESLOG Headers

A: Date - Source: CDK_DATA B
B: RDR Date - Source: CDK_DATA R
C: Deal # - Source: CDK_DATA C
D: Stock # - Source: CDK_DATA D
E: Customer Name - Source: CDK_DATA E
F: Sales Rep - Source: VSALES I
G: Sales Mgr - Source: VSALES K
H: Punched - Formula: =IF(B2="", "", "Y")
I: New/Used - Source: CDK_DATA I
J: Make - Source: VSALES E
K: Model - Source: VSALES F
L: Age - Source: VSALES G
M: Trade in - Source: TODAY - Formula: Lookup Stock No in TODAY sheet, if NEW, match col E and return value in col F, if USED, match col L and return value in col M.
N: F/C/L - Source: CDK_DATA M
O: Front Gross - Source: CDK_DATA N
P: Back Gross - Source: CDK_DATA O
Q: Total Gross - Source: CDK_DATA P

### CDK_MERGED HEADER MAP

A: Date
B: Type
C: Customer
D: FI
E: Model
F: StockNo
G: Trade
H: Sales Person
I: Contract Date
J: Deal No.
K: Stock No.
L: Customer
M: Salesperson
N: Sales Manager
O: FI Manager
P: StockType
Q: VIN
R: Sale Type
S: PLC
T: Term
U: Front GP$
V: Back GP$
W: GP$
X: Comments
Y: RDR Date
Z: Age

### DASHBOARD Header Mapping Rules

DASHBOARD!A6 Header: Date
Data Rule: Map CDK_MERGED column A

DASHBOARD!B6 Header: RDR Date
Data Rule: Map CDK_MERGED column Y

DASHBOARD!C6 Header: Deal #
Data Rule: Map CDK_MERGED column J

DASHBOARD!D6 Header: Stock #
Data Rule: Map CDK_MERGED column F

DASHBOARD!E6 Header: Customer Name
Data Rule: Map CDK_MERGED column C

DASHBOARD!F6 Header: Sales Rep
Data Rule: Map CDK_MERGED column H

DASHBOARD!G6 Header: Sales Mgr
Data Rule: Map CDK_MERGED column N

DASHBOARD!H6 Header: Punched
Data Rule: IF RDR Date is blank THEN "", ELSE "Y"

DASHBOARD!I6: New/Used
Data Rule: Map CDK_MERGED column B

DASHBOARD!J6: Make
Data Rule: Map CDK_MERGED column AA

DASHBOARD!K6: Model
Data Rule: Map CDK_MERGED column E

DASHBOARD!L6: Age
Data Rule: Map CDK_MERGED column Z

DASHBOARD!M6: Trade in
Data Rule: Map CDK_MERGED column G

DASHBOARD!N6: F/C/L
Data Rule: IF CDK_MERGED column U does not equal 'CASH' AND column T does not equal 'L' THEN "F", IF column N does equal 'L' THEN "L", ELSE "C"

DASHBOARD!O6: Front Gross
Data Rule: Map CDK_MERGED column V

DASHBOARD!P6: Back Gross
Data Rule: Map CDK_MERGED column W

DASHBOARD!Q6: Total Gross
Data Rule: Map CDK_MERGED column X

### Inventory Headers

A: Stock No.
B: Stock Type
C: Year
D: Make
E: Model
F: Color
G: Engine
H: Retail
I: Invoice
J: Lot
K: Co.
L: Age
M: Status
N: VIN
O: Mileage
P: Inventory Acct
Q: InventoryID (Table Key)

### WORKFLOW Formulas

EXPORT CDK SALES DATA, UPDATED INVENTORY LIST, AND VEHICLE SALES LIST.
Copy relDetailToSummaryDeals to CDK_DATA doc.
Copy sheet1 of manage-vehicle-deliveries-delivery-transactions to CDK_DATA doc.

Formula to use for "AGE" Drop in R2:
=MAP(C2:C, LAMBDA(id, IF(id="",, XLOOKUP(id, 'Copy of relDetailToSummaryDeals'!A2:A, 'Copy of relDetailToSummaryDeals'!C2:C, ""))))

Formula for "RDR" Drop in S2:
=MAP(J2:J, LAMBDA(id, IF(id="",, XLOOKUP(id, sheet1!B2:B, sheet1!F2:F, ""))))
