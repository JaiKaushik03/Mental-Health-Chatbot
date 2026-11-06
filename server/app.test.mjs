import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "./db.mjs";
import { createApp } from "./app.mjs";
import { createResponder } from "./ai.mjs";

async function fixture(t, options = {}) {
  const db = openDatabase(":memory:");
  const server = createApp({ db, respond: createResponder({}), ...options });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    db.close();
  });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  function client() {
    let cookie = "";
    return async (path, method = "GET", data, extra = {}) => {
      const response = await fetch(base + path, {
        method,
        headers: {
          "Content-Type": "application/json",
          Cookie: cookie,
          ...extra,
        },
        body: data === undefined ? undefined : JSON.stringify(data),
      });
      const setCookie = response.headers.get("set-cookie");
      if (setCookie) cookie = setCookie.split(";")[0];
      return {
        status: response.status,
        data: await response.json(),
        headers: response.headers,
      };
    };
  }
  const call = client();
  const guest = async () => {
    const c = client();
    assert.equal((await c("/auth/guest", "POST", {})).status, 201);
    return c;
  };
  const chat = async (c) => {
    const result = await c("/conversations", "POST", {});
    assert.equal(result.status, 201);
    return result.data.id;
  };
  return { db, call, guest, chat, client };
}

test("registration, hashed passwords, cookie session, logout and login", async (t) => {
  const { call, db } = await fixture(t);
  assert.equal((await call("/conversations")).status, 401);
  const credentials = {
    email: "User@example.com",
    password: "correct horse battery",
  };
  const registered = await call("/auth/register", "POST", credentials);
  assert.equal(registered.status, 201);
  assert.equal(registered.data.user.email, "user@example.com");
  assert.match(
    registered.headers.get("set-cookie"),
    /HttpOnly; SameSite=Strict/,
  );
  const stored = db.prepare("SELECT password FROM users").get().password;
  assert.notEqual(stored, credentials.password);
  assert.match(stored, /^[a-f0-9]{32}:[a-f0-9]{128}$/);
  assert.equal(
    (await call("/auth/session")).data.user.id,
    registered.data.user.id,
  );
  assert.equal((await call("/auth/register", "POST", credentials)).status, 409);
  assert.equal((await call("/auth/logout", "POST", {})).status, 200);
  assert.equal((await call("/auth/session")).data.user, null);
  assert.equal(
    (
      await call("/auth/login", "POST", {
        ...credentials,
        password: "incorrect password",
      })
    ).status,
    401,
  );
  assert.equal((await call("/auth/login", "POST", credentials)).status, 200);
});

