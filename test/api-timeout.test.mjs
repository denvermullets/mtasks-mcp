import test from "node:test";
import assert from "node:assert/strict";

import { apiRequest } from "../dist/api-client.js";

const realFetch = globalThis.fetch;

function setup(timeout) {
  process.env.MTASKS_API_TOKEN = "t";
  if (timeout === undefined) delete process.env.MTASKS_API_TIMEOUT_MS;
  else process.env.MTASKS_API_TIMEOUT_MS = timeout;
}

// A fetch that never resolves until its signal aborts.
function hangingFetch(_url, init) {
  return new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => {
      const err = new Error("This operation was aborted");
      err.name = "AbortError";
      reject(err);
    });
  });
}

test.afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.MTASKS_API_TIMEOUT_MS;
});

test("hung request fails with a descriptive timeout error", async () => {
  setup("50");
  globalThis.fetch = hangingFetch;
  await assert.rejects(
    apiRequest("/api/v1/slow"),
    (err) => {
      assert.equal(err.message, "Request to /api/v1/slow timed out after 50ms");
      return true;
    }
  );
});

test("fast requests are unaffected", async () => {
  setup("50");
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ ok: true }), { status: 200 });
  assert.deepEqual(await apiRequest("/api/v1/fast"), { ok: true });
});

test("default timeout is 30000ms when env var is unset", async () => {
  setup(undefined);
  let signal;
  globalThis.fetch = async (_u, init) => {
    signal = init.signal;
    return new Response("{}", { status: 200 });
  };
  const realSetTimeout = globalThis.setTimeout;
  const delays = [];
  globalThis.setTimeout = (fn, ms, ...a) => {
    delays.push(ms);
    return realSetTimeout(fn, ms, ...a);
  };
  try {
    await apiRequest("/api/v1/x");
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }
  assert.ok(signal);
  assert.ok(delays.includes(30000));
});

test("non-abort fetch errors pass through unchanged", async () => {
  setup("50");
  globalThis.fetch = async () => {
    throw new TypeError("fetch failed");
  };
  await assert.rejects(apiRequest("/api/v1/x"), /fetch failed/);
});
