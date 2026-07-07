import { describe, expect, it } from "vitest";

import { validateCommandParams, type CommandParamSchema } from "./command-param-schema.js";

const restartSchema: CommandParamSchema = {
  allowUnknown: false,
  fields: {
    serviceId: {
      type: "string",
      required: true,
      minLength: 2,
      maxLength: 80,
      pattern: /^[a-zA-Z0-9_.-]+$/,
    },
  },
};

describe("validateCommandParams", () => {
  it("passes with valid payload", () => {
    const result = validateCommandParams(restartSchema, {
      serviceId: "Spooler",
    });

    expect(result).toEqual({ ok: true });
  });

  it("fails when required field is missing", () => {
    const result = validateCommandParams(restartSchema, {});

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain("serviceId is required");
    }
  });

  it("fails when unknown fields are sent", () => {
    const result = validateCommandParams(restartSchema, {
      serviceId: "Spooler",
      force: true,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain("force is not allowed");
    }
  });

  it("fails when payload is not an object", () => {
    const result = validateCommandParams(restartSchema, "bad");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain("requestedParams must be an object");
    }
  });
});
