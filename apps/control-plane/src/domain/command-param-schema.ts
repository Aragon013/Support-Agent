type ParamType = "string" | "number" | "boolean";

export type CommandParamRule = {
  type: ParamType;
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  pattern?: RegExp;
  enumValues?: readonly (string | number | boolean)[];
  minimum?: number;
  maximum?: number;
};

export type CommandParamSchema = {
  allowUnknown?: boolean;
  fields: Record<string, CommandParamRule>;
};

export type ParamValidationResult =
  | { ok: true }
  | { ok: false; errors: string[] };

export function validateCommandParams(
  schema: CommandParamSchema,
  value: unknown,
): ParamValidationResult {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, errors: ["requestedParams must be an object"] };
  }

  const params = value as Record<string, unknown>;
  const errors: string[] = [];

  for (const [fieldName, rule] of Object.entries(schema.fields)) {
    const fieldValue = params[fieldName];
    const isMissing = fieldValue === undefined || fieldValue === null;

    if (rule.required && isMissing) {
      errors.push(`${fieldName} is required`);
      continue;
    }

    if (isMissing) {
      continue;
    }

    if (rule.type === "string") {
      if (typeof fieldValue !== "string") {
        errors.push(`${fieldName} must be a string`);
        continue;
      }
      if (rule.minLength !== undefined && fieldValue.length < rule.minLength) {
        errors.push(`${fieldName} must have at least ${rule.minLength} chars`);
      }
      if (rule.maxLength !== undefined && fieldValue.length > rule.maxLength) {
        errors.push(`${fieldName} must have at most ${rule.maxLength} chars`);
      }
      if (rule.pattern && !rule.pattern.test(fieldValue)) {
        errors.push(`${fieldName} has invalid format`);
      }
    }

    if (rule.type === "number") {
      if (typeof fieldValue !== "number" || Number.isNaN(fieldValue)) {
        errors.push(`${fieldName} must be a number`);
        continue;
      }
      if (rule.minimum !== undefined && fieldValue < rule.minimum) {
        errors.push(`${fieldName} must be >= ${rule.minimum}`);
      }
      if (rule.maximum !== undefined && fieldValue > rule.maximum) {
        errors.push(`${fieldName} must be <= ${rule.maximum}`);
      }
    }

    if (rule.type === "boolean" && typeof fieldValue !== "boolean") {
      errors.push(`${fieldName} must be a boolean`);
    }

    if (rule.enumValues && !rule.enumValues.includes(fieldValue as never)) {
      errors.push(`${fieldName} must be one of [${rule.enumValues.join(", ")}]`);
    }
  }

  if (!schema.allowUnknown) {
    const known = new Set(Object.keys(schema.fields));
    for (const key of Object.keys(params)) {
      if (!known.has(key)) {
        errors.push(`${key} is not allowed`);
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true };
}
