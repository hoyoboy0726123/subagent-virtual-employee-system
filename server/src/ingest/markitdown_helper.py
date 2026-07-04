#!/usr/bin/env python3
"""MarkItDown ingestion helper.

A tiny, dependency-isolated bridge between the Node backend and Microsoft
MarkItDown (https://github.com/microsoft/markitdown). It has two jobs and always
speaks JSON on stdout so the Node side never has to parse human text:

  * ``--probe``            → report whether markitdown is importable + its version.
  * ``--convert <path>``   → convert one local file to canonical Markdown.

Every outcome (success or failure) is a single JSON object printed to stdout with
exit code 0 for a "handled" result. A non-zero exit code is reserved for truly
unexpected crashes, which the Node wrapper treats as "helper unavailable".

The helper intentionally does no network access and only ever touches the single
explicit path it is handed — the ingestion surface stays constrained to files the
user uploaded (see the Node wrapper / service for the size + type gate).
"""
import json
import sys


def _emit(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False))
    sys.stdout.flush()


def _version():
    try:
        from importlib.metadata import version

        return version("markitdown")
    except Exception:
        return None


def probe():
    try:
        import markitdown  # noqa: F401
    except Exception as exc:  # pragma: no cover - environment dependent
        _emit({"available": False, "error": f"{type(exc).__name__}: {exc}"})
        return
    _emit({"available": True, "version": _version()})


def convert(path):
    try:
        from markitdown import MarkItDown
    except Exception as exc:  # pragma: no cover - environment dependent
        _emit({
            "ok": False,
            "available": False,
            "error": f"MarkItDown 無法載入：{type(exc).__name__}: {exc}",
        })
        return

    try:
        md = MarkItDown(enable_plugins=False)
        result = md.convert(path)
        markdown = getattr(result, "markdown", None)
        if markdown is None:
            markdown = getattr(result, "text_content", "") or ""
        title = getattr(result, "title", None)
        _emit({
            "ok": True,
            "available": True,
            "markdown": markdown,
            "title": title,
            "version": _version(),
        })
    except Exception as exc:
        _emit({
            "ok": False,
            "available": True,
            "error": f"{type(exc).__name__}: {exc}",
        })


def main(argv):
    if not argv:
        _emit({"ok": False, "error": "no command"})
        return 0
    cmd = argv[0]
    if cmd == "--probe":
        probe()
        return 0
    if cmd == "--convert":
        if len(argv) < 2:
            _emit({"ok": False, "error": "missing path"})
            return 0
        convert(argv[1])
        return 0
    _emit({"ok": False, "error": f"unknown command: {cmd}"})
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
