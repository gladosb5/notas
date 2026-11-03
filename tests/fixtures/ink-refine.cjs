const {readFileSync}=require('node:fs');
const data=readFileSync(require.resolve('../../nota.js'),'utf8').match(/const GLYPH_DATA=`([^`]+)`/)[1];
const glyphs=new Map(data.split('\n').map(line=>{
  const [code,body]=line.split(':'),[metrics,paths]=body.split('|');
  return [String.fromCharCode(+code),{w:+metrics.split(',')[1],paths:paths.split(';').filter(Boolean).map(p=>p.split(',').map(Number))}];
}));
function writing(texts,options={}){
  let seed=options.seed??42,id=0,x=options.x??40;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const slope=Math.tan((options.tilt??0)*Math.PI/180),jitter=options.jitter??0;
  return texts.map((text,word)=>{
    const strokes=[],scale=options.scales?.[word]??1,y=(options.y??180)+(options.wobble?.[word]??0);
    // Letter sizes pivot at the baseline; shears are per-word angles in degrees.
    let letter=0;
    for(const char of text){
      const glyph=glyphs.get(char),size=scale*(options.letterScales?.[word]?.[letter]??1),wobble=options.letterWobble?.[word]?.[letter]??0,shear=Math.tan((options.shears?.[word]??0)*Math.PI/180);
      for(const path of glyph.paths){
        const pts=[];
        for(let i=0;i<path.length;i+=2){
          const n=i?Math.max(1,Math.ceil(Math.hypot(path[i]-path[i-2],path[i+1]-path[i-1])*size/1.5)):1;
          for(let k=1;k<=n;k++){
            const gx=i?path[i-2]+(path[i]-path[i-2])*k/n:path[i],gy=i?path[i-1]+(path[i+1]-path[i-1])*k/n:path[i+1];
            const px=x+gx*size+shear*(gy-9)*size,py=y+gy*size+9*(scale-size)+wobble+slope*px;
            pts.push(Math.round((px+(random()-.5)*2*jitter)*10)/10,Math.round((py+(random()-.5)*2*jitter)*10)/10,.5);
          }
        }
        strokes.push({id:'refine-'+id++,author:'user',w:2,pts});
      }
      x+=glyph.w*size;letter++;
    }
    x+=options.gap??25;return strokes;
  });
}
// Glyph path counts retain the true letter boundaries even after refinement.
function letterGroups(strokes,text){
  let at=0;return [...text].map(char=>{const n=glyphs.get(char).paths.length,group=strokes.slice(at,at+n);at+=n;return group;});
}
module.exports={writing,letterGroups};
