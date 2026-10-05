import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import PDFDocument from 'pdfkit';
import { formatCell, formatInstant, type Cell, type CellKind, type ReportDocument, type ReportTable } from '../report-document';

/**
 * PDF writer. A4, with the report header, applied filters, summary figures, every table (header
 * repeated on each page), definitions and "Page n of m" footers.
 *
 * Fonts are the embedded Noto families (SIL Open Font License, see assets/fonts/OFL.txt): they
 * carry the ₹ sign, which the built-in PDF fonts do not, and the Indic scripts names are written
 * in. Each cell is set in the font for the script it contains, so "Ramesh" and "ರಮೇಶ್" both print.
 */

const FONT_DIR = resolve(__dirname, '..', '..', '..', '..', 'assets', 'fonts');

const FAMILIES = {
  latin: 'NotoSans',
  devanagari: 'NotoSansDevanagari',
  kannada: 'NotoSansKannada',
  tamil: 'NotoSansTamil',
  telugu: 'NotoSansTelugu',
} as const;
type Script = keyof typeof FAMILIES;

const SCRIPT_RANGES: [Script, RegExp][] = [
  ['kannada', /[ಀ-೿]/],
  ['telugu', /[ఀ-౿]/],
  ['tamil', /[஀-௿]/],
  ['devanagari', /[ऀ-ॿ]/],
];

const scriptOf = (text: string): Script => SCRIPT_RANGES.find(([, pattern]) => pattern.test(text))?.[0] ?? 'latin';

const NAVY: [number, number, number] = [27, 43, 68];
const GOLD: [number, number, number] = [244, 196, 48];
const INK: [number, number, number] = [30, 38, 50];
const MUTED: [number, number, number] = [110, 118, 130];
const RULE: [number, number, number] = [226, 230, 236];
const HEAD_FILL: [number, number, number] = [236, 240, 245];
const ZEBRA: [number, number, number] = [250, 251, 253];

const NUMERIC: CellKind[] = ['inr', 'number', 'litres', 'rate', 'count', 'percent'];

type Doc = InstanceType<typeof PDFDocument>;

export function fontsAvailable(): boolean {
  return existsSync(join(FONT_DIR, 'NotoSans_400Regular.ttf'));
}

function registerFonts(doc: Doc): void {
  for (const family of Object.values(FAMILIES)) {
    doc.registerFont(`${family}-Regular`, join(FONT_DIR, `${family}_400Regular.ttf`));
    doc.registerFont(`${family}-Bold`, join(FONT_DIR, `${family}_700Bold.ttf`));
  }
}

const fontFor = (text: string, bold = false) => `${FAMILIES[scriptOf(text)]}-${bold ? 'Bold' : 'Regular'}`;

/**
 * Latin ligatures (fi, fl) are switched off: the font's ligature glyphs carry no text mapping, so a
 * reader copying or searching the PDF would find "fgures" instead of "figures". Indic shaping uses
 * other OpenType features and is unaffected.
 */
const NO_LIGATURES = { liga: false, clig: false } as unknown as PDFKit.Mixins.TextOptions['features'];

export async function writePdf(report: ReportDocument): Promise<Buffer> {
  const wide = report.tables.some((t) => t.columns.length > 8);
  const doc = new PDFDocument({
    size: 'A4',
    layout: wide ? 'landscape' : 'portrait',
    margins: { top: 40, bottom: 48, left: 36, right: 36 },
    bufferPages: true,
    info: { Title: `${report.company} — ${report.title}`, Author: report.company, Creator: 'Gangamata Transport', CreationDate: report.generatedAt },
  });
  registerFonts(doc);

  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolveBuffer, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolveBuffer(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const left = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const bottom = () => doc.page.height - doc.page.margins.bottom;

  const text = (value: string, x: number, y: number, options: PDFKit.Mixins.TextOptions & { bold?: boolean; size?: number; color?: [number, number, number] } = {}) => {
    const { bold, size = 9, color = INK, ...rest } = options;
    doc.font(fontFor(value, bold)).fontSize(size).fillColor(color).text(value, x, y, { lineBreak: true, features: NO_LIGATURES, ...rest });
  };

  // ── Header band ──
  doc.rect(0, 0, doc.page.width, 74).fill(NAVY);
  doc.rect(0, 74, doc.page.width, 3).fill(GOLD);
  text(report.company, left, 20, { bold: true, size: 17, color: [255, 255, 255] });
  text(report.title, left, 44, { size: 11, color: [255, 255, 255] });
  text(`Generated ${formatInstant(report.generatedAt.toISOString())}`, left, 26, { size: 8.5, color: [220, 226, 236], width, align: 'right' });
  text(`by ${report.generatedBy}`, left, 40, { size: 8.5, color: [220, 226, 236], width, align: 'right' });

  // ── Period, financial year, filters ──
  let y = 92;
  const meta: [string, string][] = [
    ...(report.period ? ([['Period', report.period.label]] as [string, string][]) : []),
    ...(report.asOf && !report.period ? ([['As of', formatCell(report.asOf, 'date')]] as [string, string][]) : []),
    ...(report.financialYears.length ? ([['Financial year', report.financialYears.join(', ')]] as [string, string][]) : []),
    ['Filters', report.filters.length ? report.filters.map((f) => `${f.label}: ${f.value}`).join(' · ') : 'None'],
  ];
  for (const [key, value] of meta) {
    text(key, left, y, { bold: true, size: 9, color: MUTED, width: 90 });
    text(value, left + 92, y, { size: 9, width: width - 92 });
    y = Math.max(doc.y, y + 12) + 3;
  }

  // ── Summary figures ──
  if (report.summary.length) {
    y += 6;
    const perRow = wide ? 4 : 3;
    const cellWidth = width / perRow;
    for (let i = 0; i < report.summary.length; i += perRow) {
      const row = report.summary.slice(i, i + perRow);
      let rowBottom = y;
      row.forEach((item, j) => {
        const x = left + j * cellWidth;
        text(item.label, x, y, { size: 8, color: MUTED, width: cellWidth - 10 });
        const labelBottom = doc.y;
        text(formatCell(item.value, item.kind), x, labelBottom + 1, { bold: true, size: 11.5, width: cellWidth - 10 });
        rowBottom = Math.max(rowBottom, doc.y);
      });
      y = rowBottom + 8;
    }
    doc.moveTo(left, y).lineTo(left + width, y).lineWidth(0.5).strokeColor(RULE).stroke();
    y += 10;
  }

  for (const table of report.tables) y = drawTable(doc, table, y, { left, width, bottom, text });

  // ── Definitions ──
  if (report.definitions.length) {
    if (y + 40 > bottom()) {
      doc.addPage();
      y = doc.page.margins.top;
    }
    text('How these figures are calculated', left, y, { bold: true, size: 10.5 });
    y = doc.y + 4;
    for (const line of report.definitions) {
      if (y + 20 > bottom()) {
        doc.addPage();
        y = doc.page.margins.top;
      }
      text(`•  ${line}`, left, y, { size: 8.5, color: MUTED, width });
      y = doc.y + 3;
    }
  }

  // ── Footers ──
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    const footerY = doc.page.height - 30;
    const saved = doc.page.margins.bottom;
    doc.page.margins.bottom = 0; // writing in the margin must not start a new page
    doc.font('NotoSans-Regular').fontSize(7.5).fillColor(MUTED);
    doc.text(`${report.company} · ${report.title}${report.period ? ` · ${report.period.label}` : ''}`, left, footerY, { width: width - 80, lineBreak: false, features: NO_LIGATURES });
    doc.text(`Page ${i + 1} of ${range.count}`, left, footerY, { width, align: 'right', lineBreak: false });
    doc.page.margins.bottom = saved;
  }

  doc.end();
  return done;
}

