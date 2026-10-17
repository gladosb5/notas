"""Pack the existing launch-film drawings and bridge into a small alpha atlas."""
from pathlib import Path
from PIL import Image
import argparse, base64, json, math, re

args=argparse.ArgumentParser(description=__doc__)
args.add_argument('--source',type=Path,default=Path('D:/notas-launch-work/film'))
args.add_argument('--project',type=Path,default=Path(__file__).resolve().parent.parent)
options=args.parse_args()
source=options.source
logo=source/'public/logo'
m=json.loads((logo/'match.json').read_text())
bridge=json.loads((source/'src/data/logo_bridge.json').read_text())
cum=json.loads((source/'src/data/logo_n_travel.json').read_text())['cum']
dt=[0]+[max(10,cum[j]-cum[j-1]) for j in range(1,len(cum))]
speed=sum(dt)/52*m['anim_scale']
# The film retimes the spirit by brush travel, skipping several drawings at
# 24 fps. App launch explicitly plays every source drawing, once, in order.
spirit_frames=len(dt)
clean=spirit_frames+bridge['count']
letters=[]; t=clean+3
for r in m['rest']:
    length=max(3,(r['x1']-r['x0'])/speed)
    letters.append((t,length));t+=length+(3 if r['x1']-r['x0']>120 else 1)
count=math.ceil(letters[-1][0]+letters[-1][1])+1
W,H=m['canvas'];w=464;h=round(H*w/W)
atlas=Image.new('L',(w*10,h*math.ceil(count/10)))
for f in range(count):
    canvas=Image.new('L',(W,H))
    if f<spirit_frames:
        j=f
        a=Image.open(logo/f'n/n_{j:02}.png').getchannel('A')
        s=m['anim_scale']
        a=a.transform((W,H),Image.Transform.AFFINE,(1/s,0,-m['anim_x']/s,0,1/s,-m['anim_y']/s),resample=Image.Resampling.BICUBIC)
    elif f<clean:a=Image.open(logo/f"bridge/b_{f-spirit_frames:02}.png").getchannel('A')
    else:a=Image.open(logo/'nswoosh.png').getchannel('A')
    canvas.paste(a)
    for r,(start,length) in zip(m['rest'],letters):
        progress=max(0,min(1,(f-start)/length))
        if progress:
            a=Image.open(source/'public'/r['file']).getchannel('A')
            edge=round(r['x0']+(r['x1']-r['x0'])*progress)
            a.paste(0,(edge,0,W,H))
            from PIL import ImageChops
            canvas=ImageChops.lighter(canvas,a)
    atlas.paste(canvas.resize((w,h),Image.Resampling.LANCZOS),(f%10*w,f//10*h))
rgba=Image.new('RGBA',atlas.size,(0,0,0,0));rgba.putalpha(atlas)
dest=options.project/'assets/launch'
dest.mkdir(exist_ok=True)
rgba.save(dest/'spirit-v1.webp',lossless=True,method=6)
(dest/'sequence.json').write_text(json.dumps({'frames':count,'spiritFrames':spirit_frames,'columns':10,'width':w,'height':h,'fps':24}))
(dest/'README.md').write_text('''Existing Nota launch-film artwork, packed from D:/notas-launch-work/film/public/logo. Includes all 41 registered spirit drawings, the original bridge frames and the letter reveal at the film’s 24 fps. No generated artwork.

Rebuild and embed in notas.html with Python and Pillow:

    python scripts/build-launch.py --source D:/notas-launch-work/film

The atlas is lossless WebP, embedded immediately after the launch markup so launch never waits for another request. The launch runtime shows each frame once, holds the completed logo, and respects reduced motion and the saved animation preference.
''',encoding='utf-8')
page=options.project/'notas.html'
html=page.read_text(encoding='utf-8')
data=base64.b64encode((dest/'spirit-v1.webp').read_bytes()).decode()
html,n=re.subn(r'--launch-atlas:url\(data:image/webp;base64,[A-Za-z0-9+/=]+\)',lambda _:f'--launch-atlas:url(data:image/webp;base64,{data})',html)
if n!=1:raise RuntimeError('Expected exactly one embedded launch atlas')
html=re.sub(r'(const complete=\(\)=>\{cancelAnimationFrame\(raf\);show\()\d+',lambda m:m[1]+str(count-1),html)
html=re.sub(r'if\(frame>=\d+\)',f'if(frame>={count-1})',html)
page.write_text(html,encoding='utf-8',newline='\n')
print(count,w,h,(dest/'spirit-v1.webp').stat().st_size)
