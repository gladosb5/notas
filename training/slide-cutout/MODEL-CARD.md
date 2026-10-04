# Partial-slide background removal

The image selection action **remove background** runs one BiRefNet-lite model with two outputs: the general foreground matte and a locally fine-tuned slide matte. When the slide output has a confident slide region, the visible slide is kept; otherwise the general matte is used. It automatically trims transparent margins and preserves undo/redo and the background toggle.

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
- Final decoder checkpoint: `slide-decoder.pt`.
- Browser model SHA-256: `f0aef986c20a8bf72c7c6c9534c710ecf2ece4678b42584b91cacf10c81d140c`.
- Browser size: 112,525,748 bytes, divided into six files below static-host per-file limits. Every chunk and the assembled model are SHA-256 checked.

## Browser model (`export_combined.py`)

The fine-tune changes only the last decoder stage, so the backbone and the earlier decoder stages are shared and one pass gives both mattes (outputs `general` and `slide`). The previous app ran two separate 512px graphs, the slide model and then the general one from Hugging Face, and each peaked at about 2.1 GB in ONNX Runtime Web. Most of that came from the decoder's 20 deformable convolutions, which the older export spelled out as gathers and scatters. ONNX Runtime Web 1.24 has no `DeformConv` kernel, so `gs_deform.py` writes each one as bilinear `GridSample` per kernel tap plus 1x1 convolutions, nine taps at a time. In PyTorch it matches torchvision's `deform_conv2d` to float precision, and the exported float graph matches both PyTorch models to about 1e-5. Transformer matmuls are then stored as int8 (dynamic, per channel); convolutions stay fp32.

Measured in the app's runtime (ONNX Runtime Web 1.24.3, Edge, one thread):

| | Download | Peak WebAssembly memory | Time per picture |
| --- | ---: | ---: | ---: |
| Previous: slide model, then general model | 93 + 94 MB | 2,123 MB, then 2,137 MB | 7.8 + 9.1 s |
| This model, both outputs | 107 MB | 855 MB | about 9 s |

Against the float graph on 23 photos (10 COCO, 13 slide crops), int8 flips 0.03% of general-matte pixels (worst 0.20%) and 0.43% of slide-matte pixels (worst 3% on an ordinary photo, 0.77% on a slide), and changes no slide/not-slide decision. Desktop x86 ONNX Runtime without VNNI saturates in its int8 kernels and shows larger differences; `model.json` records those numbers and says so. The real browser tests (`npm run test:slide`, `npm run test:background`) cover the specialized and general paths, downloads, crop and empty-wall handling.

The slide detector, unchanged by this export, also fires on some ordinary close-up photos with a large subject (4 of the 10 COCO photos above: a bear, teddy bears, a person, cats), which then keep most of the picture.

## Reproduce

From the repository root, with Python 3.11, CUDA PyTorch, torchvision, transformers, timm, kornia, einops, numpy, Pillow, onnx, onnxruntime and huggingface_hub installed:

```powershell
py -3.11 training/slide-cutout/prepare_model.py
# Review the downloaded custom model code before the next commands.
py -3.11 training/slide-cutout/train_head.py --images ../finetunedimages
py -3.11 training/slide-cutout/train_decoder.py --images ../finetunedimages
py -3.11 training/slide-cutout/export_combined.py --images ../finetunedimages --output assets/slide
node tests/slide-background.mjs
```

The head experiment generates the masks and manifest consumed by the decoder experiment. Cached features are local training artifacts, excluded from version control. Input-image hashes and split assignments are in `manifest.json`; source photographs are not copied into the repository. The masks can be regenerated from the polygons.

## Slide surface refinement

The browser refines confident slide masks using long straight brightness boundaries in the original image. At least three supported outer edges, agreement with the model foreground, and limited added area are required. This preserves plain slide margins as a solid surface while excluding wall strips. Irregular partial projections without enough supported edges retain the model matte. Dark or low-contrast borders may also retain the original matte. This is geometric post-processing, not another model training run.

A user-provided full-slide photograph exposed holes in plain margins and retained wall below. The cropped photo (without the selection UI) is a regression fixture at `tests/fixtures/projected-slide.png`, with an approximate hand-reviewed outline in `tests/slide-surface-browser.mjs`. It is a development regression example, not an independent test set or an addition to the reported training metrics.
