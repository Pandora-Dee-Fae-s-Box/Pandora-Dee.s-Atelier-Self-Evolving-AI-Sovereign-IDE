// Settings for making pictures and songs: the engines (servers that do the work, usually on another computer on
// your network) and where the results go. Kept apart from media.ts so the store can import it without a cycle.

import type { Via } from "./outbound.ts";

export type ImageKind = "comfyui" | "a1111" | "openai";
export type SongKind = "mlx-serve" | "acestep" | "yue2-comfyui";

export type ImageEngine = {
  id: string;
  name: string;
  kind: ImageKind;
  /** Where it answers: http://macbook.local:8188 (ComfyUI), :7860 (Draw Things / Automatic1111), https://api.openai.com/v1 */
  url: string;
  /** Name of the key in Keys, if it needs one. */
  keyName?: string;
  /** OpenAI-style: the model; ComfyUI: the checkpoint (blank: the first it has). */
  model?: string;
  /** ComfyUI: your own workflow in API format, with {{prompt}} {{negative}} {{seed}} {{width}} {{height}} {{steps}} where they go. */
  workflow?: string;
  steps?: number;
  via?: Via;
  enabled: boolean;
};

export type SongEngine = {
  id: string;
  name: string;
  kind: SongKind;
  /** mlx-serve (http://127.0.0.1:11234), ACE-Step's API (http://macbook.local:8001) or ComfyUI (http://pc.local:8188) for YuE2. */
  url: string;
  keyName?: string;
  /** mlx-serve: the music model (e.g. MiniMax-Music3-MLX-Serve-8bit); ACE-Step: which model (blank: its default). */
  model?: string;
  via?: Via;
  enabled: boolean;
};

export type MadeSong = {
  id: string;
  title: string;
  style: string;
  lyrics: string;
  seconds: number;
  seed: number;
  engine: string;
  /** Its file in the music library (as named there); "" when it was left on the engine. */
  file: string;
  /** Left on the engine (played from there, not copied): which engine, and the song's name there. */
  onEngine?: { engineId: string; name: string };
  at: number;
};

/** A verdict on a song (from the songs kept on the engine), for the song writer to learn from. */
export type SongVerdict = { song: string; title: string; style: string; verdict: "good" | "bad"; why: string; by?: string; at: number };

/** A song an engine is still making: kept with the settings so the wait survives a page reload. */
export type PendingSong = {
  id: string;
  /** The engine's own job ("bridge:<id>" or "ace:<id>"). */
  ref: string;
  engineId: string;
  seed: number;
  ask: { title: string; style: string; lyrics: string; seconds: number; instrumental?: boolean };
  at: number;
};

export type MediaPrefs = {
  images: ImageEngine[];
  songs: SongEngine[];
  /** Vault folder for pictures that are made. */
  pictureFolder: string;
  /** Songs made here, newest first (the audio itself is in the music library). */
  made: MadeSong[];
  /** Songs still being made by an engine that works in jobs. */
  pending?: PendingSong[];
  /** Characters may make pictures and songs with a tool (off until switched on). */
  characterTools: boolean;
  /** Production notes added to every song's style, so a lazy engine still aims for a proper mix (on unless switched
   *  off; blank uses SONG_NOTES_DEFAULT). */
  songNotesOn?: boolean;
  songNotes?: string;
  /** Where a newly made song goes when music is already playing: next in the queue (the default), last, after the
   *  current album, or nowhere (it just waits in the library). With nothing playing it isn't started. */
  newSongs?: "next" | "last" | "after-album" | "off";
  /** Where a finished song lives: copied into SEASIDE's music library (the default), or left on the engine and
   *  played from there, like a network share (engines that keep their songs: the music bridge). */
  songsStay?: "library" | "engine";
  /** Verdicts on songs, newest first. */
  evals?: SongVerdict[];
};

export const SONG_NOTES_DEFAULT = "professional studio production, clean balanced mix, mastered, no clipping or distortion, wide dynamic range, clear vocals";
/** How long a new song is when nobody says: two minutes is rarely enough for a whole song. */
export const SONG_SECONDS_DEFAULT = 240;

export const MEDIA_DEFAULT: MediaPrefs = { images: [], songs: [], pictureFolder: "pictures/made", made: [], characterTools: false };
