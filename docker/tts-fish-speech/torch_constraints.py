import pkg_resources, pathlib

pkgs = ["torch", "torchvision", "torchaudio"]
lines = []
for name in pkgs:
    try:
        dist = pkg_resources.get_distribution(name)
    except pkg_resources.DistributionNotFound:
        continue
    lines.append(f"{name}=={dist.version}")

pathlib.Path("/tmp/torch-constraints.txt").write_text("\n".join(lines) + "\n")