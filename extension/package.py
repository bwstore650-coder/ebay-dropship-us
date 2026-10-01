"""Crée le zip à envoyer au Chrome Web Store (sans tests ni fichiers de développement)."""
import json, os, zipfile
here = os.path.dirname(os.path.abspath(__file__))
version = json.load(open(os.path.join(here, "manifest.json")))["version"]
os.makedirs(os.path.join(here, "dist"), exist_ok=True)
out = os.path.join(here, "dist", f"sellvela-extension-{version}.zip")
SKIP = {"test", "dist", "README.md", "package.py", ".gitignore"}
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for root, dirs, files in os.walk(here):
        rel = os.path.relpath(root, here)
        if rel.split(os.sep)[0] in SKIP:
            continue
        for f in sorted(files):
            if rel == "." and f in SKIP:
                continue
            path = os.path.join(root, f)
            z.write(path, os.path.relpath(path, here))
print(out)
