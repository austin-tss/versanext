import { test } from "node:test";
import assert from "node:assert/strict";
import worker, {
  originAllowed,
  normalizeMessages,
  checkRateLimit,
  resetRateLimitForTests,
} from "./index.js";

test("allows the marketing site and localhost only", () => {
  assert.equal(originAllowed("https://vnxt.app"), true);
  assert.equal(originAllowed("https://www.vnxt.app"), true);
  assert.equal(originAllowed("http://localhost:8080"), true);
  assert.equal(originAllowed("http://127.0.0.1:5500"), true);
  assert.equal(originAllowed("https://example.com"), false);
  assert.equal(originAllowed(""), false);
  assert.equal(originAllowed(null), false);
});

test("drops a leading greeting and keeps the user question", () => {
  const result = normalizeMessages({
    messages: [
      { role: "assistant", content: "Hey, what can I help you with?" },
      { role: "user", content: "  Where are you located?  " },
    ],
  });
  assert.equal(result.error, undefined);
  assert.equal(result.contents.length, 1);
  assert.equal(result.contents[0].role, "user");
  assert.equal(result.contents[0].parts[0].text, "Where are you located?");
});

test("rejects a body with no user question", () => {
  const result = normalizeMessages({ messages: [{ role: "assistant", content: "Hello" }] });
  assert.equal(typeof result.error, "string");
});

test("rate limit is per IP", () => {
  resetRateLimitForTests();
  for (let i = 0; i < 20; i += 1) assert.equal(checkRateLimit("203.0.113.9", 1_000), true);
  assert.equal(checkRateLimit("203.0.113.9", 1_000), false);
  assert.equal(checkRateLimit("203.0.113.10", 1_000), true);
});

test("POST from a disallowed origin is rejected", async () => {
  const response = await worker.fetch(new Request("https://vnxt-ask.example/ask", {
    method: "POST",
    headers: { Origin: "https://evil.example", "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: "Hi" }] }),
  }), {});
  assert.equal(response.status, 403);
});

test("OPTIONS preflight allows vnxt.app", async () => {
  const response = await worker.fetch(new Request("https://vnxt-ask.example/ask", {
    method: "OPTIONS",
    headers: { Origin: "https://vnxt.app" },
  }), {});
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "https://vnxt.app");
});

test("calls Gemini with the secret in a header and a VersaNext system prompt", async () => {
  resetRateLimitForTests();
  const original = globalThis.fetch;
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url: String(url), init };
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: "We are in Tallahassee." }] } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const response = await worker.fetch(new Request("https://vnxt-ask.example/ask", {
      method: "POST",
      headers: {
        Origin: "http://localhost:8000",
        "Content-Type": "application/json",
        "CF-Connecting-IP": "198.51.100.20",
      },
      body: JSON.stringify({
        messages: [
          { role: "assistant", content: "Hey, what can I help you with?" },
          { role: "user", content: "What is your address?" },
        ],
      }),
    }), { GEMINI_API_KEY: "test-secret-not-real", GEMINI_MODEL: "gemini-2.5-flash" });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.reply, "We are in Tallahassee.");
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), "http://localhost:8000");
    assert.match(captured.url, /models\/gemini-2\.5-flash:generateContent$/);
    assert.equal(captured.url.includes("test-secret-not-real"), false);
    assert.equal(captured.init.headers["x-goog-api-key"], "test-secret-not-real");
    const sent = JSON.parse(captured.init.body);
    assert.match(sent.systemInstruction.parts[0].text, /2915 Kerry Forest Parkway/);
    assert.match(sent.systemInstruction.parts[0].text, /not the owner|Do not describe Austin Stinson as the owner/);
    assert.equal(sent.contents[0].role, "user");
    assert.equal(sent.contents[0].parts[0].text, "What is your address?");
  } finally {
    globalThis.fetch = original;
  }
});

test("missing secret does not call Gemini", async () => {
  resetRateLimitForTests();
  let called = false;
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    called = true;
    return new Response("no");
  };
  try {
    const response = await worker.fetch(new Request("https://vnxt-ask.example/ask", {
      method: "POST",
      headers: { Origin: "https://vnxt.app", "Content-Type": "application/json", "CF-Connecting-IP": "198.51.100.21" },
      body: JSON.stringify({ messages: [{ role: "user", content: "Hello" }] }),
    }), {});
    const body = await response.json();
    assert.equal(response.status, 500);
    assert.equal(called, false);
    assert.equal(JSON.stringify(body).includes("GEMINI"), false);
  } finally {
    globalThis.fetch = original;
  }
});
