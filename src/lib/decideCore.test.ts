import test from "node:test";
import assert from "node:assert/strict";
import { answerOf, decisionPrompt, fromText, labelsOf, readProbs } from "./decideCore.ts";

test("labels: letters for options, digits for a score", () => {
  assert.deepEqual(labelsOf({ kind: "yesno", ask: "?" }), ["A", "B"]);
  assert.deepEqual(labelsOf({ kind: "choice", ask: "?", options: ["x", "y", "z"] }), ["A", "B", "C"]);
  assert.deepEqual(labelsOf({ kind: "score", ask: "?", levels: ["low", "mid", "high"] }), ["0", "1", "2"]);
});

test("the prompt: the state first, then the question and its labelled options", () => {
  const p = decisionPrompt("Dee is on sand.", { kind: "yesno", ask: "Has she reached the shore?" });
  assert.ok(p.user.startsWith("Situation:\nDee is on sand.\n\nQuestion: Has she reached the shore?"));
  assert.match(p.user, /A\. Yes\nB\. No/);
  // two questions about one state share everything before "Question:"
  const q = decisionPrompt("Dee is on sand.", { kind: "choice", ask: "Where?", options: ["beach", "hill"] });
  assert.equal(p.user.split("Question:")[0], q.user.split("Question:")[0]);
});

test("probabilities from the first token's scores (Kitti on the Mac, 2026-11-20)", () => {
  const top = [
    { token: "A", logprob: -0.574 },
    { token: "B", logprob: -0.864 },
    { token: "C", logprob: -5.26 },
    { token: " A", logprob: -8.34 },
  ];
  const [yes, no] = readProbs(top, ["A", "B"]);
  assert.ok(Math.abs(yes + no - 1) < 1e-9);
  assert.ok(yes > 0.55 && yes < 0.6, String(yes)); // " A" counts toward A
  // a label missing from the scores still gets a little, less than any that's there
  const [a, , z] = readProbs(top, ["A", "B", "Z"]);
  assert.ok(z < 0.01 && a > z);
  // a higher temperature evens things out
  assert.ok(readProbs(top, ["A", "B"], 3)[0] < yes);
});

test("with no scores, the answer given is sure", () => {
  assert.deepEqual(fromText("B", ["A", "B"]), [0, 1]);
  assert.deepEqual(fromText("<think>hmm</think>\nA. Yes", ["A", "B"]), [1, 0]);
  assert.deepEqual(fromText("I'm not sure", ["A", "B"]), [0.5, 0.5]);
  assert.equal(answerOf([0.2, 0.7, 0.1], true).pick, 1);
});
