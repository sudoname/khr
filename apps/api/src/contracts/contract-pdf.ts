import PDFDocument from 'pdfkit';

/**
 * Renders an employment contract styled after a standard Nigerian contract
 * document: green-accent header with company identity, centred title + role
 * subtitle, employer/employee particulars table, numbered clause sections
 * flowing across pages, a signature block with two witnesses, and a
 * "Confidential — {role}" footer with page numbers on every page.
 */
export interface ContractPdfData {
  companyName: string;
  rcNumber: string | null;
  companyAddress: string | null;
  title: string;
  roleTitle: string;
  employeeName: string;
  employeeNo: string;
  employeeAddress: string | null;
  startDate: string; // display-formatted, e.g. "5 January 2026"
  clauses: { heading: string; body: string }[];
}

const MARGIN = 56;
const PAGE_W = 595.28; // A4 points
const PAGE_H = 841.89;
const CONTENT_W = PAGE_W - 2 * MARGIN;
const FOOTER_H = 30;
const MAX_Y = PAGE_H - MARGIN - FOOTER_H;

const GREEN = '#15803d';
const DARK = '#0f172a';
const SLATE = '#475569';
const LINE = '#cbd5e1';

/**
 * The built-in Helvetica fonts use WinAnsi encoding, which has no naira sign
 * (U+20A6). Clause text is user-editable, so swap it for "NGN" rather than
 * emitting an unmapped glyph.
 */
const pdfSafe = (s: string) => s.replace(/\u20a6\s?/g, 'NGN ');