test("registration validates email and password, and browser cross-site writes are denied", async (t) => {
  const { call } = await fixture(t);
  assert.equal(
    (
      await call("/auth/register", "POST", {
        email: "bad",
        password: "long enough password",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await call("/auth/register", "POST", {
        email: "a@b.com",
        password: "short",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await call(
        "/auth/guest",
        "POST",
        {},
        { Origin: "https://attacker.example" },
      )
    ).status,
    403,
  );
  assert.equal(
    (await call("/auth/guest", "POST", {}, { "Sec-Fetch-Site": "cross-site" }))
      .status,
    403,
  );
});

test("conversation lifecycle, context, idempotent send, export, archive, restore, delete", async (t) => {
  const histories = [];
  const { guest, chat, db } = await fixture(t, {
    respond: async (history) => {
      histories.push(history);
      return { content: "A supportive reply", safetyCategory: "none" };
    },
  });
  const c = await guest();
  const id = await chat(c);
  const payload = { content: "A difficult day", requestId: randomUUID() };
  const sent = await c(`/conversations/${id}/messages`, "POST", payload);
  assert.equal(sent.status, 201);
  assert.equal(sent.data.messages.length, 2);
  assert.equal(sent.data.messages[1].role, "assistant");
  assert.equal(sent.data.conversation.title, payload.content);
  const retry = await c(`/conversations/${id}/messages`, "POST", payload);
  assert.equal(retry.status, 200);
  assert.deepEqual(retry.data, sent.data);
  assert.equal(histories.length, 1);
  assert.equal(
    (
      await c(`/conversations/${id}/messages`, "POST", {
        ...payload,
        content: "Changed",
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await c(`/conversations/${id}/messages`, "POST", {
        content: "A second thought",
        requestId: randomUUID(),
      })
    ).status,
    201,
  );
  assert.deepEqual(
    histories[1].map((m) => m.role),
    ["user", "assistant", "user"],
  );
  assert.equal(
    (
      await c(`/conversations/${id}`, "PATCH", {
        title: "My day",
        status: "archived",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await c(`/conversations/${id}/messages`, "POST", {
        content: "Hello",
        requestId: randomUUID(),
      })
    ).status,
    409,
  );
  assert.equal(
    (await c(`/conversations/${id}`, "PATCH", { status: "active" })).status,
    200,
  );
  assert.equal((await c("/export")).data.conversations[0].messages.length, 4);
  assert.equal((await c(`/conversations/${id}`, "DELETE")).status, 200);
  assert.equal((await c("/conversations")).data.length, 0);
  assert.equal(db.prepare("SELECT count(*) AS n FROM messages").get().n, 0);
  assert.equal(db.prepare("SELECT count(*) AS n FROM turns").get().n, 0);
});

test("users cannot access, change, send to or delete another user’s conversation", async (t) => {
  const { guest, chat } = await fixture(t);
  const a = await guest(),
    b = await guest();
  const id = await chat(a);
  for (const [path, method, data] of [
    [`/conversations/${id}/messages`, "GET"],
    [`/conversations/${id}`, "PATCH", { title: "Stolen" }],
    [
      `/conversations/${id}/messages`,
      "POST",
      { content: "Hi", requestId: randomUUID() },
    ],
    [`/conversations/${id}`, "DELETE"],
  ])
    assert.equal((await b(path, method, data)).status, 404);
  assert.equal((await b("/export")).data.conversations.length, 0);
});

test("provider failure saves neither half of an exchange and can be retried", async (t) => {
  let failed = true;
  const { guest, chat } = await fixture(t, {
    respond: async () => {
      if (failed) throw new Error("secret provider error");
      return { content: "Recovered", safetyCategory: "none" };
    },
  });
  const c = await guest();
  const id = await chat(c);
  const payload = { content: "Hello", requestId: randomUUID() };
  const response = await c(`/conversations/${id}/messages`, "POST", payload);
  assert.equal(response.status, 503);
  assert.doesNotMatch(response.data.error, /secret/);
  assert.deepEqual((await c(`/conversations/${id}/messages`)).data, []);
  failed = false;
  assert.equal(
    (await c(`/conversations/${id}/messages`, "POST", payload)).status,
    201,
  );
});

test("concurrent sends and mutations are blocked until a reply completes", async (t) => {
  let release, started;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const began = new Promise((resolve) => {
    started = resolve;
  });
  const { guest, chat } = await fixture(t, {
    respond: async () => {
      started();
      await gate;
      return { content: "Done", safetyCategory: "none" };
    },
  });
  const c = await guest();
  const id = await chat(c);
  const first = c(`/conversations/${id}/messages`, "POST", {
    content: "One",
    requestId: randomUUID(),
  });
  await began;
  assert.equal(
    (
      await c(`/conversations/${id}/messages`, "POST", {
        content: "Two",
        requestId: randomUUID(),
      })
    ).status,
    409,
  );
  assert.equal((await c(`/conversations/${id}`, "DELETE")).status, 409);
  assert.equal(
    (await c(`/conversations/${id}`, "PATCH", { status: "archived" })).status,
    409,
  );
  release();
  assert.equal((await first).status, 201);
});

test("guest logout deletes data, registered logout preserves it, account deletion cascades", async (t) => {
  const { guest, chat, call, db } = await fixture(t);
  const g = await guest();
  await chat(g);
  await g("/auth/logout", "POST", {});
  assert.equal(db.prepare("SELECT count(*) AS n FROM users").get().n, 0);
  const credentials = {
    email: "keep@example.com",
    password: "a long enough password",
  };
  await call("/auth/register", "POST", credentials);
  await chat(call);
  await call("/auth/logout", "POST", {});
  await call("/auth/login", "POST", credentials);
  assert.equal((await call("/conversations")).data.length, 1);
  assert.equal((await call("/account", "DELETE", {})).status, 400);
  assert.equal(
    (await call("/account", "DELETE", { confirm: "DELETE" })).status,
    200,
  );
  assert.equal((await call("/conversations")).status, 401);
  for (const table of [
    "users",
    "sessions",
    "conversations",
    "messages",
    "turns",
  ])
    assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n, 0);
});

test("expired guest sessions and associated conversations are removed", async (t) => {
  let time = Date.now();
  const { guest, chat, db } = await fixture(t, { now: () => time });
  const c = await guest();
  await chat(c);
  time += 24 * 3600 * 1000 + 1;
  assert.equal((await c("/auth/session")).data.user, null);
  assert.equal(db.prepare("SELECT count(*) AS n FROM users").get().n, 0);
  assert.equal(
    db.prepare("SELECT count(*) AS n FROM conversations").get().n,
    0,
  );
});

test("account deletion during an in-flight reply cannot recreate data", async (t) => {
  let release, started;
  const gate = new Promise((r) => {
    release = r;
  });
  const began = new Promise((r) => {
    started = r;
  });
  const { guest, chat, db } = await fixture(t, {
    respond: async () => {
      started();
      await gate;
      return { content: "Done", safetyCategory: "none" };
    },
  });
  const c = await guest();
  const id = await chat(c);
  const pending = c(`/conversations/${id}/messages`, "POST", {
    content: "Hello",
    requestId: randomUUID(),
  });
  await began;
  await c("/account", "DELETE", { confirm: "DELETE" });
  release();
  assert.equal((await pending).status, 401);
  assert.equal(db.prepare("SELECT count(*) AS n FROM messages").get().n, 0);
});

test("invalid inputs are rejected and login attempts are rate limited", async (t) => {
  const { call, guest, chat } = await fixture(t);
  const c = await guest();
  const id = await chat(c);
  for (const content of ["", "   ", "x".repeat(4001), 42])
    assert.equal(
      (
        await c(`/conversations/${id}/messages`, "POST", {
          content,
          requestId: randomUUID(),
        })
      ).status,
      400,
    );
  assert.equal(
    (await c(`/conversations/${id}`, "PATCH", { status: "unknown" })).status,
    400,
  );
  for (let i = 0; i < 15; i++)
    await call("/auth/login", "POST", {
      email: "no@example.com",
      password: "wrong password",
    });
  assert.equal(
    (
      await call("/auth/login", "POST", {
        email: "no@example.com",
        password: "wrong password",
      })
    ).status,
    429,
  );
});

test("SQLite data survives reopening the database", () => {
  const folder = mkdtempSync(join(tmpdir(), "still-test-"));
  try {
    const file = join(folder, "test.sqlite");
    let db = openDatabase(file);
    db.prepare("INSERT INTO users VALUES (?, ?, ?, 0, ?)").run(
      "u",
      "a@b.com",
      "hashed",
      Date.now(),
    );
    db.close();
    db = openDatabase(file);
    assert.equal(
      db.prepare("SELECT email FROM users WHERE id = ?").get("u").email,
      "a@b.com",
    );
    db.close();
  } finally {
    rmSync(folder, { recursive: true });
  }
});
