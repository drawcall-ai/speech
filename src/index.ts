import { Hono } from "hono";

type Env = { TTS_CACHE: R2Bucket; OPENROUTER_API_KEY: string };

const MODEL = "google/gemini-3.1-flash-tts-preview";
const OPENROUTER_SPEECH_URL = "https://openrouter.ai/api/v1/audio/speech";
const CACHE_VERSION = 5;
const OPENROUTER_ATTEMPTS = 3;
const MAX_TEXT = 1000;
const MAX_VOICE = 100;
const DEFAULT_VOICE = "Zephyr";
const YEAR = 31536000;

const app = new Hono<{ Bindings: Env }>();

app.get("/", async (c) => {
  const text = c.req.query("text")?.trim();
  const voice = c.req.query("voice")?.trim() || DEFAULT_VOICE;
  if (!text) return c.text("missing ?text", 400);
  if (text.length > MAX_TEXT) return c.text(`text exceeds ${MAX_TEXT} chars`, 400);
  if (voice.length > MAX_VOICE) return c.text(`voice exceeds ${MAX_VOICE} chars`, 400);

  const key = await sha256Hex(
    JSON.stringify({ v: CACHE_VERSION, model: MODEL, text, voice }),
  );
  const hit = await c.env.TTS_CACHE.get(key);
  if (hit) return audio(hit.body, hit.httpMetadata?.contentType, "HIT-R2");

  const { bytes, contentType } = await callOpenRouter(
    { text, voice },
    c.env.OPENROUTER_API_KEY,
  );
  await c.env.TTS_CACHE.put(key, bytes, { httpMetadata: { contentType } });
  return audio(bytes, contentType, "MISS");
});

async function callOpenRouter(input: { text: string; voice: string }, key: string) {
  for (let attempt = 1; attempt <= OPENROUTER_ATTEMPTS; attempt += 1) {
    const res = await fetch(OPENROUTER_SPEECH_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        input: speechPrompt(input.text),
        voice: input.voice,
        response_format: "pcm",
      }),
    });

    if (!res.ok) {
      throw new HTTPError(502, `openrouter: ${res.status} ${await res.text()}`);
    }

    const contentType = res.headers.get("content-type");
    if (!contentType?.startsWith("audio/pcm")) {
      throw new HTTPError(502, `openrouter: unexpected content-type ${contentType}`);
    }

    const pcm = await res.arrayBuffer();
    if (hasAudioData(pcm)) {
      return {
        bytes: wavFromPcm(pcm, {
          channels: audioParam(contentType, "channels") ?? 1,
          sampleRate: audioParam(contentType, "rate") ?? 24000,
          sampleWidth: 2,
        }),
        contentType: "audio/wav",
      };
    }
  }

  throw new HTTPError(502, "openrouter: empty audio response");
}

function wavFromPcm(
  pcm: ArrayBuffer,
  format: { channels: number; sampleRate: number; sampleWidth: number },
) {
  const bytesPerSample = format.sampleWidth;
  const dataSize = pcm.byteLength;
  const wav = new ArrayBuffer(44 + dataSize);
  const view = new DataView(wav);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, format.channels, true);
  view.setUint32(24, format.sampleRate, true);
  view.setUint32(28, format.sampleRate * format.channels * bytesPerSample, true);
  view.setUint16(32, format.channels * bytesPerSample, true);
  view.setUint16(34, bytesPerSample * 8, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);
  new Uint8Array(wav, 44).set(new Uint8Array(pcm));

  return wav;
}

function writeAscii(view: DataView, offset: number, value: string) {
  for (let i = 0; i < value.length; i += 1) {
    view.setUint8(offset + i, value.charCodeAt(i));
  }
}

function hasAudioData(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  return bytes.some((byte) => byte !== 0);
}

function speechPrompt(text: string) {
  return `Read this text aloud exactly: ${JSON.stringify(text)}`;
}

function audioParam(contentType: string | null, name: string) {
  const param = contentType
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));

  if (!param) return undefined;
  const value = Number(param.split("=")[1]);
  return Number.isFinite(value) ? value : undefined;
}

function audio(
  body: BodyInit | null,
  contentType: string | undefined,
  cacheStatus: string,
  immutable = true,
) {
  return new Response(body, {
    headers: {
      "content-type": contentType ?? "audio/wav",
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
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

app.onError((err) => {
  if (err instanceof HTTPError) return new Response(err.message, { status: err.status });
  console.error("unhandled:", err);
  return new Response("internal error", { status: 500 });
});

export default app;