function drawTable(
  doc: Doc,
  table: ReportTable,
  startY: number,
  layout: { left: number; width: number; bottom: () => number; text: (value: string, x: number, y: number, options?: PDFKit.Mixins.TextOptions & { bold?: boolean; size?: number; color?: [number, number, number] }) => void },
): number {
  const { left, width, bottom, text } = layout;
  const padding = 4;
  const size = table.columns.length > 10 ? 7 : 8;
  const weights = table.columns.map((c) => c.width ?? (NUMERIC.includes(c.kind) ? 1 : 1.2));
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const widths = weights.map((w) => (w / totalWeight) * width);
  const xs = widths.map((_, i) => left + widths.slice(0, i).reduce((a, b) => a + b, 0));

  const cellText = (value: Cell, kind: CellKind) => formatCell(value, kind);
  const measure = (values: string[], bold: boolean) =>
    Math.max(...values.map((value, i) => doc.font(fontFor(value, bold)).fontSize(size).heightOfString(value, { width: widths[i]! - padding * 2, features: NO_LIGATURES }))) + padding * 2;

  const drawRow = (values: string[], y: number, options: { bold?: boolean; fill?: [number, number, number]; color?: [number, number, number] }) => {
    const height = measure(values, Boolean(options.bold));
    if (options.fill) doc.rect(left, y, width, height).fill(options.fill);
    values.forEach((value, i) => {
      text(value, xs[i]! + padding, y + padding, { size, bold: options.bold, color: options.color, width: widths[i]! - padding * 2, align: NUMERIC.includes(table.columns[i]!.kind) ? 'right' : 'left' });
    });
    doc.moveTo(left, y + height).lineTo(left + width, y + height).lineWidth(0.4).strokeColor(RULE).stroke();
    return y + height;
  };

  const header = table.columns.map((c) => c.header);
  const headerHeight = measure(header, true);
  let y = startY;
  // Keep the title with at least the header and one row.
  if (y + 24 + headerHeight * 2 > bottom()) {
    doc.addPage();
    y = doc.page.margins.top;
  }
  text(table.title, left, y, { bold: true, size: 10.5 });
  y = doc.y + 4;
  y = drawRow(header, y, { bold: true, fill: HEAD_FILL, color: MUTED });

  if (!table.rows.length) {
    text('No records for this period and these filters.', left + padding, y + padding, { size, color: MUTED });
    y = doc.y + padding;
  }

  table.rows.forEach((row, index) => {
    const values = row.map((value, i) => cellText(value, table.columns[i]!.kind));
    if (y + measure(values, false) > bottom()) {
      doc.addPage();
      y = doc.page.margins.top;
      y = drawRow(header, y, { bold: true, fill: HEAD_FILL, color: MUTED });
    }
    y = drawRow(values, y, { fill: index % 2 ? ZEBRA : undefined });
  });

  if (table.totals) {
    const values = table.totals.map((value, i) => (value === '' ? '' : cellText(value, i === 0 ? 'text' : table.columns[i]!.kind)));
    if (y + measure(values, true) > bottom()) {
      doc.addPage();
      y = doc.page.margins.top;
    }
    y = drawRow(values, y, { bold: true, fill: NAVY, color: [255, 255, 255] });
  }

  const notes = [
    ...(table.totalRecords !== undefined && table.rows.length < table.totalRecords
      ? [`Showing the first ${table.rows.length.toLocaleString('en-IN')} of ${table.totalRecords.toLocaleString('en-IN')} records. The Excel export contains every record.`]
      : []),
    ...(table.note ? [table.note] : []),
  ];
  for (const note of notes) {
    text(note, left, y + 3, { size: 7.5, color: MUTED, width });
    y = doc.y;
  }
  return y + 16;
}
