/**
 * setup_wizard.js
 * Setup wizard to help new users configure required sheets for the sales log application.
 * Creates TODAY, MONTHLY, SALESPEOPLE, and DEPOSITS sheets with proper formatting.
 */

/**
 * Main setup wizard function that checks for and creates missing sheets
 * Can be called from the menu or directly
 * Safe to run multiple times (idempotent)
 * Prompts for customization, creates required sheets, and opens configuration sidebar
 * @returns {void}
 */
function runSetupWizard() {
  try {
    Logger.log("Starting setup wizard...");

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) {
      throw new Error("No active spreadsheet found. Please open a spreadsheet first.");
    }

    const results = {
      existed: [],
      created: [],
      errors: []
    };

    // Prompt for customization
    const customizationSettings = promptForCustomization(ss);
    if (customizationSettings) {
      // Store in properties for use by sheet creation functions (temporary)
      PropertiesService.getDocumentProperties().setProperty(
        'SETUP_CUSTOMIZATION',
        JSON.stringify(customizationSettings)
      );

      // Also save to permanent configuration
      try {
        const updates = { visual: customizationSettings };
        updateConfiguration(updates);
      } catch (e) {
        logWarning('runSetupWizard', 'Error saving customization to configuration', { error: e.toString() });
      }
    }

    // Check and create each required sheet
    checkAndCreateTodaySheet(ss, results);
    checkAndCreateMonthlySheet(ss, results);
    checkAndCreateSalespeopleSheet(ss, results);
    checkAndCreateDepositsSheet(ss, results);

    // Show summary dialog
    showSetupSummary(results);

    // Activate the TODAY sheet
    const todaySheet = ss.getSheetByName('TODAY');
    if (todaySheet) {
      ss.setActiveSheet(todaySheet);
    }

    // Prompt user to add sales team
    const ui = SpreadsheetApp.getUi();
    const addSalesTeamResponse = ui.alert(
      'Add Sales Team',
      'Want to add to the sales team now? You can do it later by going to the Settings menu in Sales Tools.',
      ui.ButtonSet.YES_NO
    );

    // Open configuration sidebar if user wants to add sales team
    if (addSalesTeamResponse === ui.Button.YES) {
      try {
        openConfigurationSidebar();
      } catch (e) {
        logWarning('runSetupWizard', 'Error opening configuration sidebar', { error: e.toString() });
      }
    }

    Logger.log("Setup wizard completed successfully.");

  } catch (e) {
    logError('runSetupWizard', e);
    const ui = SpreadsheetApp.getUi();
    ui.alert("Setup Error", "An error occurred during setup:\n\n" + e.message, ui.ButtonSet.OK);
  }
}

/**
 * Prompts user for customization settings through a sequence of modal dialogs.
 * Allows configuration of header colors and fonts for the setup wizard.
 *
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss - The active spreadsheet
 * @returns {Object|null} Customization settings object or null if user skips
 */
