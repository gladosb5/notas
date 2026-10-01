# Partial-slide background removal

The image selection action **remove background** first checks a locally fine-tuned BiRefNet-lite model for a confident slide region. It retains the visible slide when detected and otherwise uses the general foreground model. It automatically trims transparent margins and preserves undo/redo and the background toggle. A missing or failed slide model falls back to the general model.

## Training data and limits

The supplied `finetunedimages` folder contains 97 images, all 512 × 512 crops. We used 94: 25 crops containing visible projected content and 69 negative crops. Three ambiguous images (2036, 2037 and 2971) were excluded. `labels.json` contains approximate polygons drawn by the agent after visual inspection, not independently reviewed ground truth. The target includes the visible projection and projected application chrome, but excludes walls, projector hardware and occlusions.

Nearby filename ranges were kept together: 55 training images, 26 validation images and 13 test images. This is a proxy for capture sessions; actual capture metadata was unavailable. It does not rule out similar-scene leakage. The test set has six positives and seven negatives. Validation selected epoch 15; the test set did not select the checkpoint.

| Set | Positive mean IoU | Mean fraction retained on negative images |
| --- | ---: | ---: |
| Training | 90.9% | 0.08% |
| Validation | 98.7% | 5.56% |
| Test | 78.3% | 0% |

IoU measures predicted/labelled mask overlap, not classification accuracy. These are full-resolution-model predictions measured at 128 × 128 against the approximate labels. Test overlap ranges from 50.8% to 98.2% across the six positive crops. Some validation negatives, especially projector hardware, produce false positives.

**This set is too small and too narrow to establish full-slide generalization.** It contains no complete slide photographs. More varied rooms, screen borders, dark slides, bright walls, obstructions and independently reviewed masks are needed for that claim. Automatic routing uses minimum foreground area, confidence and mask coverage checks. These checks reduce scattered false positives but do not establish full-slide generalization or perfect image classification.

## Method and provenance

The first experiment trained only the existing final 1 × 1 segmentation head and performed poorly (`head-report.json`). The shipped experiment fine-tunes the final decoder block, final RGB input block and output head; the backbone and earlier decoder stay frozen. Training uses the original pretrained features, horizontally flipped examples, BCE plus Dice loss, and validation checkpoint selection.

- Base PyTorch model: [ZhengPeng7/BiRefNet_lite](https://huggingface.co/ZhengPeng7/BiRefNet_lite), revision `aa62cd87eafb9cc43056d08ef3615a14628b831d`.
- Browser graph: [studioludens/birefnet-lite-512](https://huggingface.co/studioludens/birefnet-lite-512), revision `4a3c40c36c94093cc1e724d9ea428b8fa4b57dc7`.
- Final decoder checkpoint: `slide-decoder.pt`.
- Browser model SHA-256: `733e4362eb1bf402500ebc0e004432545a5167ac90d327293b7b6b98c2906b2b`.
- Browser size: 97,338,225 bytes, divided into five files below static-host per-file limits. Every chunk and the assembled model are SHA-256 checked.

Export transfers the trained parameters and recomputed batch-normalization folds into the existing ONNX graph, then converts weights to fp16. Three PyTorch/ONNX comparisons include a held-out positive and a wall-only negative; binary-mask disagreement was below 0.05%. This is an export correctness check, separate from segmentation quality. A real browser check also verifies the specialized worker, downloads, crop and empty-wall handling.

## Reproduce

From the repository root, with Python 3.11, CUDA PyTorch, torchvision, transformers, timm, kornia, einops, numpy, Pillow, onnx, onnxruntime and huggingface_hub installed:

```powershell
py -3.11 training/slide-cutout/prepare_model.py
# Review the downloaded custom model code before the next commands.
py -3.11 training/slide-cutout/train_head.py --images ../finetunedimages
py -3.11 training/slide-cutout/train_decoder.py --images ../finetunedimages
py -3.11 training/slide-cutout/export_browser.py --images ../finetunedimages --output assets/slide
node tests/slide-background.mjs
```

The head experiment generates the masks and manifest consumed by the decoder experiment. Cached features are local training artifacts, excluded from version control. Input-image hashes and split assignments are in `manifest.json`; source photographs are not copied into the repository. The masks can be regenerated from the polygons.

## Slide surface refinement

The browser refines confident slide masks using long straight brightness boundaries in the original image. At least three supported outer edges, agreement with the model foreground, and limited added area are required. This preserves plain slide margins as a solid surface while excluding wall strips. Irregular partial projections without enough supported edges retain the model matte. Dark or low-contrast borders may also retain the original matte. This is geometric post-processing, not another model training run.

A user-provided full-slide photograph exposed holes in plain margins and retained wall below. The cropped photo (without the selection UI) is a regression fixture at `tests/fixtures/projected-slide.png`, with an approximate hand-reviewed outline in `tests/slide-surface-browser.mjs`. It is a development regression example, not an independent test set or an addition to the reported training metrics.
