# Third-party code in this folder

Every file here is copied in as-is (no package manager at run time), so the app works offline and nothing is
loaded from another website. When you update one, change its row too.

| Folder / file | Project | Version | Licence | Source | SHA-256 |
|---|---|---|---|---|---|
| `qrcode.min.js` | qrcode-generator (Kazuhiko Arase) | not recorded | MIT (`qrcode.LICENSE`) | https://github.com/kazuhikoarase/qrcode-generator | `51935dfba7e86cf4264f72cc848d9f743b5129383ca0cb81bb905377021fcb0d` |
| `fflate-unzip.min.js` | fflate, unzip functions only (`unzipSync`, `strFromU8`) | 0.8.3 (rebuilt and compared byte for byte on 23 Oct 2026; it is the release that fixes the ZIP64 hang advisory) | MIT (`fflate.LICENSE`) | https://github.com/101arrowz/fflate | `6e460045bc2342ddf43143b68fcc1866caab9fcc700efcc55abb1e0c42030ab4` |
| `hls/hls.light.min.js` | hls.js (light build) | 1.5.20 | Apache-2.0 (`hls/LICENSE`) | https://github.com/video-dev/hls.js | `35ef1cf70c95aea402a868c696ed32126956eb87eb0d1ed40086d5d28aeb92f3` |
| `pdfjs/pdf.min.mjs`, `pdfjs/pdf.worker.min.mjs` | pdf.js | 4.10.38 | Apache-2.0 (`pdfjs/LICENSE`) | https://github.com/mozilla/pdf.js | `44ec6f01…7212b72`, `bd888051…d41cb` |
| `spessasynth/*` | SpessaSynth (library and processor) | not recorded | Apache-2.0 (`spessasynth/LICENSE`) | https://github.com/spessasus/SpessaSynth | `8f671b7c…89015`, `109ad445…b1fb5` |
| `trystero/trystero-nostr.min.js` | Trystero (Nostr strategy) with noble-secp256k1, with two local patches (`trystero/PATCHES.txt`) | 0.26.0 | MIT (`trystero/LICENSE`, `trystero/LICENSE-noble-secp256k1`) | https://github.com/dmotz/trystero | `0d1c0246190582fff3275952907dd8eef81e45ac8a4752086261b9020c2d2eee` |

Also bundled outside this folder: GeneralUser GS 2.0.3 SoundFont (`data/music/GeneralUser-GS-LICENSE.txt`), the optional
high-quality hymn sounds (Salamander Grand Piano, GrandOrgue demo organ: `data/music/HQ-SOUNDS-LICENSE.txt`),
Atkinson Hyperlegible and Source Serif fonts (OFL, `fonts/OFL-*.txt`).

"Not recorded" means the version cannot be read from the file. The next time you update that library, write
the version here.
