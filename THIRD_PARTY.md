# Third-party components

The root MIT license covers original Notas source. It does not replace licenses on dependencies, fonts, or model weights.

Preserve license files and notices under `assets/`, including:

- [Recognition assets](assets/recognition-LICENSE.txt)
- [Hand-to-TeX ink model](assets/ink/HAND-TO-TEX-LICENSE.txt)
- [Background remover model](assets/bg/LICENSE.txt)
- [Recognition runtime notices](assets/smart/NOTICE.md)
- [Text recognition notices](assets/text/NOTICE.md)

Other bundled files may contain their own license headers or adjacent license files. npm dependencies retain their package licenses. The root and deployment lockfiles record dependency versions.

The handwriting stroke alphabet in `nota.js` is attributed there to Hershey glyph data from `techninja/hersheytextjs`. See the [background remover model card](docs/models/background.md) for model provenance.

PDF support uses [PDF.js (Apache-2.0)](assets/pdf/PDFJS-LICENSE.txt) and [pdf-lib (MIT)](assets/pdf/PDFLIB-LICENSE.txt). Additional font, CMap and decoder notices are preserved under `assets/pdf/`.

Sharing QR codes use [qrcode-generator 2.0.4 (MIT)](assets/QRCODE-LICENSE.txt), bundled locally in `assets/collab.js`. Run `npm run build:collab` to rebuild. `jsqr` is used only by browser tests to verify the displayed QR codes.
