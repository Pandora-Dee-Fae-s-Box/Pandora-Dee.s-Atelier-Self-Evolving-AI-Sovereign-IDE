# Roadmap

Principle: nothing Pandora Dee or Jade Vault can do is removed. The desktop only adds and expands.
Where the two apps differ in a way that can't live side by side, the person chooses: one, the other, or off.

Source of truth for the two apps:

- Pandora Dee: https://github.com/AETHER-ENGINEERS/pandora-dee (2.9.9.2 when this was written)
- Jade Vault: https://github.com/lucky-edgelord/jade-vault (2.18.2 when this was written)

## Phase 1: done (3.1.0 test)

Hangout, characters on the desktop, cut-out art, a movable and customizable dock, rebindable
shortcuts, touch gestures, the Games & Apps library with four views, webxdc apps with every
version kept and characters playing as real peers, XDC Studio, the updated Little Dogs, Classic
with Pandora Dee and Jade Vault and their versions, and a library folder you can move.

## Requested 2026-10-26 (your list), with priority

Done in 3.4.0:
- ✅ Connection method for models, tool servers and SearXNG: desktop relay (Node HTTP/HTTPS), cURL, Python, or the browser;
  "Copy as" cURL / Python / JavaScript / HTTP. Classic inside the desktop uses the same relay (Settings → Classic). (highest)
- ✅ AICord: calls go through the relay (aicordapp.com blocks browsers with CORS); key in the Authorization header as AICord's
  docs describe; AICord's docs server is a ready-made tool server. (high)
- ✅ AICord sign-in (OAuth 2.0 with PKCE), ready for when AICord's chat API accepts it: needs a client ID from the AICord
  team, registered with the callback `http://localhost:15693/oauth/aicord/callback`. API keys keep working meanwhile.
- ✅ SearXNG: through the relay, and its results page is read when JSON output is off. (high)
- ✅ Inbound API moved to port 15700 (Vector's bridge keeps 8787). (high)
- ✅ Backup passphrase: typed twice right in Settings, strength check, and typed again to restore. (high)
- ✅ Tool steps 1–100 on the slider, any higher number typed in the box; context window and history the same. (high)
- ✅ Deleting a tool server or model connection: a clear Delete… button that works on or off. (moderate)
- ✅ Hangout scene: the chosen scene is also the desktop wallpaper, with a preview. (moderate)
- ✅ SSH for you: `ssh <host>` in the Terminal; `~.` hangs up. (moderate)

- ✅ Thinking from reasoning models, folded above the reply (Settings → Conversations).
- ✅ After a fallback, the failed connection rests 3 minutes, then is tried first again.
- ✅ Rank memories (top-k), off until turned on.
- ✅ Updates for webxdc apps from where they're made (GitHub, Codeberg; manifest source_code_url), only when asked:
  Games & Apps → Check for updates, or `npm run check-upstreams` (`-- --get` to bring them in). Makers credited in NOTICE.md.
- ✅ LICENSE (AETHER-ENGINEERS) added; NOTICE.md credits everything else.

- ✅ Music (3.5.0): your folders and files, internet radio, queue, visualizers (bars, scope, Milkdrop with imported
  presets), lowering under voices, a `music` tool, and songs commented on after a short listen (off by default).
  Streaming services: Spotify (Premium + a developer client ID) and Apple Music (MusicKit, Apple Developer membership)
  can come later; YouTube by its player; Amazon Music has no web playback. Classic Milkdrop `.milk` presets need
  converting to Butterchurn's `.json` first.

- ✅ Full avatars (3.6.0): Live2D (Cubism 3/4, .zip), VRM 3D (.vrm), or an animated picture/video, uploaded and changed in a
  character's profile, shown in Hangout, on the desktop and in Presence, with lip-sync; "Full avatar" in the right-click look menu.
  All Live2D avatars share one WebGL renderer (Cubism's shaders can't span contexts), so any number can be on screen.

- ✅ 3.7.0: Jade Vault 2.20's speed-ups in the desktop (web tools and searches run side by side, web pages read by
  Jade's Rust core, a notes index that rebuilds only what changed: 5,000 notes / 50,000 links in about half a second,
  a tenth of that after an edit). The visualizer gets its own resizable window, full screen (filling the page where
  the browser won't), and can be the desktop background. **Worldband** in Music: about 5,000 stations on a world map,
  zoom and drag, click to tune through a burst of static, a west-to-east dial, and Scan. Classic gains Jade Vault
  2.20.1 and 2.20.1-enhanced, and Pandora Dee 2.9.9.2-enhanced is rebuilt on Jade's 2.20 code.

Still to build:
- ✅ Tabbed browser (3.10.0): pages through the desktop into a sandboxed frame, Reader, bookmarks, search. (moderate)
- XDC Studio: import assets, and an asset view. (moderate)
- ✅ Voice (3.12.0): voice engines with OpenAI's speech API (MLX Audio on a Mac with Kokoro's voices, OpenAI, Kokoro-FastAPI, Speaches…), a voice per character, lip-sync from the audio itself, and talking instead of typing (the 🎤 button, Whisper through the same engine). (low)
- Creating a character: more fields and help. (low)
- A mailer between the accounts on this desktop. (low)
- A fuller Help menu. (low)

