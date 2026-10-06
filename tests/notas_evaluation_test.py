import copy
import importlib.util
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location('audit',Path(__file__).resolve().parents[1]/'scripts/audit-notas-evaluation.py')
audit=importlib.util.module_from_spec(spec);spec.loader.exec_module(audit)

def example():
    return {'schema':'notas-ocr-eval-v1','id':'example','source_sha256':'source','writer':'writer','session':'session','split':'development','usage':'evaluation_only','expected':'x','strokes':[{'author':'user','pts':[0,0,.5,2,3,.5],'w':2,'t0':1,'t1':2,'times':[0,1]}]}

class AuditTests(unittest.TestCase):
    def test_missing_timing_is_reported(self):
        row=example();del row['strokes'][0]['times']
        self.assertEqual(audit.validate([row])['strokes_without_recorded_times'],1)

    def test_reject_transformed_duplicate(self):
        row=example();other=copy.deepcopy(row);other['id']='other';other['strokes'][0]['pts']=[10,20,.4,14,26,.7]
        with self.assertRaisesRegex(ValueError,'Duplicate ink'):audit.validate([row,other])

    def test_reject_training_writer_overlap(self):
        row=example();train=copy.deepcopy(row);train['id']='other';train['source_sha256']='elsewhere';train['strokes'][0]['pts']=[0,0,.5,3,1,.5]
        with self.assertRaisesRegex(ValueError,'overlap'):audit.validate([row],[train])

    def test_reject_bad_timing(self):
        row=example();row['strokes'][0]['times']=[2,1]
        with self.assertRaisesRegex(ValueError,'timing'):audit.validate([row])

    def test_reject_training_eligible_row(self):
        row=example();row['usage']='training'
        with self.assertRaisesRegex(ValueError,'evaluation-only'):audit.validate([row])

if __name__=='__main__':unittest.main()
