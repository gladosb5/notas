/* A projected slide is a solid surface, including its plain margins. The
 * segmentation model supplies the evidence that this is a slide; long image
 * edges can then recover margins which the pixel mask mistakenly erased.
 * Leave irregular/partial projections alone unless a surface is well supported.
 */
(function(root){
  'use strict';
  function refine(rgba,alpha,size=512){
    if(!Number.isInteger(size)||size<8||size>2048||!rgba||!alpha||rgba.length!==size*size*4||alpha.length!==size*size)throw new TypeError('invalid slide image or mask dimensions');
    const plane=size*size,gray=new Float32Array(plane);
    let left=size,top=size,right=0,bottom=0,kept=0;
    for(let i=0;i<plane;i++){
      const a=rgba[4*i+3]/255;
      gray[i]=(rgba[4*i]+rgba[4*i+1]+rgba[4*i+2])*a/3+255*(1-a);
      if(alpha[i]<128)continue;
      const x=i%size,y=Math.floor(i/size);kept++;
      left=Math.min(left,x);right=Math.max(right,x+1);
      top=Math.min(top,y);bottom=Math.max(bottom,y+1);
    }
    if(kept<plane*.15)return alpha;
    const middle=(size-1)/2,lines=[];
    for(let side=0;side<4;side++){
      const vertical=side>=2,inward=side%2===0?1:-1;
      const low=vertical?left:top,high=vertical?right:bottom,extent=high-low;
      const from=Math.max(0,Math.floor(inward===1?low-extent*.08:high-extent*.2));
      const to=Math.min(size-1,Math.ceil(inward===1?low+extent*.2:high+extent*.08));
      let best=null;
      // Search straight edges, allowing perspective. A narrow and a wider
      // contrast sample locate the transition without following text strokes.
      for(let step=-35;step<=35;step++){
        const slope=step/100;
        for(let b=from;b<=to;b++){
          let count=0,support=0,score=0;
          for(let t=4;t<size-4;t+=2){
            const q=Math.round(b+slope*(t-middle));
            if(q<4||q>=size-4)continue;
            const i=vertical?t*size+q:q*size+t,offset=vertical?inward:inward*size;
            const wide=gray[i+offset*3]-gray[i-offset*3];
            const fine=gray[i+offset]-gray[i-offset];
            count++;if(wide>18)support++;
            score+=Math.max(0,Math.min(70,wide))+.3*Math.max(0,Math.min(70,fine));
          }
          if(count<size*.27||support<count*.7||score<count*30)continue;
          score/=count;
          if(!best||score>best.score)best={b,slope,score};
        }
      }
      lines.push(best);
    }
    // Three visible edges are the minimum. The fourth may be outside the
    // photograph, but only when the model actually reaches that frame edge.
    if(lines.filter(Boolean).length<3)return alpha;
    for(let side=0;side<4;side++){
      if(lines[side])continue;
      let edge=0;
      for(let t=0;t<size;t++){
        const i=side===0?2*size+t:side===1?(size-3)*size+t:side===2?t*size+2:t*size+size-3;
        if(alpha[i]>=128)edge++;
      }
      if(edge<size*.6)return alpha;
      lines[side]={b:side%2===0?-1:size,slope:0};
    }
    const result=new Uint8ClampedArray(plane);
    let area=0,retained=0,added=0;
    for(let y=0;y<size;y++)for(let x=0;x<size;x++){
      let distance=Infinity;
      for(let side=0;side<4;side++){
        const {b,slope}=lines[side],t=side<2?x:y,q=side<2?y:x;
        distance=Math.min(distance,(side%2===0?1:-1)*(q-b-slope*(t-middle))/Math.sqrt(1+slope*slope));
      }
      const i=y*size+x;
      result[i]=255*Math.max(0,Math.min(1,distance+.5));
      if(result[i]<128)continue;
      area++;if(alpha[i]>=128)retained++;else added++;
    }
    // A strong inner panel border must not crop away the rest of the slide,
    // nor may a rectangle invent a large missing part of a partial projection.
    if(retained<kept*.88||added>area*.2||area<plane*.15)return alpha;
    return result;
  }
  if(typeof module==='object'&&module.exports)module.exports=refine;
  else root.NOTAS_SLIDE_SURFACE=refine;
})(typeof self==='object'?self:globalThis);
