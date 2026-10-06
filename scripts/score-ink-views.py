"""Compare fixed sampling-density policies on a development corpus."""
import json
import sys
from collections import Counter
from ocr_eval import normalize_latex as norm

data = json.load(open(sys.argv[1], encoding='utf-8'))
counts = Counter()
changes = []
for row in data['rows']:
    views = row.get('views', [])
    if not views:
        continue
    good = [v for v in views if v.get('terminated') and not v.get('truncated') and v.get('latex')]
    base = views[0]
    votes = Counter(norm(v['latex']) for v in good)
    agreed = [v for v in good if votes[norm(v['latex'])] >= 2]
    # Policies are defined without consulting the expected label.
    selected = {
        'baseline': base,
        'confidence': max(good, key=lambda v:v['confidence']) if good else base,
        'consensus': agreed[0] if agreed else base,
    }
    expected = norm(row['expected'])
    baseline_correct = norm(base.get('latex')) == expected and not base.get('truncated')
    for name, view in selected.items():
        correct = norm(view.get('latex')) == expected and not view.get('truncated')
        counts[name] += correct
        if name != 'baseline' and correct != baseline_correct:
            counts[name+'_gained' if correct else name+'_lost'] += 1
            changes.append(dict(id=row['id'], policy=name, gained=correct, expected=row['expected'], baseline=base['latex'], prediction=view['latex']))
    for view in views:
        counts['factor_'+str(view['factor'])] += norm(view.get('latex')) == expected and not view.get('truncated')
print(json.dumps(dict(count=len(data['rows']),counts=dict(counts),changes=changes),indent=2))
