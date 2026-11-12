import { createServer } from "node:http";
import {
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { transaction } from "./db.mjs";

const scrypt = promisify(scryptCallback);
const hash = (token) => createHash("sha256").update(token).digest("hex");
const safeUser = (user) => ({
  id: user.id,
  email: user.email,
  guest: !!user.guest,
});
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
function requireText(value, name, max, min = 1) {
  if (
    typeof value !== "string" ||
    value.trim().length < min ||
    value.length > max
  )
    throw new HttpError(400, `${name} must be ${min}–${max} characters.`);
  return value.trim();
}
async function body(req) {
  if (!req.headers["content-type"]?.startsWith("application/json"))
    throw new HttpError(415, "Use application/json.");
  let value = "";
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 20000) throw new HttpError(413, "Request too large.");
    value += chunk;
  }
  try {
    const parsed = JSON.parse(value || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw 0;
    return parsed;
  } catch {
    throw new HttpError(400, "Invalid JSON body.");
  }
}
export function createApp({
  db,
  respond,
  mode = "demo",
  origin = "http://localhost:5173",
  secureCookies = false,
  distDir,
  now = Date.now,
}) {
  const inflight = new Set();
  const limits = new Map();
  const cookieName = "still_session";
  const limit = (key, max, windowMs = 60000) => {
    const t = now();
    if (limits.size > 10000)
      for (const [k, v] of limits) if (v.until <= t) limits.delete(k);
    const item = limits.get(key);
    if (!item || item.until <= t) {
      limits.set(key, { count: 1, until: t + windowMs });
      return;
    }
    if (++item.count > max)
      throw new HttpError(
        429,
        "Too many requests. Please wait a minute and try again.",
      );
  };
  const cleanup = () => {
    db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now());
    db.prepare(
      "DELETE FROM users WHERE guest = 1 AND id NOT IN (SELECT user_id FROM sessions)",
    ).run();
  };
  const cleanupTimer = setInterval(cleanup, 60000);
  cleanupTimer.unref();
  const cookie = (token, seconds) =>
    `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${seconds}${secureCookies ? "; Secure" : ""}`;
  const session = (req) => {
    const raw = req.headers.cookie
      ?.split(";")
      .map((c) => c.trim())
      .find((c) => c.startsWith(`${cookieName}=`))
      ?.slice(cookieName.length + 1);
    if (!raw) return null;
    return db
      .prepare(
        "SELECT users.*, sessions.token_hash FROM users JOIN sessions ON users.id = sessions.user_id WHERE token_hash = ? AND expires_at > ?",
      )
      .get(hash(raw), now());
  };
  const owned = (id, user) => {
    const row = db
      .prepare("SELECT * FROM conversations WHERE id = ? AND user_id = ?")
      .get(id, user.id);
    if (!row) throw new HttpError(404, "Conversation not found.");
    return row;
  };
  const messages = (id) =>
    db
      .prepare(
        "SELECT id, role, content, safety_category AS safetyCategory, created_at AS createdAt FROM messages WHERE conversation_id = ? ORDER BY sequence",
      )
      .all(id);
  const conversation = (row) => ({
    id: row.id,
    title: row.title,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
  const newSession = (user, res, old) => {
    if (old) {
      db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(
        old.token_hash,
      );
      if (old.guest) db.prepare("DELETE FROM users WHERE id = ?").run(old.id);
    }
    const token = randomBytes(32).toString("hex");
    const seconds = user.guest ? 24 * 3600 : 7 * 24 * 3600;
    db.prepare("INSERT INTO sessions VALUES (?, ?, ?)").run(
      hash(token),
      user.id,
      now() + seconds * 1000,
    );
    res.setHeader("Set-Cookie", cookie(token, seconds));
    return { user: safeUser(user), mode };
  };
  const json = (res, status, data) => {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
    });
    res.end(JSON.stringify(data));
  };

  const server = createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
    try {
      const path = new URL(req.url, "http://localhost").pathname;
      const method = req.method;
      if (!path.startsWith("/api/")) {
        if (!distDir || !["GET", "HEAD"].includes(method))
          throw new HttpError(404, "Not found.");
        const base = resolve(distDir);
        const file = resolve(base, "." + decodeURIComponent(path));
        if (file !== base && !file.startsWith(base + sep))
          throw new HttpError(404, "Not found.");
        const types = {
          ".html": "text/html",
          ".js": "text/javascript",
          ".css": "text/css",
          ".svg": "image/svg+xml",
          ".png": "image/png",
          ".ico": "image/x-icon",
        };
        let content, type;
        try {
          content = await readFile(file);
          type = types[extname(file)] ?? "application/octet-stream";
        } catch {
          if (extname(path)) throw new HttpError(404, "Not found.");
          content = await readFile(resolve(base, "index.html"));
          type = "text/html";
        }
        res.writeHead(200, { "Content-Type": `${type}; charset=utf-8` });
        res.end(method === "HEAD" ? undefined : content);
        return;
      }
      // Readiness probes must not consume a user's rate-limit budget or depend
      // on their session. Check the database connection without exposing data.
      if (path === "/api/health" && ["GET", "HEAD"].includes(method)) {
        try {
          db.prepare("SELECT 1").get();
          return json(res, 200, { status: "ok", mode });
        } catch {
          return json(res, 503, { status: "unavailable" });
        }
      }
      // Browser writes must come from our UI. Requests without Origin are allowed for same-site forms and CLI clients.
      if (
        !["GET", "HEAD"].includes(method) &&
        ((req.headers.origin && req.headers.origin !== origin) ||
          req.headers["sec-fetch-site"] === "cross-site")
      )
        throw new HttpError(403, "Request origin not allowed.");
      cleanup();
      limit(`ip:${req.socket.remoteAddress}`, 240);
      const user = session(req);
      if (path === "/api/auth/session" && method === "GET")
        return json(res, 200, { user: user ? safeUser(user) : null, mode });
      if (
        ["/api/auth/login", "/api/auth/register", "/api/auth/guest"].includes(
          path,
        ) &&
        method === "POST"
      ) {
        limit(`auth:${req.socket.remoteAddress}`, 15);
        const data = await body(req);
        if (path.endsWith("/guest")) {
          const guest = { id: randomUUID(), email: null, guest: 1 };
          return json(
            res,
            201,
            transaction(db, () => {
              db.prepare(
                "INSERT INTO users (id, guest, created_at) VALUES (?, 1, ?)",
              ).run(guest.id, now());
              return newSession(guest, res, user);
            }),
          );
        }
        const email = requireText(data.email, "Email", 254).toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
          throw new HttpError(400, "Enter a valid email address.");
        if (
          typeof data.password !== "string" ||
          data.password.length < 10 ||
          data.password.length > 128
        )
          throw new HttpError(400, "Password must be 10–128 characters.");
        if (path.endsWith("/register")) {
          const salt = randomBytes(16).toString("hex");
          const derived = await scrypt(data.password, salt, 64);
          const account = { id: randomUUID(), email, guest: 0 };
          return json(
            res,
            201,
            transaction(db, () => {
              if (db.prepare("SELECT id FROM users WHERE email = ?").get(email))
                throw new HttpError(
                  409,
                  "An account with this email already exists.",
                );
              db.prepare("INSERT INTO users VALUES (?, ?, ?, 0, ?)").run(
                account.id,
                email,
                `${salt}:${derived.toString("hex")}`,
                now(),
              );
              return newSession(account, res, user);
            }),
          );
        }
        const account = db
          .prepare("SELECT * FROM users WHERE email = ? AND guest = 0")
          .get(email);
        const [salt, stored] = (
          account?.password ?? `${"0".repeat(32)}:${"0".repeat(128)}`
        ).split(":");
        const derived = await scrypt(data.password, salt, 64);
        if (!timingSafeEqual(derived, Buffer.from(stored, "hex")) || !account)
          throw new HttpError(401, "Email or password is incorrect.");
        return json(
          res,
          200,
          transaction(db, () => newSession(account, res, user)),
        );
      }
      if (!user)
        throw new HttpError(
          401,
          "Your session has expired. Please sign in again.",
        );
      if (path === "/api/auth/logout" && method === "POST") {
        await body(req);
        transaction(db, () => {
          db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(
            user.token_hash,
          );
          if (user.guest)
            db.prepare("DELETE FROM users WHERE id = ?").run(user.id);
        });
        res.setHeader("Set-Cookie", cookie("", 0));
        return json(res, 200, { ok: true });
      }
      if (path === "/api/account" && method === "DELETE") {
        const data = await body(req);
        if (data.confirm !== "DELETE")
          throw new HttpError(400, "Deletion confirmation required.");
        db.prepare("DELETE FROM users WHERE id = ?").run(user.id);
        res.setHeader("Set-Cookie", cookie("", 0));
        return json(res, 200, { ok: true });
      }
      if (path === "/api/export" && method === "GET") {
        return json(res, 200, {
          exportedAt: new Date(now()).toISOString(),
          user: safeUser(user),
          conversations: db
            .prepare(
              "SELECT * FROM conversations WHERE user_id = ? ORDER BY updated_at DESC",
            )
            .all(user.id)
            .map((row) => ({
              ...conversation(row),
              messages: messages(row.id),
            })),
        });
      }
      if (path === "/api/conversations") {
        if (method === "GET")
          return json(
            res,
            200,
            db
              .prepare(
                "SELECT * FROM conversations WHERE user_id = ? ORDER BY updated_at DESC, rowid DESC",
              )
              .all(user.id)
              .map(conversation),
          );
        if (method === "POST") {
          await body(req);
          limit(`new:${user.id}`, 30);
          const row = {
            id: randomUUID(),
            title: "New conversation",
            status: "active",
            created_at: new Date(now()).toISOString(),
            updated_at: new Date(now()).toISOString(),
          };
          db.prepare("INSERT INTO conversations VALUES (?, ?, ?, ?, ?, ?)").run(
            row.id,
            user.id,
            row.title,
            row.status,
            row.created_at,
            row.updated_at,
          );
          return json(res, 201, conversation(row));
        }
      }
      const match = path.match(/^\/api\/conversations\/([\w-]+)(\/messages)?$/);
      if (match) {
        const id = match[1];
        const row = owned(id, user);
        if (!match[2]) {
          if (inflight.has(id) && ["DELETE", "PATCH"].includes(method))
            throw new HttpError(
              409,
              "Please wait for the current reply before changing this conversation.",
            );
          if (method === "DELETE") {
            db.prepare("DELETE FROM conversations WHERE id = ?").run(id);
            return json(res, 200, { ok: true });
          }
          if (method === "PATCH") {
            const data = await body(req);
            if (inflight.has(id))
              throw new HttpError(409, "Please wait for the current reply.");
            const title =
              data.title === undefined
                ? row.title
                : requireText(data.title, "Title", 80);
            const status = data.status ?? row.status;
            if (!["active", "archived"].includes(status))
              throw new HttpError(400, "Invalid conversation status.");
            db.prepare(
              "UPDATE conversations SET title = ?, status = ?, updated_at = ? WHERE id = ?",
            ).run(title, status, new Date(now()).toISOString(), id);
            return json(res, 200, conversation(owned(id, user)));
          }
        } else {
          if (method === "GET") return json(res, 200, messages(id));
          if (method === "POST") {
            const data = await body(req);
            const content = requireText(data.content, "Message", 4000);
            const requestId = requireText(data.requestId, "Request ID", 100);
            const cached = db
              .prepare(
                "SELECT result FROM turns WHERE conversation_id = ? AND request_id = ?",
              )
              .get(id, requestId);
            if (cached) {
              const result = JSON.parse(cached.result);
              if (result.messages[0].content !== content)
                throw new HttpError(
                  409,
                  "Request ID already used for a different message.",
                );
              return json(res, 200, result);
            }
            if (owned(id, user).status === "archived")
              throw new HttpError(
                409,
                "Restore this conversation before sending a message.",
              );
            if (inflight.has(id))
              throw new HttpError(409, "A reply is already in progress.");
            limit(`chat:${user.id}`, 15);
            inflight.add(id);
            try {
              const history = messages(id)
                .slice(-19)
                .map((m) => ({ role: m.role, content: m.content }));
              history.push({ role: "user", content });
              let reply;
              try {
                reply = await respond(history);
              } catch {
                throw new HttpError(
                  503,
                  "The reply service is unavailable. Your message was not saved. Please try again.",
                );
              }
              // The user may log out or delete their account while an external AI call is running.
              if (!session(req))
                throw new HttpError(
                  401,
                  "Session ended before the reply completed.",
                );
              owned(id, user);
              const timestamp = new Date(now()).toISOString();
              const pair = [
                {
                  id: randomUUID(),
                  role: "user",
                  content,
                  safetyCategory: reply.safetyCategory,
                  createdAt: timestamp,
                },
                {
                  id: randomUUID(),
                  role: "assistant",
                  content: reply.content,
                  safetyCategory: reply.safetyCategory,
                  createdAt: timestamp,
                },
              ];
              const result = transaction(db, () => {
                const insert = db.prepare(
                  "INSERT INTO messages (id, conversation_id, role, content, safety_category, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                );
                for (const message of pair)
                  insert.run(
                    message.id,
                    id,
                    message.role,
                    message.content,
                    message.safetyCategory,
                    timestamp,
                  );
                const title =
                  messages(id).length === 2 && row.title === "New conversation"
                    ? content.slice(0, 60)
                    : row.title;
                db.prepare(
                  "UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?",
                ).run(title, timestamp, id);
                const value = {
                  messages: pair,
                  conversation: conversation(owned(id, user)),
                };
                db.prepare("INSERT INTO turns VALUES (?, ?, ?)").run(
                  id,
                  requestId,
                  JSON.stringify(value),
                );
                return value;
              });
              return json(res, 201, result);
            } finally {
              inflight.delete(id);
            }
          }
        }
      }
      throw new HttpError(404, "Endpoint not found.");
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      // Never log request bodies, credentials, or provider responses.
      if (status === 500)
        console.error("Request failed:", error.code ?? error.name);
      if (!res.headersSent)
        json(res, status, {
          error:
            status === 500
              ? "Something went wrong. Please try again."
              : error.message,
        });
      else res.end();
    }
  });
  server.on("close", () => clearInterval(cleanupTimer));
  return server;
}
