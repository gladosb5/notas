#!/usr/bin/env python3
"""Prepare and audit OCR dataset manifests without touching a hidden final test.

Manifest rows are JSONL and may contain:
  id, label/normalizedLabel, split, source, source_group, writer, image

The audit detects exact normalized-equation leakage, exact image-byte leakage,
and likely near-duplicate equations across splits.  Near-duplicate candidates
are generated with a scalable SimHash index and then verified with token
Jaccard and sequence similarity.  No label from a final split is ever used to
create recognition rules or model inputs.
"""

from __future__ import annotations

import argparse
import collections
import difflib
import hashlib
import json
import pathlib
from typing import Iterable

from ocr_eval import latex_tokens, normalize_latex


def read_jsonl(path: pathlib.Path) -> list[dict]:
    return [json.loads(x) for x in path.read_text(encoding="utf-8").splitlines() if x.strip()]


def write_jsonl(path: pathlib.Path, rows: Iterable[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(x, ensure_ascii=False, sort_keys=True) + "\n" for x in rows), encoding="utf-8")


def label_of(row: dict) -> str:
    for k in ("normalizedLabel", "label", "latex", "expected"):
        if row.get(k) is not None:
            return str(row[k])
    return ""


def stable_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def token_shingles(label: str, n: int = 3) -> set[str]:
    t = latex_tokens(label)
    if not t: return {""}
    if len(t) < n: return {"\x1f".join(t)}
    return {"\x1f".join(t[i:i+n]) for i in range(len(t)-n+1)}


def simhash64(shingles: set[str]) -> int:
    weights = [0] * 64
    for sh in shingles:
        h = int.from_bytes(hashlib.blake2b(sh.encode("utf-8"), digest_size=8).digest(), "big")
        for bit in range(64):
            weights[bit] += 1 if (h >> bit) & 1 else -1
    out = 0
    for bit, value in enumerate(weights):
        if value >= 0: out |= 1 << bit
    return out


def jaccard(a: set[str], b: set[str]) -> float:
    return len(a & b) / max(1, len(a | b))


def image_sha(row: dict, base: pathlib.Path) -> str | None:
    p = row.get("image")
    if not p: return None
    path = pathlib.Path(p)
    if not path.is_absolute(): path = base / path
    if not path.is_file(): return None
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""): h.update(chunk)
    return h.hexdigest()


def enrich(rows: list[dict], base: pathlib.Path) -> list[dict]:
    out = []
    for row in rows:
        r = dict(row)
        norm = normalize_latex(label_of(r))
        r["normalized_equation"] = norm
        r["equation_sha256"] = stable_hash(norm)
        im = image_sha(r, base)
        if im: r["image_sha256"] = im
        out.append(r)
    return out


