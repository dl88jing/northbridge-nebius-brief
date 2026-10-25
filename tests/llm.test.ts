import { test } from "node:test";
import assert from "node:assert/strict";
import { extractJson } from "../lib/llm";

test("extractJson strips reasoning and code fences", () => {
  assert.deepEqual(extractJson('<think>hmm {"no":1}</think>\n```json\n{"a": {"b": "}"}}\n```'), { a: { b: "}" } });
  assert.equal(extractJson("no json here"), null);
});
