import torch; print(torch.__version__, torch.version.cuda)
import os, glob

d = os.path.join(os.path.dirname(torch.__file__), "lib")
print("torch lib dir:", d)
print("libtorch_cuda:", glob.glob(os.path.join(d, "libtorch_cuda.so*")))
