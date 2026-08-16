import { LineItemTracking, TrackingCategory } from "xero-node";

/**
 * Fill in tracking category and option ids.
 *
 * Xero accepts a line's Tracking without ids and returns 200, then stores
 * nothing — the write looks successful and silently does not happen. Only
 * TrackingCategoryID + TrackingOptionID persist. Callers naturally supply
 * names, so resolve them here, and fail loudly when a name does not match
 * rather than passing through something Xero will quietly discard.
 */
export function resolveTracking(
  entries: LineItemTracking[] | undefined,
  categories: TrackingCategory[],
): LineItemTracking[] | undefined {
  if (!entries?.length) return entries;

  return entries.map((entry) => {
    // Already fully identified: trust it and leave it alone.
    if (entry.trackingCategoryID && entry.trackingOptionID) return entry;

    const category = findCategory(categories, entry);
    if (!category) {
      throw new Error(
        `Unknown tracking category ${describe(entry.name)}. Available: ${
          categories.map((c) => c.name).filter(Boolean).join(", ") || "none"
        }. Use list-tracking-categories.`,
      );
    }

    const active = (category.options ?? []).filter((o) => {
      const status = String(o.status ?? "");
      return status !== "DELETED" && status !== "ARCHIVED";
    });
    const option = active.find((o) => matches(o.name, entry.option));
    if (!option) {
      throw new Error(
        `Unknown option ${describe(entry.option)} for tracking category "${category.name}". Available: ${
          active.map((o) => o.name).filter(Boolean).join(", ") || "none"
        }. Create it with create-tracking-options, or use list-tracking-categories.`,
      );
    }

    return {
      trackingCategoryID: category.trackingCategoryID,
      trackingOptionID: option.trackingOptionID,
      name: category.name,
      option: option.name,
    };
  });
}

function findCategory(
  categories: TrackingCategory[],
  entry: LineItemTracking,
): TrackingCategory | undefined {
  if (entry.trackingCategoryID) {
    const byId = categories.find(
      (c) => c.trackingCategoryID === entry.trackingCategoryID,
    );
    if (byId) return byId;
  }
  return categories.find((c) => matches(c.name, entry.name));
}

/** Exact first, then case- and whitespace-insensitive: option names vary by hand. */
function matches(candidate: string | undefined, wanted: string | undefined): boolean {
  if (candidate === undefined || wanted === undefined) return false;
  if (candidate === wanted) return true;
  return candidate.trim().toLowerCase() === wanted.trim().toLowerCase();
}

function describe(value: string | undefined): string {
  return value === undefined ? "(none given)" : `"${value}"`;
}
