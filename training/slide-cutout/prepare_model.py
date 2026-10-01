"""Download pinned training/export inputs into this directory.
Review birefnet.py before using the training scripts (they load custom code).
"""
from pathlib import Path
from huggingface_hub import hf_hub_download
root=Path(__file__).resolve().parent
for name in ['birefnet.py','BiRefNet_config.py','config.json','model.safetensors','requirements.txt']:
    hf_hub_download('ZhengPeng7/BiRefNet_lite',name,revision='aa62cd87eafb9cc43056d08ef3615a14628b831d',local_dir=root)
hf_hub_download('studioludens/birefnet-lite-512','onnx/model.onnx',revision='4a3c40c36c94093cc1e724d9ea428b8fa4b57dc7',local_dir=root/'browser-base')