function promptForCustomization(ss) {
  const ui = SpreadsheetApp.getUi();

  try {
    // Step 1: Ask if user wants to customize
    const customizeResponse = ui.alert(
      'Customize Sheet Formatting',
      'Would you like to customize header colors and fonts?\n\n(You can skip and use default formatting)',
      ui.ButtonSet.YES_NO
    );

    if (customizeResponse !== ui.Button.YES) {
      Logger.log('User chose to skip customization');
      return null;
    }

    // Step 2: NewCar background color
    let newCarBgColor = '#234070'; // Default
    let newCarTextColor = '#FFFFFF';

    const newCarColorResponse = ui.prompt(
      'New Car Header Color',
      'Choose background color for New Car headers:\n1 = Blue (#234070)\n2 = Red (#B71C1C)\n3 = Dark Green (#1B5E20)\n4 = Dark Yellow (#F9A825)\n\nEnter 1-4 or leave blank for Blue (default)',
      ui.ButtonSet.OK_CANCEL
    );

    if (newCarColorResponse.getSelectedButton() === ui.Button.OK) {
      const choice = newCarColorResponse.getResponseText().trim();

      // Map user choice to hex color
      switch (choice) {
        case '1':
          newCarBgColor = '#234070';
          break;
        case '2':
          newCarBgColor = '#B71C1C';
          break;
        case '3':
          newCarBgColor = '#1B5E20';
          break;
        case '4':
          newCarBgColor = '#F9A825';
          break;
        default:
          // Blank or invalid - use default
          newCarBgColor = '#234070';
      }

      // Calculate WCAG compliant text color
      newCarTextColor = getWcagCompliantTextColor(newCarBgColor);
    }

    // Step 3: UsedCar fixed color (no user prompt)
    const usedCarBgColor = '#424242';
    const usedCarTextColor = '#FFFFFF';

    // Step 4: Font selection
    let headerFont = 'Calibri'; // Default

    const fontResponse = ui.prompt(
      'Font Selection',
      'Choose font style:\n1 = Calibri (default)\n2 = Arial\n3 = Times New Roman\n4 = Courier New\n\nEnter 1-4 or leave blank for default',
      ui.ButtonSet.OK_CANCEL
    );

    if (fontResponse.getSelectedButton() === ui.Button.OK) {
      const fontChoice = fontResponse.getResponseText().trim();

      switch (fontChoice) {
        case '1':
          headerFont = 'Calibri';
          break;
        case '2':
          headerFont = 'Arial';
          break;
        case '3':
          headerFont = 'Times New Roman';
          break;
        case '4':
          headerFont = 'Courier New';
          break;
        default:
          // Invalid or blank - use default (Calibri)
          headerFont = 'Calibri';
      }
    }

    // Step 5: Leaderboard color (always default - no prompt)
    const leaderboardBgColor = '#434343';
    const leaderboardTextColor = '#FFFFFF';

    // Return customization settings object
    const settings = {
      headerNewCarBgColor: newCarBgColor,
      headerNewCarTextColor: newCarTextColor,
      headerUsedCarBgColor: usedCarBgColor,
      headerUsedCarTextColor: usedCarTextColor,
      headerLeaderboardBgColor: leaderboardBgColor,
      headerLeaderboardTextColor: leaderboardTextColor,
      headerFont: headerFont
    };

    Logger.log('Customization settings collected: ' + JSON.stringify(settings));
    return settings;

  } catch (e) {
    logWarning('promptForCustomization', 'Error prompting user for customization', { error: e.toString() });
    // Return null to use defaults
    return null;
  }
}

/**
 * Checks for and creates the TODAY sheet if missing
 * Per setupsheet_headers.md:
 * - Headers: [A:G] #, CUSTOMER, FI, MODEL, STOCK #, TRADE STK#, SALES PERSON
 *           [H] blank separator
 *           [I:N] CUSTOMER, FI, MODEL, STOCK #, TRADE STK#, SALES PERSON
 *           [O] blank separator
 *           [P:R] SALESPERSON, MTD SALES, 3mo. AVERAGE
 * - Font: Calibri, sizes: A:E,G,I:L,N=18pt, F&M=10pt, P:R=14pt
 * - Column widths as specified in documentation
 *
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss - The active spreadsheet
 * @param {Object} results - Results object to track created/existing sheets
 * @returns {void}
 */