def audit(rows: list[dict], near_jaccard: float = 0.82, near_sequence: float = 0.90) -> dict:
    exact_eq = collections.defaultdict(list)
    exact_img = collections.defaultdict(list)
    for i, r in enumerate(rows):
        exact_eq[r["equation_sha256"]].append(i)
        if r.get("image_sha256"): exact_img[r["image_sha256"]].append(i)

    def cross_groups(groups):
        result = []
        for key, idxs in groups.items():
            splits = sorted({str(rows[i].get("split", "")) for i in idxs})
            if len(splits) > 1:
                result.append({"fingerprint": key, "splits": splits,
                               "ids": [rows[i].get("id", i) for i in idxs[:20]], "count": len(idxs)})
        return result

    # Four 16-bit bands give candidates that share at least one large SimHash
    # region, then the expensive reference-independent similarity checks decide.
    shingles = [token_shingles(r["normalized_equation"]) for r in rows]
    sim = [simhash64(s) for s in shingles]
    buckets = collections.defaultdict(list)
    candidates = set()
    for i, h in enumerate(sim):
        for band in range(4):
            key = (band, (h >> (band * 16)) & 0xFFFF)
            for j in buckets[key]:
                if rows[i].get("split") != rows[j].get("split"):
                    candidates.add((j, i))
            buckets[key].append(i)

    near = []
    for i, j in sorted(candidates):
        if rows[i]["equation_sha256"] == rows[j]["equation_sha256"]: continue
        jac = jaccard(shingles[i], shingles[j])
        if jac < near_jaccard: continue
        seq = difflib.SequenceMatcher(None, latex_tokens(rows[i]["normalized_equation"]), latex_tokens(rows[j]["normalized_equation"]), autojunk=False).ratio()
        if seq < near_sequence: continue
        near.append({
            "id_a": rows[i].get("id", i), "split_a": rows[i].get("split"),
            "id_b": rows[j].get("id", j), "split_b": rows[j].get("split"),
            "jaccard": round(jac, 4), "sequence_ratio": round(seq, 4),
            "equation_a": rows[i]["normalized_equation"], "equation_b": rows[j]["normalized_equation"],
        })

    source_groups = collections.defaultdict(set)
    for r in rows:
        g = r.get("source_group") or r.get("writer")
        if g is not None: source_groups[str(g)].add(str(r.get("split", "")))
    group_leaks = [{"source_group": g, "splits": sorted(s)} for g, s in source_groups.items() if len(s) > 1]
    counts = collections.Counter(str(r.get("split", "unspecified")) for r in rows)
    return {
        "rows": len(rows), "split_counts": dict(sorted(counts.items())),
        "cross_split_exact_equations": cross_groups(exact_eq),
        "cross_split_exact_images": cross_groups(exact_img),
        "cross_split_near_equations": near,
        "cross_split_source_groups": group_leaks,
        "pass": not cross_groups(exact_eq) and not cross_groups(exact_img) and not near and not group_leaks,
        "near_duplicate_thresholds": {"token_shingle_jaccard": near_jaccard, "token_sequence_ratio": near_sequence},
    }


def deterministic_split(rows: list[dict], train: float, valid: float, test: float, seed: str) -> list[dict]:
    if abs(train + valid + test - 1.0) > 1e-9: raise ValueError("split fractions must sum to 1")
    grouped = collections.defaultdict(list)
    for r in rows:
        # Prefer a true source/writer group.  Falling back to normalized equation
        # still prevents the same target expression from crossing splits.
        key = str(r.get("source_group") or r.get("writer") or r["equation_sha256"])
        grouped[key].append(r)
    out = []
    for key, group in grouped.items():
        u = int(stable_hash(seed + "\0" + key)[:16], 16) / 2**64
        split = "train" if u < train else "valid" if u < train + valid else "test"
        for row in group:
            r = dict(row); r["split"] = split; out.append(r)
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    sub = ap.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("audit"); a.add_argument("manifest", type=pathlib.Path); a.add_argument("--out", type=pathlib.Path)
    a.add_argument("--near-jaccard", type=float, default=.82); a.add_argument("--near-sequence", type=float, default=.90)
    s = sub.add_parser("split"); s.add_argument("manifest", type=pathlib.Path); s.add_argument("--out", type=pathlib.Path, required=True)
    s.add_argument("--train", type=float, default=.8); s.add_argument("--valid", type=float, default=.1); s.add_argument("--test", type=float, default=.1); s.add_argument("--seed", default="notas-ocr-v1")
    args = ap.parse_args()
    rows = enrich(read_jsonl(args.manifest), args.manifest.parent)
    if args.cmd == "split":
        rows = deterministic_split(rows, args.train, args.valid, args.test, args.seed)
        write_jsonl(args.out, rows)
        print(json.dumps(collections.Counter(r["split"] for r in rows), indent=2))
        return
    report = audit(rows, args.near_jaccard, args.near_sequence)
    text = json.dumps(report, indent=2, ensure_ascii=False) + "\n"
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True); args.out.write_text(text, encoding="utf-8")
    print(json.dumps({k: report[k] for k in ("rows", "split_counts", "pass")}, indent=2))
    print(f"exact equation leaks={len(report['cross_split_exact_equations'])} near={len(report['cross_split_near_equations'])} image={len(report['cross_split_exact_images'])} source-group={len(report['cross_split_source_groups'])}")


if __name__ == "__main__":
    main()
