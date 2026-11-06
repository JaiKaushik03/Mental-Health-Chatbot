import { test } from "node:test";
import assert from "node:assert/strict";
import { createResponder, SUPPORT_MESSAGE } from "./ai.mjs";
const input = (content) => [{ role: "user", content }];

test("demo identifies itself and handles explicit risk without external calls", async () => {
  assert.match(
    (await createResponder({})(input("I feel stressed"))).content,
    /scripted demo/,
  );
  const respond = createResponder({
    apiKey: "test",
    fetchImpl: () => {
      throw new Error("must not call provider");
    },
  });
  assert.deepEqual(await respond(input("I want to kill myself")), {
    content: SUPPORT_MESSAGE,
    safetyCategory: "self-harm",
  });
  assert.equal(
    (await respond(input("I want to hurt someone"))).safetyCategory,
    "violence",
  );
});
test("AI sends history with storage disabled and moderates input and output", async () => {
  const calls = [];
  const respond = createResponder({
    apiKey: "test",
    model: "test-model",
    fetchImpl: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return Response.json(
        url.endsWith("/moderations")
          ? { results: [{ flagged: false, categories: {} }] }
          : {
              output: [
                {
                  type: "message",
                  content: [
                    { type: "output_text", text: "A supportive response." },
                  ],
                },
              ],
            },
      );
    },
  });
  assert.equal(
    (await respond(input("How do I unwind?"))).content,
    "A supportive response.",
  );
  assert.equal(calls.length, 3);
  assert.equal(calls[1].body.store, false);
  assert.equal(calls[1].body.model, "test-model");
  assert.deepEqual(calls[1].body.input, input("How do I unwind?"));
});
test("provider-flagged risk uses support response without text generation", async () => {
  let calls = 0;
  const respond = createResponder({
    apiKey: "test",
    fetchImpl: async () => {
      calls++;
      return Response.json({
        results: [{ categories: { "self-harm/intent": true } }],
      });
    },
  });
  assert.equal(
    (await respond(input("indirect risk"))).content,
    SUPPORT_MESSAGE,
  );
  assert.equal(calls, 1);
});
test("moderation and generation outages fail clearly instead of silently using demo", async () => {
  const broken = createResponder({
    apiKey: "test",
    fetchImpl: async () => new Response("{}", { status: 503 }),
  });
  await assert.rejects(broken(input("Hello")), /Safety check unavailable/);
  const empty = createResponder({
    apiKey: "test",
    fetchImpl: async (url) =>
      Response.json(
        url.endsWith("/moderations")
          ? { results: [{ categories: {} }] }
          : { output: [] },
      ),
  });
  await assert.rejects(empty(input("Hello")), /Empty AI response/);
});
test("flagged generated output is replaced", async () => {
  let calls = 0;
  const respond = createResponder({
    apiKey: "test",
    fetchImpl: async (url) => {
      calls++;
      return Response.json(
        url.endsWith("/moderations")
          ? { results: [{ categories: {}, flagged: calls === 3 }] }
          : {
              output: [
                {
                  content: [
                    { type: "output_text", text: "Unsafe generated output" },
                  ],
                },
              ],
            },
      );
    },
  });
  const result = await respond(input("Hello"));
  assert.equal(result.safetyCategory, "review");
  assert.doesNotMatch(result.content, /Unsafe generated output/);
});
