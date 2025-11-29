# Conditional Formatting Rules Analysis

This document lists the conditional formatting rules found in the `saleslog_files` directory, specifically in `core_saleslogPro.js` and `setup_wizard.js`.

## Overview

There are two main sources of conditional formatting rules:
1.  **`core_saleslogPro.js`**: Contains the `reapplyCF` function, which is used during daily processing and updates. It attempts to preserve existing rules while managing specific "pace" and "duplicate" rules.
2.  **`setup_wizard.js`**: Contains `applyTodayConditionalFormatting` and `applyDepositsConditionalFormatting`, which are used during initial setup. These functions **overwrite** all existing rules on their respective sheets.

## Rules List

### 1. Duplicate Stock Number (New Cars)
*   **Description**: Highlights cells if the stock number (Column E) appears more than once in the column.
*   **Ranges**:
    *   `B2:G101` (in `core_saleslogPro.js`)
    *   `A2:G101` (in `setup_wizard.js`)
*   **Function Calls**:
    *   `reapplyCF` (in `core_saleslogPro.js`)
    *   `applyTodayConditionalFormatting` (in `setup_wizard.js`)
*   **Cleared Before Set**:
    *   In `reapplyCF`: **No** (Preserves non-managed rules).
    *   In `applyTodayConditionalFormatting`: **Yes** (Overwrites all rules).
*   **Overlaps**: Yes, both functions target the new car data entry area. `setup_wizard.js` includes Column A (row number), while `core_saleslogPro.js` starts at Column B.

### 2. Duplicate Stock Number (Used Cars)
*   **Description**: Highlights cells if the stock number (Column L) appears more than once in the column.
*   **Ranges**: `I2:N101`
*   **Function Calls**:
    *   `reapplyCF` (in `core_saleslogPro.js`)
    *   `applyTodayConditionalFormatting` (in `setup_wizard.js`)
*   **Cleared Before Set**:
    *   In `reapplyCF`: **No**.
    *   In `applyTodayConditionalFormatting`: **Yes**.
*   **Overlaps**: Yes, both functions target the used car data entry area.

### 3. Stock Number in Deposits (New Cars)
*   **Description**: Highlights cells if the stock number (Column E) is found in the `DEPOSITS` sheet (Column G).
*   **Ranges**:
    *   `B2:G101` (in `core_saleslogPro.js`)
    *   `A2:G101` (in `setup_wizard.js`)
*   **Function Calls**:
    *   `reapplyCF` (in `core_saleslogPro.js`)
    *   `applyTodayConditionalFormatting` (in `setup_wizard.js`)
*   **Cleared Before Set**:
    *   In `reapplyCF`: **No**.
    *   In `applyTodayConditionalFormatting`: **Yes**.
*   **Overlaps**: Yes, same as Rule 1.

### 4. Stock Number in Deposits (Used Cars)
*   **Description**: Highlights cells if the stock number (Column L) is found in the `DEPOSITS` sheet (Column G).
*   **Ranges**: `I2:N101`
*   **Function Calls**:
    *   `reapplyCF` (in `core_saleslogPro.js`)
    *   `applyTodayConditionalFormatting` (in `setup_wizard.js`)
*   **Cleared Before Set**:
    *   In `reapplyCF`: **No**.
    *   In `applyTodayConditionalFormatting`: **Yes**.
*   **Overlaps**: Yes, same as Rule 2.

### 5. Leaderboard Zero Sales Background
*   **Description**: Sets a background color for the leaderboard if all MTD sales are zero (start of month/period).
*   **Ranges**: Dynamic (defined by `RANGES.leaderboard`, typically `P2:R[n]`).
*   **Function Calls**: `reapplyCF` (in `core_saleslogPro.js`).
*   **Cleared Before Set**: **No** (Managed update).
*   **Overlaps**: No, specific to the leaderboard section.

### 6. Leaderboard Pace (Green)
*   **Description**: Highlights leaderboard entries in green if they are on pace (>= Green Threshold).
*   **Ranges**: Dynamic (`RANGES.leaderboard`).
*   **Function Calls**: `reapplyCF` (in `core_saleslogPro.js`).
*   **Cleared Before Set**: **No** (Managed update).
*   **Overlaps**: No.

### 7. Leaderboard Pace (Yellow)
*   **Description**: Highlights leaderboard entries in yellow if they are near pace (>= Yellow Threshold but < Green Threshold).
*   **Ranges**: Dynamic (`RANGES.leaderboard`).
*   **Function Calls**: `reapplyCF` (in `core_saleslogPro.js`).
*   **Cleared Before Set**: **No** (Managed update).
*   **Overlaps**: No.

### 8. Leaderboard Pace (Red)
*   **Description**: Highlights leaderboard entries in red if they are off pace (< Yellow Threshold).
*   **Ranges**: Dynamic (`RANGES.leaderboard`).
*   **Function Calls**: `reapplyCF` (in `core_saleslogPro.js`).
*   **Cleared Before Set**: **No** (Managed update).
*   **Overlaps**: No.

### 9. Deposits: Stock in TODAY (New)
*   **Description**: Highlights rows in the `DEPOSITS` sheet if the stock number (Column G) is found in the `TODAY` sheet (Column E).
*   **Ranges**: `A2:N1000` (on `DEPOSITS` sheet).
*   **Function Calls**: `applyDepositsConditionalFormatting` (in `setup_wizard.js`).
*   **Cleared Before Set**: **Yes** (Overwrites all rules on `DEPOSITS` sheet).
*   **Overlaps**: No.

### 10. Deposits: Stock in TODAY (Used)
*   **Description**: Highlights rows in the `DEPOSITS` sheet if the stock number (Column G) is found in the `TODAY` sheet (Column L).
*   **Ranges**: `A2:N1000` (on `DEPOSITS` sheet).
*   **Function Calls**: `applyDepositsConditionalFormatting` (in `setup_wizard.js`).
*   **Cleared Before Set**: **Yes** (Overwrites all rules on `DEPOSITS` sheet).
*   **Overlaps**: No.
