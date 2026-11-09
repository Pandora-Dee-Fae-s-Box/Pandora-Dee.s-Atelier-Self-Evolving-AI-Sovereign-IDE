// The rooms this device keeps, as tabs above the conversation: Home, its own room, rooms it joined from other devices.
// A click goes there; + makes a room for this device or joins another; a tab's menu renames it, brings someone over
// from it, closes the tab, or deletes the room (lib/rooms.ts).

import { useState } from "react";
import { DoorOpen, Home, MonitorSmartphone, Pencil, Plus, Trash2, UserPlus, X } from "lucide-react";
import { desk, useDesk } from "../lib/store.ts";
import { closeTab, deleteRoom, HOME, membersOf, newRoom, renameRoom, roomName, roomsOn, switchRoom } from "../lib/rooms.ts";
import { deviceName } from "../lib/devshare.ts";
import { openMenu, type MenuItem } from "./ContextMenu.tsx";
import { askText, askUser } from "./Ask.tsx";

const tell = (why: string) => why && desk().notice(why);

export function RoomTabs() {
  const roomId = useDesk((s) => s.roomId);
  const tabs = useDesk((s) => s.roomTabs);
  const rooms = useDesk((s) => s.rooms);
  const [going, setGoing] = useState("");
  if (!roomsOn()) return null;
  const go = async (id: string) => {
    if (going) return;
    setGoing(id || "home");
    tell(await switchRoom(id));
    setGoing("");
  };
  const shown = [HOME, ...tabs.filter((id) => rooms.some((r) => r.id === id))];

  const plusMenu = (e: React.MouseEvent) => {
    const others = rooms.filter((r) => !tabs.includes(r.id));
    openMenu(e, [
      {
        label: "A room for this device…",
        icon: <Plus size={14} />,
        run: () =>
          void askText("A room of its own", `${deviceName()}'s room`, { body: "Its own conversation, with whoever you invite. Your other devices can join it, and you can switch back to Home any time.", yes: "Make it" }).then(
            async (name) => name !== null && tell(await newRoom(name ?? "")),
          ),
      },
      ...(others.length
        ? [
            { sep: true } as MenuItem,
            { heading: "Join a room" } as MenuItem,
            ...others.map((r): MenuItem => ({ label: r.name, hint: r.device, icon: <DoorOpen size={14} />, run: () => void go(r.id) })),
          ]
        : []),
    ]);
  };

  const tabMenu = async (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    const at = { clientX: e.clientX, clientY: e.clientY, preventDefault: () => {}, stopPropagation: () => {} };
    const items: MenuItem[] = [];
    if (id !== roomId) {
      // someone from that room joins this one (with the model she uses: it's hers, wherever she is)
      const s = desk();
      const theirs = (await membersOf(id).catch(() => [] as string[])).filter((x) => !s.members.includes(x));
      items.push({ heading: `Bring someone from ${roomName(id)}` });
      if (theirs.length)
        items.push(
          ...theirs.map((x): MenuItem => ({ label: s.character(x)?.short ?? x, icon: <UserPlus size={14} />, run: () => tell(desk().join(x)) })),
        );
      else items.push({ label: "Everyone there is here already", disabled: true, run: () => {} });
    }
    if (id) {
      items.push(
        { sep: true },
        { label: "Rename…", icon: <Pencil size={14} />, run: () => void askText("Rename the room", roomName(id), { yes: "Rename" }).then((n) => n && renameRoom(id, n)) },
        { label: "Close the tab", hint: "the room stays", icon: <X size={14} />, run: () => void closeTab(id).then(tell) },
        {
          label: "Delete the room…",
          icon: <Trash2 size={14} />,
          danger: true,
          run: () =>
            void askUser(`Delete ${roomName(id)}?`, "It goes for every device. What was said in it stays, as a branch (the title menu at the top of the Room).", "Delete it", "Keep it").then(
              (yes) => yes && void deleteRoom(id).then(tell),
            ),
        },
      );
    }
    if (items.length) openMenu(at, items);
  };

  return (
    <div className="room-tabs" role="tablist" aria-label="Rooms">
      {shown.map((id) => {
        const meta = rooms.find((r) => r.id === id);
        return (
          <button
            key={id || "home"}
            role="tab"
            aria-selected={roomId === id}
            className={`room-tab${roomId === id ? " on" : ""}${going === (id || "home") ? " going" : ""}`}
            onClick={() => void go(id)}
            onContextMenu={(e) => void tabMenu(e, id)}
            data-tip={id ? `${meta?.name} · made on ${meta?.device}. Right-click for more` : "The room every device shares. Right-click to bring someone from it"}
          >
            {id ? <MonitorSmartphone size={13} /> : <Home size={13} />}
            <span>{roomName(id)}</span>
          </button>
        );
      })}
      <button className="room-tab add" onClick={plusMenu} aria-label="A new room, or join one" data-tip="A room for this device, or join another device's">
        <Plus size={13} />
      </button>
    </div>
  );
}
