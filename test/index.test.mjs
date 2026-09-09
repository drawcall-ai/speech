import assert from "node:assert/strict";
import test from "node:test";

import app from "../src/index.ts";

const origin = "https://share.design.drawcallcontent.com";
const speechUrl = `https://example.test/?${new URLSearchParams({
  text: "[whispers] Homburg. [long pause] Eighteen forty-one.",
  voice: "Puck",
  style: "Hushed and close, like letting someone in on a secret",
})}`;

test("allows cross-origin audio on cache misses and hits", async (t) => {
  const cache = new FakeR2Bucket();
  const fetch = t.mock.method(globalThis, "fetch", async () =>
    new Response(samplePcm(), {
      headers: { "content-type": "audio/pcm;rate=24000;channels=1" },
    }),
  );

  for (const cacheStatus of ["MISS", "HIT-R2"]) {
    const res = await app.fetch(
      new Request(speechUrl, { headers: { origin } }),
      { OPENROUTER_API_KEY: "test-key", TTS_CACHE: cache },
    );
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("access-control-allow-origin"), "*");
    assert.equal(res.headers.get("content-type"), "audio/wav");
    assert.equal(res.headers.get("x-cache"), cacheStatus);
    assert.equal(Buffer.from(await res.arrayBuffer()).subarray(0, 4).toString(), "RIFF");
  }
  assert.equal(fetch.mock.callCount(), 1);
});

test("answers CORS preflight without generating audio", async () => {
  const res = await app.fetch(
    new Request(speechUrl, {
      method: "OPTIONS",
      headers: {
        origin,
        "access-control-request-method": "GET",
        "access-control-request-headers": "range",
      },
    }),
  );
  assert.equal(res.status, 204);
  assert.equal(res.headers.get("access-control-allow-origin"), "*");
  assert.ok(res.headers.get("access-control-allow-methods").split(",").includes("GET"));
  assert.equal(res.headers.get("access-control-allow-headers"), "range");
});

for (const { name, url, status, message } of [
  { name: "validation", url: "https://example.test/", status: 400, message: "missing ?text" },
  { name: "provider", url: speechUrl, status: 502, message: "openrouter: 503 unavailable" },
]) {
  test(`keeps ${name} errors readable across origins`, async (t) => {
    t.mock.method(globalThis, "fetch", async () =>
      new Response("unavailable", { status: 503 }),
    );
    const res = await app.fetch(
      new Request(url, { headers: { origin } }),
      { OPENROUTER_API_KEY: "test-key", TTS_CACHE: new FakeR2Bucket() },
    );
    assert.equal(res.status, status);
    assert.equal(res.headers.get("access-control-allow-origin"), "*");
    assert.equal(await res.text(), message);
  });
}