function checkAndCreateTodaySheet(ss, results) {
  const sheetName = "TODAY";
  try {
    let sheet = ss.getSheetByName(sheetName);

    if (sheet) {
      results.existed.push(sheetName);
      Logger.log(sheetName + " sheet already exists.");
      return;
    }

    // Create the sheet
    sheet = ss.insertSheet(sheetName);
    Logger.log("Creating " + sheetName + " sheet...");

    // Get customization settings if they exist
    const customizationJson = PropertiesService.getDocumentProperties().getProperty('SETUP_CUSTOMIZATION');
    let settings = null;
    if (customizationJson) {
      try {
        settings = JSON.parse(customizationJson);
      } catch (e) {
        logWarning('checkAndCreateTodaySheet', 'Error parsing customization settings', { error: e.toString() });
      }
    }

    // Set defaults if no customization
    const newCarBg = settings?.headerNewCarBgColor || "#234070";
    const newCarText = settings?.headerNewCarTextColor || "#FFFFFF";
    const usedCarBg = settings?.headerUsedCarBgColor || "#424242";
    const usedCarText = settings?.headerUsedCarTextColor || "#FFFFFF";
    const leaderboardBg = settings?.headerLeaderboardBgColor || "#434343";
    const leaderboardText = settings?.headerLeaderboardTextColor || "#FFFFFF";
    const headerFont = settings?.headerFont || "Calibri";

    // Set up headers (Row 1) - per setupsheet_headers.md
    // New car sales [A:G], separator [H], Used car sales [I:N], separator [O], Leaderboard [P:R]
    const headers = [
      [
        "#", "CUSTOMER", "FI", "NEW MODEL", "STOCK #", "TRADE STK#", "SALESPERSON", // A:G
        "", // H - separator
        "CUSTOMER", "FI", "USED MODEL", "STOCK #", "TRADE STK#", "SALESPERSON", // I:N
        "", // O - separator
        "LEADERBOARD", "MTD SALES", "3mo. AVG" // P, Q, R
      ]
    ];
    sheet.getRange(1, 1, 1, 18).setValues(headers);

    // Format NewCar headers (A:G)
    sheet.getRange(1, 1, 1, 7)
      .setFontWeight("bold")
      .setHorizontalAlignment("center")
      .setBackground(newCarBg)
      .setFontColor(newCarText)
      .setFontFamily(headerFont);

    // Format UsedCar headers (I:N)
    sheet.getRange(1, 9, 1, 6)
      .setFontWeight("bold")
      .setHorizontalAlignment("center")
      .setBackground(usedCarBg)
      .setFontColor(usedCarText)
      .setFontFamily(headerFont);

    // Format Leaderboard headers (P:R)
    sheet.getRange(1, 16, 1, 3)
      .setFontWeight("bold")
      .setHorizontalAlignment("center")
      .setBackground(leaderboardBg)
      .setFontColor(leaderboardText)
      .setFontFamily(headerFont);

    // Populate leaderboard with salespeople from SALESPEOPLE sheet
    try {
      const salesSheet = ss.getSheetByName("SALESPEOPLE");
      if (salesSheet) {
        const lastRow = salesSheet.getLastRow();
        if (lastRow > 1) {
          // Get FULL NAMEs from column A, starting from row 2
          const fullNames = salesSheet.getRange(2, 1, lastRow - 1, 1).getValues();

          // Filter to get only non-empty names
          const validNames = fullNames
            .map(row => String(row[0]).trim())
            .filter(name => name);

          // Calculate dynamic range based on actual salesperson count
          const salespersonCount = Math.min(Math.max(1, validNames.length), 200);
          const endRow = salespersonCount + 1; // +1 because start row is 2
          const leaderboardRangeA1 = `P2:R${endRow}`;

          // Prepare data for leaderboard (only for actual salespeople)
          const leaderboardData = [];
          for (let i = 0; i < salespersonCount; i++) {
            if (i < validNames.length) {
              // Add salesperson name with 0 for MTD and 3mo. AVERAGE
              leaderboardData.push([validNames[i], 0, 0]);
            } else {
              // Should not happen with correct count, but safety fallback
              leaderboardData.push(["", 0, 0]);
            }
          }

          // Write to dynamic leaderboard range
          sheet.getRange(leaderboardRangeA1).setValues(leaderboardData);
          Logger.log("Leaderboard populated with " + validNames.length + " salespeople.");
        } else {
          Logger.log("SALESPEOPLE sheet exists but has no data rows. Leaderboard left empty.");
        }
      } else {
        Logger.log("SALESPEOPLE sheet not found. Leaderboard will be populated when SALESPEOPLE sheet is created.");
      }
    } catch (e) {
      logWarning('checkAndCreateTodaySheet', 'Could not populate leaderboard from SALESPEOPLE sheet', { error: e.toString() });
      // Continue with setup even if leaderboard population fails
    }

    // Set font to configured font for entire sheet
    sheet.getRange("A:R").setFontFamily(headerFont);
    sheet.getRange("A:R").setFontWeight("bold");
    sheet.getRange("A:R").setHorizontalAlignment("center");

    // Left-align leaderboard names (column P)
    sheet.getRange("P2:P").setHorizontalAlignment("left");



    // Set text wrapping for specific columns
    sheet.getRange("F1").setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP); // NewCar TRADE STK#
    sheet.getRange("M1").setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP); // UsedCar TRADE STK#
    sheet.getRange("Q1").setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP); // MTD SALES
    sheet.getRange("R1").setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP); // 3mo. AVERAGE

    // Set font sizes per documentation
    // A:N = 18pt
    sheet.getRange("A:N").setFontSize(18);
    // F (TRADE STK# for new cars) = 10pt
    sheet.getRange("F:F").setFontSize(10);
    // M (TRADE STK# for used cars) = 10pt
    sheet.getRange("M:M").setFontSize(10);
    // P:R (Leaderboard) = 14pt
    sheet.getRange("P:R").setFontSize(14);

    // Set number formats for MTD and Avg columns
    sheet.getRange("P:P").setNumberFormat("0.#");
    sheet.getRange("R:R").setNumberFormat("0.#");

    // Add incremental count in column A (A2:A51)
    const countData = [];
    for (let i = 1; i <= 50; i++) {
      countData.push([i]);
    }
    sheet.getRange(2, 1, 50, 1).setValues(countData);

    // Add borders to NEW data range
    sheet.getRange("A1:G51").setBorder(
      true, true, true, true, true, true,
      "black", SpreadsheetApp.BorderStyle.SOLID
    );

    // Add borders to USED data range
    sheet.getRange("I1:N51").setBorder(
      true, true, true, true, true, true,
      "black", SpreadsheetApp.BorderStyle.SOLID
    );

    // Add borders to LEADERBOARD data range
    sheet.getRange("P1:R51").setBorder(
      true, true, true, true, true, true,
      "black", SpreadsheetApp.BorderStyle.SOLID
    );

    // Set column widths per documentation
    sheet.setColumnWidth(1, 30);   // A: #
    sheet.setColumnWidth(2, 165);  // B: CUSTOMER
    sheet.setColumnWidth(3, 35);   // C: FI
    sheet.setColumnWidth(4, 150);  // D: MODEL
    sheet.setColumnWidth(5, 125);  // E: STOCK #
    sheet.setColumnWidth(6, 60);   // F: TRADE STK#
    sheet.setColumnWidth(7, 195);  // G: SALES PERSON
    sheet.setColumnWidth(8, 5);    // H: separator
    sheet.setColumnWidth(9, 165);  // I: CUSTOMER (used)
    sheet.setColumnWidth(10, 35);  // J: FI (used)
    sheet.setColumnWidth(11, 150); // K: MODEL (used)
    sheet.setColumnWidth(12, 125); // L: STOCK # (used)
    sheet.setColumnWidth(13, 60);  // M: TRADE STK# (used)
    sheet.setColumnWidth(14, 195); // N: SALES PERSON (used)
    sheet.setColumnWidth(15, 5);   // O: separator
    sheet.setColumnWidth(16, 170); // P: MTD SALES
    sheet.setColumnWidth(17, 70);  // Q: (middle column)
    sheet.setColumnWidth(18, 80);  // R: 3mo. AVERAGE

    // Apply conditional formatting rules
    applyTodayConditionalFormatting(sheet);

    // Auto-resize columns A through R (1-18) to optimize column widths
    // sheet.autoResizeColumns(1, 18);

    results.created.push(sheetName);
    Logger.log(sheetName + " sheet created successfully.");

  } catch (e) {
    const error = sheetName + ": " + e.message;
    results.errors.push(error);
    logError('checkAndCreateTodaySheet', e, { sheetName });
  }
}

