import { Hono } from "hono";

type Env = { TTS_CACHE: R2Bucket; FAL_API_KEY: string };

const MODEL_URL = "https://fal.run/fal-ai/elevenlabs/tts/turbo-v2.5";
const MAX_TEXT = 1000;
const MAX_VOICE = 100;
const DEFAULT_VOICE = "Rachel";
const YEAR = 31536000;

const app = new Hono<{ Bindings: Env }>();

app.get("/", async (c) => {
  const text = c.req.query("text")?.trim();
  const voice = c.req.query("voice")?.trim() || DEFAULT_VOICE;
  if (!text) return c.text("missing ?text", 400);
  if (text.length > MAX_TEXT) return c.text(`text exceeds ${MAX_TEXT} chars`, 400);
  if (voice.length > MAX_VOICE) return c.text(`voice exceeds ${MAX_VOICE} chars`, 400);

  if (c.req.header("x-internal-gen")) {
    const { bytes, contentType } = await callFal({ text, voice }, c.env.FAL_API_KEY);
    return audio(bytes, contentType, "MISS", true);
  }

  const key = await sha256Hex(JSON.stringify({ v: 2, text, voice }));
  const hit = await c.env.TTS_CACHE.get(key);
  if (hit) return audio(hit.body, hit.httpMetadata?.contentType, "HIT-R2");

  const sub = await fetch(c.req.url, {
    headers: { "x-internal-gen": "1" },
    cf: { cacheEverything: true, cacheTtl: YEAR },
  });
  if (!sub.ok) return c.text(await sub.text(), 502);

  const buf = await sub.arrayBuffer();
  const ct = sub.headers.get("content-type") ?? "audio/mpeg";
  c.executionCtx.waitUntil(
    c.env.TTS_CACHE.put(key, buf, { httpMetadata: { contentType: ct } }),
  );
  const status = sub.headers.get("cf-cache-status") === "HIT" ? "HIT-EDGE" : "MISS";
  return audio(buf, ct, status);
});

async function callFal(input: { text: string; voice: string }, key: string) {
  const res = await fetch(MODEL_URL, {
    method: "POST",
    headers: { authorization: `Key ${key}`, "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new HTTPError(502, `fal: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { audio: { url: string; content_type?: string } };
  const file = await fetch(json.audio.url);
  if (!file.ok) throw new HTTPError(502, `fal audio fetch: ${file.status}`);
  return {
    bytes: await file.arrayBuffer(),
    contentType: json.audio.content_type ?? file.headers.get("content-type") ?? "audio/mpeg",
  };
}

function audio(
  body: BodyInit | null,
  contentType: string | undefined,
  cacheStatus: string,
  immutable = true,
) {
  return new Response(body, {
    headers: {
      "content-type": contentType ?? "audio/mpeg",
      "cache-control": `public, max-age=${YEAR}${immutable ? ", immutable" : ""}`,
      "x-cache": cacheStatus,
    },
  });
}

async function sha256Hex(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

class HTTPError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

app.onError((err) => {
  if (err instanceof HTTPError) return new Response(err.message, { status: err.status });
  console.error("unhandled:", err);
  return new Response("internal error", { status: 500 });
});

export default app;
