#!/usr/bin/env python3
"""Leakage-safe mathematical OCR evaluation utilities.

The evaluator deliberately treats the target as transcription, not symbolic
equivalence.  Only insignificant LaTeX spacing and braces around a single
superscript/subscript atom are normalized.  Everything that can change the
mathematical structure remains significant.

Input is JSON or JSONL.  Rows need ``expected`` (or ``latex``/``label``) and
``predicted``.  ``id`` and ``kind``/``category`` are strongly recommended.
Repeated rows with the same id are used to report inference instability.
"""

from __future__ import annotations

import argparse
import collections
import json
import math
import pathlib
import re
from typing import Iterable, Sequence


TOKEN_RE = re.compile(r"\\[A-Za-z]+|\\.|[^\s]")
ASCII_TOKEN_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_]*|\d+(?:\.\d+)?|[^\s]")
STRUCTURAL_COMMANDS = {
    r"\frac", r"\dfrac", r"\tfrac", r"\sqrt", r"\begin", r"\end",
    r"\left", r"\right", r"\limits", r"\nolimits", "{", "}", "^", "_",
    "&", r"\\",
}


def latex_tokens(text: str | None) -> list[str]:
    return TOKEN_RE.findall(str(text or ""))


def normalize_latex(text: str | None) -> str:
    r"""Normalize only presentation-insignificant differences.

    This is intentionally stricter than CAS equivalence.  It does not rewrite
    aliases such as ``\cdot`` and ``\times``, reorder terms, simplify numbers,
    or repair syntax based on the reference answer.
    """
    toks = latex_tokens(text)
    out = " ".join(toks)
    # x^{2} and x^2 are the same unambiguous one-atom script notation.
    atom = r"([^{} ]+|\\[A-Za-z]+)"
    prev = None
    while prev != out:
        prev = out
        out = re.sub(rf"([_^]) \{{ ({atom}) \}}", r"\1 \2", out)
    return out.strip()


def normalize_ascii(text: str | None) -> str:
    """Tokenize notebook ASCII while preserving identifier boundaries."""
    return " ".join(ASCII_TOKEN_RE.findall(str(text or "")))


