// Compact CPU inference for the bundled CNN. No framework, GPU, or network calls.
(function(root){
'use strict';
function createPredictor(meta,buffer){
  if(buffer.byteLength!==meta.bytes)throw new Error('Incomplete handwriting model. Retry setup.');
  const data=new Float32Array(buffer),weights={};
  for(const layer of meta.layers){
    if(layer.offset+layer.length>data.length)throw new Error('Invalid handwriting model.');
    weights[layer.name]=data.subarray(layer.offset,layer.offset+layer.length);
  }
  function convPool(input,size,channels,outputs,kernel,bias){
    const convSize=size-2,outSize=Math.floor(convSize/2),out=new Float32Array(outputs*outSize*outSize);
    for(let oc=0;oc<outputs;oc++)for(let y=0;y<outSize;y++)for(let x=0;x<outSize;x++){
      let best=0;
      for(let py=0;py<2;py++)for(let px=0;px<2;px++){
        let sum=bias[oc];
        for(let ic=0;ic<channels;ic++)for(let ky=0;ky<3;ky++){
          const at=ic*size*size+(y*2+py+ky)*size+x*2+px,k=(oc*channels+ic)*9+ky*3;
          sum+=input[at]*kernel[k]+input[at+1]*kernel[k+1]+input[at+2]*kernel[k+2];
        }
        if(sum>best)best=sum;
      }
      out[oc*outSize*outSize+y*outSize+x]=best;
    }
    return out;
  }
  function dense(input,kernel,bias,relu){
    const out=new Float32Array(bias.length);
    for(let i=0;i<out.length;i++){
      let sum=bias[i],base=i*input.length;
      for(let j=0;j<input.length;j++)sum+=input[j]*kernel[base+j];
      out[i]=relu?Math.max(0,sum):sum;
    }
    return out;
  }
  return function(input){
    if(input.length!==1024)throw new Error('Expected a 32 by 32 symbol.');
    const a=convPool(input,32,1,16,weights['conv1.weight'],weights['conv1.bias']);
    const b=convPool(a,15,16,32,weights['conv2.weight'],weights['conv2.bias']);
    const c=dense(b,weights['fc1.weight'],weights['fc1.bias'],true);
    return dense(c,weights['fc2.weight'],weights['fc2.bias'],false);
  };
}
root.NotasCNN={createPredictor};
if(typeof module!=='undefined')module.exports=root.NotasCNN;
})(globalThis);