/**
 * Applies conditional formatting rules to the TODAY sheet
 * Updated for corrected column layout with FI column:
 * - New car STOCK # is column E
 * - Used car STOCK # is column L
 * - DEPOSITS STOCK # is column G
 * Applies duplicate detection and deposit check rules
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - The TODAY sheet
 * @returns {void}
 */
function applyTodayConditionalFormatting(sheet) {
  try {
    const rules = [];

    // Get colors from configuration, fallback to defaults
    let duplicateFillColor = "#b4ff0c";
    let duplicateTextColor = "#ff0000";

    try {
      const config = getVisualConfig();
      if (config) {
        duplicateFillColor = config.duplicateStockFillColor || duplicateFillColor;
        duplicateTextColor = config.duplicateStockTextColor || duplicateTextColor;
      }
    } catch (configError) {
      logWarning('applyTodayConditionalFormatting', 'Using default colors for CF', { error: configError.toString() });
    }

    // Rule 1: Duplicate Stock Numbers (New Cars) - A2:G101
    // Stock # is in column E
    const newCarRange = sheet.getRange("A2:G101");
    rules.push(
      SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied("=COUNTIF($E$2:$E$101,$E2)>1")
        .setBackground(duplicateFillColor)
        .setFontColor(duplicateTextColor)
        .setRanges([newCarRange])
        .build()
    );

    // Rule 2: Duplicate Stock Numbers (Used Cars) - I2:N101
    // Stock # is in column L
    const usedCarRange = sheet.getRange("I2:N101");
    rules.push(
      SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied("=COUNTIF($L$2:$L$101,$L2)>1")
        .setBackground(duplicateFillColor)
        .setFontColor(duplicateTextColor)
        .setRanges([usedCarRange])
        .build()
    );

    // Rule 3: Stock in Deposits (New Cars) - A2:G101
    // Check if new car stock (column E) exists in DEPOSITS!G:G (STOCK # column)
    rules.push(
      SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied('=COUNTIF(INDIRECT("DEPOSITS!G:G"),$E2)>0')
        .setBackground(duplicateFillColor)
        .setFontColor(duplicateTextColor)
        .setRanges([newCarRange])
        .build()
    );

    // Rule 4: Stock in Deposits (Used Cars) - I2:N101
    // Check if used car stock (column L) exists in DEPOSITS!G:G (STOCK # column)
    rules.push(
      SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied('=COUNTIF(INDIRECT("DEPOSITS!G:G"),$L2)>0')
        .setBackground(duplicateFillColor)
        .setFontColor(duplicateTextColor)
        .setRanges([usedCarRange])
        .build()
    );

    sheet.setConditionalFormatRules(rules);
    Logger.log("Conditional formatting applied to TODAY sheet.");

  } catch (e) {
    logError('applyTodayConditionalFormatting', e);
  }
}

