const ALLOWED_DOMAINS_ENV = "ALLOWED_DOMAINS";

export type DomainAccess =
  | { allowed: true; hostname: string }
  | {
      allowed: false;
      reason: "invalid-host" | "domain-not-allowed" | "not-configured";
      hostname: string | null;
    };

/**
 * Authorize the hostname in the request's Host header against a server-side
 * allowlist. `example.com` is exact; `*.example.com` permits subdomains only.
 */
export function getRequestDomainAccess(
  requestHost: string | null,
  configuredDomains = process.env[ALLOWED_DOMAINS_ENV],
): DomainAccess {
  const hostname = normalizeHostname(requestHost);
  if (!hostname) {
    return { allowed: false, reason: "invalid-host", hostname: null };
  }

  const rules = parseDomainRules(configuredDomains ?? "");
  if (rules.length === 0) {
    return { allowed: false, reason: "not-configured", hostname };
  }

  const allowed = rules.some((rule) => domainMatchesRule(hostname, rule));
  return allowed
    ? { allowed: true, hostname }
    : { allowed: false, reason: "domain-not-allowed", hostname };
}

function normalizeHostname(value: string | null): string | null {
  const candidate = value?.trim().toLowerCase();
  if (
    !candidate ||
    /[\s,@/?#\\]/.test(candidate) ||
    candidate.includes("://")
  ) {
    return null;
  }

  try {
    const hostname = new URL(`http://${candidate}`).hostname.replace(/\.$/, "");
    if (!hostname || hostname.includes(":") || hostname.includes("..")) return null;
    if (!/^[a-z0-9.-]+$/.test(hostname)) return null;
    if (hostname.split(".").some((label) => !label || label.startsWith("-") || label.endsWith("-"))) return null;
    return hostname;
  } catch {
    return null;
  }
}

function parseDomainRules(value: string): string[] {
  return value
    .split(",")
    .map((rule) => rule.trim().toLowerCase())
    .map((rule) => {
      const wildcard = rule.startsWith("*.");
      const hostname = normalizeHostname(wildcard ? rule.slice(2) : rule);
      return hostname ? `${wildcard ? "*." : ""}${hostname}` : null;
    })
    .filter((rule): rule is string => rule !== null);
}

function domainMatchesRule(hostname: string, rule: string): boolean {
  if (!rule.startsWith("*.")) return hostname === rule;

  const suffix = rule.slice(1);
  return hostname.endsWith(suffix) && hostname.length > suffix.length;
}
