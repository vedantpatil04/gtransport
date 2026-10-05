import ExcelJS from 'exceljs';
import { formatCell, formatInstant, type Cell, type CellKind, type ReportDocument, type ReportTable } from '../report-document';

/**
 * Excel writer, for management and accounting review:
 *  - "Report": what the file is — company, report, period, financial year, applied filters, who
 *    generated it and when, the headline figures, and how they are calculated;
 *  - "Summary": every breakdown table, stacked;
 *  - one data sheet per record-level table, with a frozen header and filters.
 *
 * Values are stored as real numbers and dates, so they sum, sort and pivot. Money keeps two
 * decimals and is displayed with Indian grouping (₹1,25,450.00); dates are true Excel dates.
 */

/** Indian digit grouping (lakh, crore) for rupees. Negatives (reversals) keep their minus sign. */
const INR_FORMAT = '[>=10000000]"₹"##\\,##\\,##\\,##0.00;[>=100000]"₹"##\\,##\\,##0.00;"₹"##,##0.00';
const FORMATS: Partial<Record<CellKind, string>> = {
  inr: INR_FORMAT,
  rate: '"₹"#,##0.00',
  litres: '#,##0.000',
  count: '#,##0',
  number: '#,##0.##',
  percent: '0.0"%"',
  date: 'dd-mmm-yyyy',
  datetime: 'dd-mmm-yyyy hh:mm',
};

const NAVY = 'FF1B2B44';
const HEAD = 'FFECF0F5';
const IST_MS = 330 * 60_000;

