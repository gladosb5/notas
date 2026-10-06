"""Validate manually labeled Notas ink; reject leakage into supplied training data."""
import argparse
import hashlib
import json
import math
from pathlib import Path

def load(path):
    return [json.loads(line) for line in Path(path).read_text(encoding='utf-8').splitlines() if line.strip()]

def ink_hash(row):
    points=[s['pts'][i:i+2] for s in row['strokes'] for i in range(0,len(s['pts']),3)]
    x=min(p[0] for p in points);y=min(p[1] for p in points)
    scale=max(max(p[0] for p in points)-x,max(p[1] for p in points)-y,1e-9)
    ink=[[[round((s['pts'][i]-x)/scale,6),round((s['pts'][i+1]-y)/scale,6)] for i in range(0,len(s['pts']),3)] for s in row['strokes']]
    return hashlib.sha256(json.dumps(ink,separators=(',',':')).encode()).hexdigest()

def validate(rows,training=()):
    if not rows:raise ValueError('Collection is empty.')
    ids=set();inks=set();writers=set();sessions=set();notes=set();missing=0
    for r in rows:
        if r.get('schema')!='notas-ocr-eval-v1' or r.get('usage')!='evaluation_only' or r.get('split')!='development':raise ValueError('Expected development evaluation-only rows.')
        for key in ('id','expected','writer','session','source_sha256'):
            if not isinstance(r.get(key),str) or not r[key].strip():raise ValueError(f'Missing {key}.')
        if r['id'] in ids:raise ValueError('Duplicate example ID.')
        ids.add(r['id']);writers.add(r['writer']);sessions.add((r['writer'],r['session']));notes.add(r['source_sha256'])
        if not isinstance(r.get('strokes'),list) or not r['strokes']:raise ValueError('Missing strokes.')
        for s in r['strokes']:
            pts=s.get('pts')
            if not isinstance(pts,list) or not pts or len(pts)%3 or any(type(v) not in (float,int) or not math.isfinite(v) for v in pts):raise ValueError('Invalid stroke coordinates.')
            if s.get('author')!='user':raise ValueError('Evaluation must contain user ink.')
            for key in ('w','t0','t1'):
                v=s.get(key)
                if type(v) not in (float,int) or not math.isfinite(v):raise ValueError('Invalid stroke metadata.')
            if s['w']<=0:raise ValueError('Invalid pen width.')
            times=s.get('times')
            if times is None:missing+=1
            elif not isinstance(times,list) or len(times)!=len(pts)//3 or any(type(v) not in (int,float) or not math.isfinite(v) or v<0 or (i and v<times[i-1]) for i,v in enumerate(times)):raise ValueError('Invalid point timing.')
        fingerprint=ink_hash(r)
        if fingerprint in inks:raise ValueError('Duplicate ink (including translated/scaled copies).')
        inks.add(fingerprint)
    for r in training:
        if not r.get('writer') or not r.get('session') or not r.get('source_sha256') or not r.get('strokes'):raise ValueError('Training comparison lacks provenance or ink; cannot establish separation.')
        if r.get('id') in ids or r['writer'] in writers or r['source_sha256'] in notes or ink_hash(r) in inks:raise ValueError('Training/evaluation overlap detected (writer, source note, ID or ink).')
    return {'examples':len(rows),'writers':len(writers),'sessions':len(sessions),'notes':len(notes),'strokes_without_recorded_times':missing,'training_rows_checked':len(training),'scope':'Personal development evaluation; not a sealed final test. One writer cannot establish generalization to other writers.'}

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('collection',type=Path);p.add_argument('--training',type=Path);p.add_argument('--manifest',type=Path);a=p.parse_args()
    try:
        result=validate(load(a.collection),load(a.training) if a.training else [])
        result['collection_sha256']=hashlib.sha256(a.collection.read_bytes()).hexdigest()
        if a.manifest:
            with a.manifest.open('x',encoding='utf-8') as f:json.dump(result,f,indent=2)
        print(json.dumps(result,indent=2))
    except (ValueError,KeyError,TypeError,OSError) as e:p.exit(1,f'Audit failed: {e}\n')
