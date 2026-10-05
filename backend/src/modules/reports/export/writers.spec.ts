import ExcelJS from 'exceljs';
import type { ReportDocument } from '../report-document';
import { bucketText, formatCell, formatInr } from '../report-document';
import { csvField, writeCsv } from './csv-writer';
import { fontsAvailable, writePdf } from './pdf-writer';
import { writeXlsx } from './xlsx-writer';

function sampleReport(rows = 3): ReportDocument {
  return {
    type: 'fuel',
    title: 'Fuel Report',
    company: 'Gangamata Transport',
    period: { label: '1 Apr 2026 – 5 Oct 2026', from: '2026-04-01', to: '2026-10-05' },
    asOf: '2026-10-05',
    financialYears: ['FY 2026–27'],
    filters: [{ label: 'Vehicle', value: 'KA 22 AB 1234' }, { label: 'Fuel type', value: 'Diesel' }],
    generatedAt: new Date('2026-10-05T04:30:00.000Z'),
    generatedBy: 'Office Admin',
    summary: [
      { label: 'Total amount', value: '125450.00', kind: 'inr' },
      { label: 'Average rate (weighted)', value: '94.37', kind: 'rate' },
    ],
    tables: [
      {
        title: 'Vehicle-wise spend',
        columns: [{ header: 'Vehicle', kind: 'text' }, { header: 'Amount', kind: 'inr' }],
        rows: [['KA 22 AB 1234', '125450.00']],
      },
      {
        title: 'Fuel entries',
        detail: true,
        totalRecords: rows,
        columns: [
          { header: 'Date', kind: 'date' }, { header: 'Driver', kind: 'text' }, { header: 'Litres', kind: 'litres' },
          { header: 'Amount', kind: 'inr' }, { header: 'Station', kind: 'text' }, { header: 'Recorded', kind: 'datetime' },
        ],
        rows: Array.from({ length: rows }, (_, i) => [
          `2026-10-0${(i % 5) + 1}`,
          i === 0 ? 'ರಮೇಶ್ ಕುಮಾರ್' : i === 1 ? 'सुरेश पाटील' : 'Ramesh, "Kumar"',
          '45.500',
          i === 2 ? '-500.00' : '4300.25',
          i === 2 ? '=HYPERLINK("http://x")' : 'IndianOil – NH4',
          '2026-10-01T18:45:00.000Z',
        ]),
        totals: ['Total', '', '136.500', '8100.50', '', ''],
      },
    ],
    definitions: ['Average fuel rate = total fuel amount ÷ total litres (weighted).'],
  };
}

describe('Indian formatting', () => {
  it('formats rupees with Indian grouping and two decimals', () => {
    expect(formatInr('125450')).toBe('₹1,25,450.00');
    expect(formatInr('12345678.5')).toBe('₹1,23,45,678.50');
    expect(formatInr('-500')).toBe('−₹500.00');
  });

  it('formats dates without passing through local time', () => {
    expect(formatCell('2026-04-01', 'date')).toBe('01 Apr 2026');
    expect(formatCell('2026-10-01T18:45:00.000Z', 'datetime')).toBe('02 Oct 2026 00:15 IST');
    expect(formatCell(null, 'inr')).toBe('—');
  });

  it('names trend buckets as people read them', () => {
    expect(bucketText('2026-04')).toBe('Apr 2026');
    expect(bucketText('2026-10-05')).toBe('05 Oct 2026');
  });
});

describe('CSV writer', () => {
  const csv = writeCsv(sampleReport()).toString('utf8');

  it('starts with a UTF-8 byte-order mark and keeps Indian scripts intact', () => {
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('ರಮೇಶ್ ಕುಮಾರ್');
    expect(csv).toContain('सुरेश पाटील');
  });

  it('quotes commas and quotes per RFC 4180 and uses CRLF', () => {
    expect(csv).toContain('"Ramesh, ""Kumar"""');
    expect(csv.split('\r\n')[0]).toBe('﻿Date,Driver,Litres,Amount (INR),Station,Recorded (IST)');
  });

  it('writes ISO dates, IST times and plain numbers', () => {
    const line = csv.split('\r\n')[1]!;
    expect(line.startsWith('2026-10-01,')).toBe(true);
    expect(line).toContain(',4300.25,');
    expect(line).toContain('2026-10-02 00:15');
  });

  it('neutralises text that would run as a formula, but not negative amounts', () => {
    expect(csv).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(csv).toContain(',-500.00,');
  });

  it('only quotes fields that need it', () => {
    expect(csvField('plain')).toBe('plain');
    expect(csvField('a\nb')).toBe('"a\nb"');
  });
});

