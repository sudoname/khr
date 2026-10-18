import { z } from 'zod';

export const DOCUMENT_CATEGORIES = ['CONTRACT', 'ID_DOCUMENT', 'CERTIFICATE', 'POLICY', 'OTHER'] as const;
export type DocumentCategoryValue = (typeof DOCUMENT_CATEGORIES)[number];

export const DOCUMENT_CATEGORY_LABELS: Record<DocumentCategoryValue, string> = {
  CONTRACT: 'Contract',
  ID_DOCUMENT: 'ID document',
  CERTIFICATE: 'Certificate',
  POLICY: 'Policy',
  OTHER: 'Other',
};

/** Multipart metadata accompanying a document upload. */
export const documentUploadSchema = z.object({
  name: z.string().trim().min(1).max(200),
  category: z.enum(DOCUMENT_CATEGORIES).default('OTHER'),
  /** Omitted or empty = company-level document. */
  employeeId: z.string().optional().or(z.literal('')),
});
export type DocumentUploadInput = z.infer<typeof documentUploadSchema>;

export const documentListQuerySchema = z.object({
  employeeId: z.string().optional(),
  category: z.enum(DOCUMENT_CATEGORIES).optional(),
});
