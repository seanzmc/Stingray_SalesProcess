 /*This is how to clean and normalize the MONTHLY sales data before merging with the CDK_DATA sheet.*/
function reformatDailySales() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("MONTHLY");
  const data = sheet.getRange("A:N").getValues();
  const output = [];
  let currentDate = "";

  for (let i = 0; i < data.length; i++) {
    const row = data[i];

    // Detect a date row (merged date previously in A)
    if (row[0] instanceof Date) {
      currentDate = row[0];
      continue;
    }

    // Skip blank rows
    const isEmpty = row.join("").trim() === "";
    if (isEmpty) continue;

    // NEW sale block (columns B–G → indexes 1–6)
    const newData = row.slice(1, 7);
    // Filter out rows that do not have a valid FI initial
    const hasNewFI = newData[1] && /^[A-Za-z]$/.test(String(newData[1]));
    if (newData.join('').trim() !== '' && hasNewFI) {
      output.push([currentDate, 'NEW', ...newData]);
    }

    // USED sale block (columns I–N → indexes 8–13)
    const usedData = row.slice(8, 14);
    // Filter out rows that do not have a valid FI initial
    const hasUsedFI = usedData[1] && /^[A-Za-z]$/.test(String(newData[1]));
    if (usedData.join('').trim() !== '' && hasUsedFI) {
      output.push([currentDate, 'USED', ...usedData]);
    }
  }

  // Create new sheet for clean data
  const cleaned = ss.getSheetByName("CLEANED") || ss.insertSheet("CLEANED");
  cleaned.clear();
  const headers = [
    "Date",
    "Type",
    "Customer",
    "FI",
    "Model",
    "StockNo",
    "Trade",
    "Sales Person",
  ];
  cleaned.appendRow(headers);
  cleaned.getRange(2, 1, output.length, output[0].length).setValues(output);

  SpreadsheetApp.getUi().alert('Reformat complete. See "CLEANED" tab.');
}
/*The resulting output will be in a new sheet named CLEANED. This is the data that will be merged with the CDK_DATA sheet.
The column that will have the most congruency is the StockNo column. It will ALWAYS be column F in the CLEANED sheet. For the purpose of getting this to work, hardcode the StockNo column in CDK_DATA to D. */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Data Tools')
    .addItem('Normalize Sales Log', 'reformatDailySales')
    .addToUi();
}

