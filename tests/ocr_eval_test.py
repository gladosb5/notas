import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from ocr_eval import evaluate, infer_categories, normalize_latex, structure_signature


class OcrEvaluationTests(unittest.TestCase):
    def test_normalization_is_strict_but_ignores_spacing_and_atomic_script_braces(self):
        self.assertEqual(normalize_latex(r"x ^ { 2 } + \frac { a } { b }"), normalize_latex(r"x^2+\frac{a}{b}"))
        self.assertNotEqual(normalize_latex(r"x+1"), normalize_latex(r"1+x"))
        self.assertNotEqual(normalize_latex(r"a\cdot b"), normalize_latex(r"a\times b"))

    def test_structure_is_reference_independent(self):
        self.assertEqual(structure_signature(r"\frac{x^2}{y_1}"), structure_signature(r"\frac{a^b}{c_d}"))
        self.assertNotEqual(structure_signature(r"x/y"), structure_signature(r"\frac{x}{y}"))

    def test_categories(self):
        cats = infer_categories(r"\sum_{i=1}^{n}\frac{\alpha_i}{\sqrt{x_i}}")
        for expected in ("summation", "fraction", "greek", "root", "subscript", "superscript"):
            self.assertIn(expected, cats)

    def test_repeat_instability(self):
        report = evaluate([
            {"id": "a", "expected": "x+1", "predicted": "x+1"},
            {"id": "a", "expected": "x+1", "predicted": "x-1"},
            {"id": "b", "expected": "y", "predicted": "y"},
            {"id": "b", "expected": "y", "predicted": "y"},
        ])
        self.assertEqual(report["repeat_stability"]["ids_with_repeats"], 2)
        self.assertEqual(report["repeat_stability"]["unstable_ids"], 1)

    def test_failures_and_crowding_cannot_be_hidden_by_correct_text(self):
        rows = [
            {"id": "clean", "base_id": "a", "input_type": "strokes", "segmentation_measured": True,
             "context": {"isolated": True}, "expected": "61+1=", "predicted": "61+1=", "segmentation_exact": True},
            {"id": "crowded", "base_id": "a", "input_type": "strokes", "segmentation_measured": True,
             "context": {"crowded": True}, "expected": "61+1=", "predicted": "61+1=", "segmentation_exact": False},
            {"id": "timeout", "expected": "", "predicted": "", "error": "timeout"},
        ]
        out = evaluate(rows)
        self.assertEqual(out["overall"]["exact"], 2)
        self.assertEqual(out["transcription"]["exact"], 1)
        self.assertEqual(out["segmentation"]["exact"], 0)
        self.assertEqual(out["notebook"]["exact"], 0)
        self.assertEqual(out["overall"]["inference_failures"], 1)
        self.assertEqual(out["crowding_pairs"]["regressions"], 1)

    def test_named_variables_are_not_whitespace_equivalent_in_notebook(self):
        out = evaluate([{"id": "a", "format": "ascii", "expected": "hi=4", "predicted": "h i = 4"}])
        self.assertEqual(out["overall"]["exact"], 0)

    def test_repeats_do_not_inflate_evidence(self):
        row = {"id": "a", "expected": "x=4", "predicted": "x=4"}
        once, repeated = evaluate([row]), evaluate([row]*100)
        self.assertEqual(repeated["overall"]["unique_samples"], 1)
        self.assertEqual(once["overall"]["unique_exact_wilson95"], repeated["overall"]["unique_exact_wilson95"])
        with self.assertRaises(ValueError):
            evaluate([row, {**row, "expected": "x=5"}])

    def test_augmentations_share_one_base_and_all_attempts_must_succeed(self):
        rows = [
            {"id": "a-clean", "base_id": "ink-a", "expected": "x=4", "predicted": "x=4"},
            {"id": "a-warp", "base_id": "ink-a", "expected": "x=4", "predicted": "x=9"},
        ]
        out = evaluate(rows)
        self.assertEqual(out["transcription"]["n"], 1)
        self.assertEqual(out["transcription"]["attempts"], 2)
        self.assertEqual(out["transcription"]["exact"], 0)
        with self.assertRaises(ValueError):
            evaluate([rows[0], {**rows[1], "expected": "y=4"}])

    def test_declared_categories_cannot_create_scored_category_evidence(self):
        out = evaluate([{
            "id": "fake", "categories": ["fraction", "crowded"],
            "expected": "2+2=4", "predicted": "2+2=4",
        }])
        self.assertIn("arithmetic", out["by_category"])
        self.assertNotIn("fraction", out["by_category"])
        self.assertNotIn("crowded", out["by_category"])

    def test_image_crop_never_counts_as_notebook_exact(self):
        out = evaluate([{
            "id": "crop", "base_id": "crop", "input_type": "image",
            "segmentation_measured": True, "segmentation_exact": True,
            "expected": "Pens=3", "predicted": "Pens=3", "format": "ascii",
        }])
        self.assertEqual(out["transcription"]["exact"], 1)
        self.assertEqual(out["segmentation"]["n"], 0)
        self.assertEqual(out["notebook"]["n"], 0)

    def test_evidence_counts_distinct_bases_sources_writers_and_notes(self):
        rows = [
            {"id": "a1", "base_id": "a", "source": "set", "writer_id": "w1", "source_note_id": "n1", "expected": "x", "predicted": "x"},
            {"id": "a2", "base_id": "a", "source": "set", "writer_id": "w1", "source_note_id": "n1", "expected": "x", "predicted": "x"},
            {"id": "b", "base_id": "b", "source": "set", "writer_id": "w2", "source_note_id": "n2", "expected": "y", "predicted": "y"},
        ]
        evidence = evaluate(rows)["transcription"]["evidence"]
        self.assertEqual(evidence["base_samples"], 2)
        self.assertEqual(evidence["sources"], 1)
        self.assertEqual(evidence["writers"], 2)
        self.assertEqual(evidence["source_notes"], 2)
        self.assertEqual(evidence["independent_units"], 2)
        self.assertEqual(evidence["complete_provenance_bases"], 2)


if __name__ == "__main__":
    unittest.main()
