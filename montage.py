import sys
from PIL import Image
# usage: montage.py out.png cols maxH file1 file2 ...
out, cols, maxH = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
files = sys.argv[4:]
ims = []
for f in files:
    im = Image.open(f).convert("RGB")
    if im.height > maxH:
        im = im.crop((0, 0, im.width, maxH))
    ims.append(im)
w = max(i.width for i in ims)
h = max(i.height for i in ims)
rows = (len(ims) + cols - 1) // cols
sheet = Image.new("RGB", (cols * (w + 8), rows * (h + 8)), (255, 0, 255))
for n, im in enumerate(ims):
    sheet.paste(im, ((n % cols) * (w + 8), (n // cols) * (h + 8)))
sheet.save(out)
print(out, sheet.size)
