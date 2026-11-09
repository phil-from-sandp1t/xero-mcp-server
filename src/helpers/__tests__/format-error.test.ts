import { AxiosError, AxiosHeaders } from "axios";
import { describe, expect, it } from "vitest";

import { formatError } from "../format-error.js";

function makeAxiosError(status: number, detail?: string): AxiosError {
  const headers = new AxiosHeaders();
  const config = { headers };
  const err = new AxiosError(
    "Request failed",
    String(status),
    config as never,
    null,
    {
      status,
      data: detail ? { Detail: detail } : {},
      statusText: "",
      headers: {},
      config,
    } as never,
  );
  return err;
}

describe("formatError", () => {
  describe("AxiosError mapping", () => {
    it("maps 401 to authentication message", () => {
      expect(formatError(makeAxiosError(401))).toBe(
        "Authentication failed. Please check your Xero credentials.",
      );
    });

    it("maps 403 to permission message", () => {
      expect(formatError(makeAxiosError(403))).toBe(
        "You don't have permission to access this resource in Xero.",
      );
    });

    it("maps 404 to not-found message", () => {
      expect(formatError(makeAxiosError(404))).toBe(
        "The requested resource was not found in Xero.",
      );
    });

    it("maps 429 to rate-limit message", () => {
      expect(formatError(makeAxiosError(429))).toBe(
        "Too many requests to Xero. Please try again in a moment.",
      );
    });

    it("returns response.data.Detail for non-mapped statuses", () => {
      expect(formatError(makeAxiosError(400, "Field is required"))).toBe(
        "Field is required",
      );
    });

    it("returns generic message when no Detail is provided", () => {
      expect(formatError(makeAxiosError(500))).toBe(
        "An error occurred while communicating with Xero.",
      );
    });
  });

  describe("xero-node SDK error shape", () => {
    it("extracts problem.detail and title without leaking request headers", () => {
      const sdkError = {
        response: {
          statusCode: 405,
          body: {
            httpStatusCode: "MethodNotAllowed",
            problem: {
              title: "MethodNotAllowed",
              detail: "Method not allowed for the current customer jurisdiction.",
              status: 405,
            },
          },
          headers: { "set-cookie": "ak_bmsc=secret" },
        },
        request: {
          headers: { authorization: "Bearer eyJSECRET" },
        },
      };

      const result = formatError(sdkError);

      expect(result).toBe(
        "405 MethodNotAllowed: Method not allowed for the current customer jurisdiction.",
      );
      expect(result).not.toContain("Bearer");
      expect(result).not.toContain("eyJSECRET");
      expect(result).not.toContain("set-cookie");
    });

    it("maps 401 SDK error to the standard auth message", () => {
      const sdkError = {
        response: { statusCode: 401, body: {} },
        request: { headers: { authorization: "Bearer leaky" } },
      };

      const result = formatError(sdkError);
      expect(result).toBe(
        "Authentication failed. Please check your Xero credentials.",
      );
      expect(result).not.toContain("Bearer");
    });

    it("falls back to status code + title when detail is missing", () => {
      const sdkError = {
        response: {
          statusCode: 502,
          body: { httpStatusCode: "BadGateway" },
        },
      };

      expect(formatError(sdkError)).toBe("502 BadGateway");
    });

    it("falls back to a generic title when neither problem nor httpStatusCode is present", () => {
      const sdkError = { response: { statusCode: 502 } };
      expect(formatError(sdkError)).toBe("502 HTTP error");
    });
  });

  describe("plain Error", () => {
    it("returns the error message", () => {
      expect(formatError(new Error("Employee ID is required"))).toBe(
        "Employee ID is required",
      );
    });
  });

  describe("unknown error shapes", () => {
    it("returns a generic message and never stringifies the object", () => {
      const leakyUnknown = {
        request: { headers: { authorization: "Bearer LEAKY_TOKEN" } },
      };

      const result = formatError(leakyUnknown);

      expect(result).toBe(
        "An unexpected error occurred while communicating with Xero.",
      );
      expect(result).not.toContain("Bearer");
      expect(result).not.toContain("LEAKY_TOKEN");
    });

    it("handles string errors safely", () => {
      expect(formatError("something blew up")).toBe(
        "An unexpected error occurred while communicating with Xero.",
      );
    });

    it("handles null safely", () => {
      expect(formatError(null)).toBe(
        "An unexpected error occurred while communicating with Xero.",
      );
    });
  });
});

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