test("retries empty OpenRouter audio and caches only the valid WAV", async () => {
  const cache = new FakeR2Bucket();
  const fetches = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url, init) => {
    fetches.push({ url, init });
    if (fetches.length === 1) {
      return new Response(new ArrayBuffer(0), {
        headers: { "content-type": "audio/pcm;rate=24000;channels=1" },
      });
    }

    return new Response(samplePcm(), {
      headers: { "content-type": "audio/pcm;rate=24000;channels=1" },
    });
  };

  try {
    const res = await app.fetch(
      new Request("https://example.test/?text=hello&voice=Puck"),
      { OPENROUTER_API_KEY: "test-key", TTS_CACHE: cache },
    );

    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "audio/wav");
    assert.equal(res.headers.get("x-cache"), "MISS");
    assert.equal(fetches.length, 2);
    assert.equal(
      JSON.parse(fetches[0].init.body).input,
      [
        "TTS the following transcript.",
        "Read normal words aloud exactly.",
        "Interpret bracketed stage directions as delivery instructions at their positions, not spoken words.",
        "",
        'Transcript: "hello"',
      ].join("\n"),
    );

    const body = Buffer.from(await res.arrayBuffer());
    assert.equal(body.subarray(0, 4).toString("ascii"), "RIFF");
    assert.ok(body.length > 44);
    assert.equal(cache.objects.size, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("passes style separately from transcript", async () => {
  const cache = new FakeR2Bucket();
  const fetches = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url, init) => {
    fetches.push({ url, init });
    return new Response(samplePcm(), {
      headers: { "content-type": "audio/pcm;rate=24000;channels=1" },
    });
  };

  try {
    const res = await app.fetch(
      new Request(
        "https://example.test/?text=hello&voice=Puck&style=Say%20warmly%20with%20a%20pause",
      ),
      { OPENROUTER_API_KEY: "test-key", TTS_CACHE: cache },
    );

    assert.equal(res.status, 200);
    assert.equal(
      JSON.parse(fetches[0].init.body).input,
      [
        "TTS the following transcript.",
        "Follow the style notes without reading the notes aloud.",
        "Read normal words aloud exactly.",
        "Interpret bracketed stage directions as delivery instructions at their positions, not spoken words.",
        "",
        "Style notes: Say warmly with a pause",
        "",
        'Transcript: "hello"',
      ].join("\n"),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("accepts prompt as a legacy alias for style", async () => {
  const cache = new FakeR2Bucket();
  const fetches = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url, init) => {
    fetches.push({ url, init });
    return new Response(samplePcm(), {
      headers: { "content-type": "audio/pcm;rate=24000;channels=1" },
    });
  };

  try {
    const res = await app.fetch(
      new Request("https://example.test/?text=hello&voice=Puck&prompt=Say%20warmly"),
      { OPENROUTER_API_KEY: "test-key", TTS_CACHE: cache },
    );

    assert.equal(res.status, 200);
    assert.match(JSON.parse(fetches[0].init.body).input, /Style notes: Say warmly/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("falls back to the default provider voice for a character role", async () => {
  const cache = new FakeR2Bucket();
  const fetches = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url, init) => {
    fetches.push({ url, init });
    return new Response(samplePcm(), {
      headers: { "content-type": "audio/pcm;rate=24000;channels=1" },
    });
  };

  try {
    const res = await app.fetch(
      new Request("https://example.test/?text=hello&voice=Trail%20Guide"),
      { OPENROUTER_API_KEY: "test-key", TTS_CACHE: cache },
    );

    assert.equal(res.status, 200);
    assert.equal(JSON.parse(fetches[0].init.body).voice, "Zephyr");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects conflicting style and prompt params", async () => {
  const cache = new FakeR2Bucket();
  const res = await app.fetch(
    new Request(
      "https://example.test/?text=hello&style=Say%20warmly&prompt=Say%20sadly",
    ),
    { OPENROUTER_API_KEY: "test-key", TTS_CACHE: cache },
  );

  assert.equal(res.status, 400);
  assert.equal(await res.text(), "use either ?style or ?prompt, not both");
  assert.equal(cache.objects.size, 0);
});

test("does not cache empty OpenRouter audio", async () => {
  const cache = new FakeR2Bucket();
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () =>
    new Response(new ArrayBuffer(0), {
      headers: { "content-type": "audio/pcm;rate=24000;channels=1" },
    });

  try {
    const res = await app.fetch(
      new Request("https://example.test/?text=hello&voice=Puck"),
      { OPENROUTER_API_KEY: "test-key", TTS_CACHE: cache },
    );

    assert.equal(res.status, 502);
    assert.equal(await res.text(), "openrouter: empty audio response");
    assert.equal(cache.objects.size, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function samplePcm() {
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setInt16(0, 0, true);
  view.setInt16(2, 1200, true);
  view.setInt16(4, -1200, true);
  view.setInt16(6, 0, true);
  return buffer;
}

class FakeR2Bucket {
  objects = new Map();

  async get(key) {
    const object = this.objects.get(key);
    if (!object) return null;
    return {
      body: object.body,
      httpMetadata: { contentType: object.contentType },
    };
  }

  async put(key, body, options) {
    this.objects.set(key, {
      body,
      contentType: options.httpMetadata.contentType,
    });
  }
}
