import { z } from 'zod';

/** Request contracts for the Lead Hunter API (docs/17 §46-51, docs/screens/03). Commands are strict: unknown fields are rejected. */

const text = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) => text(max).optional();
const version = z.number().int().min(1);
const mode = z.enum(['QUICK', 'DEEP', 'MARKET_EXHAUST']);
const country = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{2}$/, 'Use a 2-letter country code, e.g. US')
  .transform((c) => c.toUpperCase());
const categories = z.array(text(80).min(1)).max(30);

/** Preview: everything optional — a typed request fills the gaps; missing industry/country is reported, not guessed. */
export const PreviewMissionInput = z.strictObject({
  request: optionalText(500),
  industry: optionalText(120),
  country: country.optional(),
  region: optionalText(120),
  city: optionalText(120),
  mode: mode.optional(),
  categories: categories.optional(),
});
export type PreviewMissionInput = z.output<typeof PreviewMissionInput>;

/** Start: the confirmed, structured market (the person checked the interpretation in the preview). */
export const StartMissionInput = z.strictObject({
  request: optionalText(500),
  industry: text(120).min(1, 'Business type is required'),
  country,
  region: optionalText(120),
  city: optionalText(120),
  mode,
  categories: categories.optional(),
});
export type StartMissionInput = z.output<typeof StartMissionInput>;

export const MissionVersionInput = z.strictObject({ version });

export const MissionListQuery = z.object({
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const MissionCompaniesQuery = z.object({
  website: z.enum(['with', 'without', 'any']).default('any'),
  phone: z.enum(['with', 'any']).default('any'),
  outcome: z.enum(['CREATED', 'MATCHED_EXISTING']).optional(),
  q: optionalText(120),
  cursor: z.string().max(600).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type MissionCompaniesQuery = z.output<typeof MissionCompaniesQuery>;
