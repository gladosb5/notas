# Notas full-expression prototype — licences and attribution

The owner accepts CROHME's **CC BY-NC-SA-3.0**, including non-commercial use, attribution and share-alike. This prototype proceeds under that decision. This notice supersedes the previous experiment's non-commercial licence exclusion. No original Notas application file is relicensed or changed here.

## Distribution obligations

* **CROHME:** use and redistribute the data and adapted expression crops only for non-commercial purposes. Attribute the creators, link the source and CC BY-NC-SA-3.0, retain notices, identify changes, and distribute adapted dataset material under CC BY-NC-SA-3.0 (or an expressly permitted compatible/version option). Do not add legal or technical restrictions that prevent recipients exercising those rights. Share-alike here concerns the adapted dataset/crops; it does not by itself relicense unrelated Notas code. The owner also accepts non-commercial treatment of models trained on this data; the published FormulaNet checkpoint separately carries AGPL-3.0. A dataset licence alone is not proof that weights inherit its licence.
* **FormulaNet/Texo/Texo-web (AGPL-3.0):** retain copyright and licence notices and provide the full AGPL text. The modified ONNX wrapper and derived worker in this experiment are distributed under AGPL-3.0. Identify the graph packaging, preprocessing and decoding modifications. When distributing covered object code, provide Corresponding Source, including build scripts and the preferred source for modification available upstream; when offering a modified covered program over a network, offer its Corresponding Source to its remote users under section 13. Supply this experiment's scripts, pinned upstream source and model source with any distribution. AGPL is not a non-commercial licence. The scope of a future combined app must be assessed when integration is designed; this experiment does not assert that mere aggregation relicenses every app file.
* **MIT / BSD / MIT-CMU / PSF:** preserve copyright, permission and disclaimer texts in source/binary distributions as applicable. BSD non-endorsement clauses apply. **Apache-2.0:** preserve licence, notices and attribution; identify modified files; preserve patent/NOTICE provisions. **MPL-2.0:** keep covered files and modifications under MPL and make their source available when distributing executable forms. These build dependencies do not impose copyleft on unrelated app files merely by being used as tools. Full bundled third-party notices may carry additional component licences; retain them too.

## Attribution to retain with the crops and recognizer

“CROHME handwritten mathematical expressions, collected by the CROHME competition contributors and organizers. CROHME 2023 release: Xie Yejing, Harold Mouchère, Foteini Simistira Liwicki, Sumit Rakesh and the other creators listed in the archived Zenodo metadata, https://doi.org/10.5281/zenodo.8428035, licensed CC BY-NC-SA 3.0, https://creativecommons.org/licenses/by-nc-sa/3.0/. This prototype uses CROHME 2014/2016/2019 test material mirrored by the CoMER authors. Notas selected a deterministic subset, converted BMP to PNG, inverted backgrounds where required and bounded image dimensions. No writer identity or endorsement is asserted.”

“FormulaNet / Texo and Texo-web by alephpi and contributors, https://github.com/alephpi/Texo and https://github.com/alephpi/Texo-web, AGPL-3.0. Notas modifications: one-session ONNX If wrapper, bounded greedy browser worker, local offline packaging, diagnostics and benchmark.”

“UniMER dataset and preprocessing by the UniMERNet/OpenDataLab contributors; PP-FormulaNet-S by the PaddleOCR team; HGNetv2 implementation credits include D-FINE, RT-DETR and PaddleOCR2Pytorch. ONNX Runtime by Microsoft and contributors.”

## Exact assets used

