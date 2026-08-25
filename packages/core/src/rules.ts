import { createHash } from "node:crypto";
import type {
  CandidateAction,
  Finding,
  FindingDraft,
  FindingSample,
  FindingsArtifact,
  Observation,
  Rule,
  RuleContext,
  RuleId,
} from "./contracts.js";
import { RULE_IDS, SCHEMA_VERSION } from "./contracts.js";
import {
  isFirstParty,
  observationClassification,
} from "./network-classification.js";
import { canonicalizeUrl } from "./safe-explorer.js";

const maximumSamples = 3;

const builtinRules: readonly Rule[] = [
  placeholderLinkRule(),
  brokenInternalLinkRule(),
  pageErrorRule(),
  consoleErrorRule(),
  failedRequestRule(),
  deadControlRule(),
  pseudoControlRule(),
  horizontalOverflowRule(),
  obstructedControlRule(),
  missingNameRule(),
  keyboardFocusRule(),
  modalFocusRule(),
];

export function evaluateRules(context: RuleContext): FindingsArtifact {
  const drafts = builtinRules.flatMap((rule) =>
    context.config.rules[rule.metadata.id].enabled
      ? rule.evaluate(context)
      : [],
  );
  return {
    schemaVersion: SCHEMA_VERSION,
    target: context.target,
    findings: deduplicateFindings(drafts, context),
  };
}

export function normalizeFingerprintValue(value: string): string {
  return value
    .normalize("NFKC")
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,
      "<uuid>",
    )
    .replace(
      /\b\d{4}-\d{2}-\d{2}t\d{2}:\d{2}:\d{2}(?:\.\d+)?z\b/gi,
      "<timestamp>",
    )
    .replace(/((?:localhost|127\.0\.0\.1|\[::1\])):\d+/gi, "$1:<port>")
    .replace(/\b\d{10,}\b/g, "<number>")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function deduplicateFindings(
  drafts: readonly FindingDraft[],
  context: RuleContext,
): Finding[] {
  const grouped = new Map<string, Finding>();
  for (const draft of drafts) {
    const fingerprint = createHash("sha256")
      .update(
        normalizeFingerprintValue(
          `${draft.ruleId}|${draft.route}|${draft.cause}`,
        ),
      )
      .digest("hex");
    const existing = grouped.get(fingerprint);
    if (existing) {
      existing.occurrenceCount += 1;
      if (existing.samples.length < maximumSamples)
        existing.samples.push(draft.sample);
      continue;
    }
    grouped.set(fingerprint, {
      id: `${draft.ruleId}:${fingerprint.slice(0, 16)}`,
      fingerprint,
      ruleId: draft.ruleId,
      severity: context.config.rules[draft.ruleId].severity,
      route: draft.route,
      message: draft.message,
      occurrenceCount: 1,
      samples: [draft.sample],
    });
  }
  return [...grouped.values()].sort(
    (first, second) =>
      RULE_IDS.indexOf(first.ruleId) - RULE_IDS.indexOf(second.ruleId) ||
      first.route.localeCompare(second.route) ||
      first.fingerprint.localeCompare(second.fingerprint),
  );
}

function placeholderLinkRule(): Rule {
  const id = "navigation.placeholder-link" as const;
  return {
    metadata: {
      id,
      title: "Placeholder link",
      description: "An internal navigation control has no actionable target.",
      defaultSeverity: "warning",
    },
    evaluate(context) {
      const configured = new Set(
        context.config.placeholders.map(normalizePlaceholder),
      );
      return context.appGraph.routes.flatMap((route) =>
        route.actions.flatMap((action) => {
          if (action.kind !== "navigate") return [];
          const rawHref = action.element.attributes.href ?? "";
          const normalized = normalizePlaceholder(rawHref);
          if (
            !configured.has(normalized) &&
            !/^javascript\s*:\s*(?:void\s*\(\s*0\s*\)|;?)$/i.test(
              rawHref.trim(),
            )
          )
            return [];
          return [
            draft(
              id,
              route.url,
              `href:${normalized}`,
              "Link target is a placeholder.",
              {
                data: {
                  elementId: action.element.id,
                  name: action.element.name,
                  href: rawHref,
                },
              },
            ),
          ];
        }),
      );
    },
  };
}