/**
 * Checks for and creates the MONTHLY sheet if missing
 * Per setupsheet_headers.md:
 * - Headers: [A:G] #, CUSTOMER, FI, MODEL, STOCK #, TRADE STK#, SALES PERSON
 *           [H] blank separator
 *           [I:N] CUSTOMER, FI, MODEL, STOCK #, TRADE STK#, SALES PERSON
 *           [O] blank separator
 *           [P:R] SALESPERSON, SALES, 3mo. AVERAGE
 *           [S:X] MONTHLY ANALYTICS (merged cells)
 * - Font: Calibri, entire sheet 10pt
 * - Column widths: A:45, B:115, C:45, D:100, E:70, F:90, G:125, etc.
 *
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss - The active spreadsheet
 * @param {Object} results - Results object to track created/existing sheets
 * @returns {void}
 */
function checkAndCreateMonthlySheet(ss, results) {
  const sheetName = "MONTHLY";
  try {
    let sheet = ss.getSheetByName(sheetName);

    if (sheet) {
      results.existed.push(sheetName);
      Logger.log(sheetName + " sheet already exists.");
      return;
    }

    // Create the sheet
    sheet = ss.insertSheet(sheetName);
    Logger.log("Creating " + sheetName + " sheet...");

    // Get customization settings if they exist
    const customizationJson = PropertiesService.getDocumentProperties().getProperty('SETUP_CUSTOMIZATION');
    let settings = null;
    if (customizationJson) {
      try {
        settings = JSON.parse(customizationJson);
      } catch (e) {
        logWarning('checkAndCreateMonthlySheet', 'Error parsing customization settings', { error: e.toString() });
      }
    }

    // Set defaults if no customization
    const newCarBg = settings?.headerNewCarBgColor || "#234070";
    const newCarText = settings?.headerNewCarTextColor || "#FFFFFF";
    const usedCarBg = settings?.headerUsedCarBgColor || "#424242";
    const usedCarText = settings?.headerUsedCarTextColor || "#FFFFFF";
    const leaderboardBg = settings?.headerLeaderboardBgColor || "#434343";
    const leaderboardText = settings?.headerLeaderboardTextColor || "#FFFFFF";
    const headerFont = settings?.headerFont || "Calibri";

    // Set up headers (Row 1) - per setupsheet_headers.md
    // New car sales [A:G], separator [H], Used car sales [I:N], separator [O], Leaderboard [P:R], Analytics [S:X]
    const headers = [
      [
        "#", "CUSTOMER", "FI", "NEW MODEL", "STOCK #", "TRADE STK#", "SALESPERSON", // A:G
        "", // H - separator
        "CUSTOMER", "FI", "USED MODEL", "STOCK #", "TRADE STK#", "SALESPERSON", // I:N
        "", // O - separator
        "LEADERBOARD", "SALES", "3mo. AVG", // P:R
        "MONTHLY ANALYTICS", "", "", "", "", "" // S:X (will be merged)
      ]
    ];
    sheet.getRange(1, 1, 1, 24).setValues(headers);

    // Merge cells for MONTHLY ANALYTICS header (S1:X1)
    sheet.getRange("S1:X1").merge();

    // Format NewCar headers (A:G)
    sheet.getRange(1, 1, 1, 7)
      .setFontWeight("bold")
      .setHorizontalAlignment("center")
      .setBackground(newCarBg)
      .setFontColor(newCarText)
      .setFontFamily(headerFont);

    // Format UsedCar headers (I:N)
    sheet.getRange(1, 9, 1, 6)
      .setFontWeight("bold")
      .setHorizontalAlignment("center")
      .setBackground(usedCarBg)
      .setFontColor(usedCarText)
      .setFontFamily(headerFont);

    // Format Leaderboard headers (P:R)
    sheet.getRange(1, 16, 1, 3)
      .setFontWeight("bold")
      .setHorizontalAlignment("center")
      .setBackground(leaderboardBg)
      .setFontColor(leaderboardText)
      .setFontFamily(headerFont);

    // Format MONTHLY ANALYTICS header (S:X) - keep existing gray formatting
    sheet.getRange(1, 19, 1, 6)
      .setFontWeight("bold")
      .setHorizontalAlignment("center")
      .setBackground("#E0E0E0");

    // Set font to configured font, 10pt for entire sheet
    sheet.getRange("A:X").setFontFamily(headerFont);
    sheet.getRange("A:X").setFontSize(10);
    sheet.getRange("A:X").setFontWeight("bold");

    // Set column widths per documentation
    sheet.setColumnWidth(1, 45);   // A: #
    sheet.setColumnWidth(2, 115);  // B: CUSTOMER
    sheet.setColumnWidth(3, 45);   // C: FI
    sheet.setColumnWidth(4, 100);  // D: MODEL
    sheet.setColumnWidth(5, 70);   // E: STOCK #
    sheet.setColumnWidth(6, 90);   // F: TRADE STK#
    sheet.setColumnWidth(7, 125);  // G: SALES PERSON
    sheet.setColumnWidth(8, 5);    // H: separator
    sheet.setColumnWidth(9, 115);  // I: CUSTOMER (used)
    sheet.setColumnWidth(10, 45);  // J: FI (used)
    sheet.setColumnWidth(11, 100); // K: MODEL (used)
    sheet.setColumnWidth(12, 70);  // L: STOCK # (used)
    sheet.setColumnWidth(13, 90);  // M: TRADE STK# (used)
    sheet.setColumnWidth(14, 125); // N: SALES PERSON (used)
    sheet.setColumnWidth(15, 5);   // O: separator
    sheet.setColumnWidth(16, 160); // P: MTD SALES
    sheet.setColumnWidth(17, 50);  // Q: (middle)
    sheet.setColumnWidth(18, 60);  // R: 3mo. AVERAGE
    sheet.setColumnWidth(19, 180); // S: MONTHLY ANALYTICS
    sheet.setColumnWidth(20, 140); // T: analytics column
    sheet.setColumnWidth(21, 120); // U: analytics column
    sheet.setColumnWidth(22, 100); // V: analytics column
    sheet.setColumnWidth(23, 100); // W: analytics column
    sheet.setColumnWidth(24, 100); // X: analytics column

    // Auto-resize columns A through X (1-24) to optimize column widths
   // sheet.autoResizeColumns(1, 24);

    results.created.push(sheetName);
    Logger.log(sheetName + " sheet created successfully.");

  } catch (e) {
    const error = sheetName + ": " + e.message;
    results.errors.push(error);
    logError('checkAndCreateMonthlySheet', e, { sheetName });
  }
}

