---
name: speech
description: Use the Drawcall Speech API from apps, websites, and 3D experiences. Use when explaining or showcasing text-to-speech usage with https://v1.speech.drawcall.ai, including simple HTML audio, JavaScript audio loading, Three.js positional audio, voice selection, browser autoplay constraints, URL encoding, caching behavior, and limits.
---

# Speech

## Endpoint

Drawcall Speech turns text into an audio URL.

```text
GET https://v1.speech.drawcall.ai/?text=Hello+world&voice=Aria
```

- `text`: required, URL-encoded, trimmed, max 1000 chars.
- `voice`: optional, URL-encoded, defaults to `Rachel`.
- Response: audio file, usually `audio/mpeg`.
- Cache: generated clips are cached by text and voice; reuse identical URLs for repeatable playback.
- Errors: plain text `400` for invalid input, `502` for generation failures.

## Examples

HTML audio:

```html
<audio
  controls
  src="https://v1.speech.drawcall.ai/?text=Welcome+to+Drawcall&voice=Aria"
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
const voice = encodeURIComponent("Roger");
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

Known voices include `Rachel`, `Aria`, `Roger`, `Sarah`, `Laura`, `Charlie`, `George`, `Callum`, `River`, `Liam`, `Charlotte`, `Alice`, `Matilda`, `Will`, `Jessica`, `Eric`, `Chris`, `Brian`, `Daniel`, `Lily`, and `Bill`.

Browsers usually require a click/tap before audio can play. In UI, start playback from a user gesture and resume the audio context first if needed.
