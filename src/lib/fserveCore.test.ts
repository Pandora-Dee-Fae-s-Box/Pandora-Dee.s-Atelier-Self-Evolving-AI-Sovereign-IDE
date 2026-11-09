import { test } from "node:test";
import assert from "node:assert/strict";
import { fileLine, listText, parseCommand } from "./fserveCore.ts";

test("the old-school commands, and everything else left alone", () => {
  assert.deepEqual(parseCommand("!list"), { cmd: "list", arg: "" });
  assert.deepEqual(parseCommand("  @find liber al  "), { cmd: "find", arg: "liber al" });
  assert.deepEqual(parseCommand("!GET #12"), { cmd: "get", arg: "#12" });
  assert.deepEqual(parseCommand("!queue"), { cmd: "queue", arg: "" });
  assert.deepEqual(parseCommand("!get"), { cmd: "help", arg: "" }, "!get with nothing to get explains itself");
  assert.equal(parseCommand("hello !list"), null);
  assert.equal(parseCommand("@pandora hi"), null, "a mention isn't a command");
  assert.equal(parseCommand("!listen to this"), null);
});

test("what !list says", () => {
  const files = [{ n: 1, shelf: "Models", rel: "small/tiny.gguf", name: "tiny.gguf", size: 4_100_000_000 }];
  assert.equal(fileLine(files[0]), "#1 · Models/small/tiny.gguf · 4.1 GB");
  assert.match(listText("Pandora", [{ name: "Models", count: 1 }], files), /^📚 Pandora's library: 1 file on Models \(1\)\.\n#1/);
  assert.match(listText("Pandora", [], []), /isn't handing out any files/);
});
