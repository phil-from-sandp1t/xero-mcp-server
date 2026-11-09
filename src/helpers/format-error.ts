import { AxiosError } from "axios";

interface XeroSdkProblem {
  title?: string;
  detail?: string;
  status?: number;
}

interface XeroSdkError {
  response: {
    statusCode: number;
    body?: {
      httpStatusCode?: string;
      problem?: XeroSdkProblem;
      Detail?: string;
      /** Present on Xero exceptions, e.g. "ValidationException". */
      Type?: string;
      /** Present on Xero exceptions, e.g. "A validation exception occurred". */
      Message?: string;
    };
  };
}

function isXeroSdkError(error: unknown): error is XeroSdkError {
  if (typeof error !== "object" || error === null) return false;
  const response = (error as { response?: unknown }).response;
  if (typeof response !== "object" || response === null) return false;
  return typeof (response as { statusCode?: unknown }).statusCode === "number";
}

const GENERIC_ERROR =
  "An unexpected error occurred while communicating with Xero.";

function readMessages(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  return list
    .map((entry) =>
      typeof entry === "object" && entry !== null
        ? (entry as { Message?: unknown }).Message
        : undefined,
    )
    .filter((message): message is string => typeof message === "string")
    .map((message) => message.trim())
    .filter((message) => message.length > 0);
}

/**
 * Pull the human-readable reasons out of a Xero ValidationException body.
 *
 * Only `Elements[*].ValidationErrors[*].Message` and
 * `Elements[*].Warnings[*].Message` are read. Nothing else from the body is
 * returned, so whatever else travels with it cannot leak.
 */
function extractValidationMessages(
  body: unknown,
  status?: number,
): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const payload = body as { Type?: unknown; Elements?: unknown };
  if (!Array.isArray(payload.Elements)) return undefined;

  const errors: string[] = [];
  const warnings: string[] = [];
  for (const element of payload.Elements) {
    if (typeof element !== "object" || element === null) continue;
    const { ValidationErrors, Warnings } = element as {
      ValidationErrors?: unknown;
      Warnings?: unknown;
    };
    errors.push(...readMessages(ValidationErrors));
    warnings.push(...readMessages(Warnings));
  }

  const unique = (items: string[]) => [...new Set(items)];
  const parts: string[] = [];
  if (errors.length > 0) parts.push(unique(errors).join("; "));
  if (warnings.length > 0) {
    parts.push(`Warnings: ${unique(warnings).join("; ")}`);
  }
  if (parts.length === 0) return undefined;
  const prefix =
    status === undefined
      ? "Xero rejected the request"
      : `Xero rejected the request (${status})`;
  return `${prefix}: ${parts.join(" ")}`;
}

/**
 * xero-node rejects some 400s (ValidationException among them) with the
 * JSON-stringified HttpError rather than an object. Parse it, but never
 * return any of the raw string: it carries the Bearer token in
 * `request.headers.authorization`.
 */
function formatStringError(error: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(error);
  } catch {
    return GENERIC_ERROR;
  }
  if (typeof parsed !== "object" || parsed === null) return GENERIC_ERROR;

  const candidate = parsed as {
    response?: { body?: unknown; statusCode?: unknown };
    body?: unknown;
  };
  const status =
    typeof candidate.response?.statusCode === "number"
      ? candidate.response.statusCode
      : undefined;
  const validation =
    extractValidationMessages(candidate.response?.body, status) ??
    extractValidationMessages(candidate.body, status) ??
    extractValidationMessages(parsed, status);
  if (validation) return validation;

  // Not a validation payload, but it may still be an SDK error we know how
  // to describe from whitelisted fields.
  if (isXeroSdkError(parsed)) return formatSdkError(parsed);
  return GENERIC_ERROR;
}

function formatSdkError(error: XeroSdkError): string {
  const status = error.response.statusCode;
  const mapped = formatHttpStatus(status);
  if (mapped) return mapped;

  const validation = extractValidationMessages(error.response.body, status);
  if (validation) return validation;

  const body = error.response.body;
  const problem = body?.problem;
  const title =
    problem?.title ?? body?.httpStatusCode ?? body?.Type ?? "HTTP error";
  const detail = problem?.detail ?? body?.Detail ?? body?.Message;
  return detail ? `${status} ${title}: ${detail}` : `${status} ${title}`;
}

function formatHttpStatus(status: number): string {
  switch (status) {
    case 401:
      return "Authentication failed. Please check your Xero credentials.";
    case 403:
      return "You don't have permission to access this resource in Xero.";
    case 404:
      return "The requested resource was not found in Xero.";
    case 429:
      return "Too many requests to Xero. Please try again in a moment.";
    default:
      return "";
  }
}

/**
 * Format error messages for return to the LLM.
 *
 * Never stringify unknown error objects — the xero-node SDK rejects with a
 * plain object whose `request.headers.authorization` field contains the
 * caller's Bearer token. Whitelist the fields we extract so secrets never
 * reach the response.
 */
export function formatError(error: unknown): string {
  if (error instanceof AxiosError) {
    const status = error.response?.status;
    const detail = error.response?.data?.Detail;

    if (status !== undefined) {
      const mapped = formatHttpStatus(status);
      if (mapped) return mapped;
    }
    const validation = extractValidationMessages(error.response?.data, status);
    if (validation) return validation;
    return detail || "An error occurred while communicating with Xero.";
  }

  if (isXeroSdkError(error)) {
    return formatSdkError(error);
  }

  if (typeof error === "string") {
    return formatStringError(error);
  }

  if (error instanceof Error) {
    return error.message;
  }

  return GENERIC_ERROR;
}