function brokenInternalLinkRule(): Rule {
  const id = "navigation.broken-internal-link" as const;
  return {
    metadata: {
      id,
      title: "Broken internal link",
      description:
        "An observed internal link ends in an HTTP error or redirect loop.",
      defaultSeverity: "error",
    },
    evaluate(context) {
      const config = context.config.rules[id];
      const drafts: FindingDraft[] = [];
      for (const route of context.appGraph.routes) {
        for (const action of route.actions) {
          const destination = internalHttpDestination(action, context.target);
          if (!destination || matchesAny(destination, config.ignoreUrlPatterns))
            continue;
          const failedResponse = context.observations.find((observation) => {
            if (observation.kind !== "response") return false;
            const status = numberValue(observation.data.status);
            return (
              status !== undefined &&
              status >= 400 &&
              chainStartsAt(observation, destination)
            );
          });
          if (failedResponse) {
            const status = numberValue(failedResponse.data.status) ?? 0;
            const finalUrl =
              stringValue(failedResponse.data.url) ?? destination;
            drafts.push(
              draft(
                id,
                route.url,
                `${destination}|${status}|${finalUrl}`,
                `Internal link ended with HTTP ${status}.`,
                observationSample(failedResponse, {
                  sourceElementId: action.element.id,
                  destination,
                  redirectChain: redirectChain(failedResponse),
                }),
              ),
            );
            continue;
          }
          const redirectLoop = context.observations.find(
            (observation) =>
              observation.kind === "request-failed" &&
              chainStartsAt(observation, destination) &&
              /too_many_redirects|redirect loop/i.test(
                stringValue(observation.data.error) ?? "",
              ),
          );
          if (redirectLoop)
            drafts.push(
              draft(
                id,
                route.url,
                `${destination}|redirect-loop`,
                "Internal link entered a redirect loop.",
                observationSample(redirectLoop, {
                  sourceElementId: action.element.id,
                  destination,
                  redirectChain: redirectChain(redirectLoop),
                }),
              ),
            );
        }
      }
      return drafts;
    },
  };
}

function pageErrorRule(): Rule {
  const id = "runtime.page-error" as const;
  return runtimeMessageRule({
    id,
    kind: "page-error",
    title: "Unhandled page exception",
    description: "The page emitted an unhandled JavaScript exception.",
    defaultSeverity: "error",
    message: "Page emitted an unhandled JavaScript exception.",
  });
}

function consoleErrorRule(): Rule {
  const id = "runtime.console-error" as const;
  const base = runtimeMessageRule({
    id,
    kind: "console",
    title: "Console error",
    description: "The page emitted a console error.",
    defaultSeverity: "warning",
    message: "Page emitted a console error.",
  });
  return {
    ...base,
    evaluate(context) {
      return base
        .evaluate(context)
        .filter((candidate) => candidate.sample.data.level === "error");
    },
  };
}

function failedRequestRule(): Rule {
  const id = "runtime.failed-request" as const;
  return {
    metadata: {
      id,
      title: "Failed first-party request",
      description:
        "A first-party load or navigation request failed or returned 5xx.",
      defaultSeverity: "error",
    },
    evaluate(context) {
      const config = context.config.rules[id];
      return context.observations.flatMap((observation) => {
        if (
          observation.kind !== "request-failed" &&
          observation.kind !== "response"
        )
          return [];
        const classification = observationClassification(observation);
        const url = stringValue(observation.data.url);
        if (
          !classification ||
          !url ||
          classification.scope !== "first-party" ||
          classification.expectedCancellation ||
          matchesAny(url, config.ignoreUrlPatterns)
        )
          return [];
        const error = stringValue(observation.data.error) ?? "";
        if (matchesAny(error, config.ignoreMessagePatterns)) return [];
        const status = numberValue(observation.data.status);
        if (observation.kind === "response" && (status ?? 0) < 500) return [];
        const route = stringValue(observation.data.routeUrl) ?? context.target;
        const cause = `${url}|${classification.resourceType}|${error || status}`;
        return [
          draft(
            id,
            route,
            cause,
            observation.kind === "response"
              ? `First-party request returned HTTP ${status}.`
              : "First-party request failed before receiving a response.",
            observationSample(observation, {
              scope: classification.scope,
              role: classification.role,
              resourceType: classification.resourceType,
            }),
          ),
        ];
      });
    },
  };
}

