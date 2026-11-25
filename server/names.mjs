// A name someone typed, as a file or folder name. The characters Windows won't have in a name become ones that look
// the same ("Kids: Elsa?" stays readable, "AC/DC" stays one name), so a name reads the way it was typed and still
// can't climb out of its folder. Names that come with a file from a device are cut to their last part first.

const LOOK = { "<": "＜", ">": "＞", ":": "꞉", '"': "＂", "/": "∕", "\\": "⧵", "|": "｜", "?": "？", "*": "＊" };

export function typedName(n, fallback) {
  const s = String(n || "")
    .replace(/[<>:"/\\|?*]/g, (c) => LOOK[c])
    .replace(/[\x00-\x1f]/g, "")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 120)
    .replace(/[. ]+$/, "");
  return !s ? fallback : /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(s) ? `${s}_` : s;
}