/** A typed cell value for Excel, or text for anything that is not a number/date. */
function excelValue(value: Cell, kind: CellKind): string | number | Date | null {
  if (value === null || value === '') return null;
  switch (kind) {
    case 'inr':
    case 'rate':
    case 'litres':
    case 'count':
    case 'number':
    case 'percent': {
      const n = Number(value);
      return Number.isFinite(n) ? n : String(value);
    }
    case 'date':
      return /^\d{4}-\d{2}-\d{2}/.test(String(value)) ? new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`) : String(value);
    case 'datetime': {
      // Stored as India wall-clock time, which is how the business reads it.
      const instant = Date.parse(String(value));
      return Number.isNaN(instant) ? String(value) : new Date(instant + IST_MS);
    }
    default:
      return String(value);
  }
}

const sheetName = (title: string, used: Set<string>): string => {
  const base = title.replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 28) || 'Data';
  let name = base;
  for (let i = 2; used.has(name.toLowerCase()); i += 1) name = `${base.slice(0, 26)} ${i}`;
  used.add(name.toLowerCase());
  return name;
};

function writeTable(sheet: ExcelJS.Worksheet, table: ReportTable, startRow: number, options: { titled: boolean }): number {
  let rowNumber = startRow;
  if (options.titled) {
    const title = sheet.getRow(rowNumber);
    title.getCell(1).value = table.title;
    title.getCell(1).font = { bold: true, size: 12 };
    rowNumber += 1;
  }
  const header = sheet.getRow(rowNumber);
  table.columns.forEach((column, i) => {
    const cell = header.getCell(i + 1);
    cell.value = column.kind === 'inr' ? `${column.header} (₹)` : column.kind === 'datetime' ? `${column.header} (IST)` : column.header;
    cell.font = { bold: true, color: { argb: options.titled ? 'FF3C4655' : 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: options.titled ? HEAD : NAVY } };
    cell.alignment = { vertical: 'middle', wrapText: true };
  });
  const headerRow = rowNumber;
  rowNumber += 1;

  for (const values of table.rows) {
    const row = sheet.getRow(rowNumber);
    values.forEach((value, i) => {
      const column = table.columns[i]!;
      const cell = row.getCell(i + 1);
      cell.value = excelValue(value, column.kind);
      const format = FORMATS[column.kind];
      if (format && cell.value !== null && typeof cell.value !== 'string') cell.numFmt = format;
    });
    rowNumber += 1;
  }

  if (table.totals) {
    const row = sheet.getRow(rowNumber);
    table.totals.forEach((value, i) => {
      const column = table.columns[i]!;
      const cell = row.getCell(i + 1);
      cell.value = i === 0 ? String(value ?? '') : excelValue(value, column.kind);
      const format = FORMATS[column.kind];
      if (i > 0 && format && cell.value !== null && typeof cell.value !== 'string') cell.numFmt = format;
      cell.font = { bold: true };
      cell.border = { top: { style: 'thin' } };
    });
    rowNumber += 1;
  }

  const notes = [
    ...(table.totalRecords !== undefined && table.rows.length < table.totalRecords ? [`${table.rows.length} of ${table.totalRecords} records.`] : []),
    ...(table.note ? [table.note] : []),
    ...(!table.rows.length ? ['No records for this period and these filters.'] : []),
  ];
  for (const note of notes) {
    sheet.getRow(rowNumber).getCell(1).value = note;
    sheet.getRow(rowNumber).getCell(1).font = { italic: true, color: { argb: 'FF6E7682' } };
    rowNumber += 1;
  }

  if (!options.titled) {
    sheet.views = [{ state: 'frozen', ySplit: headerRow }];
    if (table.rows.length) sheet.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: headerRow + table.rows.length, column: table.columns.length } };
  }
  return rowNumber;
}

const widthFor = (kind: CellKind, hint = 1) => Math.round((kind === 'text' ? 18 : kind === 'datetime' ? 20 : kind === 'inr' ? 16 : 13) * Math.max(1, hint));

export async function writeXlsx(report: ReportDocument): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = report.company;
  workbook.created = report.generatedAt;
  workbook.title = `${report.company} — ${report.title}`;
  const used = new Set<string>();

  // ── Report (metadata) ──
  const meta = workbook.addWorksheet(sheetName('Report', used));
  meta.columns = [{ width: 34 }, { width: 60 }];
  const lines: [string, string | number | Date | null, string?][] = [
    [report.company, null],
    [report.title, null],
    ['', null],
    ...(report.period
      ? ([
          ['Period', report.period.label],
          ['From', new Date(`${report.period.from}T00:00:00.000Z`), FORMATS.date],
          ['To', new Date(`${report.period.to}T00:00:00.000Z`), FORMATS.date],
        ] as [string, string | Date, string?][])
      : []),
    ...(report.asOf && !report.period ? ([['As of', new Date(`${report.asOf}T00:00:00.000Z`), FORMATS.date]] as [string, Date, string][]) : []),
    ['Financial year', report.financialYears.join(', ') || '—'],
    ['Filters', report.filters.length ? '' : 'None'],
    ...report.filters.map((f) => [`   ${f.label}`, f.value] as [string, string]),
    ['Generated', formatInstant(report.generatedAt.toISOString())],
    ['Generated by', report.generatedBy],
  ];
  lines.forEach(([key, value, format], i) => {
    const row = meta.getRow(i + 1);
    row.getCell(1).value = key;
    row.getCell(2).value = value;
    if (format) row.getCell(2).numFmt = format;
    row.getCell(1).font = i < 2 ? { bold: true, size: i === 0 ? 14 : 12 } : { bold: true, color: { argb: 'FF6E7682' } };
  });
  let next = lines.length + 2;
  if (report.summary.length) {
    meta.getRow(next).getCell(1).value = 'Key figures';
    meta.getRow(next).getCell(1).font = { bold: true, size: 12 };
    next += 1;
    for (const item of report.summary) {
      const row = meta.getRow(next);
      row.getCell(1).value = item.label;
      const value = excelValue(item.value, item.kind);
      row.getCell(2).value = item.kind === 'text' ? formatCell(item.value, 'text') : value;
      const format = FORMATS[item.kind];
      if (format && value !== null && typeof value !== 'string') row.getCell(2).numFmt = format;
      row.getCell(2).alignment = { horizontal: 'left' };
      next += 1;
    }
    next += 1;
  }
  if (report.definitions.length) {
    meta.getRow(next).getCell(1).value = 'How these figures are calculated';
    meta.getRow(next).getCell(1).font = { bold: true, size: 12 };
    next += 1;
    for (const line of report.definitions) {
      const cell = meta.getRow(next).getCell(1);
      cell.value = line;
      meta.mergeCells(next, 1, next, 2);
      cell.alignment = { wrapText: true, vertical: 'top' };
      meta.getRow(next).height = Math.max(15, Math.ceil(line.length / 90) * 15);
      next += 1;
    }
  }

  // ── Summary (breakdowns) ──
  const summaries = report.tables.filter((t) => !t.detail);
  if (summaries.length) {
    const sheet = workbook.addWorksheet(sheetName('Summary', used));
    const widest = Math.max(...summaries.map((t) => t.columns.length));
    sheet.columns = Array.from({ length: widest }, (_, i) => ({ width: Math.max(...summaries.map((t) => (t.columns[i] ? widthFor(t.columns[i]!.kind, t.columns[i]!.width) : 10))) }));
    let row = 1;
    for (const table of summaries) row = writeTable(sheet, table, row, { titled: true }) + 1;
  }

  // ── Data sheets ──
  for (const table of report.tables.filter((t) => t.detail)) {
    const sheet = workbook.addWorksheet(sheetName(table.title, used));
    sheet.columns = table.columns.map((c) => ({ width: widthFor(c.kind, c.width) }));
    writeTable(sheet, table, 1, { titled: false });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer as ArrayBuffer);
}
