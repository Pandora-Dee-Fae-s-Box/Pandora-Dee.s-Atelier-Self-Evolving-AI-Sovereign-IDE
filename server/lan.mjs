// The devices on the local network, for Explorer (computers that share folders) and Sentry (a device that's new, or
// one that started sharing). What's on the LAN comes from this computer's own ARP table (the devices it has talked to
// or heard from); each is asked only whether it answers on the file-sharing port (445), and a sharing computer for its
// name. Nothing is sent beyond the local network. Looked at only when asked from this computer (Sentry's network watch,
// or Explorer's "Look for computers").

import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import dns from "node:dns";
import { execFile } from "node:child_process";

const run = (cmd, args, ms = 8000) =>
  new Promise((resolve) => execFile(cmd, args, { windowsHide: true, timeout: ms }, (_e, out) => resolve(String(out || ""))));

/** "arp -a" as { ip, mac } (multicast, broadcast and incomplete entries left out). */
export function parseArp(text) {
  const out = [];
  const seen = new Set();
  for (const line of String(text).split(/\r?\n/)) {
    // Windows: "  192.168.1.20         a4-5e-60-12-34-56     dynamic"; macOS/Linux: "? (192.168.1.20) at a4:5e:60:12:34:56 on en0"
    const m = /(\d{1,3}(?:\.\d{1,3}){3})\)?\s+(?:at\s+)?([0-9a-f]{2}(?:[-:][0-9a-f]{2}){5})/i.exec(line);
    if (!m) continue;
    const ip = m[1], mac = m[2].toLowerCase().replace(/-/g, ":");
    const first = Number(ip.split(".")[0]), last = Number(ip.split(".")[3]);
    if (first >= 224 || last === 255 || last === 0) continue; // multicast, broadcast
    if (mac === "ff:ff:ff:ff:ff:ff" || mac.startsWith("01:00:5e") || mac === "00:00:00:00:00:00") continue;
    if (seen.has(mac)) continue;
    seen.add(mac);
    out.push({ ip, mac });
  }
  return out;
}

/** A computer's NetBIOS name from "nbtstat -A" (its <00> UNIQUE line). */
export function parseNbtstat(text) {
  const m = /^\s*([^\s<]{1,15})\s*<00>\s+UNIQUE/im.exec(String(text));
  return m ? m[1] : "";
}

/** Does it answer on this port? (a short knock; nothing is sent) */
const answers = (ip, port, ms = 600) =>
  new Promise((resolve) => {
    const s = net.connect({ host: ip, port });
    const done = (ok) => (s.destroy(), resolve(ok));
    s.setTimeout(ms, () => done(false));
    s.once("connect", () => done(true));
    s.once("error", () => done(false));
  });

async function nameOf(ip, sharing) {
  try {
    const [n] = await dns.promises.reverse(ip);
    if (n) return n.replace(/\.(local|lan|home|localdomain)$/i, "");
  } catch {
    /* no name in DNS */
  }
  if (sharing && process.platform === "win32") return parseNbtstat(await run("nbtstat", ["-A", ip], 5000));
  return "";
}

export function createLan({ dataDir, now = Date.now }) {
  const file = () => path.join(dataDir(), "lan.json");
  const read = () => {
    try {
      const j = JSON.parse(fs.readFileSync(file(), "utf8"));
      return { devices: j.devices ?? {}, events: Array.isArray(j.events) ? j.events : [], at: j.at ?? 0 };
    } catch {
      return { devices: {}, events: [], at: 0 };
    }
  };
  const write = (st) => {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(file(), JSON.stringify(st, null, 1));
  };
  let busy = null;

  /**
   * Look at the network now. A device seen for the first time, or one that starts sharing folders, is an event (the
   * very first look only learns what's there, so a whole household isn't reported as new). `table` is for tests.
   */
  function scan({ table } = {}) {
    if (busy) return busy;
    busy = (async () => {
      const st = read();
      const first = st.at === 0;
      const found = parseArp(table ?? (await run("arp", ["-a"])));
      const checked = await Promise.all(
        found.map(async (d) => {
          const sharing = table ? false : await answers(d.ip, 445);
          return { ...d, sharing, name: table ? "" : await nameOf(d.ip, sharing) };
        }),
      );
      const t = now();
      const fresh = [];
      for (const d of checked) {
        const old = st.devices[d.mac];
        const name = d.name || old?.name || "";
        if (!old && !first) fresh.push({ at: t, kind: "new", mac: d.mac, ip: d.ip, name });
        else if (old && d.sharing && !old.sharing && !first) fresh.push({ at: t, kind: "sharing", mac: d.mac, ip: d.ip, name });
        st.devices[d.mac] = { ip: d.ip, name, sharing: d.sharing, first: old?.first ?? t, last: t, label: old?.label ?? "" };
      }
      st.events = [...fresh, ...st.events].slice(0, 200);
      st.at = t;
      write(st);
      return { ...list(), fresh };
    })().finally(() => (busy = null));
    return busy;
  }

  /** What's known, newest seen first. */
  function list() {
    const st = read();
    const devices = Object.entries(st.devices)
      .map(([mac, d]) => ({ mac, ...d }))
      .sort((a, b) => b.last - a.last || a.ip.localeCompare(b.ip, undefined, { numeric: true }));
    return { at: st.at, devices, events: st.events.slice(0, 50) };
  }

  /** A name of the household's own for a device ("Kai's tablet"). */
  function label(mac, text) {
    const st = read();
    const d = st.devices[String(mac).toLowerCase()];
    if (!d) throw Object.assign(new Error("That device isn't known here."), { status: 404 });
    d.label = String(text ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
    write(st);
    return list();
  }

  return { scan, list, label };
}
