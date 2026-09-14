"""Command line entry point: ingest, query, inspect, compare."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Annotated

import typer
from rich.console import Console
from rich.table import Table

from .config import CorpusConfig, get_settings
from .hardware import detect_machine
from .index import CorpusStore
from .ingest import ConversionOptions, ingest
from .models import EMBEDDING_MODELS, GENERATION_MODELS
from .report import SCHEMA_VERSION
from .retrieval import CorpusRetriever

app = typer.Typer(
    add_completion=False,
    help="Aneural document pipeline: PDFs in, citable passages out.",
)
console = Console()


def _setup_logging(verbose: bool) -> None:
    logging.basicConfig(
        level=logging.INFO if verbose else logging.WARNING,
        format="%(levelname)s %(name)s: %(message)s",
    )
    # Docling's model loaders are extremely chatty at INFO and drown out the
    # pipeline's own progress.
    for noisy in ("docling", "urllib3", "httpx", "transformers", "RapidOCR"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


def _corpus(
    name: str,
    embedding: str | None,
    generation: str | None,
    cache: str | None,
) -> CorpusConfig:
    return CorpusConfig.build(
        name,
        embedding_model=embedding,
        generation_model=generation,
        cache_model=cache,
    )


@app.command()
def machine() -> None:
    """Show what this machine was detected as, and what it will pick."""
    m = detect_machine()
    console.print(f"[bold]{m.describe()}[/bold]")
    config = CorpusConfig.build("example")
    console.print(config.describe())
    console.print(
        "\n[dim]Override with ANEURAL_TIER=small|medium|large, or pass "
        "--embedding / --generation explicitly.[/dim]"
    )


@app.command(name="models")
def list_models() -> None:
    """List the model catalogue with dimensions and context windows."""
    table = Table(title="Embedding models")
    for col in ("name", "provider", "dims", "max tokens", "notes"):
        table.add_column(col, overflow="fold")
    for m in EMBEDDING_MODELS.values():
        table.add_row(
            m.name, m.provider.value, str(m.dimension), str(m.max_tokens), m.notes
        )
    console.print(table)

    table = Table(title="Generation models")
    for col in ("name", "provider", "context", "notes"):
        table.add_column(col, overflow="fold")
    for g in GENERATION_MODELS.values():
        table.add_row(g.name, g.provider.value, str(g.context_window), g.notes)
    console.print(table)


@app.command(name="ingest")
def ingest_command(
    paths: Annotated[list[Path], typer.Argument(help="Documents to ingest")],
    corpus: Annotated[str, typer.Option(help="Corpus name")] = "default",
    embedding: Annotated[str | None, typer.Option(help="Embedding model")] = None,
    generation: Annotated[str | None, typer.Option(help="Generation model")] = None,
    cache: Annotated[str | None, typer.Option(help="Cache embedding model")] = None,
    ocr: Annotated[bool, typer.Option(help="Run OCR (needed for scanned PDFs)")] = False,
    overwrite: Annotated[bool, typer.Option(help="Drop the index first")] = False,
    raw_coords: Annotated[
        bool,
        typer.Option(
            "--raw-coords",
            help="Emit Docling's native bottomleft boxes instead of flipping to topleft",
        ),
    ] = False,
    verbose: Annotated[bool, typer.Option("-v", "--verbose")] = False,
) -> None:
    """Convert, chunk, embed and index documents."""
    _setup_logging(verbose)
    config = _corpus(corpus, embedding, generation, cache)
    console.print(config.describe())

    report = ingest(
        list(paths),
        config,
        get_settings(),
        SCHEMA_VERSION,
        conversion=ConversionOptions(ocr=ocr),
        overwrite=overwrite,
        to_topleft=not raw_coords,
    )

    console.print(
        f"\n[green]indexed[/green] {report.node_count} nodes from "
        f"{len(report.documents)} document(s), {report.pages} pages "
        f"in {report.seconds:.1f}s"
    )
    coverage = report.provenance_coverage
    style = "green" if coverage == 1.0 else "yellow"
    console.print(
        f"[{style}]provenance coverage: {coverage:.1%}[/{style}]"
        + (
            f"  ({report.nodes_without_provenance} node(s) cannot be cited)"
            if report.nodes_without_provenance
            else ""
        )
    )


@app.command()
def query(
    question: Annotated[str, typer.Argument(help="What to ask the corpus")],
    corpus: Annotated[str, typer.Option()] = "default",
    embedding: Annotated[str | None, typer.Option()] = None,
    top_k: Annotated[int, typer.Option("-k", "--top-k")] = 5,
    min_score: Annotated[
        float | None,
        typer.Option(help="Drop passages below this similarity rather than returning them"),
    ] = None,
    as_json: Annotated[bool, typer.Option("--json")] = False,
    verbose: Annotated[bool, typer.Option("-v", "--verbose")] = False,
) -> None:
    """Retrieve passages, with their citations resolved."""
    _setup_logging(verbose)
    config = _corpus(corpus, embedding, None, None)
    retriever = CorpusRetriever(config, get_settings(), SCHEMA_VERSION)
    passages = retriever.retrieve(question, top_k=top_k, min_score=min_score)

    if as_json:
        console.print_json(json.dumps([p.as_dict() for p in passages]))
        return

    if not passages:
        # The honest answer, and the one CLAUDE.md asks for over a synthesized
        # one: nothing in the corpus met the bar.
        console.print("[yellow]No passage in this corpus met the threshold.[/yellow]")
        return

    for i, p in enumerate(passages, 1):
        score = f"{p.score:.3f}" if p.score is not None else "—"
        console.print(f"\n[bold]{i}. {p.source_file}[/bold]  score {score}")
        if p.headings:
            console.print(f"   [dim]{p.headings}[/dim]")
        console.print(f"   {p.text.strip()[:300]}")
        if not p.is_citable:
            console.print("   [red]No source recorded[/red]")
            continue
        for ref in p.source_refs:
            boxes = len(ref.get("bbox", []))
            console.print(
                f"   [cyan]page {ref['page']}[/cyan] · {boxes} region(s) · "
                f"{ref['coordOrigin']}"
            )


@app.command()
def info(
    corpus: Annotated[str, typer.Option()] = "default",
    embedding: Annotated[str | None, typer.Option()] = None,
) -> None:
    """Show an index's state and the models that built it."""
    config = _corpus(corpus, embedding, None, None)
    store = CorpusStore(config, get_settings(), SCHEMA_VERSION)
    console.print_json(json.dumps(store.stats(), default=str))


