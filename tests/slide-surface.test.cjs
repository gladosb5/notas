const test=require('node:test');
const assert=require('node:assert/strict');
const refine=require('../slide-surface.js');

test('a projected surface keeps blank margins and excludes wall despite a ragged model mask',()=>{
  const size=512,rgba=new Uint8ClampedArray(size*size*4),mask=new Uint8ClampedArray(size*size);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const i=y*size+x,inside=x>=25&&x<=485&&y>=45-x*.04&&y<=460-x*.02;
    const value=inside?195:55+(x+y)%7;
    rgba.set([value,value,value,255],i*4);
    // Lost blank margin at the top, and an erroneous wall strip below.
    if(inside&&!(x>50&&x<150&&y<120)||x>=30&&x<=480&&y>=449&&y<480)mask[i]=255;
  }
  const result=refine(rgba,mask);
  assert.notEqual(result,mask);
  assert.equal(result[70*size+100],255,'plain slide margin is solid');
  assert.equal(result[472*size+250],0,'wall below the slide is removed');
  assert.equal(result[250*size+10],0,'wall beside the slide is removed');
  assert.equal(result[250*size+250],255,'slide content survives');
});

test('a partial irregular projection without three supported borders keeps its original matte',()=>{
  const size=512,rgba=new Uint8ClampedArray(size*size*4),mask=new Uint8ClampedArray(size*size);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const i=y*size+x,inside=y>180&&(y<410?x>40:x>290);
    const value=inside?190:60;
    rgba.set([value,value,value,255],i*4);mask[i]=inside?255:0;
  }
  assert.equal(refine(rgba,mask),mask,'do not fill wall into an L-shaped partial projection');
});
