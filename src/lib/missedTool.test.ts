import { test } from "node:test";
import assert from "node:assert/strict";
import { missedTool, missedNote } from "./missedTool.ts";

const TOOLS = ["web_search", "browser", "my_keys", "files_list"];

test("a planned call that never came out is found (Dee on the Qwen3-32B distill)", () => {
  const thinking = "2. **Web Search Function**: I need to use the `web_search` tool to look up this exact phrase.\n\nLet me proceed with the search.";
  assert.equal(missedTool(thinking, "No official results.", TOOLS), "web_search");
  assert.equal(missedTool("", "Let me open the browser and look.", TOOLS), "browser");
  assert.equal(missedTool("I'll check my_keys first.", "", TOOLS), "my_keys");
  assert.equal(missedTool("I'll run a web search for it.", "", TOOLS), "web_search");
});

test("mentions without intent, or with a no, aren't", () => {
  assert.equal(missedTool("The browser tool returns page elements.", "", TOOLS), null);
  assert.equal(missedTool("I don't need web_search for this.", "", TOOLS), null);
  assert.equal(missedTool("I can answer without the browser.", "", TOOLS), null);
  assert.equal(missedTool("", "Want me to use the browser to check?", TOOLS), null);
  assert.equal(missedTool("", "If you like, I could run web_search next.", TOOLS), null);
  assert.equal(missedTool("Let me think about browsers in general.", "", TOOLS), null);
  // from the Qwen3-32B run: a sentence about the project, not her plan
  assert.equal(missedTool("", "It claims to open a browser at localhost:15693, but there's no main.js.", TOOLS), null);
  assert.equal(missedTool("I'll use web_search.", "", []), null);
  assert.equal(missedTool("", "", TOOLS), null);
});

test("the note says what happened and leaves the choice", () => {
  assert.equal(missedNote("web_search"), "[Desk note] web_search didn't run: tools only run when you call them. Call it if you meant to; otherwise answer as you are.");
});
