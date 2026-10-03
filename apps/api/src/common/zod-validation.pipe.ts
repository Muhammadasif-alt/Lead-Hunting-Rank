import type { PipeTransform } from '@nestjs/common';
import { ValidationError } from '@revenue-os/shared';
import type { z } from 'zod';

/**
 * Validates a body/query/param against a Zod schema and returns the parsed value.
 * Use `z.strictObject(...)` for commands so unknown fields are rejected (no mass-assignment — Tech Spec #10 §18).
 *
 *   @Post() create(@Body(new ZodValidationPipe(CreateCompanyInput)) input: CreateCompanyInput) {}
 */
export class ZodValidationPipe<T extends z.ZodType> implements PipeTransform<unknown, z.output<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.output<T> {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;
    throw new ValidationError(
      'Request validation failed',
      result.error.issues.map((issue) => ({
        path: issue.path.join('.') || undefined,
        message: issue.message,
      })),
    );
  }
}