function deadControlRule(): Rule {
  const id = "interaction.dead-control" as const;
  return observationIssueRule({
    id,
    kind: "interaction-attempt",
    title: "Dead control",
    description:
      "A safe control executed successfully without an observable effect.",
    defaultSeverity: "error",
    message: "Control completed without an observable effect.",
    matches: (observation) => observation.data.outcome === "fail",
    cause: (observation) =>
      `element:${elementIdentity(observation)}|viewport:${viewportName(observation)}`,
  });
}

function pseudoControlRule(): Rule {
  const id = "interaction.pseudo-control" as const;
  return observationIssueRule({
    id,
    kind: "accessibility-check",
    title: "Pseudo-control",
    description:
      "An element looks clickable but lacks complete interaction semantics.",
    defaultSeverity: "warning",
    message: "Clickable-looking element lacks functional semantics.",
    matches: (observation) => observation.data.issue === "pseudo-control",
    cause: (observation) => `element:${elementIdentity(observation)}`,
  });
}

function horizontalOverflowRule(): Rule {
  const id = "responsive.horizontal-overflow" as const;
  return observationIssueRule({
    id,
    kind: "layout-check",
    title: "Horizontal overflow",
    description: "The document is wider than the configured viewport.",
    defaultSeverity: "error",
    message: "Page has horizontal overflow at a configured viewport.",
    matches: (observation) => observation.data.issue === "horizontal-overflow",
    cause: (observation) =>
      `viewport:${viewportName(observation)}|offender:${nestedIdentity(
        observation.data.offender,
      )}`,
  });
}

function obstructedControlRule(): Rule {
  const id = "interaction.obstructed-control" as const;
  return observationIssueRule({
    id,
    kind: "layout-check",
    title: "Obstructed control",
    description:
      "A visible control cannot be actioned at its center point or reached in the viewport.",
    defaultSeverity: "error",
    message: "Visible control is covered or outside the actionable viewport.",
    matches: (observation) =>
      observation.data.issue === "obstructed-control" ||
      observation.data.issue === "outside-viewport",
    cause: (observation) =>
      `element:${elementIdentity(observation)}|viewport:${viewportName(
        observation,
      )}|issue:${stringValue(observation.data.issue)}`,
  });
}

function missingNameRule(): Rule {
  const id = "accessibility.missing-name" as const;
  return observationIssueRule({
    id,
    kind: "accessibility-check",
    title: "Missing accessible name",
    description: "A visible interactive control has no accessible name.",
    defaultSeverity: "warning",
    message: "Visible control has no accessible name.",
    matches: (observation) => observation.data.issue === "missing-name",
    cause: (observation) => `element:${elementIdentity(observation)}`,
  });
}

function keyboardFocusRule(): Rule {
  const id = "accessibility.keyboard-focus" as const;
  return observationIssueRule({
    id,
    kind: "accessibility-check",
    title: "Keyboard focus failure",
    description:
      "A bounded Tab traversal lost focus or cycled before reaching visible controls.",
    defaultSeverity: "warning",
    message: "Keyboard traversal did not reach all visible controls reliably.",
    matches: (observation) =>
      observation.data.issue === "keyboard-focus" &&
      observation.data.outcome === "fail",
    cause: (observation) => `viewport:${viewportName(observation)}`,
  });
}

