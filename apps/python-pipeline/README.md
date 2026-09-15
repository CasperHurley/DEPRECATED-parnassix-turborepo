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

## Scanned and handwritten documents

**OCR engine choice is an accuracy decision, not a performance one**, and the
spread is not subtle. Measured on a rasterized copy of the sample agreement:

| Engine | Output |
| --- | --- |
| auto (RapidOCR) | `"Eit   tn  (or t  n  y ts t r t the other party."` |
| `native` (Apple Vision) | `"Either party may terminate this Agreement for convenience upon thirty (30) days written notice to the other party."` |

Same page, same pipeline. The first is unusable as evidence — and it would be
embedded, retrieved and quoted with a *correct* citation attached, pointing at a
real region of a real page containing text the document does not say.

So on macOS the default engine is `native` (Apple's Vision framework, via the
`ocrmac` extra), which also has the best handwriting support of the traditional
engines. Bounding boxes survive OCR intact, so scanned pages are citable exactly
like digital ones.

```sh
uv sync --extra ocrmac
uv run aneural-pipeline ingest scan.pdf --ocr                    # picks native on macOS
uv run aneural-pipeline ingest scan.pdf --ocr --full-page-ocr    # scans with a junk text layer
uv run aneural-pipeline ingest scan.pdf --ocr --ocr-engine tesseract
```

`--full-page-ocr` matters more than it sounds: cheap scanning software often
emits a garbage text layer, which makes layout analysis treat a picture of text
as text and skip OCR on it entirely.

**For difficult handwriting**, traditional OCR is the wrong tool and Docling
ships a VLM pipeline instead — `granite-docling`, `nanonets-ocr2`, `glm-ocr`,
several with **MLX builds** that run natively on Apple Silicon. That path is not
wired up here yet; it is materially slower and needs its own provenance
verification, since a VLM emits layout tokens rather than reading boxes off the
page.

**A document that OCR cannot read is never silently dropped.** It converts
without raising and produces nothing, which is why `IngestReport` tracks
`empty_documents` separately from failures and the CLI exits non-zero.

## Nothing is skipped quietly

A run over a thousand documents will meet a corrupt file, a password-protected
one, and a provider whose extra is not installed. One bad document does not lose
the batch: failures are collected per document and re-reported at the end.

- `report.failures` — documents that raised, with the exception type
- `report.empty_documents` — converted fine, produced no text (the scanned-PDF
  signature)
- `report.ok` — true only if every document attempted actually landed
- the CLI **exits 1** on a partial run, so a script cannot report success having
  skipped documents

## Model selection is per corpus, and by machine

`aneural-pipeline machine` detects total memory and picks a **tier**, and the
tier picks a model per **role**. Roles are separate because their cost profiles
are: embedding a corpus is a big one-off batch, embedding a query for the cache
happens on every request, and generation is where hosted tokens get expensive.

| Tier | Memory | Corpus embed | Cache embed | Generation |
| --- | --- | --- | --- | --- |
| small | < 16 GB | `bge-small-en-v1.5` (384d) | `bge-small-en-v1.5` | `llama3.1` |
| medium | 16–32 GB | `nomic-embed-text` (768d) | `nomic-embed-text` | `llama3.1` |
| large | 32–64 GB | `bge-m3` (1024d) | `nomic-embed-text` (768d) | `qwen2.5:32b` |
| xlarge | 64–128 GB | `bge-m3` | `nomic-embed-text` | `llama3.3:70b` |
| workstation | ≥ 128 GB | `bge-m3` | `nomic-embed-text` | `llama3.3:70b` |
| cluster | pooled (exo) | `bge-m3` *(local)* | `nomic-embed-text` *(local)* | the cluster |

The richer tiers spend their headroom on **generation**, not embedding: `bge-m3`
is already the best local embedding model in the catalogue, so a 256 GB machine
has nothing better to run for that role.

### Pooling machines with exo

[exo](https://github.com/exo-explore/exo) pools several Apple Silicon machines
over Thunderbolt and exposes an OpenAI-compatible API, so a cluster is reachable
through the ordinary `openai-compatible` provider — no special client:

```sh
export ANEURAL_EXO_BASE_URL=http://localhost:8000/v1
uv run aneural-pipeline machine     # reports the cluster, tier becomes `cluster`
```

Two deliberate choices. Detection is **opt-in** rather than probed by default:
exo's head node also listens on :8000, so a default localhost probe could find
*this service's own API* and misread it as a cluster. And a cluster is used for
**generation only** — embedding stays local, because it is a throughput-bound
batch over many small inputs where shipping every chunk across a network costs
more than running a 567M-parameter model on the machine you are already on.

## Providers

| Provider | Use |
| --- | --- |
| `ollama` | Local daemon. The default everywhere. |
| `huggingface` | Local, in-process (`--extra huggingface`). Runs in CI. |
| `openai` | Hosted. Honours `ANEURAL_OPENAI_BASE_URL`, so a gateway can sit in front. |
| `bedrock` | AWS Bedrock (`--extra bedrock`). Hosted, but in the customer's own account and region — often the only acceptable hosted option for privileged documents. Credentials come from the standard AWS chain. |
| `openai-compatible` | Any OpenAI-wire endpoint (`--extra compatible`): exo, vLLM, LM Studio, or an AI gateway. |

### Bringing your own models

The built-in catalogue cannot know about a model released next month or a
private fine-tune. Point `ANEURAL_MODEL_CATALOG` at a JSON file:

```json
{
  "embedding": {
    "my-finetune": {
      "provider": "openai-compatible",
      "dimension": 1024,
      "max_tokens": 8192,
      "base_url": "http://gpu-rig:8000/v1",
      "hf_tokenizer": "BAAI/bge-m3"
    }
  },
  "generation": { "my-llm": { "provider": "ollama", "context_window": 32768 } }
}
```

Overrides may replace built-in entries by name. `dimension` is **mandatory and
never defaulted** — it is the one field that cannot be guessed, because a wrong
value builds an index that accepts every write and fails only at query time. A
catalogue file that is configured but missing is an error, not a shrug: silently
ignoring it would run a whole corpus on the wrong models.

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
