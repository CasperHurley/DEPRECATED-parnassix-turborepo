import { z } from "zod";

/**
 * Provenance: where a rendered fact actually came from.
 *
 * Citation granularity is per-fact, not per-component — a single timeline event
 * or table cell carries its own SourceRef. See CLAUDE.md ("Provenance is
 * per-fact, first-class").
 *
 * Shape is provisional and tracks what LlamaIndex + Docling emit; it will be
 * firmed up as the Python ingestion service matures.
 */

/**
 * A bounding box in the source document's own coordinate space.
 * Field names follow Docling's convention (left/top/right/bottom).
 */
export const BBoxSchema = z.object({
  l: z.number(),
  t: z.number(),
  r: z.number(),
  b: z.number(),
});
export type BBox = z.infer<typeof BBoxSchema>;

/**
 * Which corner a bbox's origin sits in. PDFs are conventionally bottom-left
 * while renderers are top-left, so this is carried explicitly rather than
 * assumed — a highlight overlay needs the page height to flip BOTTOMLEFT boxes.
 * Getting this wrong renders highlights mirrored vertically, which is the kind
 * of bug that looks like a rounding error for a week.
 */
export const CoordOrigin = {
  TopLeft: "topleft",
  BottomLeft: "bottomleft",
} as const;
export type CoordOrigin = (typeof CoordOrigin)[keyof typeof CoordOrigin];
export const CoordOriginSchema = z.enum(CoordOrigin);

export const SourceRefSchema = z.object({
  /** The source document this fact was extracted from. */
  documentId: z.string().min(1),
  /** Stable LlamaIndex node id, for round-tripping back to the extraction. */
  nodeId: z.string().min(1),
  /** 1-based page number within the source document. */
  page: z.number().int().positive(),
  /**
   * The region(s) to highlight. An array because a quoted fact routinely spans
   * more than one line, and each line is its own box.
   */
  bbox: z.array(BBoxSchema).default([]),
  coordOrigin: CoordOriginSchema.default(CoordOrigin.BottomLeft),
  /**
   * Source page dimensions. Required in practice to render a highlight: a
   * BOTTOMLEFT bbox cannot be flipped into the renderer's TOPLEFT space without
   * the page height. Optional only because this whole shape is provisional.
   */
  pageSize: z
    .object({ width: z.number().positive(), height: z.number().positive() })
    .optional(),
  /** Embedding chunk that produced this match, when retrieval drove it. */
  chunkId: z.string().optional(),
  /** Verbatim source text, for footnote-style rendering on export. */
  quotedText: z.string().optional(),
});
export type SourceRef = z.infer<typeof SourceRefSchema>;
