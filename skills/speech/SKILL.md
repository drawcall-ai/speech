---
name: speech
description: Use the Drawcall Speech API from apps, websites, and 3D experiences. Use when explaining or showcasing text-to-speech usage with https://v1.speech.drawcall.ai, including simple HTML audio, JavaScript audio loading, voice selection, style control, browser autoplay constraints, URL encoding, caching behavior, and first-request warmup.
---

# Speech

Use Drawcall Speech for spoken output: NPC dialogue, narration, tutorial voice, accessibility readouts, and UI voice lines. It turns text into an audio clip URL that an app can load and play.

## Endpoint

Drawcall Speech turns text into an audio URL.

```text
GET https://v1.speech.drawcall.ai/?text=Hello+world&voice=Zephyr
```

- `text`: required, URL-encoded, trimmed, max 1000 chars.
- `style`: optional, URL-encoded, trimmed, max 1000 chars. Use it for delivery instructions such as tone, emotion, accent, pace, and pauses.
- `voice`: optional, URL-encoded, defaults to `Zephyr`.
- Response: audio file, usually `audio/wav`.
- Cache: generated clips are cached by text, style, and voice; reuse identical URLs for repeatable playback.
- Errors: plain text `400` for invalid input, `502` for generation failures.

## Style

Use `text`, `voice`, and `style` as the stable API shape. This follows the common TTS split: transcript text is separate from voice selection and delivery control. `style` is Drawcall Speech's public name for natural-language delivery instructions; it maps well to Gemini style prompts and Azure-style SSML naming without exposing model prompt mechanics.

Keep the words to speak in `text`, and put line-level delivery notes in `style` when the whole line needs tone, emotion, accent, pace, or pauses. Style is best-effort rather than sample-accurate timing; for exact timing, pre-generate and edit audio assets.

Good style values:

- `Say warmly and excitedly, with a long pause after the first sentence.`
- `Read this as a spooky whisper, slowly, with a nervous laugh near the end.`
- `Use a calm British narrator tone and leave a short pause between clauses.`

Inline stage directions in `text` are better for local changes at specific points. Use bracketed directions such as `[pause]`, `[long pause]`, `[whispers]`, `[shouting]`, `[happy]`, `[sad]`, `[laughs]`, or `[very slow]`. The service asks the model to treat bracketed directions as performance notes rather than spoken words, but this is still model-dependent. Put broad direction in `style`; put timed or local switches in `text`.

```text
GET https://v1.speech.drawcall.ai/?text=Hello+from+Drawcall.+Now+we+continue.&voice=Puck&style=Say+warmly+and+excitedly,+with+a+long+dramatic+pause+after+the+first+sentence.
```

```text
GET https://v1.speech.drawcall.ai/?text=[whispers]+I+found+it.+[long+pause]+[shouting]+Run+now!&voice=Puck&style=Start+tense,+then+turn+urgent.
```

## First Request Delay

The first time a specific `text`, `style`, and `voice` combination is requested, the endpoint has to generate the clip before it can serve it. That short delay can corrupt in-app behavior if a test expects instant playback, animation sync, or deterministic timing.

If that matters, warm the cache before testing by calling the endpoint once for each needed line, style, and voice. Later requests for the same URL are cached and should be instant.

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
