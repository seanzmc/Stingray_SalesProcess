# Dashboard Pre-Plan

I do not even know what to modify on this dashboard map but I can tell you how I want the dashboard to behave:

I want it to primarily be a BDC activity monitor with an executive dashboard aspect.

So the things I want it to show are:

- Group Totals
  - Total Appointments assigned
    - Read and rank only from:
    - `APPOINTMENTS!G:G, Match RR_USERS!$C$2="BDC"`
  - Total phone leads assigned
    - Read from
    - `RR_AUDIT! column B User {Name} &&`
    - `RR_AUDIT! column C Action= "Phone Lead"`
- Activity by individual BDC rep (`RR_USERS: column C= "BDC"`)
  - Total appointments assigned
  - Appointments reassigned
  - Phone leads assigned
- I also want to show the `ROSTER` of sales reps and track the number of appointments that were reassigned from their name (meaning they were assigned an appointment then the same appointment was then reassigned to the next in line)

For that last one we may need to add a simple id to appointments to make them easier to track for this.

The reassignment logic could probably be updated to use this id to make it easier to track and reassign.

Idea for id:

`id="{customer}{date}{time}"`
