// Reproducible synthetic local HTTP benchmark. No AI provider is contacted.
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir, cpus, platform, arch } from "node:os";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { openDatabase } from "../server/db.mjs";
import { createApp } from "../server/app.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const report = {
  kind: "synthetic loopback HTTP benchmark; no AI inference; not internet load",
  node: process.version,
  platform: `${platform()} ${arch()}`,
  cpu: cpus()[0]?.model,
  dataset: {
    conversations: 100,
    messages: 0,
    storage: "temporary SQLite file in WAL mode",
  },
  workload:
    "authenticated GET /api/conversations returning 100 synthetic records",
  requestsPerCase: 100,
  warmupRequests: 10,
  cases: [],
};
const pct = (a, p) => a[Math.max(0, Math.ceil(a.length * p) - 1)];
for (const concurrency of [1, 8]) {
  const temp = await mkdtemp(join(tmpdir(), "still-benchmark-"));
  const db = openDatabase(join(temp, "benchmark.sqlite"));
  const server = createApp({
    db,
    respond: async () => {
      throw new Error("Benchmark must not invoke AI");
    },
  });
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const auth = await fetch(`${base}/auth/guest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(auth.status, 201);
    const { user } = await auth.json();
    const cookie = auth.headers.get("set-cookie").split(";")[0];
    const insert = db.prepare(
      "INSERT INTO conversations VALUES (?, ?, ?, ?, ?, ?)",
    );
    for (let i = 0; i < 100; i++)
      insert.run(
        `fixture-${i}`,
        user.id,
        `Synthetic conversation ${i}`,
        "active",
        "2026-01-01T00:00:00Z",
        "2026-01-01T00:00:00Z",
      );
    const read = async () => {
      const res = await fetch(`${base}/conversations`, {
        headers: { Cookie: cookie },
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.length, 100);
    };
    for (let i = 0; i < 10; i++) await read();
    let next = 0,
      errors = 0;
    const latencies = [];
    const start = performance.now();
    await Promise.all(
      Array.from({ length: concurrency }, async () => {
        while (next++ < 100) {
          const tick = performance.now();
          try {
            await read();
          } catch {
            errors++;
          }
          latencies.push(performance.now() - tick);
        }
      }),
    );
    const elapsed = performance.now() - start;
    latencies.sort((a, b) => a - b);
    report.cases.push({
      concurrency,
      requests: latencies.length,
      errors,
      median_ms: pct(latencies, 0.5),
      p95_ms: pct(latencies, 0.95),
      max_ms: latencies.at(-1),
      elapsed_ms: elapsed,
      requests_per_second: 100000 / elapsed,
      sorted_latency_ms: latencies,
    });
    assert.equal(errors, 0);
    assert.equal(latencies.length, 100);
    console.log(
      JSON.stringify(report.cases.at(-1), (key, value) =>
        key === "sorted_latency_ms" ? undefined : value,
      ),
    );
  } finally {
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
    db.close();
    await rm(temp, { recursive: true, force: true });
  }
}
await mkdir(resolve(root, "docs/benchmarks"), { recursive: true });
await writeFile(
  resolve(root, "docs/benchmarks/api-results.json"),
  `${JSON.stringify(report, null, 2)}\n`,
);