function modalFocusRule(): Rule {
  const id = "accessibility.modal-focus" as const;
  return observationIssueRule({
    id,
    kind: "accessibility-check",
    title: "Modal focus failure",
    description:
      "A modal did not receive, contain, or return focus as expected.",
    defaultSeverity: "error",
    message: "Modal focus behavior is incomplete.",
    matches: (observation) =>
      observation.data.issue === "modal-focus" &&
      observation.data.outcome === "fail",
    cause: (observation) => `element:${elementIdentity(observation)}`,
  });
}

function observationIssueRule(options: {
  id: RuleId;
  kind: Observation["kind"];
  title: string;
  description: string;
  defaultSeverity: "warning" | "error";
  message: string;
  matches: (observation: Observation) => boolean;
  cause: (observation: Observation) => string;
}): Rule {
  return {
    metadata: options,
    evaluate(context) {
      return context.observations.flatMap((observation) => {
        if (observation.kind !== options.kind || !options.matches(observation))
          return [];
        return [
          draft(
            options.id,
            stringValue(observation.data.routeUrl) ?? context.target,
            options.cause(observation),
            options.message,
            observationSample(observation),
          ),
        ];
      });
    },
  };
}

function runtimeMessageRule(options: {
  id: RuleId;
  kind: Observation["kind"];
  title: string;
  description: string;
  defaultSeverity: "warning" | "error";
  message: string;
}): Rule {
  return {
    metadata: options,
    evaluate(context) {
      const config = context.config.rules[options.id];
      return context.observations.flatMap((observation) => {
        if (observation.kind !== options.kind) return [];
        const message =
          stringValue(observation.data.message) ??
          stringValue(observation.data.text) ??
          "unknown";
        if (matchesAny(message, config.ignoreMessagePatterns)) return [];
        const route = stringValue(observation.data.routeUrl) ?? context.target;
        return [
          draft(
            options.id,
            route,
            message,
            options.message,
            observationSample(observation),
          ),
        ];
      });
    },
  };
}

function draft(
  ruleId: RuleId,
  route: string,
  cause: string,
  message: string,
  sample: FindingSample,
): FindingDraft {
  return { ruleId, route, cause, message, sample };
}

function observationSample(
  observation: Observation,
  extra: Record<string, unknown> = {},
): FindingSample {
  return {
    sequence: observation.sequence,
    atMs: observation.atMs,
    data: { ...observation.data, ...extra },
  };
}

function internalHttpDestination(
  action: CandidateAction,
  target: string,
): string | undefined {
  if (action.kind !== "navigate" || !action.destination) return undefined;
  try {
    const url = new URL(action.destination);
    return (url.protocol === "http:" || url.protocol === "https:") &&
      isFirstParty(target, url.toString())
      ? canonicalizeUrl(url.toString())
      : undefined;
  } catch {
    return undefined;
  }
}

function chainStartsAt(observation: Observation, destination: string): boolean {
  const chain = redirectChain(observation);
  const first = chain.at(0) ?? stringValue(observation.data.url);
  if (!first) return false;
  try {
    return canonicalizeUrl(first) === canonicalizeUrl(destination);
  } catch {
    return false;
  }
}

function redirectChain(observation: Observation): string[] {
  const value = observation.data.redirectChain;
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function normalizePlaceholder(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "");
}

function matchesAny(value: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => {
    const expression = pattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replaceAll("*", ".*");
    return new RegExp(`^${expression}$`, "i").test(value);
  });
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function elementIdentity(observation: Observation): string {
  return nestedIdentity(observation.data.element);
}

function nestedIdentity(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return "unknown";
  const record = value as Record<string, unknown>;
  return [record.id, record.tagName, record.role, record.name]
    .filter((entry): entry is string => typeof entry === "string")
    .join(":");
}

function viewportName(observation: Observation): string {
  const viewport = observation.data.viewport;
  if (typeof viewport === "string") return viewport;
  if (viewport && typeof viewport === "object" && !Array.isArray(viewport))
    return stringValue((viewport as Record<string, unknown>).name) ?? "unknown";
  return "unknown";
}