describe('Excel writer', () => {
  let workbook: ExcelJS.Workbook;

  beforeAll(async () => {
    workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load((await writeXlsx(sampleReport())) as never);
  });

  it('has a metadata sheet, a summary sheet and a data sheet', () => {
    expect(workbook.worksheets.map((s) => s.name)).toEqual(['Report', 'Summary', 'Fuel entries']);
  });

  it('records the period, financial year, filters and author', () => {
    const values = workbook.getWorksheet('Report')!.getSheetValues().flat().map(String);
    expect(values).toContain('Gangamata Transport');
    expect(values).toContain('FY 2026–27');
    expect(values).toContain('KA 22 AB 1234');
    expect(values).toContain('Office Admin');
  });

  it('stores real dates and numbers with Indian rupee formatting', () => {
    const sheet = workbook.getWorksheet('Fuel entries')!;
    expect(sheet.getRow(1).getCell(4).value).toBe('Amount (₹)');
    const date = sheet.getRow(2).getCell(1);
    expect(date.value).toEqual(new Date('2026-10-01T00:00:00.000Z'));
    expect(date.numFmt).toBe('dd-mmm-yyyy');
    const amount = sheet.getRow(2).getCell(4);
    expect(amount.value).toBe(4300.25);
    expect(amount.numFmt).toContain('[>=100000]"₹"');
    expect(sheet.getRow(2).getCell(3).value).toBe(45.5);
    expect(sheet.getRow(2).getCell(2).value).toBe('ರಮೇಶ್ ಕುಮಾರ್');
  });

  it('writes the lakh/crore grouping with literal (escaped) commas, as Excel requires', async () => {
    // Read the raw styles part: ExcelJS's own reader unescapes formats, which would hide a bug.
    // jszip is the zip library ExcelJS itself depends on.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const JSZip = require('jszip') as { loadAsync: (data: Buffer) => Promise<{ file: (name: string) => { async: (type: 'string') => Promise<string> } | null }> };
    const zip = await JSZip.loadAsync(await writeXlsx(sampleReport()));
    const styles = await zip.file('xl/styles.xml')!.async('string');
    expect(styles).toContain('[&gt;=10000000]&quot;₹&quot;##\\,##\\,##\\,##0.00;[&gt;=100000]&quot;₹&quot;##\\,##\\,##0.00;&quot;₹&quot;##,##0.00');
  });

  it('keeps a formula-looking value as text, never a formula', () => {
    const cell = workbook.getWorksheet('Fuel entries')!.getRow(4).getCell(5);
    expect(cell.type).toBe(ExcelJS.ValueType.String);
    expect(cell.value).toBe('=HYPERLINK("http://x")');
  });

  it('adds the totals row', () => {
    const totals = workbook.getWorksheet('Fuel entries')!.getRow(5);
    expect(totals.getCell(1).value).toBe('Total');
    expect(totals.getCell(4).value).toBe(8100.5);
  });
});

describe('PDF writer', () => {
  it('has the embedded fonts available', () => {
    expect(fontsAvailable()).toBe(true);
  });

  it('produces a valid PDF with embedded Noto fonts', async () => {
    const pdf = await writePdf(sampleReport());
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    const text = pdf.toString('latin1');
    expect(text).toMatch(/NotoSans/);
    expect(text).toMatch(/NotoSansKannada/);
    expect(text).toMatch(/NotoSansDevanagari/);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
  });

  it('paginates long tables', async () => {
    const pages = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;
    const short = await writePdf(sampleReport(3));
    const long = await writePdf(sampleReport(400));
    expect(pages(short)).toBe(1);
    expect(pages(long)).toBeGreaterThan(5);
  });
});