/**
 * Checks for and creates the SALESPEOPLE sheet if missing
 * Per setupsheet_headers.md:
 * - Headers: [A:C] FULL NAME, ALIASES, DISPLAY CODE
 * - Column widths: All 150
 * - Font: Calibri, 10pt (default)
 * Includes example data to guide users
 *
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss - The active spreadsheet
 * @param {Object} results - Results object to track created/existing sheets
 * @returns {void}
 */
function checkAndCreateSalespeopleSheet(ss, results) {
  const sheetName = "SALESPEOPLE";
  try {
    let sheet = ss.getSheetByName(sheetName);

    if (sheet) {
      results.existed.push(sheetName);
      Logger.log(sheetName + " sheet already exists.");
      return;
    }

    // Create the sheet
    sheet = ss.insertSheet(sheetName);
    Logger.log("Creating " + sheetName + " sheet...");

    // Set up headers (Row 1) - per setupsheet_headers.md (uppercase)
    const headers = [
      ["FULL NAME", "ALIASES", "DISPLAY CODE"]
    ];
    sheet.getRange(1, 1, 1, 3).setValues(headers);

    // Format header row
    sheet.getRange(1, 1, 1, 3)
      .setFontWeight("bold")
      .setHorizontalAlignment("center")
      .setBackground("#E0E0E0");

    // Set font to Calibri, 10pt for entire sheet
    sheet.getRange("A:C").setFontFamily("Calibri");
    sheet.getRange("A:C").setFontSize(10);
    sheet.getRange("A:C").setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);

    // Add example data to help users understand the format
    const exampleData = [
      ["John Smith", "JS, Johnny", "JS"],
      ["Jane Doe", "JD, Jane", "JD"],
      ["Bob Wilson", "BW, Bob, Wilson", "BW"]
    ];
    sheet.getRange(2, 1, 3, 3).setValues(exampleData);

    // Set column widths per documentation (all 150)
    sheet.setColumnWidth(1, 150); // FULL NAME
    sheet.setColumnWidth(2, 150); // ALIASES
    sheet.setColumnWidth(3, 150); // DISPLAY CODE

    results.created.push(sheetName);
    Logger.log(sheetName + " sheet created successfully.");

  } catch (e) {
    const error = sheetName + ": " + e.message;
    results.errors.push(error);
    logError('checkAndCreateSalespeopleSheet', e, { sheetName });
  }
}

