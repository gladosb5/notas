"""Transfer the trained tail into the proven 512px ONNX graph, including BN
folds. Validate PyTorch/ONNX probabilities before producing browser chunks.
"""
import argparse,hashlib,json
from pathlib import Path
import numpy as np
from PIL import Image
import torch
import onnx
from onnx import numpy_helper
import onnxruntime as ort
from onnxruntime.transformers.float16 import convert_float_to_float16
from transformers import AutoModelForImageSegmentation
ROOT=Path(__file__).resolve().parent
parser=argparse.ArgumentParser()
parser.add_argument('--images',type=Path,default=Path.cwd()/'finetunedimages')
parser.add_argument('--output',type=Path,default=Path.cwd()/'notas/assets/slide')
args=parser.parse_args()
torch.set_num_threads(4)
model=AutoModelForImageSegmentation.from_pretrained(str(ROOT),trust_remote_code=True,local_files_only=True).eval()
state=torch.load(ROOT/'slide-decoder.pt',weights_only=True)
model.decoder.decoder_block1.load_state_dict({k[6:]:v for k,v in state.items() if k.startswith('block.')})
model.decoder.ipt_blk1.load_state_dict({k[4:]:v for k,v in state.items() if k.startswith('rgb.')})
model.decoder.conv_out1.load_state_dict({k[5:]:v for k,v in state.items() if k.startswith('head.')})
graph=onnx.load(ROOT/'browser-base/onnx/model.onnx')
weights=model.state_dict();initializers={i.name:i for i in graph.graph.initializer}
changed=[]
for name,item in initializers.items():
    if name.startswith(('decoder.decoder_block1.','decoder.ipt_blk1.','decoder.conv_out1.')):
        value=weights[name].numpy();assert list(value.shape)==list(item.dims)
        item.CopyFrom(numpy_helper.from_array(value,name));changed.append(name)
block=model.decoder.decoder_block1
folds={
 '/decoder/decoder_block1/conv_in/Conv':(block.conv_in,block.bn_in),
 '/decoder/decoder_block1/conv_out/Conv':(block.conv_out,block.bn_out),
 '/decoder/decoder_block1/dec_att/conv1/Conv':(block.dec_att.conv1,block.dec_att.bn1),
 '/decoder/decoder_block1/dec_att/global_avg_pool/global_avg_pool.1/Conv':(block.dec_att.global_avg_pool[1],block.dec_att.global_avg_pool[2])
}
for node in graph.graph.node:
    if node.name in folds:
        conv,bn=folds.pop(node.name);fused=torch.nn.utils.fuse_conv_bn_eval(conv,bn)
        for name,value in zip(node.input[1:],[fused.weight,fused.bias]):
            initializers[name].CopyFrom(numpy_helper.from_array(value.detach().numpy(),name));changed.append(name)
assert not folds,folds
onnx.checker.check_model(graph)
graph=convert_float_to_float16(graph,keep_io_types=True,disable_shape_infer=True)
out=ROOT/'slide-model-fp16.onnx';onnx.save(graph,out)
del graph
options=ort.SessionOptions();options.log_severity_level=3;options.intra_op_num_threads=4;options.graph_optimization_level=ort.GraphOptimizationLevel.ORT_ENABLE_ALL
session=ort.InferenceSession(str(out),sess_options=options,providers=['CPUExecutionProvider'])
model=model.cuda();checks=[]
for name in ['IMG_1740.png','IMG_2719.png','IMG_2880.png']:
    a=np.array(Image.open(args.images/name).convert('RGB'),dtype=np.float32)/255
    a=((a-np.array([.485,.456,.406],np.float32))/np.array([.229,.224,.225],np.float32)).transpose(2,0,1)[None].copy()
    with torch.no_grad():expected=model(torch.from_numpy(a).cuda())[-1].sigmoid().cpu().numpy()
    result=session.run(None,{session.get_inputs()[0].name:a})[-1]
    actual=1/(1+np.exp(-np.clip(result,-80,80)))
    difference=np.abs(actual-expected)
    check=dict(file=name,mean_error=float(difference.mean()),p99_error=float(np.quantile(difference,.99)),mask_disagreement=float(np.mean((actual>.5)!=(expected>.5))))
    print(check,flush=True);checks.append(check)
    assert check['p99_error']<.03 and check['mask_disagreement']<.01,'browser export differs from training model'
data=out.read_bytes();digest=hashlib.sha256(data).hexdigest();parts=[]
target=args.output;target.mkdir(parents=True,exist_ok=True)
for index,start in enumerate(range(0,len(data),20*1024*1024)):
    name=f'slide-{digest[:12]}.{index}.bin';chunk=data[start:start+20*1024*1024];(target/name).write_bytes(chunk)
    parts.append(dict(file=name,bytes=len(chunk),sha256=hashlib.sha256(chunk).hexdigest()))
manifest=dict(version=1,sha=digest,sha256=digest,url='./assets/slide/model.json?v='+digest[:12],bytes=len(data),parts=parts,input_size=512,output='logits',base_revision='4a3c40c36c94093cc1e724d9ea428b8fa4b57dc7',validation=checks)
(target/'model.json').write_text(json.dumps(manifest,indent=2))
(target/'model.js').write_text('self.NOTAS_SLIDE_MODEL='+json.dumps(manifest)+';')
(ROOT/'export-report.json').write_text(json.dumps(dict(changed_initializers=changed,**manifest),indent=2))
print('exported',digest,len(data),flush=True)
