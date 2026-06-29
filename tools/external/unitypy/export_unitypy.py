import argparse
import json
import os
from pathlib import Path

try:
    import UnityPy
except ImportError as exc:
    raise SystemExit("UnityPy is not installed. Run: python -m pip install UnityPy") from exc


EXTENSIONS = {
    "Texture2D": ".png",
    "Sprite": ".png",
    "AudioClip": ".wav",
    "TextAsset": ".txt",
    "Mesh": ".obj",
    "Shader": ".shader",
    "MonoBehaviour": ".json",
}


def safe_name(value, fallback):
    text = str(value or fallback)
    for char in '<>:"/\\|?*\x00':
        text = text.replace(char, "_")
    return text.strip() or fallback


def export_object(obj, output_dir, index):
    data = obj.read()
    type_name = obj.type.name
    base = safe_name(getattr(data, "name", ""), f"{type_name}_{index:05d}")
    extension = EXTENSIONS.get(type_name, ".bin")
    target = output_dir / type_name
    target.mkdir(parents=True, exist_ok=True)

    if type_name in ("Texture2D", "Sprite"):
        image = data.image
        path = target / f"{base}.png"
        image.save(path)
        return str(path)

    if type_name == "AudioClip":
        exported = []
        for name, audio_data in data.samples.items():
            path = target / f"{safe_name(name, base)}.wav"
            path.write_bytes(audio_data)
            exported.append(str(path))
        return exported

    if type_name == "TextAsset":
        path = target / f"{base}.txt"
        script = getattr(data, "script", b"")
        if isinstance(script, str):
            path.write_text(script, encoding="utf-8", errors="ignore")
        else:
            path.write_bytes(script)
        return str(path)

    if type_name == "Mesh":
        path = target / f"{base}.obj"
        path.write_text(data.export(), encoding="utf-8", errors="ignore")
        return str(path)

    if type_name == "Shader":
        path = target / f"{base}.shader"
        path.write_text(data.export(), encoding="utf-8", errors="ignore")
        return str(path)

    if type_name == "MonoBehaviour":
        path = target / f"{base}.json"
        path.write_text(json.dumps(data.type_tree, ensure_ascii=False, indent=2), encoding="utf-8")
        return str(path)

    path = target / f"{base}{extension}"
    path.write_bytes(obj.get_raw_data())
    return str(path)


def iter_files(root):
    for current, _, names in os.walk(root):
        for name in names:
            yield Path(current) / name


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("input_dir")
    parser.add_argument("output_dir")
    parser.add_argument("--types", default="texture,audio,mesh,text")
    args = parser.parse_args()

    wanted = {item.strip().lower() for item in args.types.split(",") if item.strip()}
    type_map = {
        "texture": {"Texture2D", "Sprite"},
        "audio": {"AudioClip"},
        "mesh": {"Mesh"},
        "text": {"TextAsset", "Shader", "MonoBehaviour"},
    }
    allowed = set()
    for key in wanted:
        allowed.update(type_map.get(key, {key}))

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    manifest = {"input": args.input_dir, "types": sorted(allowed), "files": []}

    index = 0
    for file_path in iter_files(args.input_dir):
        try:
            env = UnityPy.load(str(file_path))
        except Exception:
            continue
        for obj in env.objects:
            if obj.type.name not in allowed:
                continue
            index += 1
            try:
                exported = export_object(obj, output_dir, index)
                if not isinstance(exported, list):
                    exported = [exported]
                for item in exported:
                    manifest["files"].append({"source": str(file_path), "type": obj.type.name, "output": item})
            except Exception as exc:
                manifest["files"].append({"source": str(file_path), "type": obj.type.name, "error": str(exc)})

    (output_dir / "unitypy-manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
