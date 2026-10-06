# Third-party components

The root MIT license covers original Notas source. It does not replace licenses on dependencies, fonts, or model weights.

Preserve license files and notices under `assets/`, including:

- [Recognition assets](assets/recognition-LICENSE.txt)
- [Hand-to-TeX ink model](assets/ink/HAND-TO-TEX-LICENSE.txt)
- [Slide/background model](assets/slide/LICENSE.txt)
- [Recognition runtime notices](assets/smart/NOTICE.md)
- [Text recognition notices](assets/text/NOTICE.md)

Other bundled files may contain their own license headers or adjacent license files. npm dependencies retain their package licenses. The root and deployment lockfiles record dependency versions.

The handwriting stroke alphabet in `nota.js` is attributed there to Hershey glyph data from `techninja/hersheytextjs`. See the [slide model card](docs/models/slide.md) for model provenance and limitations.
