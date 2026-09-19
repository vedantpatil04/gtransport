import { saveFile, type SaveResult } from './download';

export type XlsxCell = string | number | Date | null;
export interface XlsxSheet {
  name: string;
  header: string[];
  rows: XlsxCell[][];
  widths?: number[];
}

/** Builds a real .xlsx workbook in the browser. Loaded on demand to keep the first load light. */
export async function exportXlsx(filename: string, sheets: XlsxSheet[]): Promise<SaveResult> {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  const data = sheets.map((s) => ({
    sheet: s.name.slice(0, 31),
    columns: (s.widths ?? s.header.map(() => 18)).map((width) => ({ width })),
    data: [
      s.header.map((h) => ({ value: h, fontWeight: 'bold' as const, backgroundColor: '#1B2B44', color: '#FFFFFF' })),
      ...s.rows.map((r) =>
        r.map((v) => (v === null ? null : typeof v === 'number' ? { value: v, type: Number, format: Number.isInteger(v) ? '#,##0' : '#,##0.00' } : v instanceof Date ? { value: v, type: Date, format: 'dd-mm-yyyy' } : { value: v, type: String })),
      ),
    ],
  }));
  const blob = await writeXlsxFile(data as never).toBlob();
  return saveFile(filename, blob);
}

export interface PdfSection {
  heading: string;
  head: string[];
  body: (string | number)[][];
  /** column indexes to right-align (amounts) */
  numeric?: number[];
  foot?: (string | number)[];
}

/** A clean A4 report with a branded header, summary tables and page numbers. */
export async function exportPdf(filename: string, opts: { title: string; subtitle: string; company: string; generated: string; sections: PdfSection[]; footer: string }): Promise<SaveResult> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  doc.setFillColor(27, 43, 68);
  doc.rect(0, 0, W, 78, 'F');
  doc.setFillColor(244, 196, 48);
  doc.rect(0, 78, W, 3, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(17);
  doc.text(opts.company, 40, 34);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(opts.subtitle, 40, 54);
  doc.setFontSize(9);
  doc.text(opts.generated, W - 40, 54, { align: 'right' });
  doc.setTextColor(20, 30, 45);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(opts.title, 40, 112);

  let y = 128;
  for (const s of opts.sections) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(20, 30, 45);
    if (y > 740) {
      doc.addPage();
      y = 50;
    }
    doc.text(s.heading, 40, y + 6);
    const columnStyles: Record<number, { halign: 'right' }> = {};
    (s.numeric ?? []).forEach((i) => (columnStyles[i] = { halign: 'right' }));
    autoTable(doc, {
      startY: y + 14,
      head: [s.head],
      body: s.body.map((r) => r.map(String)),
      foot: s.foot ? [s.foot.map(String)] : undefined,
      margin: { left: 40, right: 40 },
      styles: { fontSize: 9, cellPadding: 5, textColor: [30, 38, 50], lineColor: [226, 230, 236], lineWidth: 0.5 },
      headStyles: { fillColor: [236, 240, 245], textColor: [60, 70, 85], fontStyle: 'bold' },
      footStyles: { fillColor: [27, 43, 68], textColor: [255, 255, 255], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [250, 251, 253] },
      columnStyles,
      didParseCell: (data) => {
        if ((data.section === 'head' || data.section === 'foot') && (s.numeric ?? []).includes(data.column.index)) data.cell.styles.halign = 'right';
      },
    });
    y = ((doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? y + 60) + 26;
  }
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(120, 128, 140);
    doc.text(opts.footer, 40, doc.internal.pageSize.getHeight() - 24);
    doc.text(`${i} / ${pages}`, W - 40, doc.internal.pageSize.getHeight() - 24, { align: 'right' });
  }
  return saveFile(filename, doc.output('blob'));
}

/** PDF core fonts have no ₹ glyph, so amounts print as "Rs 1,23,456". */
export const rs = (n: number) => `Rs ${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Math.round(n))}`;