| Resource | Source and exact pin | Licence / use |
|---|---|---|
| FormulaNet weights, ONNX encoder/decoder and tokenizer | [Hugging Face](https://huggingface.co/alephpi/FormulaNet/tree/63e04c86fc96c2324811114351eeea8118bf6b28), revision `63e04c86fc96c2324811114351eeea8118bf6b28`; every downloaded file SHA256 in `model-manifest.json` | Model card: AGPL-3.0. Published ONNX used, PyTorch safetensors used for verification. No training or quantization. |
| Texo Python reference | [Source](https://github.com/alephpi/Texo/tree/26880f5a0e4cf474351dd5327e7b4c0d7eb30522), `26880f5a0e4cf474351dd5327e7b4c0d7eb30522` | AGPL-3.0. HGNetv2, layer implementation and preprocessing specification used. Full source and licence retained under `upstream/Texo`. |
| Texo-web browser reference | [Source](https://github.com/alephpi/Texo-web/tree/b0977c40e233dbc55dc73b630efe33bf5111cdc5), `b0977c40e233dbc55dc73b630efe33bf5111cdc5` | AGPL-3.0. Studied/adapted preprocessing and greedy decoding; its Nuxt/transformers.js app and its network configuration are not used at runtime. Full source retained. |
| CROHME test BMPs and captions | [CoMER data.zip](https://raw.githubusercontent.com/Green-Wood/CoMER/ee15cdbe02467fd29f386fd554b4bc2185110fcc/data.zip), `ee15cdbe02467fd29f386fd554b4bc2185110fcc`; archive/member/output SHA256 in `crohme-corpus.json` | CROHME under the owner's accepted CC BY-NC-SA-3.0 treatment. CoMER is a data mirror here, not an inference/code dependency. The old test mirror does not include a separate per-file licence grant; the official 2023 metadata establishes that release's CC licence, not independent proof of every older file's history. This provenance limit is recorded, not used to withhold execution. |
| CROHME licence evidence | [Zenodo record 8428035](https://zenodo.org/records/8428035), metadata revision 3; saved `evidence/crohme2023.txt` | CC BY-NC-SA-3.0. Both attempted 2023 archive endpoints returned HTTP 504; no 2023 archive was used. |
| Existing 100-layout corpus | Existing `corpus.json`, PNGs and `make-corpus.mjs`, preserved and reused; PNG/source hashes in corpus manifest | MNIST held-out glyphs plus generated layouts. MNIST: Yann LeCun, Corinna Cortes and Christopher J. C. Burges; [source](https://www.tensorflow.org/datasets/catalog/mnist), CC BY-SA-3.0 as documented by TFDS. Retain attribution and share-alike for adapted dataset material. Source IDX was not redownloaded. |
| Existing Notas CNN baseline | Existing `/assets/symbols-cnn.json`, `/assets/symbols-cnn.f32`, `/recognition-worker.js`, `/cnn-runtime.js`; exact SHA256 in `baseline-results.json` | Used unmodified for comparison. Rights/provenance retained in existing `assets/recognition-MODEL.md`; no new licence for user-owned app code is asserted. Its upstream training sources are HASYv2 (ODbL, Martin Thoma, https://doi.org/10.5281/zenodo.259444), MNIST above, EMNIST (NIST-derived, https://www.nist.gov/itl/products-and-services/emnist-dataset; no separate explicit grant established here) and generated/composite strokes. No baseline training datasets beyond the existing synthetic-corpus glyphs were downloaded or retrained in this run. |

The combined ONNX is pinned in `build-manifest.json`. It preserves FP32 weights and adds lexical ONNX If branches. `runtime-manifest.json` pins every loaded model/runtime binary by SHA256. Npm tarballs are pinned by exact version and SHA512 integrity in `package-lock.json`. Python versions and installed metadata/licence-file SHA256 are in `python-dependencies.json`; `requirements-lock.txt` pins the isolated environment. These metadata hashes identify the installed metadata, not wheel hashes.

## Checkpoint training ancestry (not downloaded or trained here)

The exact historical training bytes and teacher checkpoint SHA are **not published by the selected checkpoint card**. The pins below identify the inspected source cards, not a fabricated training-data lock. `evidence/training-chain.json` retains their metadata. No claim of independently audited training membership or writer-disjoint evaluation is made.

| Ancestor | Inspected source pin | Recorded obligations / limitation |
|---|---|---|
| alephpi/UniMER-Train | https://huggingface.co/datasets/alephpi/UniMER-Train/tree/f0eef12674e6424fb3c3300665e0318ee17bdee9 | No licence field in this rearranged dataset card; inherit documented source constraints rather than inventing a grant. Not shipped as a dataset. |
| UniMER_Dataset | https://huggingface.co/datasets/wanderkid/UniMER_Dataset/tree/2343ddd963290469da36ca83e3a56c66e068add9 | Card declares Apache-2.0; identifies CROHME Train, HME100K Train and printed sources. Retain source attribution and upstream component restrictions. |
| CROHME training subset | UniMER card above; historical exact archive SHA not supplied | Accepted CC BY-NC-SA-3.0 obligations above. |
| HME100K | https://github.com/tal-tech/SAN and https://ai.100tal.com/dataset | UniMER explicitly requires separate download for copyright compliance. No exact historical archive or transferable dataset licence established here. Not downloaded or redistributed; recorded as upstream training ancestry of the accepted published AGPL checkpoint. Do not describe its dataset rights as Apache merely from UniMER metadata. |
| Printed UniMER sources / Pix2tex | UniMER card above; https://github.com/lukas-blecher/LaTeX-OCR | Exact historical training source bytes and component grants not supplied by FormulaNet. Not redistributed. |
| PP-FormulaNet-S teacher/base | https://huggingface.co/PaddlePaddle/PP-FormulaNet-S/tree/0572450e501be9eb1b1cdb7e00fccf4b22fab4df | Apache-2.0 card; preserve attribution, licence, notices and modification notices if redistributing. This inspected revision is not claimed to be the exact distillation teacher. No teacher weights downloaded here. |

Upstream code credit chain retained in Texo: D-FINE, RT-DETR, PaddleOCR and PaddleOCR2Pytorch (Apache-2.0); UniMERNet preprocessing (Apache-2.0, cited `41659a39d683de1de9cdbcc6a941bf9a2efdd55e`); my-unimernet preprocessing (MIT, cited `46f7ee83bbb6a61c83776e0c33b300a17d02d1d2`); PaddleOCR2Pytorch padding reference `702c805136d7224884d9c9e032949e35533233b4`. Actual copied code is pinned by the Texo SHA above. Where Texo gives no ancestry revision, none is invented. Repository URLs and declared licences are retained in `evidence/code-chain.json`.

## Runtime and build tools

The following tables list the installed dependency closure, including support packages that may not execute on every command. Only ONNX Runtime Web's WASM build and its bundled components are loaded by the prototype at runtime; Python and the benchmark tools are build/evaluation-only. Full available licence texts are retained under `licenses/`; consult those texts for bundled-component exceptions. Microsoft Edge is a separately installed proprietary browser, not redistributed. Node and Python are separately identified build runtimes; system libraries are not embedded into the prototype.

### npm packages

| Dependency | Exact version | Licence | Source |
|---|---|---|---|
| @protobufjs/aspromise | `1.1.2` | BSD-3-Clause | https://registry.npmjs.org/@protobufjs/aspromise/-/aspromise-1.1.2.tgz |
| @protobufjs/base64 | `1.1.2` | BSD-3-Clause | https://registry.npmjs.org/@protobufjs/base64/-/base64-1.1.2.tgz |
| @protobufjs/codegen | `2.0.5` | BSD-3-Clause | https://registry.npmjs.org/@protobufjs/codegen/-/codegen-2.0.5.tgz |
| @protobufjs/eventemitter | `1.1.1` | BSD-3-Clause | https://registry.npmjs.org/@protobufjs/eventemitter/-/eventemitter-1.1.1.tgz |
| @protobufjs/fetch | `1.1.1` | BSD-3-Clause | https://registry.npmjs.org/@protobufjs/fetch/-/fetch-1.1.1.tgz |
| @protobufjs/float | `1.0.2` | BSD-3-Clause | https://registry.npmjs.org/@protobufjs/float/-/float-1.0.2.tgz |
| @protobufjs/path | `1.1.2` | BSD-3-Clause | https://registry.npmjs.org/@protobufjs/path/-/path-1.1.2.tgz |
| @protobufjs/pool | `1.1.0` | BSD-3-Clause | https://registry.npmjs.org/@protobufjs/pool/-/pool-1.1.0.tgz |
| @protobufjs/utf8 | `1.1.2` | BSD-3-Clause | https://registry.npmjs.org/@protobufjs/utf8/-/utf8-1.1.2.tgz |
| @types/node | `26.5.0` | MIT | https://registry.npmjs.org/@types/node/-/node-26.5.0.tgz |
| flatbuffers | `25.9.23` | Apache-2.0 | https://registry.npmjs.org/flatbuffers/-/flatbuffers-25.9.23.tgz |
| guid-typescript | `1.0.9` | ISC | https://registry.npmjs.org/guid-typescript/-/guid-typescript-1.0.9.tgz |
| long | `5.3.2` | Apache-2.0 | https://registry.npmjs.org/long/-/long-5.3.2.tgz |
| onnxruntime-common | `1.24.3` | MIT | https://registry.npmjs.org/onnxruntime-common/-/onnxruntime-common-1.24.3.tgz |
| onnxruntime-web | `1.24.3` | MIT | https://registry.npmjs.org/onnxruntime-web/-/onnxruntime-web-1.24.3.tgz |
| platform | `1.3.6` | MIT | https://registry.npmjs.org/platform/-/platform-1.3.6.tgz |
| protobufjs | `7.6.6` | BSD-3-Clause | https://registry.npmjs.org/protobufjs/-/protobufjs-7.6.6.tgz |
| undici-types | `8.9.0` | MIT | https://registry.npmjs.org/undici-types/-/undici-types-8.9.0.tgz |

### python packages

| Dependency | Exact version | Licence | Source |
|---|---|---|---|
| antlr4-python3-runtime | `4.9.3` | BSD-3-Clause | https://pypi.org/project/antlr4-python3-runtime/4.9.3/ |
| certifi | `2026.7.22` | MPL-2.0 | https://pypi.org/project/certifi/2026.7.22/ |
| charset-normalizer | `3.5.1` | MIT | https://pypi.org/project/charset-normalizer/3.5.1/ |
| colorama | `0.4.6` | BSD-3-Clause | https://pypi.org/project/colorama/0.4.6/ |
| filelock | `3.32.3` | MIT | https://pypi.org/project/filelock/3.32.3/ |
| flatbuffers | `25.12.19` | Apache 2.0 | https://pypi.org/project/flatbuffers/25.12.19/ |
| fsspec | `2026.7.0` | BSD-3-Clause | https://pypi.org/project/fsspec/2026.7.0/ |
| huggingface_hub | `0.36.2` | Apache | https://pypi.org/project/huggingface_hub/0.36.2/ |
| hydra-core | `1.3.2` | MIT | https://pypi.org/project/hydra-core/1.3.2/ |
| idna | `3.19` | BSD-3-Clause | https://pypi.org/project/idna/3.19/ |
| Jinja2 | `3.1.6` | BSD-3-Clause | https://pypi.org/project/Jinja2/3.1.6/ |
| MarkupSafe | `3.0.3` | BSD-3-Clause | https://pypi.org/project/MarkupSafe/3.0.3/ |
| ml_dtypes | `0.6.0` | Apache-2.0 | https://pypi.org/project/ml_dtypes/0.6.0/ |
| mpmath | `1.3.0` | BSD-3-Clause | https://pypi.org/project/mpmath/1.3.0/ |
| networkx | `3.6.1` | BSD-3-Clause | https://pypi.org/project/networkx/3.6.1/ |
| numpy | `2.2.6` | BSD-3-Clause plus bundled notices | https://pypi.org/project/numpy/2.2.6/ |
| omegaconf | `2.3.1` | BSD-3-Clause | https://pypi.org/project/omegaconf/2.3.1/ |
| onnx | `1.20.1` | Apache-2.0 | https://pypi.org/project/onnx/1.20.1/ |
| onnxruntime | `1.24.3` | MIT License | https://pypi.org/project/onnxruntime/1.24.3/ |
| packaging | `26.3` | Apache-2.0 OR BSD-2-Clause | https://pypi.org/project/packaging/26.3/ |
| pillow | `11.1.0` | MIT-CMU | https://pypi.org/project/pillow/11.1.0/ |
| protobuf | `7.36.1` | 3-Clause BSD License | https://pypi.org/project/protobuf/7.36.1/ |
| PyYAML | `6.0.3` | MIT | https://pypi.org/project/PyYAML/6.0.3/ |
| regex | `2026.9.3` | Apache-2.0 AND CNRI-Python | https://pypi.org/project/regex/2026.9.3/ |
| requests | `2.34.2` | Apache-2.0 | https://pypi.org/project/requests/2.34.2/ |
| safetensors | `0.8.0` | Apache-2.0 | https://pypi.org/project/safetensors/0.8.0/ |
| sympy | `1.14.0` | BSD-3-Clause | https://pypi.org/project/sympy/1.14.0/ |
| tokenizers | `0.19.1` | Apache-2.0 | https://pypi.org/project/tokenizers/0.19.1/ |
| torch | `2.7.0+cpu` | BSD-3-Clause | https://pypi.org/project/torch/2.7.0/ |
| tqdm | `4.70.0` | MPL-2.0 AND MIT | https://pypi.org/project/tqdm/4.70.0/ |
| transformers | `4.40.0` | Apache 2.0 License | https://pypi.org/project/transformers/4.40.0/ |
| typing_extensions | `4.16.0` | PSF-2.0 | https://pypi.org/project/typing_extensions/4.16.0/ |
| urllib3 | `2.7.0` | MIT | https://pypi.org/project/urllib3/2.7.0/ |

Additional evaluation/build runtimes: Playwright and playwright-core 1.58.2 (Apache-2.0), https://github.com/microsoft/playwright; pngjs 7.0.0 (MIT), https://github.com/pngjs/pngjs. Exact package metadata SHA256 are in evaluation-dependencies.json; existing root package-lock.json pins their package integrity. Node.js v22.22.1 (MIT and bundled component notices), https://nodejs.org; CPython 3.11.11 (PSF-2.0 and bundled notices), https://www.python.org/downloads/release/python-31111/; uv 0.6.6 commit c1a0bb85e (MIT OR Apache-2.0), https://github.com/astral-sh/uv. The isolated CPython distribution is python-build-standalone as selected by uv; its archive/install metadata remain under `python/`. Global Python 3.14 executes standard-library download and memory-sampling scripts. ISC dependencies require preservation of their copyright/permission/disclaimer text, like MIT. Installed Python code files are individually SHA256-pinned in python-dependencies.json (excluding mutable .pyc files).
