import assert from "node:assert/strict";
import test from "node:test";

import app from "../src/index.ts";

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
      'TTS the following transcript exactly.\n\nTranscript: "hello"',
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
