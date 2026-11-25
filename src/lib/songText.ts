// Reading a song a character wrote: "TITLE: …", "STYLE: …", then "LYRICS:" and the words.

export function parseSong(raw: string, instrumental = false): { title: string; style: string; lyrics: string } | null {
  const text = raw.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/\*\*(TITLE|STYLE|LYRICS)\s*(:?)\s*\*\*/gi, "$1$2").trim();
  const title = /^\s*#*\s*TITLE\s*:\s*(.+)$/im.exec(text)?.[1]?.trim().replace(/^["*“]+|["*”]+$/g, "") ?? "";
  const style = /^\s*#*\s*STYLE\s*:\s*(.+)$/im.exec(text)?.[1]?.trim().replace(/^["*]+|["*]+$/g, "") ?? "";
  const lyrics = /^\s*#*\s*LYRICS\s*:\s*\n?([\s\S]+)$/im.exec(text)?.[1]?.trim().replace(/^```\w*\n?|\n?```$/g, "").trim() ?? "";
  if (!style) return null;
  return { title: title || "Untitled", style, lyrics: instrumental ? "" : lyrics };
}

/** A length that fits these lyrics, in seconds: about four and a half seconds a sung line and eight for each section
 *  (intros, breaks, the build into a chorus), never under `least` (four minutes unless said) nor over `most`.
 *  An engine cuts a song off at the length it's given, so a guess on the long side is the safer one. */
export function fitLength(lyrics: string, least = 240, most = 360): number {
  const lines = lyrics.split("\n").map((l) => l.trim()).filter(Boolean);
  const tags = lines.filter((l) => /^\[[^\]]*\]$/.test(l)).length;
  const sung = lines.length - tags;
  const guess = Math.round((sung * 4.5 + tags * 8 + 10) / 10) * 10;
  return Math.max(least, Math.min(most, guess));
}

// Section tags a song engine knows (MiniMax Music's documented ones; ACE-Step and YuE read the common ones too).
// A tag carrying more than its name, like "[Verse 1 - soft piano, whispered]", gets sung word for word by MiniMax
// Music, so before a song is sent the tag becomes just "[Verse]" and what it said moves into the style.
const SECTIONS: [RegExp, string][] = [
  [/^pre[\s-]?chorus\b/i, "Pre-Chorus"],
  [/^post[\s-]?chorus\b/i, "Post-Chorus"],
  [/^build[\s-]?up\b/i, "Build-up"],
  [/^break[\s-]?down\b/i, "Breakdown"],
  [/^(chorus|refrain)\b/i, "Chorus"],
  [/^verse\b/i, "Verse"],
  [/^intro(duction)?\b/i, "Intro"],
  [/^(outro|ending|end|coda)\b/i, "Outro"],
  [/^bridge\b/i, "Bridge"],
  [/^hook\b/i, "Hook"],
  [/^interlude\b/i, "Interlude"],
  [/^(instrumental|inst)\b/i, "Instrumental"],
  [/^(guitar |piano |sax |synth |drum )?solo\b/i, "Solo"],
  [/^drop\b/i, "Drop"],
  [/^break\b/i, "Break"],
];

/** Lyrics ready for an engine: section tags reduced to their plain names, and anything else in square brackets (how
 *  a part should sound, stage directions) taken out of what gets sung. `notes` is that, in order, for the style
 *  ("Verse 1: soft piano, whispered; Chorus: full band"). Words in round brackets stay: they're sung as backing
 *  vocals, as songwriters mean them. */
export function engineLyrics(lyrics: string): { lyrics: string; notes: string[] } {
  const notes: string[] = [];
  let section = "";
  const out: string[] = [];
  for (const raw of lyrics.split("\n")) {
    const line = raw.trim();
    const whole = /^\[([^\]]*)\]$/.exec(line);
    if (whole) {
      const inside = whole[1].trim();
      if (/^instrumental$/i.test(inside) && lyrics.trim() === line) {
        out.push(line); // a whole song that's just [Instrumental]
        continue;
      }
      const hit = SECTIONS.find(([re]) => re.test(inside));
      if (hit) {
        const [re, name] = hit;
        // the part's own label (Verse 1, Chorus 2) and what's said after it
        const after = inside.replace(re, "").trim();
        const num = /^(\d+)\b/.exec(after)?.[1] ?? "";
        const said = after.replace(/^\d+\b/, "").replace(/^[\s:–—,(-]+|[\s)]+$/g, "").trim();
        section = `${name}${num ? ` ${num}` : ""}`;
        if (said) notes.push(`${section}: ${said}`);
        out.push(`[${name}]`);
      } else if (inside) {
        // a direction on its own line ("[soft piano builds]"): it belongs to the part it's in
        notes.push(section ? `${section}: ${inside}` : inside);
      }
      continue;
    }
    // directions in the middle of a sung line come out of it too
    const sung = raw.replace(/\[([^\]]*)\]/g, (_, d: string) => (d.trim() && notes.push(section ? `${section}: ${d.trim()}` : d.trim()), "")).replace(/\s{2,}/g, " ");
    if (sung.trim() || !raw.trim()) out.push(sung.trimEnd());
  }
  return { lyrics: out.join("\n").replace(/\n{3,}/g, "\n\n").trim(), notes };
}

/** The style with the arrangement notes taken out of the lyrics added (kept short: the style is a prompt). */
export function styleWithArrangement(style: string, notes: string[], max = 600): string {
  if (!notes.length) return style;
  let arr = notes.join("; ");
  if (arr.length > max) arr = `${arr.slice(0, max - 1).replace(/[;,]?\s*\S*$/, "")}…`;
  return `${style.trim().replace(/[,.\s]+$/, "")}. Arrangement: ${arr}`;
}
