// Where a character's own requests (http_request, reading a page) may go. Pure, so it's tested on its own
// (netGuard.test.ts). The local network (this computer, the home network, a tailnet) is out of reach unless it's listed;
// SEASIDE's own address never is, since its page and its API share it. A key tied to hosts is only ever sent there.

/** This device, the home network or a tailnet, by its name or address. */
export function isPrivateHost(host: string): boolean {
  const h = String(host || "").toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!h) return true;
  const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h);
  if (v4) {
    const a = Number(v4[1]), b = Number(v4[2]);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (h.includes(":")) return h === "::" || h === "::1" || /^f[cd]/.test(h) || /^fe[89ab]/.test(h) || h.startsWith("::ffff:");
  if (!h.includes(".")) return true; // one word ("nas", "router"): a machine on this network
  return /(^|\.)(localhost|local|lan|home|home\.arpa|internal|intranet|corp|ts\.net)$/.test(h);
}

/** "api.github.com, *.githubusercontent.com" → its hosts. */
export const hostList = (v: string | undefined) => String(v ?? "").split(/[\s,]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
/** A host against a pattern: exact, or *.example.com for it and everything under it. A pattern may carry a port. */
export const hostMatches = (host: string, pat: string) => (pat.startsWith("*.") ? host === pat.slice(2) || host.endsWith(pat.slice(1)) : host === pat);

export type GuardRules = {
  /** Local addresses a character may reach anyway ("192.168.1.20, homeassistant.local"). */
  localHosts?: string;
  /** Each key's hosts, by its name. */
  keyHosts?: Record<string, string>;
  /** SEASIDE's own host (and port): never reached by a character's request. */
  self?: string;
};

/** Why a request to this address, carrying these keys, may not go: or "" when it may. */
export function refusal(url: string, keys: Iterable<string>, rules: GuardRules): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return "That isn't a usable address.";
  }
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const withPort = u.port ? `${host}:${u.port}` : host;
  const self = String(rules.self ?? "").toLowerCase();
  if (self && (withPort === self || (isPrivateHost(host) && u.port && self.endsWith(`:${u.port}`))))
    return "That's SEASIDE's own address, which a character's request never reaches.";
  if (isPrivateHost(host) && !hostList(rules.localHosts).some((p) => hostMatches(host, p) || hostMatches(withPort, p)))
    return `${host} is on this computer or the local network, which isn't reached unless it's listed in Connections → Web → Local addresses.`;
  for (const k of keys) {
    const hosts = hostList(rules.keyHosts?.[k]);
    if (hosts.length && !hosts.some((p) => hostMatches(host, p))) return `{{${k}}} only goes to ${hosts.join(", ")}, not to ${host}.`;
  }
  return "";
}

/** The keys whose values are in this text (filled in now, or already filled in by something else). */
export function keysIn(text: string, env: Record<string, string>, into = new Set<string>()) {
  for (const [k, v] of Object.entries(env)) if (v && v.length >= 4 && text.includes(v)) into.add(k);
  return into;
}
