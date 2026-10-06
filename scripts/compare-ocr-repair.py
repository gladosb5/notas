"""Paired evaluation: transcription, grouping, acceptance and uncertainty."""
import argparse
import json
import math
import random
from pathlib import Path
from ocr_eval import normalize_latex, normalize_ascii

def exact(row):
    norm=normalize_latex if row.get('format')=='latex' else normalize_ascii
    return not row.get('error') and norm(row['predicted'])==norm(row['expected']) and row.get('segmentation_exact') is True

def wilson(k,n):
    if not n:return None
    z=1.959963984540054;p=k/n;d=1+z*z/n
    centre=(p+z*z/(2*n))/d
    half=z*math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d
    return [max(0,centre-half),min(1,centre+half)]

def metrics(rows):
    accepted=[r for r in rows if r.get('automatic_eligible')]
    correct=sum(exact(r) for r in rows);ac=sum(exact(r) for r in accepted)
    return {'n':len(rows),'exact':correct,'exact_rate':correct/len(rows) if rows else None,
        'exact_95_wilson':wilson(correct,len(rows)),
        'segmentation_exact':sum(r.get('segmentation_exact') is True for r in rows),
        'errors':sum(bool(r.get('error')) for r in rows),
        'accepted':len(accepted),'accepted_correct':ac,'accepted_wrong':len(accepted)-ac,
        'acceptance_coverage':len(accepted)/len(rows) if rows else None,
        'accepted_precision':ac/len(accepted) if accepted else None,
        'accepted_precision_95_wilson':wilson(ac,len(accepted)),
        'median_ms':sorted(r['ms'] for r in rows)[len(rows)//2] if rows else None}

def compare(before,after):
    if before['corpus_sha256']!=after['corpus_sha256'] or before['sample_hashes']!=after['sample_hashes']:
        raise ValueError('Different evaluation inputs')
    a={r['id']:r for r in before['rows']};b={r['id']:r for r in after['rows']}
    if len(a)!=len(before['rows']) or len(b)!=len(after['rows']) or a.keys()!=b.keys():
        raise ValueError('Need identical unique sample IDs; repeats cannot inflate n')
    for key in a:
        if (a[key]['expected'],a[key]['format'])!=(b[key]['expected'],b[key]['format']):
            raise ValueError('Changed target labels')
    output={}
    for kind in ['isolated','crowded']:
        ids=[k for k in a if a[k]['kind']==kind]
        pairs=[(int(exact(a[k])),int(exact(b[k]))) for k in ids]
        gains=sum(y>x for x,y in pairs);losses=sum(x>y for x,y in pairs)
        n=len(pairs);rng=random.Random(20260915)
        differences=[y-x for x,y in pairs]
        boot=sorted(sum(rng.choices(differences,k=n))/n for _ in range(2000)) if n else []
        discordant=gains+losses
        p=min(1,2*sum(math.comb(discordant,k) for k in range(min(gains,losses)+1))/2**discordant) if discordant else 1
        output[kind]={'before':metrics([a[k] for k in ids]),'after':metrics([b[k] for k in ids]),
            'gains':gains,'losses':losses,'paired_delta':(gains-losses)/n if n else None,
            'paired_delta_bootstrap_95':[boot[49],boot[1949]] if boot else None,'mcnemar_exact_p':p}
    return {'protocol':'Frozen paired end-to-end comparison; exact requires transcription AND target stroke membership.',
        'limitations':'Expression-derived synthetic pages, not natural notes. Unknown writer identities and shared distractors limit independence; confidence intervals are descriptive sample-level intervals. Acceptance is not transcription accuracy.',
        'corpus_sha256':before['corpus_sha256'],'cohorts':output,
        'changed_readings':[{'id':k,'expected':a[k]['expected'],'before':a[k]['predicted'],'after':b[k]['predicted']} for k in a if a[k]['predicted']!=b[k]['predicted']]}

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('before');p.add_argument('after');p.add_argument('--out',required=True);args=p.parse_args()
    result=compare(json.loads(Path(args.before).read_text(encoding='utf-8')),json.loads(Path(args.after).read_text(encoding='utf-8')))
    Path(args.out).write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps(result['cohorts'],indent=2))
