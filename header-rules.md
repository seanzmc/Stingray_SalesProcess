# Header Rules for DASHBOARD sheet

## Location - Rules

### CDK_DATA HEADER MAP:

A: Key (table key)
B: Contract Date
C: Deal No.
D: Stock No.
E: Customer
F: Salesperson
G: Sales Manager
H: FI Manager
I: StockType
J: VIN
K: Sale Type
L: PLC
M: Term
N: Front GP$
O: Back GP$
P: GP$
Q: Comments
R: Age
S: RDR

### COLUMN COMPARISON:
COL---NEW HEADER---OLD HEADER
A---Key---Deal No.
B---Contract Date---Customer
C---Deal No.---VIN
D---Stock No.---Stock No.
E---Customer---Status
F---Salesperson---PLC
G---Sales Manager---Contract Date
H---FI Manager---Sale Type
I---StockType---Year
J---VIN---Model
K---Sale Type---StockType
L---PLC---Front GP$
M---Term---Back GP$
N---Front GP$---GP$
O---Back GP$---Cash Price
P---GP$---Trades
Q---Comments---Service Contract
R---AGE---Finance Institution
S---RDR---Salesperson
T---EMPTY---Sales Manager
U---EMPTY---FI Manager
V---EMPTY---Term
W---EMPTY---Comments
X---EMPTY---AGE
Y---EMPTY---RDR Date

### CDK_MERGED HEADER MAP:

A	Date
B	Type
C	Customer
D	FI
E	Model
F	StockNo
G	Trade
H	Sales Person
I	Key
J	Contract Date
K	Deal No.
L	Stock No.
M	Customer
N	Salesperson
O	Sales Manager
P	FI Manager
Q	StockType
R	VIN
S	Sale Type
T	PLC
U	Term
V	Front GP$
W	Back GP$
X	GP$
Y	Comments
Z	Age
AA	RDR

### DASHBOARD Header Mapping Rules

DASHBOARD!A6 Header: Date
Data Rule: Map CDK_MERGED column A

DASHBOARD!B6 Header: Date Reported
Data Rule: Map CDK_MERGED column AA

DASHBOARD!C6 Header: Deal #
Data Rule: Map CDK_MERGED column K

DASHBOARD!D6 Header: Stock #
Data Rule: Map CDK_MERGED column L

DASHBOARD!E6 Header: Customer Name
Data Rule: Map CDK_MERGED column C

DASHBOARD!F6 Header: Sales Rep
Data Rule: Map CDK_MERGED column H

DASHBOARD!G6 Header: Sales Mgr
Data Rule: Map CDK_MERGED column O

DASHBOARD!H6 Header: Punched
Data Rule: IF CDK_MERGED column B equals 'NEW' THEN 'Y', ELSE ''

DASHBOARD!I6: New/Used
Data Rule: Map CDK_MERGED column B

DASHBOARD!J6: Make
Data Rule: IF CDK_MERGED column B equals 'NEW' THEN 'CHEV', ELSE SKIP

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

### WORKFLOW Formulas

EXPORT CDK SALES DATA, UPDATED INVENTORY LIST, AND VEHICLE SALES LIST.
Copy relDetailToSummaryDeals to CDK_DATA doc.
Copy sheet1 of manage-vehicle-deliveries-delivery-transactions to CDK_DATA doc.

Formula to use for "AGE" Drop in R2:
=MAP(C2:C, LAMBDA(id, IF(id="",, XLOOKUP(id, 'Copy of relDetailToSummaryDeals'!A2:A, 'Copy of relDetailToSummaryDeals'!C2:C, ""))))

Formula for "RDR" Drop in S2:
=MAP(J2:J, LAMBDA(id, IF(id="",, XLOOKUP(id, sheet1!B2:B, sheet1!F2:F, ""))))

### Inventory Headers

A	"Stock No."
B	"Stock Type"
C	Year
D	Make
E	Model
F	Color
G	Engine
H	Retail
I	Invoice
J	Lot
K	Co.
L	Age
M	Status
N	VIN
O	Mileage
P	Inventory Acct
Q	InventoryID (Table Key)
