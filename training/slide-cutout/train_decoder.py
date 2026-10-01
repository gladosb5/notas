"""Second experiment: fine-tune the last decoder block and RGB/output heads.
Uses reviewed-in-session approximate polygons; validation groups choose the
checkpoint. Test groups are reported only after checkpoint selection.
"""
import argparse,copy,json,random
from pathlib import Path
import numpy as np
from PIL import Image
import torch
from torch import nn
import torch.nn.functional as F
from transformers import AutoModelForImageSegmentation
ROOT=Path(__file__).resolve().parent
parser=argparse.ArgumentParser();parser.add_argument('--images',type=Path,default=Path.cwd()/'finetunedimages');args=parser.parse_args()
torch.manual_seed(20260928);random.seed(20260928);torch.set_num_threads(4)
device='cuda';rows=json.loads((ROOT/'manifest.json').read_text())
model=AutoModelForImageSegmentation.from_pretrained(str(ROOT),trust_remote_code=True,local_files_only=True).to(device).eval()
for p in model.parameters():p.requires_grad_(False)
mean=torch.tensor([.485,.456,.406])[None,:,None,None];std=torch.tensor([.229,.224,.225])[None,:,None,None]
rgb=torch.stack([torch.from_numpy(np.array(Image.open(args.images/r['file']).convert('RGB'),dtype=np.float32)/255).permute(2,0,1) for r in rows]);rgb=(rgb-mean)/std
Y=torch.stack([torch.from_numpy(np.array(Image.open(ROOT/'masks'/r['file']).resize((128,128),Image.Resampling.NEAREST),dtype=np.float32)/255)[None] for r in rows]).to(device)
cache=ROOT/'decoder-features.pt'
if cache.exists():X=torch.load(cache,weights_only=True)
else:
    captures=[];hook=model.decoder.decoder_block1.register_forward_pre_hook(lambda m,a:captures.append(a[0].detach().cpu().half()))
    for i in range(len(rows)):
        with torch.no_grad():model(rgb[i:i+1].to(device))
        print('decoder features',i+1,len(rows),flush=True)
    hook.remove();X=torch.cat(captures);torch.save(X,cache)
class Tail(nn.Module):
    def __init__(self):
        super().__init__();self.block=copy.deepcopy(model.decoder.decoder_block1);self.rgb=copy.deepcopy(model.decoder.ipt_blk1);self.head=copy.deepcopy(model.decoder.conv_out1)
    def forward(self,x,rgb):
        features=self.block(x)
        features=F.interpolate(features,size=rgb.shape[-2:],mode='bilinear',align_corners=True)
        return self.head(torch.cat([features,self.rgb(rgb)],1))
tail=Tail().eval();del model;torch.cuda.empty_cache()
for p in tail.parameters():p.requires_grad_(True)
small=F.interpolate(rgb,size=(128,128),mode='bilinear',align_corners=True)
splits={n:[i for i,r in enumerate(rows) if r['split']==n] for n in ['train','validation','test']}
def evaluate(ids,full=False,save=False):
    out=[];losses=[]
    with torch.no_grad():
        for i in ids:
            logits=tail(X[i:i+1].float().to(device),(rgb if full else small)[i:i+1].to(device))
            logits=F.interpolate(logits,size=(128,128),mode='bilinear',align_corners=False)
            pred=logits.sigmoid()>.5;truth=Y[i:i+1]>.5
            union=(pred|truth).sum().item();inter=(pred&truth).sum().item()
            losses.append(F.binary_cross_entropy_with_logits(logits,Y[i:i+1]).item())
            out.append(dict(file=rows[i]['file'],positive=rows[i]['positive'],iou=inter/union if union else 1.,foreground_fraction=pred.float().mean().item()))
            if save:
                (ROOT/'predictions').mkdir(exist_ok=True)
                Image.fromarray((pred[0,0].cpu().numpy()*255).astype('uint8')).resize((512,512)).save(ROOT/'predictions'/rows[i]['file'])
    return dict(loss=float(np.mean(losses)),positive_miou=float(np.mean([r['iou'] for r in out if r['positive']])),negative_foreground=float(np.mean([r['foreground_fraction'] for r in out if not r['positive']])),images=out)
optimizer=torch.optim.AdamW(tail.parameters(),lr=1e-4,weight_decay=.01)
best=float('inf');stale=0;history=[]
positive=[i for i in splits['train'] if rows[i]['positive']];negative=[i for i in splits['train'] if not rows[i]['positive']]
for epoch in range(60):
    order=positive*2+random.sample(negative,min(len(negative),len(positive)*2));random.shuffle(order)
    for start in range(0,len(order),2):
        ids=order[start:start+2];features=X[ids].float().to(device);pixels=small[ids].to(device);target=Y[ids]
        if random.random()<.5:features=features.flip(-1);pixels=pixels.flip(-1);target=target.flip(-1)
        logits=tail(features,pixels);prob=logits.sigmoid()
        bce=F.binary_cross_entropy_with_logits(logits,target)
        dice=1-(2*(prob*target).sum((1,2,3))+1)/(prob.sum((1,2,3))+target.sum((1,2,3))+1)
        loss=bce+dice.mean();optimizer.zero_grad();loss.backward();torch.nn.utils.clip_grad_norm_(tail.parameters(),1);optimizer.step()
    val=evaluate(splits['validation']);score=val['positive_miou']-val['negative_foreground']
    history.append(dict(epoch=epoch+1,validation=val['positive_miou'],negative_foreground=val['negative_foreground']))
    if -score<best:
        best=-score;best_epoch=epoch+1;best_state=copy.deepcopy(tail.state_dict());stale=0
    else:stale+=1
    print('epoch',epoch+1,'validation',val['positive_miou'],'negative',val['negative_foreground'],flush=True)
    if stale>=12:break
tail.load_state_dict(best_state)
torch.save({k:v.cpu() for k,v in best_state.items()},ROOT/'slide-decoder.pt')
results={n:evaluate(ids,full=True,save=True) for n,ids in splits.items()}
report=dict(method='fine-tuned final decoder block, RGB input block and output head; backbone frozen',best_epoch=best_epoch,counts={n:len(ids) for n,ids in splits.items()},results=results,history=history,full_slide_generalization='unmeasured; dataset contains partial crops only',labels='approximate agent-drawn polygons',deployment='experimental; not promoted automatically')
(ROOT/'decoder-report.json').write_text(json.dumps(report,indent=2));print(json.dumps({n:{k:v for k,v in r.items() if k!='images'} for n,r in results.items()},indent=2),flush=True)