/**
 * Checks for and creates the DEPOSITS sheet if missing
 * Per setupsheet_headers.md:
 * - Headers: [A:N] DATE, NEW/USED, YEAR, MAKE, MODEL, ORDER #, STOCK #,
 *                  SALESPERSON, BDC, CUSTOMER, DIRECTOR, PHONE #, EST DELIVERY DATE, NOTES
 * - Complete restructure from 7 to 14 columns
 * - Font: Calibri, 10pt (default)
 * - STOCK # column (G) is critical for TODAY sheet conditional formatting
 *
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss - The active spreadsheet
 * @param {Object} results - Results object to track created/existing sheets
 * @returns {void}
 */
function checkAndCreateDepositsSheet(ss, results) {
  const sheetName = "DEPOSITS";
  try {
    let sheet = ss.getSheetByName(sheetName);

    if (sheet) {
      results.existed.push(sheetName);
      Logger.log(sheetName + " sheet already exists.");
      return;
    }

    // Create the sheet
    sheet = ss.insertSheet(sheetName);
    Logger.log("Creating " + sheetName + " sheet...");

    // Set up headers (Row 1) - per setupsheet_headers.md
    // Complete restructure: 7 columns -> 14 columns (A:N)
    const headers = [
      [
        "DATE", "NEW/USED", "YEAR", "MAKE", "MODEL", "ORDER #", "STOCK #",
        "SALESPERSON", "BDC", "CUSTOMER", "DIRECTOR", "PHONE #", "EST DELIVERY DATE", "NOTES"
      ]
    ];
    sheet.getRange(1, 1, 1, 14).setValues(headers);

    // Format header row
    sheet.getRange(1, 1, 1, 14)
      .setFontWeight("bold")
      .setHorizontalAlignment("center")
      .setBackground("#E0E0E0");

    // Set font to Calibri, 10pt for entire sheet
    sheet.getRange("A:N").setFontFamily("Calibri");
    sheet.getRange("A:N").setFontSize(10);
    sheet.getRange("A:N").setVerticalAlignment("center");
    sheet.getRange("A:N").setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);
    sheet.getRange("A:N").setHorizontalAlignment("center");

    // Set column widths for better display
    sheet.setColumnWidth(1, 100);  // A: DATE
    sheet.setColumnWidth(2, 80);   // B: NEW/USED
    sheet.setColumnWidth(3, 60);   // C: YEAR
    sheet.setColumnWidth(4, 120);  // D: MAKE
    sheet.setColumnWidth(5, 120);  // E: MODEL
    sheet.setColumnWidth(6, 100);  // F: ORDER #
    sheet.setColumnWidth(7, 120);  // G: STOCK # (critical for TODAY sheet CF)
    sheet.setColumnWidth(8, 120);  // H: SALESPERSON
    sheet.setColumnWidth(9, 100);  // I: BDC
    sheet.setColumnWidth(10, 150); // J: CUSTOMER
    sheet.setColumnWidth(11, 120); // K: DIRECTOR
    sheet.setColumnWidth(12, 120); // L: PHONE #
    sheet.setColumnWidth(13, 120); // M: EST DELIVERY DATE
    sheet.setColumnWidth(14, 200); // N: NOTES

    // Apply conditional formatting rules
    applyDepositsConditionalFormatting(sheet);

    results.created.push(sheetName);
    Logger.log(sheetName + " sheet created successfully.");

  } catch (e) {
    const error = sheetName + ": " + e.message;
    results.errors.push(error);
    logError('checkAndCreateDepositsSheet', e, { sheetName });
  }
}

