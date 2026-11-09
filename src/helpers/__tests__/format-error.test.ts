import { AxiosError, AxiosHeaders } from "axios";
import { describe, expect, it } from "vitest";

import { formatError } from "../format-error.js";

const TOKEN = "Bearer eyJhbGciOi.secret-access-token";

// Shaped after the ValidationException Xero returned for a tracking-only edit
// to a paid invoice dated before the year-end lock date (issue #10).
const validationBody = {
  ErrorNumber: 10,
  Type: "ValidationException",
  Message: "A validation exception occurred",
  Elements: [
    {
      Status: "PAID",
      ValidationErrors: [
        {
          Message:
            "The document cannot be edited as it is currently dated before the end of year lock date, currently set at 30-Jun-2025",
        },
      ],
      Warnings: [
        {
          Message:
            "Some fields cannot be changed on an invoice that has payments or credit notes allocated to it.",
        },
      ],
    },
  ],
};

// What xero-node 13.x actually rejects with: the HttpError, stringified, with
// the request (and its Authorization header) along for the ride.
function stringifiedHttpError(body: unknown): string {
  return JSON.stringify({
    response: {
      statusCode: 400,
      body,
      headers: { "content-type": "application/json" },
      request: {
        uri: { href: "https://api.xero.com/api.xro/2.0/Invoices/abc" },
        method: "POST",
        headers: { authorization: TOKEN, "xero-tenant-id": "tenant-1" },
      },
    },
    body,
  });
}

describe("formatError: stringified xero-node errors", () => {
  it("surfaces ValidationErrors and Warnings from a stringified HttpError", () => {
    const message = formatError(stringifiedHttpError(validationBody));

    expect(message).toContain("end of year lock date");
    expect(message).toContain(
      "Warnings: Some fields cannot be changed on an invoice",
    );
    expect(message).not.toContain("unexpected error");
  });

  it("never echoes the bearer token or request details", () => {
    const message = formatError(stringifiedHttpError(validationBody));

    expect(message).not.toContain("secret-access-token");
    expect(message).not.toContain("authorization");
    expect(message).not.toContain("tenant-1");
    expect(message).not.toContain("api.xero.com");
  });

  it("accepts a bare validation payload as the string", () => {
    const message = formatError(JSON.stringify(validationBody));
    expect(message).toContain("end of year lock date");
  });

  it("de-duplicates messages repeated across elements", () => {
    const repeated = {
      ...validationBody,
      Elements: [validationBody.Elements[0], validationBody.Elements[0]],
    };
    const message = formatError(stringifiedHttpError(repeated));
    expect(message.match(/end of year lock date/g)).toHaveLength(1);
  });

  it("falls back to the generic message for a string that is not JSON", () => {
    const message = formatError(`request failed ${TOKEN}`);
    expect(message).toBe(
      "An unexpected error occurred while communicating with Xero.",
    );
  });

  it("falls back to the generic message for JSON with no validation messages", () => {
    const message = formatError(
      JSON.stringify({ request: { headers: { authorization: TOKEN } } }),
    );
    expect(message).toBe(
      "An unexpected error occurred while communicating with Xero.",
    );
  });

  it("describes a stringified non-validation SDK error from whitelisted fields", () => {
    const message = formatError(
      JSON.stringify({
        response: {
          statusCode: 401,
          request: { headers: { authorization: TOKEN } },
        },
      }),
    );
    expect(message).toBe(
      "Authentication failed. Please check your Xero credentials.",
    );
  });
});

describe("formatError: object-shaped errors carrying a validation body", () => {
  it("surfaces validation messages from an SDK error object", () => {
    const message = formatError({
      response: {
        statusCode: 400,
        body: validationBody,
        request: { headers: { authorization: TOKEN } },
      },
    });
    expect(message).toContain("end of year lock date");
    expect(message).not.toContain("secret-access-token");
  });

  it("surfaces validation messages from an AxiosError", () => {
    const error = new AxiosError("Request failed", "ERR_BAD_REQUEST");
    error.response = {
      status: 400,
      statusText: "Bad Request",
      data: validationBody,
      headers: {},
      config: { headers: new AxiosHeaders() },
    };
    expect(formatError(error)).toContain("end of year lock date");
  });

  it("keeps the existing problem/detail formatting for non-validation bodies", () => {
    const message = formatError({
      response: {
        statusCode: 400,
        body: { problem: { title: "Bad Request", detail: "Invalid date" } },
      },
    });
    expect(message).toBe("400 Bad Request: Invalid date");
  });
});
