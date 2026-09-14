# `apps/python-pipeline`

Documents in, **citable** passages out.

This is the service that turns a PDF into embeddings *and* into the per-fact
provenance the frontend needs to circle a region of the source page. Everything
here exists to make one sentence true: a fact shown in a report can be pointed
at, on the page it came from, and the pointer is produced by this pipeline
rather than by a language model.

## Why not just tell the LLM to copy the coordinates

The obvious design is to put `bbox` values in the LLM's context and instruct it
to copy them into its JSON output. Don't. A model asked to copy numbers usually
copies them, and "usually" is not something a citation can rest on — it can
transpose a digit, average two boxes, or attach page 4's coordinates to page 5's
sentence. Every one of those failures **validates**: a well-formed citation
pointing at the wrong place, which is worse than no citation at all because it
looks checked.

So the model never sees a coordinate (`ingest/nodes.py:PROVENANCE_KEYS` excludes
them from its view) and never emits one. It emits a `nodeId` — a value it either
retrieved or did not. `POST /citations/resolve` turns ids into provenance from
the index. An invented id lands in `unresolved` instead of becoming a plausible
lie. There is a test asserting coordinates never reach the model's view.

## Quick start

```sh
pnpm --filter python-pipeline redis:up      # Redis Stack (RediSearch + semantic cache)
uv sync                                     # or: pnpm --filter python-pipeline build
uv run python scripts/make_sample_pdf.py    # a 3-page fixture with known content

uv run aneural-pipeline machine                                 # what this box will pick
uv run aneural-pipeline ingest samples/sample-agreement.pdf --corpus demo
uv run aneural-pipeline query "What is the liability cap?" --corpus demo
uv run aneural-pipeline serve                                   # HTTP on :8000
```

Ollama must be running, with an embedding model pulled (`ollama pull bge-m3`).

## Model selection is per corpus, and by machine

`aneural-pipeline machine` detects total memory and picks a **tier**, and the
tier picks a model per **role**. Roles are separate because their cost profiles
are: embedding a corpus is a big one-off batch, embedding a query for the cache
happens on every request, and generation is where hosted tokens get expensive.

| Tier | Memory | Corpus embed | Cache embed | Generation |
| --- | --- | --- | --- | --- |
| small | < 16 GB | `bge-small-en-v1.5` (384d) | `bge-small-en-v1.5` | `llama3.1` |
| medium | 16–32 GB | `nomic-embed-text` (768d) | `nomic-embed-text` | `llama3.1` |
| large | ≥ 32 GB | `bge-m3` (1024d) | `nomic-embed-text` (768d) | `qwen2.5:32b` |

Note the large tier deliberately does **not** use `bge-m3` for the cache: the
cache embeds one short query per request and its vectors are never compared
against corpus vectors, so the small model is strictly the better trade.

**No tier ever defaults to a hosted model** — pinned by a test. Detection must
never be the reason a run starts costing money or sends privileged documents off
the machine. Hosted models are reachable, but only by asking:

```sh
uv run aneural-pipeline ingest doc.pdf --embedding text-embedding-3-large
ANEURAL_TIER=small uv run aneural-pipeline machine    # force a tier
```

Because embedding dimension is baked into an index at creation, **the index name
contains the model identity**. Indexing one corpus under two models produces two
coexisting indexes rather than one corrupt one, which is what makes this work:

```sh
uv run aneural-pipeline compare "What is the liability cap?" samples/*.pdf
```

Conversion is cached by content hash, so `compare` re-runs only the embedding
step.

## The coordinate problem

PDF boxes are bottom-left origin; renderers are top-left. Three facts, all
verified against a real conversion rather than taken from documentation:

1. Docling emits `coord_origin: "BOTTOMLEFT"` for PDF content, serialized
   **uppercase**, where the wire contract's enum is lowercase.
2. In bottom-left space **`t > b`** — `t` is the visually-upper edge and holds
   the *larger* y. Treating `t` as a screen-space top mirrors every highlight
   about the page midline, which reads as a plausible offset rather than a bug.
3. **Page dimensions are not in chunk metadata.** They live on
   `DoclingDocument.pages` and are gone by the time chunks exist, so they are
   captured at conversion and carried alongside. Without them a bottom-left box
   cannot be flipped and a box in points cannot be scaled to a rendered page.

