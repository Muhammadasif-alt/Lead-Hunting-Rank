import { z } from 'zod';

/** Request contracts for the CRM API (docs/14 §19). Commands are strict: unknown fields are rejected. */

const text = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) => text(max).optional();
const version = z.number().int().min(1);

const companyFields = {
  legalName: optionalText(200),
  website: optionalText(300),
  phone: optionalText(40),
  industry: optionalText(120),
  addressLine: optionalText(200),
  city: optionalText(120),
  region: optionalText(120),
  country: optionalText(2),
  postalCode: optionalText(20),
};

export const CreateCompanyInput = z.strictObject({ displayName: text(200).min(1, 'Company name is required'), ...companyFields });
export type CreateCompanyInput = z.output<typeof CreateCompanyInput>;

export const UpdateCompanyInput = z
  .strictObject({ version, displayName: text(200).min(1).optional(), ...companyFields })
  .refine((v) => Object.keys(v).length > 1, 'Nothing to update');

export const ArchiveInput = z.strictObject({ version, reason: optionalText(500) });
export const VersionInput = z.strictObject({ version });

export const CompanyListQuery = z.object({
  search: optionalText(120),
  status: z.enum(['DISCOVERED', 'RESEARCHING', 'ACTIVE', 'CUSTOMER', 'FORMER_CUSTOMER', 'DISQUALIFIED', 'ARCHIVED', 'ALL']).optional(),
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const PageQuery = z.object({ cursor: z.uuid().optional(), limit: z.coerce.number().int().min(1).max(100).default(50) });

const personFields = {
  fullName: optionalText(200),
  firstName: optionalText(100),
  lastName: optionalText(100),
  linkedinUrl: z.union([z.literal(''), z.url().max(300)]).optional(),
  timezone: optionalText(64),
  language: optionalText(16),
};

export const AddPersonInput = z
  .strictObject({ ...personFields, title: optionalText(120), department: optionalText(120), seniority: optionalText(60) })
  .refine((v) => v.fullName || v.firstName || v.lastName, { message: 'A name is required', path: ['fullName'] });

export const UpdatePersonInput = z.strictObject({ version, ...personFields }).refine((v) => Object.keys(v).length > 1, 'Nothing to update');

export const EndEmploymentInput = z.strictObject({ endedAt: z.coerce.date().optional() });

export const ContactPointInput = z.strictObject({
  type: z.enum(['EMAIL', 'PHONE', 'MOBILE', 'BUSINESS_PHONE', 'OTHER']),
  value: text(320).min(1),
  label: optionalText(60),
  isPrimary: z.boolean().optional(),
});

export const SOURCE_TYPES = ['MANUAL', 'WEBSITE', 'PHONE_CALL', 'EMAIL', 'DIRECTORY', 'SOCIAL', 'DOCUMENT', 'OTHER'] as const;

export const ObservationInput = z.strictObject({
  field: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/, 'Use a snake_case field name, e.g. employee_range'),
  value: z.union([text(2000).min(1), z.number(), z.boolean()]),
  source: z.strictObject({
    sourceType: z.enum(SOURCE_TYPES),
    sourceName: optionalText(120),
    sourceUrl: z.url().max(500).optional(),
    observedAt: z.coerce.date(),
    excerpt: optionalText(2000),
  }),
  confidence: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
  supersede: z.boolean().optional(),
});

export const DuplicateListQuery = PageQuery.extend({ view: z.enum(['open', 'resolved']).default('open') });
export const MergeInput = z.strictObject({ targetId: z.uuid(), version, reason: optionalText(500) });
export const RejectInput = z.strictObject({ version, reason: optionalText(500) });
