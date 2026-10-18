export const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const ngn = new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 2 });

export function formatNgn(value: string | number): string {
  return ngn.format(typeof value === 'string' ? Number(value) : value);
}

export function runStatusTone(status: string): 'slate' | 'green' | 'amber' | 'blue' {
  switch (status) {
    case 'PAID':
      return 'green';
    case 'APPROVED':
      return 'blue';
    case 'PENDING_APPROVAL':
      return 'amber';
    default:
      return 'slate';
  }
}
