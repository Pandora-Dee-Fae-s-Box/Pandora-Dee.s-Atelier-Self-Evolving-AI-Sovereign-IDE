// The music player's saved settings (kept apart from the player so the store can load them without it).

export type Station = { name: string; url: string; favicon?: string; tags?: string; country?: string; codec?: string; bitrate?: number; homepage?: string };

/** A playlist: a name and songs in order (by id, which is the file's path, so a rescan keeps it). */
export type MusicPlaylist = { id: string; name: string; items: string[] };

export type MusicPrefs = {
  /** Playlists, shared by every device (the desk is). */
  playlists: MusicPlaylist[];
  folders: string[];
  stations: Station[];
  volume: number;
  shuffle: boolean;
  repeat: "off" | "all" | "one";
  /** Lower the music while a character speaks. */
  duck: boolean;
  /** When a new song starts, the character in focus may say something about it (uses the AI). */
  comment: boolean;
  viz: "off" | "bars" | "scope" | "milkdrop";
  preset: string;
  /** Milkdrop: a new preset every so often. */
  cycle: boolean;
  /** The visualizer as the desktop's background, behind the windows. */
  vizBackground: boolean;
  /** How strongly the background visualizer shows (0..1). */
  vizBackgroundOpacity: number;
  /** Height of the visualizer above Music's lists, in pixels (dragged by its edge). */
  vizHeight: number;
};

export const MUSIC_DEFAULT: MusicPrefs = { playlists: [], folders: [], stations: [], volume: 0.7, shuffle: false, repeat: "all", duck: true, comment: false, viz: "bars", preset: "", cycle: true, vizBackground: false, vizBackgroundOpacity: 0.85, vizHeight: 180 };