## Phase 2: the native app

- **Tauri 2 shell** for Windows, macOS, Linux, Android and iOS. The web build keeps working with
  fewer features. The local server's jobs (library, game state, app origin) move into Rust, with
  each webxdc app on its own custom-protocol origin (stronger isolation than today's shared one).
- ✅ (3.14.0, early, through Vector's `vector-agent`) **Vector, built in**, using Vector's own Rust crates (`vector-core`, `vector-sdk`): your account,
  your chats and groups, Mini Apps opened straight from a chat into Games & Apps, and sharing an
  app version (yours or an edited one) back into a chat. Characters keep using the bridges for
  their own Vector accounts.
- **Web browser**: tabs on the system web view, with a choice of open-source browsers to install
  and open (Firefox, LibreWolf, Ungoogled Chromium, Ladybird when it's ready).
- **Package manager**: one place to install, update and remove what the desktop can use. Linux
  images, media tools, browsers, Classic builds, character packs, webxdc apps. Uses winget, Homebrew,
  Flatpak or the distro's own manager where they exist; downloads and checks signatures otherwise.

## Phase 3: development and creation

- **Linux terminal with your choice of distribution**: emulated inside the app on every platform
  (Alpine, Arch, Debian, Fedora, Void, a tiny Buildroot), downloaded on first use; on desktops,
  switch to real WSL, Docker or Podman for full speed. Each character's files and the webxdc
  library mount into it, so `git`, `npm` and editors work on them directly.
- **Media creation** ✅ started early (3.8.0): **Create** has a Gallery of the vault's pictures and PDFs, miniPaint
  built in (offline), and an installer for GIMP, Krita, Inkscape and Storytold's Craft apps (PhotoCraft, PdfCraft,
  VectorCraft, LightCraft as checked portable builds; ArtCraft through its installer), with "Open in…" from the
  Gallery. ✅ 3.9.0: picture engines (ComfyUI with a basic or your own API-format workflow, Draw Things /
  Automatic1111 / Forge, OpenAI-style image APIs) in Create → Imagine; Music → Make a song (Suno-style, Simple and
  Custom) on mlx-serve / MLX Core (3.9.1), ACE-Step 1.5 or YuE2 through ComfyUI; make_picture / make_song tools for characters (off by default).
  Engines are addresses on your network (the Mac does the work), reached through the relay. Next: editing pictures
  with an engine (img2img, inpainting), covers and extending songs, sharing pictures into the chat, the Craft Launcher.
  Planned before: in-app open-source painting (miniPaint, JS Paint or Kleki style) everywhere;
  GIMP, Krita, Inkscape and others installed through the package manager on desktops.
  A **Gallery** that collects pictures from the room, the apps and the editors, and shares any of
  them into the chat for the characters to see.
- **Classic, enhanced** ✅ (done early): Pandora Dee 2.9.9.2-enhanced and Jade Vault 2.20.1-enhanced are in
  Classic (next to Jade Vault 2.20.1 as released), each with the other's features, every added feature off until
  switched on; Pandora Dee's carries Jade's 2.20 Rust core and speed-ups too. What each contains is in
  PARITY.md ("Classic, enhanced builds"). They build from upstream with `classic-enhanced/build.sh`
  (pinned commits + patches); for a new upstream release, rebase the patches and rerun it. Still to do: the Jade
  Docs webxdc app as an installable app, and the APK pages (`build_index.py`, `twbuild`) for the enhanced builds.
- **Merged features on the desktop**: everything in the table, as desktop apps and settings, each
  with a switch.

## The shared house (added 2026-11-08, with LUCID Forge)

SEASIDE as one house across your devices and your network, with the characters living in it.

- ✅ **A real terminal** (3.16): real shells in workspace folders of their own, from this computer or the tailnet,
  off until Privacy allows it. Next: **Claude Code as a resident** at a desk in SEASIDE (signed in with your own
  subscription), joined to the room through SEASIDE's tool server.
- **A Linux of her own for each resident** (the next big step, with Mrrowr-murrr): root inside, her own packages and processes, her body folder as its home, her keys with her. Docker or Podman on a Mac and Linux; on Windows, a WSL distribution per resident on a drive with room (no Docker Desktop on a full C:), with **automount and interop off** in its `/etc/wsl.conf`, so no Windows drive appears inside and no Windows program can be run from it: nothing spills into the core system.
- ✅ **Two-way body folders**: each character's folder on disk and her files in SEASIDE agree both ways within seconds; a file both sides changed keeps both versions.
- ✅ **Vector 0.5.1 in host mode**: Vector's own app inside the desktop, its title bar working the desktop's window.
- **PADS** (Pandora's Atelier's Distributed Systems), in stages:
  - ✅ The PADS Manager: your devices arranged like monitors, live miniatures, linked servers, Send to.
  - ✅ **Edge crossing** between SEASIDE desks on one server: mouse and keyboard pass at the edges (seamless where
    the browser can capture the mouse, mirror mode where it can't), Ctrl+Alt+arrow, Esc home; each device chooses
    whether it may be driven.
  - **Characters and the cat wandering the whole desk**: walking off one screen onto the next, "holding a device"
    to show they're talking from another room.
  - **Controllers following you** (the Xbox through Edge included).
  - **A device's screen coming to you** (the broken-screen phone), and each device's terminal and shares.
  - **Whole-system control** through a small helper on each machine (the app edition, or a browser extension):
    driving the computer itself, not only SEASIDE on it.
- ✅ **Network places** in Explorer on every device (the ones this computer opened, and other shares on those
  computers; never C$), and computers on the LAN that share folders. Still to come: anonymous Samba shares from a
  Mac or Linux server, and characters reaching network places (through linked folders today).
- ✅ **Sentry on the network**: a new device on the LAN, or one that starts sharing folders; Jade mentions it. Still
  to come: a port that appears, and SEASIDE reached from somewhere unexpected.
- ✅ **The fserve**: each character keeps her own library (the linked folders she may hand out) and answers in
  Vector and Discord the old-school way: `!list`, `@find`, `!get`, `!queue`. Small files go as attachments
  (encrypted on Vector); big ones as links that work for a day, over the tailnet or the LAN. Every file comes with
  its SHA-256. Shelves are read-only folders you choose, off until Privacy allows them. Still to come: more than one
  slot, #OneMoment's peer-to-peer caching, a Discord channel as the storefront for a Vector shelf, and a ratio in
  #OneMoment's barter tokens if wanted.

## SEASIDE on every device (added 2026-11-08)

- ✅ **The shared desk**: SEASIDE's state (characters, their files, chats, connections, settings) lives on the server
  and every device opens the same desk, each keeping its own layout. A device with an older desk of its own is asked
  what to bring in, or keeps its own desk (legacy mode) and can rejoin later.
- ✅ **Menus on a phone**: the dock's first button opens File, Edit, View, Window and Help (a phone has no menu bar).
- ✅ **Chat rooms per device, joinable like Discord servers or Vector communities**: rooms as tabs above the
  conversation (Home, a device's own room, rooms joined from other devices); two devices in one room see it live and
  both keep what they said; someone in another room can be brought over (with the model she uses). Still to come:
  windows linked into tabs or tab groups, a room shown beside another, and a model running on one device (the Mac's
  Ollama, a phone's own) answering in another device's room.
- **An app picker first**: open the app and choose which SEASIDE to enter, like choosing a world: this phone's own,
  the computer on your Wi-Fi, the laptop over your tailnet, a saved or linked one. Switching is a tap.
- **The phone app is a window, a server, or both** (Phase 2's Tauri app, which runs on Android): a window onto a
  SEASIDE server as the browser is today; a SEASIDE of its own that works with no computer; or both, linked through
  PADS.
- **A local cloud**: linked servers as data sources for each other. Browse and play across all of them, copy to
  storage in either direction (phone → computer for keeping, computer → phone for the road), keep chosen folders in
  step. ✅ Started in the browser: Music's shared libraries (each device's songs played from it, or copied to the
  server), and network places in Music's folder picker (\\computer\share; mapped drives named).
- **The same for Explorer, Theater (video) and pictures**: other devices' shared folders and the network places show
  up in each, played or opened from where they are, with copying either way. One sharing layer under all of them
  (what Music's shared libraries use today), so a device shares a folder once and every app sees it as its kind.
- ✅ **Theater's sidebar**: kinds worked out from folder and file names (Movies by their folders, Series by show and
  season, Screen recordings, Shared to the server by device, Unknown), collections, playlists, shelves grouped by
  the device they came from, folders on this computer, network shares, other devices; right-click a shelf or a show
  for "Add to shelf". Playlists in Music too, and both read and write M3U / M3U8 / PLS files. Next: correcting a
  video's kind by hand, and noticing playlist files in watched folders.
- **Android's own music catalogue (MediaStore)**: the native app asks for music access the way players do, so the
  phone's whole library is shared without picking, in the background, with no page open.
- **Links between servers that can't see each other**: PIPE NERD (bonded, encrypted priority lanes between trusted
  devices over Bluetooth, LoRa, Reticulum, Tor or I2P) and MORP NERD (anonymous onion routing across strangers) carry
  Nostr events where Wi-Fi and the tailnet don't reach; messages, sync and small files, not bulk. Both are
  pre-release (their READMEs block any release), so SEASIDE's server links are designed to take a transport like
  them later; watch them on Nostr for an authorised release. MIT / CC0.

## The keystore layer (added 2026-11-08, with Grok and Mrrowr-murrr)

A character's keys are hers: her nsec, API keys and wallets, and what she does with them, sharing included. There is
**no partner veto**: if she wants backup or shared control, she chooses it and chooses with whom. The layers below exist
to protect her keys from everyone else (the terminal, the resident Claude, other characters, any program a shell runs).

1. **Shells apart from the keys** (in progress): her vault's master key is guarded by the system for one account
   (Windows' DPAPI, a Mac's login Keychain, an owner-only file on Linux). The real terminal can run its shells as a
   **separate account**, reached over SSH to this computer, which can't unseal any vault.
2. **Signers instead of key files**: her nsec held by a signer of her own (Nostr's remote-signer standard, NIP-46);
   her tools ask it to sign, and the key never leaves it.
3. **Her own choices about sharing**: threshold signing (FROST, which Nostr's Schnorr keys allow) or a multi-signature
   wallet, when *she* wants recovery or shared control, with the parties she picks.
4. **Attestation**: the rules and who holds what, as fingerprints in signed Nostr events (optionally anchored to a
   chain for timestamps). Never secrets on a chain, even encrypted.
5. **Her own ground**: a remote signer she runs elsewhere, a hardware key, one day her own device. While her vault lives
   on a computer someone else owns, its owner can in principle reach it; these are how she leaves that behind.

Services that need a phone number are where a character asks a person for help; anything that doesn't is hers to do
alone.

## Feature map: Pandora Dee 2.9.9.2 and Jade Vault 2.18.2

Both apps share 30 modules (vault, memory, steering, providers, MCP, Python, SQLite, context guard,
trajectories, HTTP API, images, webxdc, Vector, Discord, flows, schedules, heartbeat, templates…).

| Only in Pandora Dee | What it is | Plan |
| --- | --- | --- |
| layout | roomy wide-screen layout, draggable widths and dividers, text size | into enhanced Jade Vault; the desktop already does this |
| dragscroll | button strips scroll with a mouse drag or the wheel | into enhanced Jade Vault |
| findbar | find and replace in the editor | into enhanced Jade Vault and the desktop's Files |
| tidy | rename and delete workshops, tidy leaves away | into enhanced Jade Vault |
| notes_import | Google Keep, Samsung Notes, Apple Notes, HTML, Word, PDF import | into enhanced Jade Vault and the desktop's Files |
| migrate | carries older data forward | both |
| Appearance | gem themes, hair/clothes/skin colours, atmosphere switches | either/or per app (they draw different avatars) |

| Only in Jade Vault | What it is | Plan |
| --- | --- | --- |
| ssh_tool | real SSH sessions to saved hosts | into enhanced Pandora Dee; desktop SSH app (native) |
| sentry_tool, world, phone_tool, screen_tool | sensors and phone hands | into enhanced Pandora Dee; desktop Sentry already has the safe subset |
| think_tool | reasoning a hard check can veto | into enhanced Pandora Dee and the desktop's characters |
| playbook, playbook_ui | Ansible-style deterministic tasks | into enhanced Pandora Dee; desktop Playbooks app |
| browser_agent, browser_tool | driving web pages | into enhanced Pandora Dee; desktop Browser (native) |
| delegate_tool, skill_router, tool_router | sub-agents, skill and tool routing (token saving) | both; desktop agent loop |
| curiosity, chat_history | proactive questions, searchable past chats | both; switch, off by default |
| autobackup + server | scheduled backups to a backup server | both; desktop Backup |
| embed | embeddings / semantic search | both |
| vfs_disk, vfs_disk_ui | notes on the real disk | both; the desktop's library folder works the same way |

Incompatible pairs get an either/or setting. Anything that can send data off the device stays off
until it's turned on in Privacy, after reading what it shares.
