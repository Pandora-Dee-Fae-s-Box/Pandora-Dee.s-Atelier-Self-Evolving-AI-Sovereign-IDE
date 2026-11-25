// ngit-reader bridge: read Nostr-hosted git repos (NIP-34 / gitworkshop.dev)
// through an MCP server that may run over stdio or a configured HTTP endpoint.
// No npm package exists for ngit-reader, so everything here is optional and
// driven by pdd.config.json -> ngitReader.

import { randomUUID } from "node:crypto";

const DEFAULT_ID = "ngit-reader";
const RPC_TIMEOUT = 120_000;

/** Build a bridge around the desktop's stdio MCP host.
 *  opts.stdio  - the createMcpStdio() instance from plugin.mjs
 *  opts.config - readConfig().ngitReader (may be undefined)
 */
export function createNgit({ stdio, config = {} }) {
  let httpClient = null;
  let rpcId = 1;

  function mode() {
    if (config?.url && typeof config.url === "string") return "http";
    if (config?.command && typeof config.command === "string") return "stdio";
    return "none";
  }

  function safeConfig() {
    return {
      mode: mode(),
      id: DEFAULT_ID,
      command: config?.command || null,
      args: Array.isArray(config?.args) ? config.args : [],
      cwd: config?.cwd || null,
      url: config?.url || null,
      // never expose env values
      envKeys: config?.env && typeof config.env === "object" ? Object.keys(config.env) : [],
      note: "ngit-reader is not on npm; configure command/url in pdd.config.json -> ngitReader.",
    };
  }

  function ensureHttp() {
    if (httpClient) return httpClient;
    const url = config?.url;
    if (!url || typeof url !== "string") throw new Error("No ngitReader.url configured.");
    httpClient = {
      url,
      async send(method, params) {
        const id = rpcId++;
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
        });
        if (!res.ok) throw new Error(`ngit-reader HTTP ${res.status}: ${await res.text().catch(() => "")}`);
        const msg = await res.json();
        if (msg.error) throw Object.assign(new Error(msg.error.message || "ngit-reader error"), { code: msg.error.code });
        return msg.result;
      },
    };
    return httpClient;
  }

  async function ensureStdio() {
    const st = stdio.status(DEFAULT_ID);
    if (st.running) return st;
    const command = config?.command;
    if (!command || typeof command !== "string") throw new Error("No ngitReader.command configured.");
    const args = Array.isArray(config?.args) ? config.args : [];
    const cwd = config?.cwd || undefined;
    const env = config?.env && typeof config.env === "object" ? config.env : {};
    return stdio.start({ id: DEFAULT_ID, command, args, cwd, env });
  }

  async function send(method, params) {
    if (mode() === "http") {
      return ensureHttp().send(method, params);
    }
    await ensureStdio();
    const id = rpcId++;
    const msg = { jsonrpc: "2.0", id, method, params };
    const out = await stdio.send(DEFAULT_ID, msg, RPC_TIMEOUT);
    if (out && out.error) throw Object.assign(new Error(out.error.message || "ngit-reader error"), { code: out.error.code });
    return out?.result;
  }

  async function tools() {
    if (mode() === "none") return { tools: [], config: safeConfig() };
    const list = await send("tools/list", {});
    return { tools: list?.tools ?? [], config: safeConfig() };
  }

  async function call(name, args = {}) {
    if (mode() === "none") throw new Error("ngit-reader is not configured. Set ngitReader.command or ngitReader.url in pdd.config.json.");
    return send("tools/call", { name: String(name), arguments: args });
  }

  function close() {
    try {
      stdio.stop(DEFAULT_ID);
    } catch {
      /* already stopped */
    }
    httpClient = null;
  }

  return { tools, call, config: safeConfig, close };
}
