import { zipSync } from "fflate";

export const REGISTRATION_EXPORT_COLUMNS = [
  "Player name", "Registration ID", "Phone / mobile", "Facebook profile", "Club / group",
  "Partner", "Division", "Shirt size", "Payment status", "Payment proof",
] as const;

export type RegistrationExportRow = {
  name: string;
  id: string;
  phone?: string;
  facebookProfile?: string;
  club?: string;
  partnerName?: string;
  divisionName: string;
  shirtSize?: string;
  paid: boolean;
  paymentProofUrl?: string;
};

export type RegistrationExportSheet = { name: string; rows: RegistrationExportRow[] };

function csvCell(value: unknown) {
  let text = String(value ?? "");
  if (/^[\s]*[=+@]/.test(text) || /^[\s]*-[0-9]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}

export function registrationSheetCsv(sheet: RegistrationExportSheet) {
  const records = [
    [...REGISTRATION_EXPORT_COLUMNS],
    ...sheet.rows.map(row => [
      row.name, row.id, row.phone, row.facebookProfile, row.club, row.partnerName,
      row.divisionName, row.shirtSize, row.paid ? "Validated" : "Pending", row.paymentProofUrl || "",
    ]),
  ];
  return "\uFEFF" + records.map(record => record.map(csvCell).join(",")).join("\r\n");
}

function xml(value: unknown) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}
function colName(index: number) {
  let value = index + 1, result = "";
  while (value) { const remainder = (value - 1) % 26; result = String.fromCharCode(65 + remainder) + result; value = Math.floor((value - 1) / 26); }
  return result;
}
function uniqueSheetNames(sheets: RegistrationExportSheet[]) {
  const seen = new Set<string>();
  return sheets.map((sheet, index) => {
    const base = (sheet.name || `Division ${index + 1}`).replace(/[\\/?*:[\]]/g, " ").trim().slice(0, 31) || `Division ${index + 1}`;
    let name = base, suffix = 2;
    while (seen.has(name.toLowerCase())) {
      const tail = ` (${suffix++})`;
      name = base.slice(0, 31 - tail.length) + tail;
    }
    seen.add(name.toLowerCase());
    return name;
  });
}

export function buildRegistrationWorkbook(sheets: RegistrationExportSheet[]) {
  const selected = sheets.length ? sheets : [{ name: "Registrations", rows: [] }];
  const names = uniqueSheetNames(selected);
  const files: Record<string, Uint8Array> = {};
  const sheetRefs: string[] = [];
  const sheetRelationships: string[] = [];

  selected.forEach((sheet, sheetIndex) => {
    const sheetId = sheetIndex + 1;
    const rows = [
      REGISTRATION_EXPORT_COLUMNS.map((header, column) => ({ value: header, column })),
      ...sheet.rows.map(row => [
        row.name, row.id, row.phone || "", row.facebookProfile || "", row.club || "",
        row.partnerName || "", row.divisionName, row.shirtSize || "", row.paid ? "Validated" : "Pending",
        row.paymentProofUrl ? "View payment proof" : "No payment proof uploaded",
      ].map((value, column) => ({ value, column, link: column === 9 ? row.paymentProofUrl : undefined }))),
    ];
    const relationships: string[] = [];
    const sheetRows = rows.map((cells, rowIndex) => {
      const cellXml = cells.map(cell => {
        const reference = `${colName(cell.column)}${rowIndex + 1}`;
        if (cell.link) {
          const rid = `rId${relationships.length + 1}`;
          relationships.push(`<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${xml(cell.link)}" TargetMode="External"/>`);
          return `<c r="${reference}" t="inlineStr"><is><t>View payment proof</t></is></c>`;
        }
        return `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${xml(cell.value)}</t></is></c>`;
      }).join("");
      return `<row r="${rowIndex + 1}">${cellXml}</row>`;
    }).join("");
    // Link references are assigned in row order; these relationship IDs match the exported proof cells.
    let hyperlinkIndex = 0;
    const exactHyperlinks = rows.slice(1).flatMap((cells, index) => cells.filter(cell => cell.link).map(cell => `<hyperlink ref="${colName(cell.column)}${index + 2}" r:id="rId${++hyperlinkIndex}"/>`)).join("");
    files[`xl/worksheets/sheet${sheetId}.xml`] = new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetData>${sheetRows}</sheetData>${exactHyperlinks ? `<hyperlinks>${exactHyperlinks}</hyperlinks>` : ""}</worksheet>`);
    files[`xl/worksheets/_rels/sheet${sheetId}.xml.rels`] = new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships.join("")}</Relationships>`);
    sheetRefs.push(`<sheet name="${xml(names[sheetIndex])}" sheetId="${sheetId}" r:id="rId${sheetId}"/>`);
    sheetRelationships.push(`<Relationship Id="rId${sheetId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${sheetId}.xml"/>`);
  });

  files["[Content_Types].xml"] = new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${selected.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`);
  files["_rels/.rels"] = new TextEncoder().encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  files["xl/workbook.xml"] = new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheetRefs.join("")}</sheets></workbook>`);
  files["xl/_rels/workbook.xml.rels"] = new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheetRelationships.join("")}</Relationships>`);
  return zipSync(files, { level: 6 });
}
