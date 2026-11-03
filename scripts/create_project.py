#!/usr/bin/env python3
"""Create a thin video project that reuses this skill's engine and resources."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


PROJECT_DIRS = ("source", "renders", "clips", "qa")


def starter_timeline(title: str) -> dict:
    return {
        "meta": {
            "title": title,
            "width": 1080,
            "height": 1920,
            "fps": 30,
            "total": 4.0,
            "palette": {
                "ink": "#FFFFFF",
                "sub": "#C7CFDC",
                "accent": "#FEBD0D",
                "gold": "#FEBD0D",
                "scrim": "#06080C",
            },
            "inDur": 0.42,
            "outDur": 0.32,
            "yMin": 940.8,
            "yMax": 1497.6,
        },
        "groups": [
            {
                "id": "g01",
                "y": 1300,
                "t0": 0.2,
                "t1": 3.8,
                "items": [
                    {
                        "id": "g01-m",
                        "role": "main",
                        "text": "在这里输入重点",
                        "size": 110,
                        "device": "slam",
                        "t0": 0.2,
                        "t1": 3.8,
                    },
                    {
                        "id": "g01-s",
                        "role": "sub",
                        "text": "副字",
                        "size": 56,
                        "device": "fade",
                        "t0": 0.55,
                        "t1": 3.8,
                    },
                ],
            }
        ],
    }


def preview_script(skill_dir: Path) -> str:
    return f"""#!/bin/zsh
set -e

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILL_DIR="${{KINETIC_SKILL_DIR:-$HOME/.agents/skills/social-media-savvy-talking-head-kinetic-video}}"
if [ ! -f "$SKILL_DIR/SKILL.md" ]; then
  SKILL_DIR="{skill_dir}"
fi

exec node "$SKILL_DIR/engine/preview_server.mjs" --project "$PROJECT_DIR"
"""


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Create a project without copying the shared engine or audio libraries."
    )
    parser.add_argument("project", help="Project directory")
    parser.add_argument("--title", default="未命名项目")
    args = parser.parse_args()

    skill_dir = Path(__file__).resolve().parents[1]
    project = Path(args.project).expanduser().resolve()
    project.mkdir(parents=True, exist_ok=True)

    for name in PROJECT_DIRS:
        (project / name).mkdir(exist_ok=True)

    timeline_path = project / "timeline.json"
    if timeline_path.exists():
        print(f"保留已有 timeline.json：{timeline_path}")
    else:
        timeline_path.write_text(
            json.dumps(starter_timeline(args.title), ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

    preview_path = project / "preview.sh"
    preview_path.write_text(preview_script(skill_dir), encoding="utf-8")
    preview_path.chmod(0o755)

    gitignore_path = project / ".gitignore"
    if not gitignore_path.exists():
        gitignore_path.write_text(
            "\n".join(
                [
                    "node_modules/",
                    "overlay/",
                    "overlay-*/",
                    "renders/",
                    "clips/",
                    "qa/",
                    "timeline.js",
                    "*.log",
                    "*.bak",
                    "*.lock",
                    "",
                ]
            ),
            encoding="utf-8",
        )

    print(f"PROJECT={project}")
    print(f"SKILL={skill_dir}")
    print(f"TIMELINE={timeline_path}")
    print(f"PREVIEW={preview_path}")
    print("共享引擎、音乐库和音效库均未复制；项目直接复用 skill 目录。")


if __name__ == "__main__":
    main()