export function renderContractPdf(data: ContractPdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: MARGIN, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    let y = MARGIN;

    const ensureSpace = (h: number) => {
      if (y + h > MAX_Y) {
        doc.addPage();
        y = MARGIN;
      }
    };

    /** Flowing paragraph: wraps, page-breaks via ensureSpace, advances y. */
    const paragraph = (
      s: string,
      opts: { font?: string; size?: number; color?: string; align?: 'left' | 'justify' | 'center'; width?: number; x?: number } = {},
    ) => {
      const font = opts.font ?? 'Helvetica';
      const size = opts.size ?? 10;
      const width = opts.width ?? CONTENT_W;
      const x = opts.x ?? MARGIN;
      doc.font(font).fontSize(size);
      const safe = pdfSafe(s);
      // Split-flow across pages: pdfkit's own auto page break fights the
      // explicit footer reserve, so break manually when the block overflows.
      const h = doc.heightOfString(safe, { width, align: opts.align ?? 'left' });
      if (y + Math.min(h, size * 3) > MAX_Y) ensureSpace(h);
      doc.fillColor(opts.color ?? DARK).text(safe, x, y, { width, align: opts.align ?? 'left' });
      y = doc.y;
    };

    const hr = (color = LINE, width = 0.5) => {
      doc.moveTo(MARGIN, y).lineTo(PAGE_W - MARGIN, y).lineWidth(width).strokeColor(color).stroke();
    };

    // ── Header: green accent band + company identity ─────────────────────
    doc.rect(0, 0, PAGE_W, 10).fill(GREEN);
    y = MARGIN;
    paragraph(data.companyName, { font: 'Helvetica-Bold', size: 18, color: DARK });
    const subBits = [data.rcNumber, data.companyAddress].filter(Boolean).join('  ·  ');
    if (subBits) {
      y += 2;
      paragraph(subBits, { size: 9, color: SLATE });
    }
    y += 10;
    hr(GREEN, 1.5);
    y += 18;

    // ── Title + role subtitle ────────────────────────────────────────────
    paragraph(data.title.toUpperCase(), { font: 'Helvetica-Bold', size: 16, color: GREEN, align: 'center' });
    y += 4;
    paragraph(data.roleTitle, { size: 11, color: SLATE, align: 'center' });
    y += 16;

    // ── Particulars table ────────────────────────────────────────────────
    const LABEL_W = 150;
    const row = (label: string, value: string | null) => {
      const v = pdfSafe(value || '—');
      doc.font('Helvetica').fontSize(9.5);
      const vh = doc.heightOfString(v, { width: CONTENT_W - LABEL_W - 12 });
      const rh = Math.max(vh, 12) + 8;
      ensureSpace(rh + 2);
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor(SLATE).text(label.toUpperCase(), MARGIN, y + 4, {
        width: LABEL_W,
        lineBreak: false,
      });
      doc.font('Helvetica').fontSize(9.5).fillColor(DARK).text(v, MARGIN + LABEL_W + 12, y + 4, {
        width: CONTENT_W - LABEL_W - 12,
      });
      y += rh;
      hr();
    };
    hr();
    row('Employer', data.companyName);
    row('RC Number', data.rcNumber);
    row('Registered Address', data.companyAddress);
    row('Employee', data.employeeName);
    row('Employee No', data.employeeNo);
    row('Employee Address', data.employeeAddress);
    row('Position', data.roleTitle);
    row('Commencement Date', data.startDate);
    y += 20;

    // ── Numbered clauses ─────────────────────────────────────────────────
    data.clauses.forEach((clause, i) => {
      ensureSpace(48); // keep the heading attached to at least two body lines
      paragraph(`${i + 1}. ${clause.heading}`, { font: 'Helvetica-Bold', size: 11, color: GREEN });
      y += 4;
      paragraph(clause.body, { size: 10, color: DARK, align: 'justify' });
      y += 14;
    });

    // ── Signature block ──────────────────────────────────────────────────
    ensureSpace(240);
    y += 6;
    paragraph(
      'IN WITNESS WHEREOF the parties have executed this contract of employment on the dates written below.',
      { font: 'Helvetica-Oblique', size: 10, color: SLATE },
    );
    y += 24;

    const COL2_X = MARGIN + CONTENT_W / 2 + 12;
    const COL_W = CONTENT_W / 2 - 24;
    const signatory = (x: number, party: string, name: string) => {
      doc.font('Helvetica-Bold').fontSize(9).fillColor(SLATE).text(party.toUpperCase(), x, y, { lineBreak: false });
      doc.moveTo(x, y + 40).lineTo(x + COL_W, y + 40).lineWidth(0.75).strokeColor(DARK).stroke();
      doc.font('Helvetica').fontSize(9).fillColor(DARK).text(`Name: ${name}`, x, y + 46, { lineBreak: false });
      doc.text('Date: ____________________', x, y + 60, { lineBreak: false });
    };
    signatory(MARGIN, 'For the Employer (signature)', '____________________________');
    signatory(COL2_X, 'Employee (signature)', data.employeeName);
    y += 86;

    paragraph('WITNESSES', { font: 'Helvetica-Bold', size: 9, color: SLATE });
    y += 8;
    for (const n of [1, 2]) {
      ensureSpace(34);
      doc
        .font('Helvetica')
        .fontSize(9)
        .fillColor(DARK)
        .text(
          `${n}.  Name: ______________________________   Signature: ____________________   Date: ______________`,
          MARGIN,
          y,
          { lineBreak: false },
        );
      y += 28;
    }

    // ── Per-page footer (bufferPages) ────────────────────────────────────
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      // Zero the bottom margin so footer text cannot trigger an auto page add.
      doc.page.margins.bottom = 0;
      const fy = PAGE_H - 34;
      doc
        .font('Helvetica')
        .fontSize(8)
        .fillColor(SLATE)
        .text(`Confidential — ${pdfSafe(data.roleTitle)}`, MARGIN, fy, { lineBreak: false });
      const pageLabel = `Page ${i - range.start + 1} of ${range.count}`;
      const w = doc.widthOfString(pageLabel);
      doc.text(pageLabel, PAGE_W - MARGIN - w, fy, { lineBreak: false });
    }

    doc.end();
  });
}