By default the pipeline flips to top-left at ingestion using docling's own
`BoundingBox.to_top_left_origin`, and says so in `coordOrigin`. `pageSize` is
always sent regardless, because the renderer needs it to scale points onto
whatever width it drew the page at. `--raw-coords` emits Docling's native
bottom-left boxes instead; either way the stated origin matches the coordinates
actually sent, which is asserted by tests in both directions.

## What is fixed relative to the stock integrations

`llama-index-node-parser-docling` is deliberately **not** used directly:

- It assigns `uuid4` node ids. Re-ingesting an unchanged document would produce
  entirely new ids, so every `SourceRef` in every previously generated report
  would stop resolving — citations would rot on reindex. Ids here are derived
  from content and are stable across runs (and *change* when the text changes,
  so an id never silently rebinds to different words).
- It ends with `node.metadata = metadata`, overwriting anything set on the
  source document — including the document id.

One more shape difference worth knowing: a `SourceRef` carries one `page` and
many `bbox`es, but a chunk can straddle a page break. Such a chunk produces
**one ref per page**, all sharing a `nodeId`.

## The contract

Wire types are authored in Zod in `packages/report-schema`, emitted as JSON
Schema, and generated into Pydantic here by `scripts/generate_models.py`
(`src/aneural_pipeline/report/_generated.py`, gitignored — committing it would
create a second copy of the contract that can drift). Turbo orders this app's
build after the schema package, so the JSON being read is always current.

JSON Schema cannot express cross-field rules, so the `superRefine`s in
`primitives.ts` do not survive codegen. `report/validate.py` reimplements them.
That is a real duplication cost; the alternative is worse — without it an agent
emits a spec, Pydantic accepts it, and the *renderer* rejects it, so the retry
loop that exists to catch agent mistakes never sees the mistake.

## Semantic cache

Runs on the same Redis Stack instance as the vector index. It caches the answer
**and its citations together**: they are one artifact, and re-resolving
citations on a cache hit against a possibly-reindexed corpus would let the two
disagree.

The threshold is a **distance** — lower is tighter. The default of `0.25` is
measured, not guessed: on the sample corpus with `nomic-embed-text`, paraphrases
of one question sit at 0.12–0.22 while genuinely different questions about the
same document sit at 0.49+. The gap is wide enough to put the threshold between
them. The original `0.1` sat *inside* the paraphrase band, so the cache only hit
on byte-identical questions and earned nothing.

Re-measure for your own corpus before trusting it — a cache that answers a
question the user did not ask is worse than a miss, because the stale answer
arrives carrying citations that make it look verified.

## Commands

| Command | Does |
| --- | --- |
| `aneural-pipeline machine` | Detected tier and the models it implies |
| `aneural-pipeline models` | The catalogue, with dimensions and context windows |
| `aneural-pipeline ingest PATHS` | Convert, chunk, embed, index. Reports provenance coverage |
| `aneural-pipeline query Q` | Retrieve passages with citations resolved |
| `aneural-pipeline compare Q PATHS` | Index under several models and compare |
| `aneural-pipeline info` | Index state and the models that built it |
| `aneural-pipeline serve` | HTTP API |

Useful flags: `--ocr` (scanned PDFs — off by default because it roughly triples
conversion time; sparse output is detected and warned about instead),
`--min-score` (drop weak passages rather than returning the least-bad chunk),
`--raw-coords`, `--overwrite`.

## HTTP API

| Route | Purpose |
| --- | --- |
| `GET /health` | Status, schema version, detected machine |
| `GET /corpora/{corpus}` | Index stats and the metadata that built it |
| `POST /query` | Retrieve passages with citations; semantic-cached |
| `POST /citations/resolve` | node ids → provenance. The deterministic half of citation |

Note what is absent: no endpoint accepts coordinates from a caller. Provenance
is produced here or it does not exist.

## Notes

- Python is pinned to **3.13**: `llama-index-vector-stores-redis` declares
  `<3.14`, and `redisvl` is held at the 0.4 line by that same package.
- Docling uses **MPS** on Apple Silicon automatically.
- `provenance coverage` in the ingest summary is the fraction of nodes that can
  be cited. Below 100% means some chunks can be retrieved and quoted but not
  pointed at — worth knowing before a report is built on them.
