import type { Observation } from "./contracts.js";

export type NetworkScope = "first-party" | "third-party" | "unknown";
export type RequestRole = "navigation" | "resource";

export interface NetworkClassification {
  scope: NetworkScope;
  role: RequestRole;
  resourceType: string;
  expectedCancellation: boolean;
}

export function isFirstParty(target: string, url: string): boolean {
  try {
    return new URL(target).origin === new URL(url).origin;
  } catch {
    return false;
  }
}

export function isExpectedCancellation(
  errorText: string,
  resourceType: string,
): boolean {
  const cancelled = /(?:err_aborted|aborted|cancelled|canceled)/i.test(
    errorText,
  );
  return cancelled && resourceType !== "document";
}

export function classifyNetworkRequest(options: {
  target: string;
  url: string;
  resourceType: string;
  navigation?: boolean;
  errorText?: string;
}): NetworkClassification {
  let validUrl = true;
  try {
    new URL(options.url);
  } catch {
    validUrl = false;
  }
  return {
    scope: validUrl
      ? isFirstParty(options.target, options.url)
        ? "first-party"
        : "third-party"
      : "unknown",
    role:
      options.navigation === true || options.resourceType === "document"
        ? "navigation"
        : "resource",
    resourceType: options.resourceType,
    expectedCancellation: isExpectedCancellation(
      options.errorText ?? "",
      options.resourceType,
    ),
  };
}

export function observationClassification(
  observation: Observation,
): NetworkClassification | undefined {
  if (observation.kind !== "response" && observation.kind !== "request-failed")
    return undefined;
  const url = stringValue(observation.data.url);
  const resourceType = stringValue(observation.data.resourceType);
  const scope = stringValue(observation.data.scope);
  const role = stringValue(observation.data.role);
  if (!url || !resourceType) return undefined;
  return {
    scope:
      scope === "first-party" || scope === "third-party" || scope === "unknown"
        ? scope
        : observation.data.firstParty === true
          ? "first-party"
          : "third-party",
    role: role === "navigation" ? "navigation" : "resource",
    resourceType,
    expectedCancellation: observation.data.expectedCancellation === true,
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
