# Background removal

The image selection action **remove background** runs [studioludens/birefnet-lite-512](https://huggingface.co/studioludens/birefnet-lite-512), a 512 × 512 ONNX export of [ZhengPeng7/BiRefNet_lite](https://huggingface.co/ZhengPeng7/BiRefNet_lite) (MIT), in `bg-worker.js`. The output is one channel of logits; the sigmoid is the alpha matte, scaled back to the picture. The result is trimmed of transparent margins automatically and keeps undo/redo and the background toggle.

## Runtime

- **Precision:** fp32 (`onnx/model.onnx`, 191,877,254 bytes).
- **Backend:** WebGPU where the browser gives the worker an adapter, with ONNX Runtime Web's WebAssembly backend as the fallback. The fallback is used when there is no WebGPU adapter, when the session cannot be created on it, and when a run fails on the GPU after it started (a lost device, a buffer that cannot be allocated): the model is then started again on WebAssembly and the picture is retried.
- **Runtime:** ONNX Runtime Web 1.24.3, the WebGPU build (`assets/smart/ort.webgpu.min.js` with its loader `ort-wasm-simd-threaded.asyncify.js`). The WebAssembly fallback is the same build's CPU backend. Its binary is 27 MB, over the static host limit, so it is two parts in `assets/smart/` that the worker joins and checks before starting. The handwriting readers still use the smaller WebAssembly-only build beside it.
- **Input:** `input_image`, RGB 512 × 512, scaled by 1/255 and normalised with the ImageNet mean and standard deviation. Transparent pixels are read as white. **Output:** `output_image`, one channel of logits.

## Packaging

The model is pinned to revision `962e67969ec6acec9c19fab76acee4f5e22e990c`; the model's SHA-256 is `1cb0fb360dad…` (`assets/bg/model.json` has the whole hash). Static hosts cap a file at 25 MiB, so `scripts/make-bg-model.mjs` cuts it into ten parts of at most 20 MiB under `assets/bg/` (and the runtime binary into two). Every part and the assembled model are SHA-256 checked in the browser, and the model is kept in the model store, so after the first download it works offline.

The licence (MIT, Copyright 2024 ZhengPeng, 2026 Studio Ludens V.O.F.) is `assets/bg/LICENSE.txt`.

## What changed from the previous model

The previous model was a locally fine-tuned BiRefNet-lite with a second "slide" output that kept a projected slide whole. That output does not exist in this model, so slides are matted like any other picture. `slide-surface.js` and `assets/slide/` are no longer loaded; `docs/models/slide.md` records how that model was made.
