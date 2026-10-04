"""Modulated deformable conv as GridSample + 1x1 convs, for ONNX Runtime Web (no DeformConv kernel there).
Taps are sampled in groups of up to 9 and accumulated, so the largest temporary is 9*C*H*W."""
import torch,torch.nn.functional as F
def deform_gs(x,offset,mask,weight,bias,pad,group=9,grouped=None):
    N,C,H,W=x.shape;O,_,kh,kw=weight.shape;Ho,Wo=offset.shape[2:]
    ys=torch.arange(Ho,dtype=x.dtype).view(1,Ho,1)-pad;xs=torch.arange(Wo,dtype=x.dtype).view(1,1,Wo)-pad
    taps=[(i,j) for i in range(kh) for j in range(kw)];out=None
    for g in range(0,len(taps),group):
        part=taps[g:g+group];cols=[]
        for i,j in part:
            k=i*kw+j
            py=ys+i+offset[:,2*k];px=xs+j+offset[:,2*k+1]
            grid=torch.stack((px*(2/(W-1))-1,py*(2/(H-1))-1),-1)
            cols.append(F.grid_sample(x,grid,mode='bilinear',padding_mode='zeros',align_corners=True)*mask[:,k:k+1])
        col=torch.cat(cols,1) if len(cols)>1 else cols[0]
        w=grouped[g//group] if grouped is not None else torch.stack([weight[:,:,i,j] for i,j in part],1).reshape(O,len(part)*C,1,1)
        y=F.conv2d(col,w,bias if out is None else None)
        out=y if out is None else out+y
    return out
def patch(module):
    def forward(self,x):
        offset=self.offset_conv(x);modulator=2.*torch.sigmoid(self.modulator_conv(x))
        assert self.stride==(1,1)
        grouped=[getattr(self,f'_gw{n}') for n in range(self._ngw)] if hasattr(self,'_ngw') else None
        return deform_gs(x,offset,modulator,self.regular_conv.weight,self.regular_conv.bias,self.padding,grouped=grouped)
    module.DeformableConv2d.forward=forward
def freeze(model,module,group=9):
    """Store each tap group's 1x1 weight as a buffer, so the export sees constants."""
    for sub in model.modules():
        if isinstance(sub,module.DeformableConv2d):
            w=sub.regular_conv.weight.detach();O,C,kh,kw=w.shape;taps=[(i,j) for i in range(kh) for j in range(kw)]
            parts=[taps[g:g+group] for g in range(0,len(taps),group)]
            for n,part in enumerate(parts):sub.register_buffer(f'_gw{n}',torch.stack([w[:,:,i,j] for i,j in part],1).reshape(O,len(part)*C,1,1).contiguous())
            sub._ngw=len(parts)
if __name__=='__main__':
    from torchvision.ops import deform_conv2d
    torch.manual_seed(0)
    for k,p,h in [(1,0,16),(3,1,32),(7,3,128)]:
        x=torch.randn(1,64,h,h);off=torch.randn(1,2*k*k,h,h)*3;m=torch.rand(1,k*k,h,h)*2;w=torch.randn(256,64,k,k)*.05;b=torch.randn(256)
        ref=deform_conv2d(x,off,w,b,padding=p,mask=m);got=deform_gs(x,off,m,w,b,p)
        print(k,'max abs diff',float((ref-got).abs().max()),'ref scale',float(ref.abs().max()))