/**
 * Applies conditional formatting rules to the DEPOSITS sheet
 * Highlights rows where stock numbers match entries on the TODAY sheet
 * This mirrors the "Stock in Deposits" rules from the TODAY sheet (lines 471-491)
 * - DEPOSITS STOCK # is column G
 * - TODAY New car STOCK # is column E
 * - TODAY Used car STOCK # is column L
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - The DEPOSITS sheet
 * @returns {void}
 */
function applyDepositsConditionalFormatting(sheet) {
  try {
    const rules = [];

    // Get colors from configuration, fallback to defaults
    let duplicateFillColor = "#b4ff0c";
    let duplicateTextColor = "#ff0000";

    try {
      const config = getVisualConfig();
      if (config) {
        duplicateFillColor = config.duplicateStockFillColor || duplicateFillColor;
        duplicateTextColor = config.duplicateStockTextColor || duplicateTextColor;
      }
    } catch (configError) {
      logWarning('applyDepositsConditionalFormatting', 'Using default colors for CF', { error: configError.toString() });
    }

    // Define the data range for DEPOSITS (A2:N1000 to cover plenty of rows)
    const depositsRange = sheet.getRange("A2:N1000");

    // Rule 1: Stock in TODAY New Cars (column E)
    // Check if DEPOSITS stock (column G) exists in TODAY!E:E (new car stock numbers)
    rules.push(
      SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied('=COUNTIF(INDIRECT("TODAY!E:E"),$G2)>0')
        .setBackground(duplicateFillColor)
        .setFontColor(duplicateTextColor)
        .setRanges([depositsRange])
        .build()
    );

    // Rule 2: Stock in TODAY Used Cars (column L)
    // Check if DEPOSITS stock (column G) exists in TODAY!L:L (used car stock numbers)
    rules.push(
      SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied('=COUNTIF(INDIRECT("TODAY!L:L"),$G2)>0')
        .setBackground(duplicateFillColor)
        .setFontColor(duplicateTextColor)
        .setRanges([depositsRange])
        .build()
    );

    sheet.setConditionalFormatRules(rules);
    Logger.log("Conditional formatting applied to DEPOSITS sheet.");

  } catch (e) {
    logError('applyDepositsConditionalFormatting', e);
  }
}

/**
 * Shows a summary dialog to the user with setup results
 * Displays created sheets, existing sheets, and any errors encountered
 * @param {Object} results - Results object containing existed, created, and errors arrays
 * @returns {void}
 */
function showSetupSummary(results) {
  const ui = SpreadsheetApp.getUi();
  let message = "";

  // Build summary message
  if (results.created.length === 0 && results.errors.length === 0) {
    message = "All required sheets already exist:\n\n";
    message += results.existed.map(name => "✓ " + name).join("\n");
    message += "\n\nNo setup needed. Your spreadsheet is ready to use!";

    ui.alert("Setup Complete", message, ui.ButtonSet.OK);
    return;
  }

  if (results.created.length > 0) {
    message += "SHEETS CREATED:\n";
    message += results.created.map(name => "✓ " + name).join("\n");
    message += "\n\n";
  }

  if (results.existed.length > 0) {
    message += "SHEETS ALREADY EXISTED:\n";
    message += results.existed.map(name => "• " + name).join("\n");
    message += "\n\n";
  }

  if (results.errors.length > 0) {
    message += "ERRORS ENCOUNTERED:\n";
    message += results.errors.map(error => "✗ " + error).join("\n");
    message += "\n\n";
  }

  if (results.errors.length > 0) {
    message += "Some sheets could not be created. Please check the errors above.";
    ui.alert("Setup Completed with Errors", message, ui.ButtonSet.OK);
  } else {
    message += "Setup complete! Your sales log spreadsheet is ready to use.";
    ui.alert("Setup Successful", message, ui.ButtonSet.OK);
  }
}
