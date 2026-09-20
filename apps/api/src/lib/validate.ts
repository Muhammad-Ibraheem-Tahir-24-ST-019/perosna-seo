import { z } from 'zod';

/** Parses and throws ZodError, which the error handler renders as 422. */
export function parseBody<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  return schema.parse(body ?? {});
}

export function parseQuery<T extends z.ZodTypeAny>(schema: T, query: unknown): z.infer<T> {
  return schema.parse(query ?? {});
}

export const emailSchema = z
  .string()
  .trim()
  .min(3)
  .max(254)
  .email('Enter a valid email address.');

/**
 * Password policy: length does most of the work, so the floor is 10 characters
 * with a mix requirement rather than an unmemorable symbol soup.
 */
export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters.')
  .max(200)
  .refine((value) => /[a-zA-Z]/.test(value) && /[0-9]/.test(value), {
    message: 'Include at least one letter and one number.',
  });

export const cuidLike = z.string().min(8).max(64).regex(/^[a-zA-Z0-9_-]+$/, 'Invalid identifier.');

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursor: z.string().max(500).optional(),
});
