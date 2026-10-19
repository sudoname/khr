import PDFDocument from 'pdfkit';

/**
 * Pure layout code: amounts arrive as display-ready numbers (payslips are
 * stored as Decimal(18,2), which converts to Number exactly for any realistic
 * payroll figure). All computation stays in the Decimal engine.
 */
export interface PayslipPdfLine {
  label: string;
  current: number;
  ytd: number;
}

export interface PayslipPdfData {
  companyName: string;
  rcNumber: string | null;
  period: string; // e.g. "January 2026"
  status: string; // run status, e.g. PAID
  paidAt: Date | null;
  employeeName: string;
  employeeNo: string;
  bankName: string | null;
  bankAccountNumber: string | null;
  taxRegime: string | null;
  adjustmentNote: string | null;
  currency: string;
  earnings: PayslipPdfLine[];
  deductions: PayslipPdfLine[];
  employerContributions: PayslipPdfLine[];
  net: PayslipPdfLine;
}

const PAGE_MARGIN = 48;
const COL_LABEL_X = PAGE_MARGIN;
const COL_CURRENT_RIGHT = 420;
const COL_YTD_RIGHT = 547;
const SLATE = '#475569';
const DARK = '#0f172a';
const LINE = '#cbd5e1';
const ACCENT = '#0891b2';
const ROW_H = 16;

function money(n: number): string {
  return n.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function renderPayslipPdf(data: PayslipPdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: PAGE_MARGIN });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // All vertical positioning is explicit (pdfkit's auto-flow y gets reset by
    // non-breaking absolute-positioned text, so we track y ourselves).
    let y = PAGE_MARGIN;

    const text = (
      s: string,
      x: number,
      opts: { font?: string; size?: number; color?: string; width?: number } = {},
    ) => {
      doc
        .font(opts.font ?? 'Helvetica')
        .fontSize(opts.size ?? 9)
        .fillColor(opts.color ?? SLATE)
        .text(s, x, y, { lineBreak: false, ...(opts.width ? { width: opts.width, lineBreak: true } : {}) });
    };
    const rightText = (s: string, rightX: number, opts: { font?: string; size?: number; color?: string } = {}) => {
      doc.font(opts.font ?? 'Helvetica').fontSize(opts.size ?? 9);
      const w = doc.widthOfString(s);
      doc.fillColor(opts.color ?? DARK).text(s, rightX - w, y, { lineBreak: false });
    };
    const hr = () => {
      doc.moveTo(COL_LABEL_X, y).lineTo(COL_YTD_RIGHT, y).lineWidth(0.5).strokeColor(LINE).stroke();
    };
    const amountRow = (
      label: string,
      current: number,
      ytd: number,
      opts: { font?: string; size?: number; labelColor?: string; amountColor?: string } = {},
    ) => {
      text(label, COL_LABEL_X, { font: opts.font, size: opts.size, color: opts.labelColor ?? DARK });
      rightText(money(current), COL_CURRENT_RIGHT, { font: opts.font, size: opts.size, color: opts.amountColor });
      rightText(money(ytd), COL_YTD_RIGHT, { font: opts.font, size: opts.size, color: opts.amountColor });
      y += ROW_H;
    };
    const section = (title: string, lines: PayslipPdfLine[]) => {
      if (lines.length === 0) return;
      text(title, COL_LABEL_X, { font: 'Helvetica-Bold', size: 8, color: ACCENT });
      y += ROW_H - 2;
      for (const line of lines) amountRow(line.label, line.current, line.ytd);
      const total = lines.reduce((a, l) => a + l.current, 0);
      const totalYtd = lines.reduce((a, l) => a + l.ytd, 0);
      amountRow('Subtotal', total, totalYtd, { font: 'Helvetica-Bold', labelColor: SLATE });
      y += 6;
    };

    // ── Header ──────────────────────────────────────────────────────────
    text(data.companyName, COL_LABEL_X, { font: 'Helvetica-Bold', size: 18, color: DARK });
    y += 24;
    if (data.rcNumber) {
      text(data.rcNumber, COL_LABEL_X);
      y += 14;
    }
    text(`PAYSLIP — ${data.period}`, COL_LABEL_X, { font: 'Helvetica-Bold', size: 12, color: ACCENT });
    y += 18;
    text(
      data.status === 'PAID'
        ? `Paid${data.paidAt ? ` on ${data.paidAt.toISOString().slice(0, 10)}` : ''}`
        : `Status: ${data.status} (preview — not yet paid)`,
      COL_LABEL_X,
    );
    y += 18;
    hr();
    y += 12;

    // ── Employee block ──────────────────────────────────────────────────
    text(data.employeeName, COL_LABEL_X, { font: 'Helvetica-Bold', size: 10, color: DARK });
    y += 14;
    text(`Employee No: ${data.employeeNo}`, COL_LABEL_X);
    y += 13;
    if (data.bankName || data.bankAccountNumber) {
      text(`Bank: ${data.bankName ?? '—'}  ·  Account: ${data.bankAccountNumber ?? '—'}`, COL_LABEL_X);
      y += 13;
    }
    if (data.taxRegime) {
      text(`Tax regime: ${data.taxRegime}`, COL_LABEL_X);
      y += 13;
    }
    y += 10;

    // ── Column headings ────────────────────────────────────────────────
    text('ITEM', COL_LABEL_X, { font: 'Helvetica-Bold', size: 8 });
    rightText('THIS PERIOD', COL_CURRENT_RIGHT, { font: 'Helvetica-Bold', size: 8, color: SLATE });
    rightText('YEAR TO DATE', COL_YTD_RIGHT, { font: 'Helvetica-Bold', size: 8, color: SLATE });
    y += 13;
    hr();
    y += 10;

    section('EARNINGS', data.earnings);
    section('DEDUCTIONS', data.deductions);

    // ── Net pay ─────────────────────────────────────────────────────────
    hr();
    y += 8;
    amountRow(data.net.label, data.net.current, data.net.ytd, {
      font: 'Helvetica-Bold',
      size: 11,
      amountColor: ACCENT,
    });
    y += 4;
    hr();
    y += 12;

    section('EMPLOYER CONTRIBUTIONS (not deducted from pay)', data.employerContributions);

    // ── Notes / footer ──────────────────────────────────────────────────
    if (data.adjustmentNote) {
      text(`Note: ${data.adjustmentNote}`, COL_LABEL_X, { font: 'Helvetica-Oblique' });
      y += 16;
    }
    y += 10;
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(SLATE)
      .text(
        `All amounts in ${data.currency}. Year-to-date figures cover January through ${data.period}. ` +
          `This is a computer-generated payslip and requires no signature. Generated ${new Date().toISOString().slice(0, 10)} by KHR.`,
        COL_LABEL_X,
        y,
        { width: COL_YTD_RIGHT - COL_LABEL_X },
      );

    doc.end();
  });
}
