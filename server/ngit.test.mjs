import assert from "node:assert";
import test from "node:test";
import { createNgit } from "./ngit.mjs";

function makeStdio(answers = {}) {
  let started = null;
  let stopped = false;
  return {
    start(opts) {
      started = opts;
      return { id: opts.id, running: true };
    },
    stop(id) {
      stopped = id;
      return true;
    },
    status(id) {
      return started ? { id, running: !stopped } : { id, running: false };
    },
    async send(id, msg) {
      if (stopped) return { error: { code: -32000, message: "stopped" } };
      const key = `${msg.method}:${JSON.stringify(msg.params)}`;
      const res = answers[key];
      if (res instanceof Error) throw res;
      return { jsonrpc: "2.0", id: msg.id, result: res };
    },
  };
}

test("ngit config() reports unconfigured mode", async () => {
  const ngit = createNgit({ stdio: makeStdio() });
  const c = ngit.config();
  assert.strictEqual(c.mode, "none");
  assert.strictEqual(c.command, null);
  assert.ok(c.note.includes("not on npm"));
});

test("ngit tools() returns empty list when unconfigured", async () => {
  const ngit = createNgit({ stdio: makeStdio() });
  const t = await ngit.tools();
  assert.deepStrictEqual(t.tools, []);
  assert.strictEqual(t.config.mode, "none");
});

test("ngit call() throws when unconfigured", async () => {
  const ngit = createNgit({ stdio: makeStdio() });
  await assert.rejects(() => ngit.call("read_repo", {}), /not configured/);
});

test("ngit stdio mode starts server and lists tools", async () => {
  const stdio = makeStdio({
    'tools/list:{}': { tools: [{ name: "read_repo", description: "Read a repo" }] },
  });
  const ngit = createNgit({
    stdio,
    config: { command: "node", args: ["./reader.mjs"], cwd: "/tmp" },
  });
  const t = await ngit.tools();
  assert.strictEqual(t.tools.length, 1);
  assert.strictEqual(t.tools[0].name, "read_repo");
  assert.strictEqual(stdio.status("ngit-reader").running, true);
  ngit.close();
  assert.strictEqual(stdio.status("ngit-reader").running, false);
});

test("ngit stdio mode calls a tool", async () => {
  const stdio = makeStdio({
    'tools/list:{}': { tools: [{ name: "read_repo" }] },
    'tools/call:{"name":"read_repo","arguments":{"repo":"naddr123"}}': { content: [{ type: "text", text: "hello" }] },
  });
  const ngit = createNgit({
    stdio,
    config: { command: "node", args: ["./reader.mjs"] },
  });
  const out = await ngit.call("read_repo", { repo: "naddr123" });
  assert.deepStrictEqual(out, { content: [{ type: "text", text: "hello" }] });
});

test("ngit stdio mode surfaces JSON-RPC errors", async () => {
  const stdio = makeStdio({
    'tools/call:{"name":"read_repo","arguments":{"repo":"bad"}}': { error: { code: -32602, message: "bad repo" } },
  });
  const ngit = createNgit({
    stdio,
    config: { command: "node", args: ["./reader.mjs"] },
  });
  await assert.rejects(() => ngit.call("read_repo", { repo: "bad" }), /bad repo/);
});

test("ngit HTTP mode lists tools via fetch", async () => {
  let posted = null;
  const ngit = createNgit({
    stdio: makeStdio(),
    config: { url: "http://localhost:9999/mcp" },
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    posted = { url, body: JSON.parse(init.body) };
    return {
      ok: true,
      status: 200,
      text: async () => "",
      json: async () => ({ jsonrpc: "2.0", id: posted.body.id, result: { tools: [{ name: "read_repo" }] } }),
    };
  };
  try {
    const t = await ngit.tools();
    assert.strictEqual(posted.body.method, "tools/list");
    assert.strictEqual(t.tools[0].name, "read_repo");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ngit HTTP mode calls a tool", async () => {
  let posted = null;
  const ngit = createNgit({
    stdio: makeStdio(),
    config: { url: "http://localhost:9999/mcp" },
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    posted = { url, body: JSON.parse(init.body) };
    return {
      ok: true,
      status: 200,
      text: async () => "",
      json: async () => ({ jsonrpc: "2.0", id: posted.body.id, result: { content: [] } }),
    };
  };
  try {
    await ngit.call("read_repo", { repo: "naddr" });
    assert.strictEqual(posted.body.method, "tools/call");
    assert.deepStrictEqual(posted.body.params, { name: "read_repo", arguments: { repo: "naddr" } });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ngit HTTP mode surfaces HTTP errors", async () => {
  const ngit = createNgit({
    stdio: makeStdio(),
    config: { url: "http://localhost:9999/mcp" },
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 503, text: async () => "overloaded" });
  try {
    await assert.rejects(() => ngit.tools(), /HTTP 503/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
