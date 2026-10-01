"""Fine-tune BiRefNet-lite's actual 120-channel final segmentation head.

The frozen decoder features are cached once; no generated masks are used as
targets. Run with Python 3.11 / CUDA. Source photos stay outside the repo.
"""
import argparse, copy, hashlib, json, random
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw
import torch
import torch.nn.functional as F
from transformers import AutoModelForImageSegmentation

ROOT=Path(__file__).resolve().parent
parser=argparse.ArgumentParser();parser.add_argument('--images',type=Path,default=Path.cwd()/'finetunedimages')
DATA=parser.parse_args().images.resolve()
torch.manual_seed(20260928);random.seed(20260928);torch.set_num_threads(4)
labels=json.loads((ROOT/'labels.json').read_text())
rows=[]
(ROOT/'masks').mkdir(exist_ok=True)
for path in sorted(DATA.glob('*.png')):
    key=path.stem.split('_')[-1]
    if key in labels['exclude']:continue
    mask=Image.new('L',(512,512))
    if key in labels['polygons']:ImageDraw.Draw(mask).polygon([tuple(p) for p in labels['polygons'][key]],fill=255)
    mask.save(ROOT/'masks'/path.name)
    split='train'
    for name in ['validation','test']:
        if any(lo<=int(key)<=hi for lo,hi in labels[name+'_ranges']):split=name
    rows.append(dict(file=path.name,sha256=hashlib.sha256(path.read_bytes()).hexdigest(),split=split,positive=key in labels['polygons']))
(ROOT/'manifest.json').write_text(json.dumps(rows,indent=2))
assert rows,'no input photos'
device='cuda' if torch.cuda.is_available() else 'cpu'
model=AutoModelForImageSegmentation.from_pretrained(str(ROOT),trust_remote_code=True,local_files_only=True).to(device).eval()
for p in model.parameters():p.requires_grad_(False)
head=copy.deepcopy(model.decoder.conv_out1[0]).float()
original=copy.deepcopy(head.state_dict())
cache=ROOT/'features.pt'
if cache.exists():
    saved=torch.load(cache,weights_only=True);X,Y=saved['X'],saved['Y']
    assert saved['files']==[r['file'] for r in rows]
else:
    captured=[]
    hook=model.decoder.conv_out1.register_forward_pre_hook(lambda module,args:captured.append(F.interpolate(args[0],size=(96,96),mode='bilinear',align_corners=False).detach().cpu().half()))
    xs=[];ys=[]
    mean=torch.tensor([.485,.456,.406],device=device)[None,:,None,None]
    std=torch.tensor([.229,.224,.225],device=device)[None,:,None,None]
    for index,row in enumerate(rows):
        a=np.array(Image.open(DATA/row['file']).convert('RGB'),dtype=np.float32)/255
        x=torch.from_numpy(a).permute(2,0,1)[None].to(device)
        with torch.no_grad():model((x-mean)/std)
        xs.append(captured.pop())
        y=np.array(Image.open(ROOT/'masks'/row['file']).resize((96,96),Image.Resampling.NEAREST),dtype=np.float32)/255
        ys.append(torch.from_numpy(y)[None,None])
        print('features',index+1,len(rows),row['file'],flush=True)
    hook.remove();X=torch.cat(xs);Y=torch.cat(ys)
    torch.save(dict(X=X,Y=Y,files=[r['file'] for r in rows]),cache)
del model;torch.cuda.empty_cache()
X=X.float().to(device);Y=Y.to(device)
splits={name:[i for i,r in enumerate(rows) if r['split']==name] for name in ['train','validation','test']}
def evaluate(ids):
    with torch.no_grad():
        logits=head(X[ids]);pred=logits.sigmoid()>.5;truth=Y[ids]>.5
        loss=F.binary_cross_entropy_with_logits(logits,Y[ids]).item()
        per=[]
        for j,i in enumerate(ids):
            intersection=(pred[j]&truth[j]).sum().item();union=(pred[j]|truth[j]).sum().item()
            per.append(dict(file=rows[i]['file'],positive=rows[i]['positive'],iou=intersection/union if union else 1.,foreground_fraction=pred[j].float().mean().item()))
        pos=[r['iou'] for r in per if r['positive']];neg=[r['foreground_fraction'] for r in per if not r['positive']]
        return dict(loss=loss,positive_miou=float(np.mean(pos)) if pos else None,negative_foreground=float(np.mean(neg)) if neg else None,images=per)
baseline={name:evaluate(ids) for name,ids in splits.items()}
for p in head.parameters():p.requires_grad_(True)
optimizer=torch.optim.AdamW(head.parameters(),lr=.003,weight_decay=.01)
best=float('inf');best_state=None;stale=0;history=[]
for epoch in range(200):
    order=splits['train'].copy();random.shuffle(order)
    for start in range(0,len(order),8):
        ids=order[start:start+8];logits=head(X[ids]);target=Y[ids]
        loss=F.binary_cross_entropy_with_logits(logits,target,pos_weight=torch.tensor(2.,device=device))
        optimizer.zero_grad();loss.backward();optimizer.step()
    val=evaluate(splits['validation']);history.append(dict(epoch=epoch+1,validation_loss=val['loss']))
    if val['loss']<best-1e-5:
        best=val['loss'];best_state=copy.deepcopy(head.state_dict());stale=0;best_epoch=epoch+1
    else:stale+=1
    if epoch%10==0:print('epoch',epoch+1,val['loss'],val['positive_miou'],flush=True)
    if stale>=30:break
head.load_state_dict(best_state)
results={name:evaluate(ids) for name,ids in splits.items()}
torch.save({k:v.cpu() for k,v in best_state.items()},ROOT/'slide-head.pt')
report=dict(base='ZhengPeng7/BiRefNet_lite',revision='aa62cd87eafb9cc43056d08ef3615a14628b831d',method='frozen backbone and decoder; fine-tuned existing final Conv2d(120,1,1)',best_epoch=best_epoch,counts={n:len(ids) for n,ids in splits.items()},baseline=baseline,tuned=results,history=history,limitations=['Approximate agent-drawn masks, not independently reviewed.','Nearby filename groups held out together; capture-session metadata unavailable.','All images are 512x512 crops from a narrow classroom domain. No real full-slide evaluation.'])
(ROOT/'report.json').write_text(json.dumps(report,indent=2))
print(json.dumps({n:{k:v for k,v in result.items() if k!='images'} for n,result in results.items()},indent=2),flush=True)
