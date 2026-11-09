// PADS's live wire: one WebSocket per device of an account, so a mouse and keyboard can cross from one SEASIDE to the
// next as fast as they move. The server only passes messages along, between devices of the same account; input
// ("ctl") reaches a device only while that device has said it may be controlled (its own PADS switch, off at first).

const MAX = 64 * 1024;

export function createPadsWire({ pads }) {
  const conns = new Map(); // device id → { account, conn, allow }

  /** A device's page connects: it must be one of the account's PADS devices. */
  function attach(conn, { account, device }) {
    const acct = String(account || "").slice(0, 80);
    const id = String(device || "").slice(0, 40);
    if (!/^[A-Za-z0-9_-]{8,40}$/.test(id) || !pads.has(acct, id)) return void conn.close();
    conns.get(id)?.conn.close(); // the same device again (a reload): the newer page takes over
    const me = { account: acct, conn, allow: false };
    conns.set(id, me);
    const peers = () => [...conns.entries()].filter(([k, c]) => k !== id && c.account === acct).map(([k, c]) => ({ id: k, allow: c.allow }));
    const announce = () => {
      for (const [, c] of conns) if (c.account === acct) c.conn.sendText(JSON.stringify({ type: "peers", peers: [...conns.entries()].filter(([, x]) => x.account === acct).map(([k, x]) => ({ id: k, allow: x.allow })) }));
    };
    conn.onmessage = (data) => {
      if (typeof data !== "string" || data.length > MAX) return;
      let m;
      try {
        m = JSON.parse(data);
      } catch {
        return;
      }
      if (m.type === "allow") {
        me.allow = Boolean(m.allow);
        return announce();
      }
      if (m.type !== "to") return;
      const to = conns.get(String(m.to || ""));
      if (!to || to.account !== acct) return void conn.sendText(JSON.stringify({ type: "gone", id: m.to }));
      // input only into a device that allows it; anything else (its answers, "leave") always passes
      if (m.ctl && !to.allow) return void conn.sendText(JSON.stringify({ type: "refused", id: m.to }));
      to.conn.sendText(JSON.stringify({ type: "from", from: id, ctl: Boolean(m.ctl), ev: m.ev }));
    };
    conn.onclose = () => {
      if (conns.get(id)?.conn === conn) conns.delete(id);
      announce();
    };
    conn.sendText(JSON.stringify({ type: "peers", peers: peers() }));
    announce();
  }

  return { attach, connected: () => [...conns.keys()] };
}
