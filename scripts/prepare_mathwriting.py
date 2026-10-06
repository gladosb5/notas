#!/usr/bin/env python3
"""Convert MathWriting InkML to deterministic raster OCR corpora.

The converter never changes split membership. It can prepare train/valid/test,
but the benchmark protocol in docs/OCR-EVALUATION.md forbids running inference
on test until the candidate has been frozen. Test labels may be read by the
separate leakage audit because contamination checks necessarily require them.

Rendering uses the dataset's recommended round radius of 1.5 coordinate units,
adds a fixed source-space margin, and rasterizes at 2x before Lanczos downsample
for stable antialiasing. Coordinates are not normalized across writers/devices.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import xml.etree.ElementTree as ET

from PIL import Image, ImageDraw

NS = {"i": "http://www.w3.org/2003/InkML"}


def parse(path: pathlib.Path) -> tuple[dict[str, str], list[list[tuple[float, float]]]]:
    root = ET.parse(path).getroot()
    annotations = {}
    for item in root.findall("i:annotation", NS):
        annotations[item.attrib.get("type", "")] = item.text or ""
    traces = []
    for node in root.findall("i:trace", NS):
        pts = []
        for raw in (node.text or "").split(","):
            parts = raw.strip().split()
            if len(parts) >= 2:
                pts.append((float(parts[0]), float(parts[1])))
        if pts:
            traces.append(pts)
    return annotations, traces


def render(traces: list[list[tuple[float, float]]], out: pathlib.Path, margin: float = 10.0) -> tuple[int, int]:
    points = [p for trace in traces for p in trace]
    if not points:
        raise ValueError("Ink has no trace points")
    x0 = min(p[0] for p in points) - margin
    y0 = min(p[1] for p in points) - margin
    x1 = max(p[0] for p in points) + margin
    y1 = max(p[1] for p in points) + margin
    width = max(4, int(round(x1 - x0 + 1)))
    height = max(4, int(round(y1 - y0 + 1)))
    aa = 2
    image = Image.new("L", (width * aa, height * aa), 255)
    draw = ImageDraw.Draw(image)
    stroke_width = max(1, int(round(3.0 * aa)))
    for trace in traces:
        pts = [((x - x0) * aa, (y - y0) * aa) for x, y in trace]
        if len(pts) == 1:
            x, y = pts[0]
            r = 1.5 * aa
            draw.ellipse((x - r, y - r, x + r, y + r), fill=0)
        else:
            draw.line(pts, fill=0, width=stroke_width, joint="curve")
            r = 1.5 * aa
            for x, y in (pts[0], pts[-1]):
                draw.ellipse((x - r, y - r, x + r, y + r), fill=0)
    image = image.resize((width, height), Image.Resampling.LANCZOS).convert("RGB")
    out.parent.mkdir(parents=True, exist_ok=True)
    image.save(out, format="PNG", optimize=True)
    return image.size


def sha256(path: pathlib.Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("source", type=pathlib.Path, help="Extracted mathwriting-2024(-excerpt) directory")
    ap.add_argument("--out", type=pathlib.Path, default=pathlib.Path("experiments/ocr-quality/mathwriting"))
    ap.add_argument("--splits", default="train,valid,test", help="Comma-separated split names")
    args = ap.parse_args()
    splits = [s.strip() for s in args.splits.split(",") if s.strip()]
    manifest = []
    corpora = {s: [] for s in splits}
    for split in splits:
        for ink in sorted((args.source / split).glob("*.inkml")):
            ann, traces = parse(ink)
            sample_id = ann.get("sampleId") or ink.stem
            expected_split = ann.get("splitTagOriginal") or split
            if expected_split != split:
                raise ValueError(f"Split mismatch for {ink}: directory={split!r}, annotation={expected_split!r}")
            label = ann.get("normalizedLabel") or ann.get("label")
            if not label:
                raise ValueError(f"Missing label in {ink}")
            png = args.out / split / f"{sample_id}.png"
            w, h = render(traces, png)
            row = {
                "id": sample_id,
                "split": split,
                "label": label,
                "normalizedLabel": label,
                "image": str(png.resolve()),
                "source": "MathWriting 2024",
                "ink_creation_method": ann.get("inkCreationMethod"),
                "width": w,
                "height": h,
                "image_sha256": sha256(png),
                "inkml_sha256": sha256(ink),
            }
            manifest.append(row)
            # Paths in this corpus are absolute so the existing native benchmark
            # can consume it without copying data into its experiment directory.
            corpora[split].append({
                "id": sample_id,
                "kind": f"mathwriting-{split}",
                "latex": label,
                "image": str(png.resolve()),
                "width": w,
                "height": h,
                "sha256": row["image_sha256"],
            })
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "manifest.jsonl").write_text(
        "".join(json.dumps(r, ensure_ascii=False, sort_keys=True) + "\n" for r in manifest), encoding="utf-8"
    )
    for split, samples in corpora.items():
        (args.out / f"{split}-corpus.json").write_text(
            json.dumps({"source": "MathWriting 2024", "split": split, "samples": samples}, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
    print(json.dumps({s: len(corpora[s]) for s in splits}, indent=2))


if __name__ == "__main__":
    main()