@app.command()
def serve(
    host: Annotated[str | None, typer.Option()] = None,
    port: Annotated[int | None, typer.Option()] = None,
    reload: Annotated[bool, typer.Option()] = False,
) -> None:
    """Run the HTTP API."""
    import uvicorn

    settings = get_settings()
    uvicorn.run(
        "aneural_pipeline.api.app:app",
        host=host or settings.api_host,
        port=port or settings.api_port,
        reload=reload,
    )


@app.command()
def compare(
    question: Annotated[str, typer.Argument()],
    paths: Annotated[list[Path], typer.Argument(help="Documents to index under each model")],
    models: Annotated[
        str, typer.Option(help="Comma-separated embedding models")
    ] = "bge-m3,nomic-embed-text,mxbai-embed-large",
    corpus: Annotated[str, typer.Option()] = "compare",
    top_k: Annotated[int, typer.Option("-k", "--top-k")] = 3,
    verbose: Annotated[bool, typer.Option("-v", "--verbose")] = False,
) -> None:
    """Index the same documents under several embedding models and compare results.

    Each model gets its own index (dimensions differ, so they cannot share one),
    and conversion is cached, so only the embedding step is repeated. This is
    the cheap way to answer "is the bigger model actually better on MY
    documents" rather than on a public benchmark.
    """
    _setup_logging(verbose)
    settings = get_settings()
    results: list[tuple[str, float, list]] = []

    for name in [m.strip() for m in models.split(",") if m.strip()]:
        config = CorpusConfig.build(corpus, embedding_model=name)
        console.print(f"\n[bold]{name}[/bold] ({config.embedding.dimension}d)")
        report = ingest(
            list(paths), config, settings, SCHEMA_VERSION, overwrite=True
        )
        retriever = CorpusRetriever(config, settings, SCHEMA_VERSION)
        passages = retriever.retrieve(question, top_k=top_k)
        results.append((name, report.seconds, passages))

    table = Table(title=f"Top {top_k} for: {question}")
    table.add_column("model")
    table.add_column("index time", justify="right")
    for i in range(top_k):
        table.add_column(f"#{i + 1}", overflow="fold")
    for name, seconds, passages in results:
        cells = []
        for i in range(top_k):
            if i < len(passages):
                p = passages[i]
                score = f"{p.score:.3f}" if p.score is not None else "—"
                page = p.source_refs[0]["page"] if p.source_refs else "?"
                cells.append(f"p{page} {score}\n{p.text.strip()[:60]}")
            else:
                cells.append("—")
        table.add_row(name, f"{seconds:.1f}s", *cells)
    console.print(table)


if __name__ == "__main__":
    app()
