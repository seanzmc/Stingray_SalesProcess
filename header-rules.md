# Header Rules for DASHBOARD sheet

## Location - Rules

DASHBOARD!A6 Header: Date
Data Rule: Map CDK_MERGED column A

DASHBOARD!B6 Header: Date Reported
Data Rule: SKIP

DASHBOARD!C6 Header: Deal #
Data Rule: Map CDK_MERGED column I

DASHBOARD!D6 Header: Stock #
Data Rule: Map CDK_MERGED column F

DASHBOARD!E6 Header: Customer Name
Data Rule: Map CDK_MERGED column J

DASHBOARD!F6 Header: Sales Rep
Data Rule: Map CDK_MERGED column H

DASHBOARD!G6 Header: Sales Mgr
Data Rule: SKIP

DASHBOARD!H6 Header: Punched
Data Rule: IF CDK_MERGED column B equals 'NEW' THEN 'Y', ELSE 'USED'

DASHBOARD!I6: New/Used
Data Rule: Map CDK_MERGED column B

DASHBOARD!J6: Make
Data Rule: IF CDK_MERGED column B equals 'NEW' THEN 'CHEV', ELSE SKIP

DASHBOARD!K6: Model
Data Rule: Map CDK_MERGED column E

DASHBOARD!L6: Age
Data Rule: SKIP

DASHBOARD!M6: Trade in
Data Rule: Map CDK_MERGED column G

DASHBOARD!N6: F/C/L
Data Rule: IF CDK_MERGED column AC does not equal 'CASH' AND column N does not equal 'L' THEN "F", IF column N does equal 'L' THEN "L", ELSE "C"

DASHBOARD!O6: Front Gross
Data Rule: Map CDK_MERGED column T

DASHBOARD!P6: Back Gross
Data Rule: Map CDK_MERGED column U

DASHBOARD!Q6: Total Gross
Data Rule: Map CDK_MERGED column V
