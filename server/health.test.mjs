import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { openDatabase } from "./db.mjs";
import { createApp } from "./app.mjs";

async function fixture(t) {
  const db = openDatabase(":memory:");
  const server = createApp({
    db,
    respond: async () => ({ text: "synthetic" }),
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    try {
      db.close();
    } catch {
      /* A test deliberately closes the database. */
    }
  });
  return { db, base: `http://127.0.0.1:${server.address().port}` };
}

test("readiness is anonymous and does not disclose private state", async (t) => {
  const { base } = await fixture(t);
  const res = await fetch(`${base}/api/health`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: "ok", mode: "demo" });
  assert.equal(res.headers.get("set-cookie"), null);
});

test("HEAD readiness returns no body", async (t) => {
  const { base } = await fixture(t);
  const res = await fetch(`${base}/api/health`, { method: "HEAD" });
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "");
});

test("readiness remains available after application rate limiting", async (t) => {
  const { base } = await fixture(t);
  let status;
  for (let i = 0; i < 241; i++) {
    const res = await fetch(`${base}/api/auth/session`);
    status = res.status;
    await res.arrayBuffer();
  }
  assert.equal(status, 429);
  assert.equal((await fetch(`${base}/api/health`)).status, 200);
});

test("closed database returns a bounded 503 readiness failure", async (t) => {
  const { base, db } = await fixture(t);
  db.close();
  const res = await fetch(`${base}/api/health`);
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { status: "unavailable" });
});
