#!/usr/bin/env python3
"""Fetch Xiaomark API help docs and save each page as a Markdown file."""

from __future__ import annotations

import argparse
import datetime as dt
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Iterable, List

try:
    from bs4 import BeautifulSoup
except ImportError as exc:  # pragma: no cover
    raise SystemExit(
        "Missing dependency: beautifulsoup4. Install with `python3 -m pip install --user beautifulsoup4 markdownify`."
    ) from exc

try:
    from markdownify import markdownify as md
except ImportError as exc:  # pragma: no cover
    raise SystemExit(
        "Missing dependency: markdownify. Install with `python3 -m pip install --user beautifulsoup4 markdownify`."
    ) from exc


BASE_URL = "https://xiaomark.com"
INDEX_PATH = "/help/api/"
INDEX_URL = urllib.parse.urljoin(BASE_URL, INDEX_PATH)
UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
)


def fetch_html(url: str, timeout: int = 30) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        charset = resp.headers.get_content_charset() or "utf-8"
        return resp.read().decode(charset, errors="replace")


def dedupe_keep_order(items: Iterable[str]) -> List[str]:
    seen = set()
    out: List[str] = []
    for item in items:
        if item in seen:
            continue
        seen.add(item)
        out.append(item)
    return out


def normalize_help_api_path(href: str) -> str | None:
    if not href:
        return None
    parsed = urllib.parse.urlparse(href)
    path = parsed.path
    if not path.startswith("/help/api"):
        return None
    if path == "/help/api":
        path = "/help/api/"
    # Only keep pages under the API section.
    if not (path == "/help/api/" or path.startswith("/help/api/")):
        return None
    return path


def discover_doc_paths(index_html: str) -> List[str]:
    soup = BeautifulSoup(index_html, "html.parser")
    paths: List[str] = [INDEX_PATH]
    for a in soup.find_all("a", href=True):
        path = normalize_help_api_path(a["href"])
        if path:
            paths.append(path)
    return dedupe_keep_order(paths)


def slug_from_path(path: str) -> str:
    if path in ("/help/api", "/help/api/"):
        return "index"
    slug = path.removeprefix("/help/api/").strip("/")
    return slug or "index"


def clean_html_content(soup: BeautifulSoup) -> None:
    # Remove anchors/buttons injected by docs renderer that are noise in Markdown.
    for tag in soup.select("script, style"):
        tag.decompose()
    for tag in soup.select(".copy-code-button, .anchor-link"):
        tag.decompose()


def code_lang_from_class(el) -> str | None:
    cls = el.get("class", [])
    if not cls:
        return None
    for name in cls:
        if name.startswith("language-"):
            return name.split("language-", 1)[1] or None
    return None


def html_fragment_to_markdown(html_fragment: str) -> str:
    frag = BeautifulSoup(html_fragment, "html.parser")
    clean_html_content(frag)
    text = md(
        str(frag),
        heading_style="ATX",
        bullets="-",
        code_language_callback=code_lang_from_class,
        strip=["style", "script"],
    )
    # Light normalization for readability.
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip() + "\n"


def parse_page(html: str) -> tuple[str, str]:
    soup = BeautifulSoup(html, "html.parser")
    title_el = soup.find("h1")
    body_el = soup.select_one(".html-content")
    if not title_el or not body_el:
        raise ValueError("Could not locate page title/body in document")
    title = title_el.get_text(" ", strip=True)
    body_md = html_fragment_to_markdown(str(body_el))
    return title, body_md


def write_markdown_file(path: Path, title: str, source_url: str, body_md: str) -> None:
    fetched = dt.datetime.now().astimezone().strftime("%Y-%m-%d %H:%M:%S %z")
    content = (
        f"# {title}\n\n"
        f"- Source: {source_url}\n"
        f"- Fetched: {fetched}\n\n"
        f"{body_md}"
    )
    path.write_text(content, encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--out-dir",
        default="docs/xiaomark-api",
        help="Directory to save generated Markdown files (default: docs/xiaomark-api)",
    )
    parser.add_argument("--delay", type=float, default=0.15, help="Delay between requests (seconds)")
    args = parser.parse_args()

    out_dir = Path(args.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"Fetching index: {INDEX_URL}")
    index_html = fetch_html(INDEX_URL)
    paths = discover_doc_paths(index_html)
    print(f"Discovered {len(paths)} API doc pages.")

    entries = []
    failures = []
    for i, path in enumerate(paths, start=1):
        url = urllib.parse.urljoin(BASE_URL, path)
        slug = slug_from_path(path)
        filename = f"{i:02d}-{slug}.md"
        target = out_dir / filename
        try:
            html = fetch_html(url)
            title, body_md = parse_page(html)
            write_markdown_file(target, title, url, body_md)
            entries.append((i, title, url, filename))
            print(f"[{i:02d}/{len(paths):02d}] OK  {path} -> {filename}")
        except Exception as exc:  # pragma: no cover
            failures.append((path, str(exc)))
            print(f"[{i:02d}/{len(paths):02d}] ERR {path}: {exc}", file=sys.stderr)
        time.sleep(max(args.delay, 0))

    readme = out_dir / "README.md"
    lines = [
        "# Xiaomark API Docs (Local Markdown Export)",
        "",
        f"- Source index: {INDEX_URL}",
        f"- Exported pages: {len(entries)}",
        "",
        "## Files",
        "",
    ]
    for i, title, url, filename in entries:
        lines.append(f"- `{filename}`: [{title}]({url})")
    if failures:
        lines.extend(["", "## Failures", ""])
        for path, err in failures:
            lines.append(f"- `{path}`: {err}")
    lines.append("")
    readme.write_text("\n".join(lines), encoding="utf-8")

    if failures:
        print(f"Completed with {len(failures)} failures.", file=sys.stderr)
        return 1
    print(f"Completed successfully. Files saved to: {out_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
