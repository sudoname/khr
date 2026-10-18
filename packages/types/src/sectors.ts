/** Industry sectors a company can belong to. Mirrors the Prisma CompanySector enum. */
export const COMPANY_SECTORS = [
  'AGRICULTURE',
  'TECHNOLOGY',
  'BANKING',
  'FINANCE',
  'CONSTRUCTION',
  'RETAIL',
  'HEALTHCARE',
  'EDUCATION',
  'ENERGY',
  'MANUFACTURING',
  'TELECOMMUNICATIONS',
  'HOSPITALITY',
  'TRANSPORT_LOGISTICS',
  'MEDIA',
  'GOVERNMENT',
  'NGO',
  'OTHER',
] as const;

export type CompanySector = (typeof COMPANY_SECTORS)[number];

export const COMPANY_SECTOR_LABELS: Record<CompanySector, string> = {
  AGRICULTURE: 'Agriculture',
  TECHNOLOGY: 'Technology',
  BANKING: 'Banking',
  FINANCE: 'Finance',
  CONSTRUCTION: 'Construction',
  RETAIL: 'Retail',
  HEALTHCARE: 'Healthcare',
  EDUCATION: 'Education',
  ENERGY: 'Energy',
  MANUFACTURING: 'Manufacturing',
  TELECOMMUNICATIONS: 'Telecommunications',
  HOSPITALITY: 'Hospitality',
  TRANSPORT_LOGISTICS: 'Transport & Logistics',
  MEDIA: 'Media',
  GOVERNMENT: 'Government',
  NGO: 'NGO / Non-profit',
  OTHER: 'Other',
};
