"""Paired development comparison using the project's strict LaTeX scorer."""
import json
import sys
from ocr_eval import normalize_latex

before, after = (json.load(open(p, encoding='utf-8')) for p in sys.argv[1:3])
assert before['inputHash'] == after['inputHash'], 'Inputs differ'
old = {r['id']: r for r in before['rows']}
counts = dict(before=0, after=0, gained=0, lost=0, alternative_recovery=0)
changes = []
for row in after['rows']:
    prior = old[row['id']]
    expected = normalize_latex(row['expected'])
    a = not prior.get('truncated') and normalize_latex(prior.get('latex')) == expected
    b = not row.get('truncated') and normalize_latex(row.get('latex')) == expected
    counts['before'] += a
    counts['after'] += b
    counts['gained'] += b and not a
    counts['lost'] += a and not b
    counts['alternative_recovery'] += not b and any(normalize_latex(s) == expected for s in row.get('alternatives', []))
    if a != b:
        changes.append(dict(id=row['id'], expected=row['expected'], before=prior.get('latex'), after=row.get('latex'), gained=b))
print(json.dumps(dict(count=len(old), **counts, median_ms=[before['median_ms'], after['median_ms']], p95_ms=[before['p95_ms'], after['p95_ms']], changes=changes), indent=2))
