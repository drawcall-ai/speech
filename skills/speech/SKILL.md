---
name: speech
description: Use the Drawcall Speech API from apps, websites, and 3D experiences. Use when explaining or showcasing text-to-speech usage with https://v1.speech.drawcall.ai, including simple HTML audio, JavaScript audio loading, voice selection, browser autoplay constraints, URL encoding, caching behavior, and first-request warmup.
---

# Speech

Use Drawcall Speech for spoken output: NPC dialogue, narration, tutorial voice, accessibility readouts, and UI voice lines. It turns text into an audio clip URL that an app can load and play.

## Endpoint

Drawcall Speech turns text into an audio URL.

```text
GET https://v1.speech.drawcall.ai/?text=Hello+world&voice=Zephyr
```

- `text`: required, URL-encoded, trimmed, max 1000 chars.
- `voice`: optional, URL-encoded, defaults to `Zephyr`.
- Response: audio file, usually `audio/wav`.
- Cache: generated clips are cached by text and voice; reuse identical URLs for repeatable playback.
- Errors: plain text `400` for invalid input, `502` for generation failures.

## First Request Delay

The first time a specific `text` and `voice` combination is requested, the endpoint has to generate the clip before it can serve it. That short delay can corrupt in-app behavior if a test expects instant playback, animation sync, or deterministic timing.

If that matters, warm the cache before testing by calling the endpoint once for each needed line and voice. Later requests for the same text and voice are cached and should be instant.

For tighter control, download and store the audio files locally, then serve them from the app. A good middle ground is a small speech script that predownloads every line while keeping the voice line text in one source file, so changing a line remains a single source change.

## Examples

HTML audio:

```html
<audio
  controls
  src="https://v1.speech.drawcall.ai/?text=Welcome+to+Drawcall&voice=Zephyr"
></audio>
```

Three.js positional audio:

```ts
import * as THREE from "three";

const listener = new THREE.AudioListener();
camera.add(listener);

const speaker = new THREE.Object3D();
speaker.position.set(2, 1.5, -3);
scene.add(speaker);

const audio = new THREE.PositionalAudio(listener);
audio.setRefDistance(2);
audio.setRolloffFactor(1.5);
speaker.add(audio);

const text = encodeURIComponent("I am speaking from over here.");
const voice = encodeURIComponent("Puck");
new THREE.AudioLoader().load(
  `https://v1.speech.drawcall.ai/?text=${text}&voice=${voice}`,
  (buffer) => {
    audio.setBuffer(buffer);
    audio.setVolume(1);
    audio.play();
  },
);
```

## Voice

Known voices include `Zephyr`, `Puck`, `Charon`, `Kore`, `Fenrir`, `Leda`, `Orus`, `Aoede`, `Callirrhoe`, `Autonoe`, `Enceladus`, `Iapetus`, `Umbriel`, `Algieba`, `Despina`, `Erinome`, `Algenib`, `Rasalgethi`, `Laomedeia`, `Achernar`, `Alnilam`, `Schedar`, `Gacrux`, `Pulcherrima`, `Achird`, `Zubenelgenubi`, `Vindemiatrix`, `Sadachbia`, `Sadaltager`, and `Sulafat`.

Browsers usually require a click/tap before audio can play. In UI, start playback from a user gesture and resume the audio context first if needed.
