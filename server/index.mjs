import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase } from "./db.mjs";
import { createResponder } from "./ai.mjs";
import { createApp } from "./app.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
try {
  process.loadEnvFile(resolve(root, ".env"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const port = Number(process.env.PORT || 3001);
const host = process.env.HOST || "127.0.0.1";
const production = process.env.NODE_ENV === "production";
const apiKey = process.env.OPENAI_API_KEY?.trim();
const db = openDatabase(
  process.env.DATABASE_PATH || resolve(root, "data", "still.sqlite"),
);
const server = createApp({
  db,
  respond: createResponder({
    apiKey,
    model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
  }),
  mode: apiKey ? "ai" : "demo",
  origin:
    process.env.APP_ORIGIN ||
    (production ? `http://localhost:${port}` : "http://localhost:5173"),
  secureCookies: process.env.COOKIE_SECURE === "true",
  distDir: production ? resolve(root, "dist") : undefined,
});
server.listen(port, host, () =>
  console.log(
    `Still backend: http://${host}:${port} (${apiKey ? "AI" : "scripted demo"} mode)`,
  ),
);
server.on("error", (error) => {
  console.error(`Unable to start server: ${error.code}`);
  db.close();
  process.exitCode = 1;
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
