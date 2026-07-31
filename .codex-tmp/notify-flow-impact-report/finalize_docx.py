from __future__ import annotations

import os
import shutil
import tempfile
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET


REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
CT_NS = "http://schemas.openxmlformats.org/package/2006/content-types"
ET.register_namespace("", REL_NS)
ET.register_namespace("", CT_NS)


def source_part_for_relationship_part(rel_part: str) -> str | None:
    if rel_part == "_rels/.rels":
        return None
    marker = "/_rels/"
    if marker not in rel_part or not rel_part.endswith(".rels"):
        return None
    prefix, filename = rel_part.split(marker, 1)
    return f"{prefix}/{filename[:-5]}"


def clean_relationships(
    payload: bytes,
    source_payload: bytes | None = None,
) -> tuple[bytes, set[str]]:
    root = ET.fromstring(payload)
    changed = False
    media: set[str] = set()
    source_text = source_payload.decode("utf-8", errors="ignore") if source_payload else ""
    for rel in list(root):
        target = rel.attrib.get("Target", "")
        rel_type = rel.attrib.get("Type", "")
        rel_id = rel.attrib.get("Id", "")
        target_lower = target.lower()
        if "customxml/" in target_lower or "customXml" in rel_type:
            root.remove(rel)
            changed = True
            continue
        if rel_type.endswith("/image"):
            if source_payload is not None and rel_id not in source_text:
                root.remove(rel)
                changed = True
                continue
            media.add(Path(target).name)
    if not changed:
        return payload, media
    return ET.tostring(root, encoding="utf-8", xml_declaration=True), media


def remove_custom_xml_from_content_types(payload: bytes) -> bytes:
    root = ET.fromstring(payload)
    changed = False
    for item in list(root):
        part_name = item.attrib.get("PartName", "")
        if part_name.lower().startswith("/customxml/"):
            root.remove(item)
            changed = True
    if not changed:
        return payload
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def finalize(input_path: Path, output_path: Path) -> None:
    with zipfile.ZipFile(input_path, "r") as source:
        names = set(source.namelist())
        cleaned_relationships: dict[str, bytes] = {}
        used_media: set[str] = set()
        for name in names:
            if not name.endswith(".rels"):
                continue
            source_part = source_part_for_relationship_part(name)
            source_payload = source.read(source_part) if source_part in names else None
            payload, media = clean_relationships(source.read(name), source_payload)
            cleaned_relationships[name] = payload
            used_media.update(media)

        output_path.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(output_path, "w", compression=zipfile.ZIP_DEFLATED) as target:
            for info in source.infolist():
                name = info.filename
                lowered = name.lower()
                if lowered.startswith("customxml/"):
                    continue
                if lowered.startswith("word/media/") and Path(name).name not in used_media:
                    continue
                payload = cleaned_relationships.get(name, source.read(name))
                if name == "[Content_Types].xml":
                    payload = remove_custom_xml_from_content_types(payload)
                target.writestr(info, payload)


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("input")
    parser.add_argument("output")
    args = parser.parse_args()
    finalize(Path(args.input), Path(args.output))
    print(args.output)
