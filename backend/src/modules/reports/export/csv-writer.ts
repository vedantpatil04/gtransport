import type { Cell, CellKind, ReportColumn, ReportDocument, ReportTable } from '../report-document';

/**
 * CSV writer for large tabular exports: the report's record-level table, one row per record.
 *
 * - UTF-8 with a byte-order mark, so Excel opens Hindi, Kannada, Tamil, Telugu and Marathi names
 *   correctly instead of guessing a legacy code page;
 * - RFC 4180 quoting (commas, quotes and line breaks inside a field are safe) and CRLF endings;
 * - dates as YYYY-MM-DD and times as YYYY-MM-DD HH:MM in IST, which no locale misreads;
 * - money as plain numbers with two decimals — a currency symbol would turn it into text;
 * - a text cell that begins with =, +, -, @ or a control character is prefixed with an
 *   apostrophe, so a value typed into the app can never run as a spreadsheet formula.
 */

const BOM = '﻿';
const IST_MS = 330 * 60_000;
const FORMULA_START = /^[=+\-@\t\r]/;

function raw(value: Cell, kind: CellKind): string {
  if (value === null) return '';
  switch (kind) {
    case 'date':
      return String(value).slice(0, 10);
    case 'datetime': {
      const instant = Date.parse(String(value));
      if (Number.isNaN(instant)) return String(value);
      return new Date(instant + IST_MS).toISOString().slice(0, 16).replace('T', ' ');
    }
    case 'text': {
      const text = String(value);
      return FORMULA_START.test(text) ? `'${text}` : text;
    }
    default:
      return String(value);
  }
}

export function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

const header = (column: ReportColumn) => (column.kind === 'inr' ? `${column.header} (INR)` : column.kind === 'datetime' ? `${column.header} (IST)` : column.header);

export function writeCsvTable(table: ReportTable): Buffer {
  const lines = [table.columns.map((c) => csvField(header(c))).join(',')];
  for (const row of table.rows) lines.push(row.map((value, i) => csvField(raw(value, table.columns[i]!.kind))).join(','));
  return Buffer.from(BOM + lines.join('\r\n') + '\r\n', 'utf8');
}

/** The report's primary record table — the first detail table — as CSV. */
export function writeCsv(report: ReportDocument): Buffer {
  const table = report.tables.find((t) => t.detail) ?? report.tables[0];
  if (!table) return Buffer.from(BOM, 'utf8');
  return writeCsvTable(table);
}
