# `apps/python-pipeline`

**The worked example.** This app used to *be* the document pipeline — about 2,700 lines of
conversion, chunking, provenance, embeddings, a vector store, a semantic cache, hardware
tiering and retrieval. None of that was specific to reports, to evidentiary work, or to
Parnassix, so it was extracted into [`parnassix`](../../../Pythoness/pythoness) — the
`pythoness` library — and this app now consumes it.

What is left is what a consumer actually has to write, which is the point:

| File | Lines | What it is |
| --- | --- | --- |
| `wire.py` | ~20 of code | `ReportSchemaWire` — this project's `SourceRef` spelling, validated against its own contract |
| `report/` | ~200 + generated | The contract: Pydantic models generated from the Zod schema, plus the cross-field rules JSON Schema cannot carry |
| `api/app.py` | ~110 | The library's tool routes, mounted, plus three contract endpoints |
| `cli.py` | ~100 | The report-specific commands. Everything else is `parnassix` |

Everything below the `Fragment` boundary — Docling, the conversion cache, the coordinate
flip, stable node ids, the index guard, the semantic cache — is tested in `pythoness`, not
here. What is tested here is the contract.

## The integration, in one file

`pythoness` establishes **where** a fact came from: a document, a page, boxes on it, the page
size. It knows nothing about what any consumer calls those fields. A consumer brings a
`WireFormat` and gets its own spelling:

```python
class ReportSchemaWire(CamelWire):
    def source_ref(self, locator, *, document_id, node_id):
        ref = super().source_ref(locator, document_id=document_id, node_id=node_id)
        validate_source_ref(ref)      # round-trips through the generated SourceRef
        return ref

register_wire("report-schema", ReportSchemaWire())
```

`pythoness.toml` then names it:

```toml
[settings]
imports = ["parnassix_pipeline.wire"]   # so the name resolves

[[corpus]]
name = "default"
wire = "report-schema"
```

**This is a guarantee the old code did not have.** `ingest/provenance.py` built
`{documentId, nodeId, page, bbox, coordOrigin, pageSize, quotedText}` inline, with hardcoded
camelCase keys mirroring `packages/report-schema/src/source.ts` — a *shape* coupling with no
import, so nothing could detect drift. Now the dict is parsed by the model generated from the
committed JSON Schema, and a ref that does not satisfy the contract fails during ingestion
rather than in the renderer three steps later.

**It refuses anything that is not a page.** `SourceRef` is a document, a page and boxes; it
has no spelling for a table or a recorded SQL statement, so `CamelWire` raises on those
locator kinds rather than inventing one. That is deliberate. Emitting a made-up camelCase
shape for a query citation would produce something the renderer's validator rejects — *after*
a corpus had been built. If Parnassix ever needs a database source, the Zod contract grows a
variant first and `wire.py` follows it.

## Why not just tell the LLM to copy the coordinates

The obvious design is to put `bbox` values in the LLM's context and instruct it to copy them
into its JSON output. Don't. A model asked to copy numbers usually copies them, and "usually"
is not something a citation can rest on — it can transpose a digit, average two boxes, or
attach page 4's coordinates to page 5's sentence. Every one of those failures **validates**: a
well-formed citation pointing at the wrong place, which is worse than no citation because it
looks checked.

So the model never sees a coordinate and never emits one. It emits a `nodeId`, and
`POST /citations/resolve` turns ids into provenance from the index. An invented id lands in
`unresolved` instead of becoming a plausible lie. That rule now lives in the library, enforced
structurally: a `Fragment` keeps its locators in a different field from its text, so there is
nothing to leak.

## Quick start

```sh
pnpm --filter python-pipeline build     # uv sync + generate Pydantic models and schema.json
parnassix sync                                 # convert, embed, index ./samples
parnassix query "what is the liability cap?"   # passages with report-schema refs
parnassix cite <nodeId>                        # resolve one citation
```

No Docker and no Ollama are required: the library's default vector store is embedded and its
floor-tier embedding model runs in process. Set `storage = "redis"` in `pythoness.toml` and run
`pnpm --filter python-pipeline redis:up` to use Redis instead.

The report-specific commands live under `parnassix-pipeline`:

```sh
uv run parnassix-pipeline contract              # which contract version this build carries
uv run parnassix-pipeline check refs.json       # validate agent output against it
uv run parnassix-pipeline serve                 # the HTTP surface
```

## The HTTP surface

`build_routes(app)` mounts the library's entire tool registry, so this app does not describe,
validate or version a single one of those routes:

| From | Routes |
| --- | --- |
| `pythoness` | `/health`, `/search`, `/citations/resolve`, `/citations/pin`, `/fragments/get`, `/corpora/list`, `/sync`, `/tables/list`, `/tables/describe`, `/sql/query` |
| here | `/contract`, `/contract/source-ref`, `/contract/time-span` |

The three local ones exist because the agent workflow layer needs the same checks the ingestion
path applies, and a second implementation of them in NestJS is how the two would come to
disagree.

The same tools are also reachable over MCP — `parnassix mcp`, or `parnassix init --claude` to register this
corpus with Claude.

## The two-repository cost, stated plainly

`parnassix` is consumed as an **editable path dependency** (`../../../../Pythoness/pythoness`),
because it is not published yet. Two consequences:

- This app does not build on a machine without that checkout beside this repo.
- The library sits outside the turbo workspace, so **turbo will not invalidate this app's cache
  when pythoness changes.** `pretest` runs `uv sync` so tests cannot run against a stale
  install; that is a mitigation, not a fix.

Both go away when `parnassix` is published: the path dep becomes a pinned version, and a bump
is a `uv.lock` change that turbo's existing `inputs` already watches.

## The contract, and where it lives on disk

`report/_generated.py` and `report/schema.json` are **build outputs**, generated from
`packages/report-schema/schema/report-schema.json` by `scripts/generate_models.py`. Neither is
committed — a second copy of the contract in the repository is a second copy that can drift.

`report/validate.py` reads `schema.json` through `importlib.resources`. It used to walk six
directory levels up to the schema package, which resolved from a checkout and from nowhere
else: installed as a wheel, `SCHEMA_VERSION` silently became `"unknown"`, and the index
metadata then recorded a corpus as built against a contract nobody could name.

`report/validate.py` is a deliberate second implementation of rules that already exist in
TypeScript, and that cost is worth naming: two copies can drift. The alternative is worse —
without it, an agent emits a spec, Pydantic accepts it, it crosses the wire, and the *renderer*
rejects it, so the retry loop that is supposed to catch agent mistakes never sees them.
`tests/test_contract.py` pins both implementations to the same examples.

## Tests

```sh
pnpm --filter python-pipeline test
```

- `test_contract.py` — the cross-field rules, byte-unchanged from before the extraction.
- `test_wire.py` — that `ReportSchemaWire` emits exactly the seven contract keys, that every
  ref validates against the generated model, that a bottomleft box with no `pageSize` is
  refused, and that a non-page locator is refused too. Includes an end-to-end pass over the
  sample PDF, because the shape coupling this replaces was invisible to every tool.

`test_provenance.py`, `test_registry.py`, `test_resilience.py` and `test_index_guard.py` moved
to `pythoness` with the code they covered.
