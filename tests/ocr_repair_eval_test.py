import importlib.util
from pathlib import Path
import sys
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
spec=importlib.util.spec_from_file_location('compare_repair',Path(__file__).resolve().parents[1]/'scripts/compare-ocr-repair.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class PairedMetricsTest(unittest.TestCase):
    def row(self,**kw):
        return dict(id='a',expected='1+2',predicted='1+2',format='latex',kind='isolated',segmentation_exact=True,error=None,ms=1,automatic_eligible=True,**kw)
    def test_abstention_does_not_count_as_transcription_gain(self):
        before=self.row();after={**before,'automatic_eligible':False}
        wrap=lambda row:dict(corpus_sha256='x',sample_hashes={'a':'x'},rows=[row])
        result=m.compare(wrap(before),wrap(after))['cohorts']['isolated']
        self.assertEqual(result['gains'],0)
        self.assertEqual(result['after']['exact_rate'],1)
        self.assertIsNone(result['after']['accepted_precision'])
    def test_wrong_grouping_fails_even_when_text_matches(self):
        self.assertFalse(m.exact({**self.row(),'segmentation_exact':False}))
    def test_brackets_and_signs_are_not_normalized_away(self):
        self.assertFalse(m.exact({**self.row(),'expected':'(x-y)/2','predicted':'x-y/2'}))
    def test_duplicate_attempts_cannot_inflate_sample_count(self):
        data=dict(corpus_sha256='x',sample_hashes={'a':'x'},rows=[self.row(),self.row()])
        with self.assertRaises(ValueError):m.compare(data,data)
    def test_different_inputs_are_rejected(self):
        a=dict(corpus_sha256='x',sample_hashes={'a':'x'},rows=[self.row()])
        with self.assertRaises(ValueError):m.compare(a,{**a,'corpus_sha256':'y'})

if __name__=='__main__':unittest.main()
