# PP-OCRv6 handwritten-text search model

Notas uses the PP-OCRv6 small recognition model only to create hidden local
search transcripts for handwriting. Its output is not used to replace ink or
to evaluate maths.

Upstream project: PaddlePaddle/PaddleOCR

Model: `PP-OCRv6_small_rec_onnx`

Configuration: `configs/rec/PP-OCRv6/PP-OCRv6_small_rec.yml`

Dictionary: `ppocr/utils/dict/ppocrv6_dict.txt`

License: Apache License 2.0. PaddleOCR source files and the PP-OCRv6 model are
distributed under Apache-2.0.

Checked-in artifact hashes:

- `ppocrv6-small.onnx` SHA-256
  `5435fd747c9e0efe15a96d0b378d5bd157e9492ed8fd80edf08f30d02fa24634`
- `ppocrv6_dict.txt` SHA-256
  `b5f2bfe2bdd9448429e3e82b51c789775d9b42f2403d082b00662eb77e401c5d`

The runtime preprocessing follows PaddleOCR recognition preprocessing:
48-pixel input height, dynamic width, BGR channels, normalization to `[-1,1]`,
and CTC decoding with a blank class plus a literal space character.
