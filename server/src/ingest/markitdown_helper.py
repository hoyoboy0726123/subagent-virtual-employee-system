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
        if str(path).lower().endswith(".pdf"):
            markdown = (markdown or "") + _pdf_tables_markdown(path)
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


def _cell(v):
    """One table cell → safe Markdown (no pipes/newlines)."""
    return " ".join(str(v or "").split()).replace("|", "\\|")


def _pdf_tables_markdown(path):
    """Extract genuine tables from a PDF as Markdown tables via pdfplumber.

    MarkItDown's PDF path (pdfminer in the pinned 0.1.x line) flattens tabular
    layouts into loose text and loses row association entirely. pdfplumber
    reconstructs tables from page geometry, so we append them as a clearly
    labelled section AFTER the canonical MarkItDown text. If pdfplumber isn't
    installed, or nothing credible is found, we return "" and the document is
    just the plain conversion, exactly as before — enrichment must never break
    the base pipeline.
    """
    try:
        import pdfplumber
    except Exception:
        return ""
    def credible(rows, strict):
        """Filter out things that are not really tables (stray lines / prose)."""
        if len(rows) < 2 or max(len(r) for r in rows) < 2:
            return False
        if not strict:
            return True
        # Text-strategy tables are inferred from word positions, so prose can
        # masquerade as a table. Demand a consistent rectangular grid with
        # mostly filled cells before we believe it.
        widths = {len(r) for r in rows}
        if len(widths) != 1:
            return False
        cells = [str(c or "").strip() for r in rows for c in r]
        return sum(1 for c in cells if c) / len(cells) >= 0.75

    def to_block(rows, page_no):
        width = max(len(r) for r in rows)
        norm = [list(r) + [""] * (width - len(r)) for r in rows]
        header, body = norm[0], norm[1:]
        lines = [
            "| " + " | ".join(_cell(c) for c in header) + " |",
            "| " + " | ".join(["---"] * width) + " |",
        ]
        lines += ["| " + " | ".join(_cell(c) for c in row) + " |" for row in body]
        return f"（第 {page_no} 頁）\n" + "\n".join(lines)

    # Budget: table enrichment is a nice-to-have that must never blow the base
    # conversion's time budget. Cap pages scanned and wall-clock; the expensive
    # text-strategy pass (per-page word clustering) is skipped once time is
    # tight. flush_cache() keeps memory flat on long PDFs.
    import time
    MAX_PAGES = 60
    TIME_BUDGET_S = 25.0
    started = time.monotonic()
    blocks = []
    try:
        with pdfplumber.open(path) as pdf:
            for page_no, page in enumerate(pdf.pages, start=1):
                if page_no > MAX_PAGES or (time.monotonic() - started) > TIME_BUDGET_S:
                    break
                found = []
                # Primary: ruled tables (cell borders drawn as lines).
                for table in page.extract_tables() or []:
                    rows = [r for r in table if r and any(str(c or "").strip() for c in r)]
                    if credible(rows, strict=False):
                        found.append(rows)
                # Fallback: borderless tables laid out purely by position — infer
                # the grid from text alignment (expensive), only while there's
                # ample time budget left.
                if not found and (time.monotonic() - started) < TIME_BUDGET_S * 0.5:
                    settings = {"vertical_strategy": "text", "horizontal_strategy": "text"}
                    for table in page.extract_tables(settings) or []:
                        rows = [r for r in table if r and any(str(c or "").strip() for c in r)]
                        if credible(rows, strict=True):
                            found.append(rows)
                blocks += [to_block(rows, page_no) for rows in found]
                page.flush_cache()
    except Exception:
        return ""
    if not blocks:
        return ""
    return "\n\n## 文件中的表格（自動抽取）\n\n" + "\n\n".join(blocks)


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