def edit_distance(a: Sequence[str] | str, b: Sequence[str] | str) -> int:
    """Levenshtein distance with O(min(n,m)) memory."""
    if len(a) < len(b):
        a, b = b, a
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(cur[-1] + 1, prev[j] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def micro_accuracy(pairs: Iterable[tuple[Sequence[str] | str, Sequence[str] | str]]) -> float:
    distance = total = 0
    for expected, predicted in pairs:
        distance += edit_distance(expected, predicted)
        total += max(len(expected), len(predicted))
    return 1.0 if total == 0 else max(0.0, 1.0 - distance / total)


def symbol_tokens(text: str | None) -> list[str]:
    return [t for t in latex_tokens(text) if t not in STRUCTURAL_COMMANDS]


def _balanced_depth(tokens: Sequence[str]) -> tuple[int, bool]:
    depth = best = 0
    ok = True
    for tok in tokens:
        if tok == "{":
            depth += 1
            best = max(best, depth)
        elif tok == "}":
            depth -= 1
            if depth < 0:
                ok = False
                depth = 0
    return best, ok and depth == 0


def structure_signature(text: str | None) -> dict[str, object]:
    """Reference-independent structural signature for a LaTeX expression."""
    t = latex_tokens(text)
    depth, balanced = _balanced_depth(t)
    commands = collections.Counter(x for x in t if x.startswith("\\"))
    frac_count = sum(commands[x] for x in (r"\frac", r"\dfrac", r"\tfrac"))
    envs = []
    for i in range(len(t) - 3):
        if t[i] in (r"\begin", r"\end") and t[i + 1] == "{" and t[i + 3] == "}":
            envs.append((t[i], t[i + 2]))
    bracket_counts = collections.Counter(x for x in t if x in "()[]{}")
    return {
        "frac": frac_count,
        "sqrt": commands[r"\sqrt"],
        "sup": t.count("^"),
        "sub": t.count("_"),
        "int": commands[r"\int"] + commands[r"\iint"] + commands[r"\iiint"] + commands[r"\oint"],
        "sum": commands[r"\sum"],
        "prod": commands[r"\prod"],
        "lim": commands[r"\lim"],
        "max_group_depth": depth,
        "balanced_groups": balanced,
        "envs": envs,
        "brackets": dict(sorted(bracket_counts.items())),
        "linebreaks": t.count(r"\\"),
        "align_tabs": t.count("&"),
    }


def infer_categories(text: str | None) -> set[str]:
    s = str(text or "")
    t = latex_tokens(s)
    cats: set[str] = set()
    frac = sum(t.count(x) for x in (r"\frac", r"\dfrac", r"\tfrac"))
    if frac:
        cats.add("fraction")
        if frac > 1 or re.search(r"\\(?:d?frac|tfrac)\s*\{[^{}]*\\(?:d?frac|tfrac)", s):
            cats.add("nested_fraction")
    if "^" in t: cats.add("superscript")
    if "_" in t: cats.add("subscript")
    if r"\sqrt" in t:
        cats.add("root")
        if "[" in t: cats.add("nth_root")
    if any(x in t for x in (r"\int", r"\iint", r"\iiint", r"\oint")): cats.add("integral")
    if r"\sum" in t: cats.add("summation")
    if r"\prod" in t: cats.add("product")
    if r"\lim" in t: cats.add("limit")
    if any(x in t for x in (r"\sin", r"\cos", r"\tan", r"\cot", r"\sec", r"\csc")): cats.add("trigonometric")
    if any(x in t for x in (r"\log", r"\ln", r"\lg")): cats.add("logarithm")
    greek = {r"\alpha",r"\beta",r"\gamma",r"\delta",r"\epsilon",r"\varepsilon",r"\zeta",r"\eta",r"\theta",r"\vartheta",r"\iota",r"\kappa",r"\lambda",r"\mu",r"\nu",r"\xi",r"\pi",r"\rho",r"\sigma",r"\tau",r"\upsilon",r"\phi",r"\varphi",r"\chi",r"\psi",r"\omega",r"\Gamma",r"\Delta",r"\Theta",r"\Lambda",r"\Xi",r"\Pi",r"\Sigma",r"\Phi",r"\Psi",r"\Omega"}
    if greek.intersection(t): cats.add("greek")
    if any(x in t for x in (r"\in",r"\notin",r"\subset",r"\subseteq",r"\supset",r"\cup",r"\cap",r"\emptyset",r"\mathbb")): cats.add("sets")
    if any(x in t for x in ("<", ">", r"\le", r"\leq", r"\ge", r"\geq", r"\neq")): cats.add("inequality")
    if any(x in s for x in ("(",")","[","]",r"\left",r"\right")): cats.add("brackets")
    if any(env in s for env in ("matrix", "pmatrix", "bmatrix", "vmatrix", "Vmatrix")): cats.add("matrix")
    if any(env in s for env in ("cases", "piecewise")): cats.add("piecewise")
    if r"\\" in t or any(env in s for env in ("aligned", "gathered", "split", "multline")): cats.add("multiline")
    if any(x in t for x in (r"\partial", r"\mathrm", r"\operatorname")) or "dx" in s or "dy" in s:
        cats.add("calculus_notation")
    if len(t) >= 50: cats.add("long")
    if len(t) >= 80 or (len(t) >= 40 and max(structure_signature(s)["max_group_depth"], 0) >= 4): cats.add("dense")
    plain = re.sub(r"\\[A-Za-z]+", " ", s)
    without_functions = re.sub(
        r"\b(?:sin|cos|tan|cot|sec|csc|log|ln|lg|exp|sqrt|pi)\b",
        " ", plain, flags=re.I,
    )
    if re.search(r"\b[A-Za-z_][A-Za-z0-9_]{1,31}\b", without_functions): cats.add("named_variable")
    if not re.search(r"[A-Za-z\\]", s) and re.search(r"\d", s) and re.search(r"[=+*/-]", s): cats.add("arithmetic")
    if re.search(r"(^|[=(,+*/])\s*-\s*[A-Za-z0-9]", s): cats.add("negative")
    if re.search(r"[A-Za-z0-9})]\s*/\s*[A-Za-z0-9({]", s): cats.add("fraction")
    if not cats: cats.add("simple_or_other")
    return cats


def _derived_categories(row: dict, expected: str) -> set[str]:
    """Derive scored categories from the reference and measured page context."""
    categories = infer_categories(expected)
    context = row.get("context") if isinstance(row.get("context"), dict) else {}
    if context.get("isolated") is True:
        categories.add("isolated")
    if context.get("crowded") is True:
        categories.add("crowded")
    return categories


def _aggregate_by_base(rows: list[dict], success_key: str) -> dict:
    """Collapse repeats and augmentations sharing a base handwriting sample."""
    groups: dict[str, list[dict]] = collections.defaultdict(list)
    for row in rows:
        groups[row["base_id"]].append(row)
    successes = sum(all(item[success_key] for item in group) for group in groups.values())
    n = len(groups)
    return {"n": n, "exact": successes, "exact_match": successes / n if n else None, "attempts": len(rows)}


def _evidence_counts(rows: list[dict]) -> dict:
    """Report handwriting diversity without treating missing provenance as evidence."""
    bases = {row["base_id"] for row in rows}
    sources = {row["source"] for row in rows if row["source"]}
    writers = {(row["source"], row["writer_id"]) for row in rows if row["writer_id"]}
    notes = {(row["source"], row["source_note_id"]) for row in rows if row["source_note_id"]}
    units = {
        (row["source"], row["writer_id"], row["source_note_id"], row["base_id"])
        for row in rows if row["source"] and row["writer_id"] and row["source_note_id"]
    }
    complete = {
        row["base_id"] for row in rows
        if row["source"] and row["writer_id"] and row["source_note_id"]
    }
    return {
        "base_samples": len(bases),
        "sources": len(sources),
        "writers": len(writers),
        "source_notes": len(notes),
        "independent_units": len(units),
        "complete_provenance_bases": len(complete),
    }


def _row_expected(row: dict) -> str:
    for key in ("expected", "latex", "label", "normalizedLabel"):
        if key in row and row[key] is not None:
            return str(row[key])
    raise KeyError("row has no expected/latex/label/normalizedLabel")


def load_rows(path: pathlib.Path) -> list[dict]:
    text = path.read_text(encoding="utf-8")
    if path.suffix.lower() == ".jsonl":
        return [json.loads(line) for line in text.splitlines() if line.strip()]
    obj = json.loads(text)
    if isinstance(obj, list):
        return obj
    for key in ("rows", "results", "samples"):
        if isinstance(obj.get(key), list):
            return obj[key]
    raise ValueError(f"Cannot find row array in {path}")


def evaluate(rows: list[dict]) -> dict:
    cooked = []
    by_id: dict[str, list[str]] = collections.defaultdict(list)
    references = {}
    base_references = {}
    for n, row in enumerate(rows):
        exp = _row_expected(row)
        pred = str(row.get("predicted", row.get("prediction", row.get("latex_pred", ""))) or "")
        # Notebook ASCII identifiers are semantic: hi and h i are different.
        # LaTeX's whitespace convention must not hide that app-level error.
        ascii_mode = row.get("format") == "ascii"
        ne, np = (normalize_ascii(exp), normalize_ascii(pred)) if ascii_mode else (normalize_latex(exp), normalize_latex(pred))
        categories = _derived_categories(row, exp)
        declared_categories = set(row.get("categories") or [])
        if row.get("kind"): declared_categories.add(str(row["kind"]))
        if row.get("category"): declared_categories.add(str(row["category"]))
        failed = bool(row.get("error")) or row.get("truncated") is True or row.get("terminated") is False
        transcription_exact = ne == np and not failed
        segmentation_measured = row.get("input_type") == "strokes" and row.get("segmentation_measured") is True
        segmentation_exact = segmentation_measured and row.get("segmentation_exact") is True
        notebook_exact = segmentation_measured and segmentation_exact and transcription_exact
        struct = structure_signature(exp) == structure_signature(pred)
        rid = str(row.get("id", n))
        base_id = str(row.get("base_id", rid))
        ref_key = ("ascii" if ascii_mode else "latex", ne)
        if rid in references and references[rid] != ne:
            raise ValueError(f"Conflicting expected transcription for repeated id {rid}")
        references[rid] = ne
        if base_id in base_references and base_references[base_id] != ref_key:
            raise ValueError(f"Conflicting expected transcription for base_id {base_id}")
        base_references[base_id] = ref_key
        by_id[rid].append(np)
        cooked.append({"id": rid, "expected": exp, "predicted": pred, "ne": ne, "np": np,
                       "transcription_exact": transcription_exact, "notebook_exact": notebook_exact,
                       "segmentation_exact": segmentation_exact, "segmentation_measured": segmentation_measured,
                       "structural": struct, "categories": sorted(categories),
                       "declared_categories": sorted(declared_categories), "error": row.get("error"), "failed": failed,
                       "base_id": base_id, "source": row.get("source"), "writer_id": row.get("writer_id"),
                       "source_note_id": row.get("source_note_id"), "input_type": row.get("input_type")})

    n = len(cooked)
    exact_n = sum(x["transcription_exact"] for x in cooked)
    struct_n = sum(x["structural"] for x in cooked)
    char_acc = micro_accuracy((x["ne"], x["np"]) for x in cooked)
    token_acc = micro_accuracy((latex_tokens(x["expected"]), latex_tokens(x["predicted"])) for x in cooked)
    symbol_acc = micro_accuracy((symbol_tokens(x["expected"]), symbol_tokens(x["predicted"])) for x in cooked)

    cats = sorted({c for row in cooked for c in row["categories"]})
    by_category = {}
    for cat in cats:
        subset = [x for x in cooked if cat in x["categories"]]
        count = len(subset)
        aggregate = _aggregate_by_base(subset, "transcription_exact")
        st = sum(x["structural"] for x in subset)
        notebook_subset = [x for x in subset if x["segmentation_measured"]]
        notebook_aggregate = _aggregate_by_base(notebook_subset, "notebook_exact")
        by_category[cat] = {
            **aggregate,
            "failure_rate": 1 - aggregate["exact_match"] if aggregate["exact_match"] is not None else None,
            "structural_accuracy": st / count if count else None,
            "token_accuracy": micro_accuracy((latex_tokens(x["expected"]), latex_tokens(x["predicted"])) for x in subset),
            "notebook_n": notebook_aggregate["n"],
            "notebook_exact": notebook_aggregate["exact"],
            "notebook_exact_match": notebook_aggregate["exact_match"],
            "evidence": _evidence_counts(subset),
        }

    repeated = {k: v for k, v in by_id.items() if len(v) > 1}
    unstable = {k: v for k, v in repeated.items() if len(set(v)) > 1}
    repeat_stats = {
        "ids_with_repeats": len(repeated),
        "unstable_ids": len(unstable),
        "stable_fraction": (1 - len(unstable) / len(repeated)) if repeated else None,
        "unstable_examples": dict(list(unstable.items())[:50]),
    }
    # Repeated inference is not new independent handwriting. Count one success
    # only when every attempt for that sample succeeds; never inflate the CI
    # by rerunning the same easy examples hundreds of times.
    independent = _aggregate_by_base(cooked, "transcription_exact")
    unique_n, unique_exact = independent["n"], independent["exact"]
    interval = None
    if unique_n:
        z = 1.959963984540054
        p = unique_exact / unique_n
        denominator = 1 + z*z/unique_n
        centre = (p + z*z/(2*unique_n))/denominator
        radius = z*math.sqrt(p*(1-p)/unique_n + z*z/(4*unique_n**2))/denominator
        interval = [max(0., centre-radius), min(1., centre+radius)]
    paired = []
    for base_id in sorted({x["base_id"] for x in cooked}):
        clean = [x for x in cooked if x["base_id"] == base_id and "isolated" in x["categories"] and x["segmentation_measured"]]
        crowded = [x for x in cooked if x["base_id"] == base_id and "crowded" in x["categories"] and x["segmentation_measured"]]
        if clean and crowded:
            paired.append({"base_id": base_id, "isolated_correct": all(x["notebook_exact"] for x in clean),
                           "crowded_correct": all(x["notebook_exact"] for x in crowded),
                           "same_transcription": {x["np"] for x in clean} == {x["np"] for x in crowded}})

    notebook_rows = [x for x in cooked if x["segmentation_measured"]]
    segmentation = _aggregate_by_base(notebook_rows, "segmentation_exact")
    notebook = _aggregate_by_base(notebook_rows, "notebook_exact")

    return {
        "protocol": {
            "primary_metric": "normalized exact transcription match",
            "normalization": "LaTeX token spacing ignored; braces around one-atom superscripts/subscripts ignored; no mathematical-equivalence rewriting",
            "character_accuracy": "micro 1-normalized Levenshtein on normalized LaTeX text",
            "token_accuracy": "micro 1-normalized Levenshtein on LaTeX tokens",
            "symbol_accuracy": "micro token accuracy excluding structural/grouping tokens",
            "structural_accuracy": "exact match of reference-independent structure signature",
            "ascii": "set format=ascii for notebook readings; multi-letter identifiers are indivisible tokens",
            "interval": "95% Wilson interval over independent base samples; repeats and augmentations sharing base_id must all succeed",
            "categories": "scored categories are derived from expected transcription and measured page context; declared labels do not create scored evidence",
            "notebook": "notebook exact requires input_type=strokes, segmentation_measured=true, exact target segmentation, and exact transcription; image crops never qualify",
        },
        "overall": {
            "n": n,
            "exact": exact_n,
            "exact_match": exact_n / n if n else None,
            "character_accuracy": char_acc,
            "token_accuracy": token_acc,
            "symbol_accuracy": symbol_acc,
            "structural_accuracy": struct_n / n if n else None,
            "inference_failures": sum(x["failed"] for x in cooked),
            "segmentation_failures": sum(x["segmentation_measured"] and not x["segmentation_exact"] for x in cooked),
            "unique_samples": unique_n,
            "unique_reliably_exact": unique_exact,
            "unique_exact_wilson95": interval,
            "independent_exact_match": independent["exact_match"],
        },
        "transcription": {**independent, "evidence": _evidence_counts(cooked)},
        "segmentation": {**segmentation, "evidence": _evidence_counts(notebook_rows)},
        "notebook": {**notebook, "evidence": _evidence_counts(notebook_rows)},
        "by_category": by_category,
        "category_macro_exact": sum(c["exact_match"] for c in by_category.values()) / len(by_category) if by_category else None,
        "worst_category_exact": min((c["exact_match"] for c in by_category.values()), default=None),
        "crowding_pairs": {"n": len(paired), "regressions": sum(x["isolated_correct"] and not x["crowded_correct"] for x in paired), "pairs": paired},
        "repeat_stability": repeat_stats,
        "failures": [
            {"id": x["id"], "expected": x["expected"], "predicted": x["predicted"], "categories": x["categories"],
             "declared_categories": x["declared_categories"], "error": x["error"],
             "segmentation_exact": x["segmentation_exact"] if x["segmentation_measured"] else None}
            for x in cooked if not x["transcription_exact"]
        ],
        "notebook_failures": [
            {"id": x["id"], "base_id": x["base_id"], "expected": x["expected"], "predicted": x["predicted"],
             "categories": x["categories"], "error": x["error"], "segmentation_exact": x["segmentation_exact"]}
            for x in notebook_rows if not x["notebook_exact"]
        ],
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("input", type=pathlib.Path)
    ap.add_argument("--out", type=pathlib.Path)
    args = ap.parse_args()
    report = evaluate(load_rows(args.input))
    text = json.dumps(report, indent=2, ensure_ascii=False) + "\n"
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(text, encoding="utf-8")
    print(json.dumps(report["overall"], indent=2))
    print(json.dumps(report["repeat_stability"], indent=2))


if __name__ == "__main__":
    main()
