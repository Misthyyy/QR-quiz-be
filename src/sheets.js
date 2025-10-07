import { google } from "googleapis";

function getSheetsClient() {
  const jwt = new google.auth.JWT(
    process.env.SERVICE_ACCOUNT_EMAIL,
    undefined,
    process.env.SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    ["https://www.googleapis.com/auth/spreadsheets.readonly"]
  );
  return google.sheets({ version: "v4", auth: jwt });
}

export async function loadPools() {
  const sheets = getSheetsClient();
  const spreadsheetId = process.env.SPREADSHEET_ID;

  const ranges = ["PoolA!A2:F", "PoolB!A2:F"];
  const { data } = await sheets.spreadsheets.values.batchGet({
    spreadsheetId,
    ranges,
  });

  const [aRows, bRows] = data.valueRanges.map((v) => v.values || []);
  const mapRow = (r, idx) => ({
    id: idx + 1,
    q: r[0],
    options: [r[1], r[2], r[3], r[4]],
    correct: Math.max(0, (parseInt(r[5], 10) || 1) - 1),
  });

  return {
    A: aRows.map(mapRow),
    B: bRows.map(mapRow),
  };
}

export async function loadDonorPhones() {
  const sheets = getSheetsClient();
  const spreadsheetId = process.env.SPREADSHEET_ID;

  const range = "PoolC!A2:B"; // cột A: tên, cột B: số điện thoại
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
  });

  const rows = data.values || [];
  const donors = rows
    .filter((r) => r[1]) // chỉ lấy dòng có số điện thoại
    .map((r, i) => ({
      id: i + 1,
      name: r[0] || "",
      phone: r[1].trim(),
    }));

  return donors;
}
