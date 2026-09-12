import * as React from "react";

/**
 * The medium and box a report is being rendered into.
 *
 * Deliberately NOT part of @repo/report-schema: render context is decided by
 * the client at render time, not by an agent, so it is not part of the wire
 * contract.
 *
 * No component owns its own dimensions. The same report has to render to a
 * phone, a slide, letter paper, and a poster board, so components lay out from
 * the box they are given. See CLAUDE.md ("Render context in the type system").
 */

export type RenderMedium = "screen" | "print" | "slide";

export interface RenderContextValue {
    medium: RenderMedium;
    /** Available width in px. 0 means "not yet measured". */
    width: number;
    /** Available height in px. 0 means "not yet measured". */
    height: number;
}

export const defaultRenderContext: RenderContextValue = {
    medium: "screen",
    width: 0,
    height: 0,
};

const RenderContext = React.createContext<RenderContextValue>(defaultRenderContext);

export function RenderContextProvider({
    value,
    children,
}: {
    value: Partial<RenderContextValue>;
    children: React.ReactNode;
}) {
    const resolved = React.useMemo(
        () => ({ ...defaultRenderContext, ...value }),
        [value.medium, value.width, value.height],
    );
    return <RenderContext.Provider value={resolved}>{children}</RenderContext.Provider>;
}

export function useRenderContext(): RenderContextValue {
    return React.useContext(RenderContext);
}

/**
 * True when the output is a fixed page rather than an interactive surface.
 * Hover-only affordances (including citation popovers) must not be the only way
 * to reach information when this is true.
 */
export function useIsStaticMedium(): boolean {
    const { medium } = useRenderContext();
    return medium !== "screen";
}
