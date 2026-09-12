import * as React from "react";
import { ComponentErrorCard } from "./ComponentErrorCard";

/**
 * Catches a throw during a component's render.
 *
 * This is the second of two distinct failure mechanisms, and it is not
 * interchangeable with the first: schema validation catches malformed *data*
 * before render, while this catches a component that blows up on data that
 * validated fine. Both are needed to honour "an invalid component renders an
 * error card, it never blanks the report".
 *
 * Class component because React error boundaries have no hooks equivalent —
 * this is the one place in the package that needs one.
 */
export class ComponentErrorBoundary extends React.Component<
    { componentId: string; children: React.ReactNode },
    { error: Error | null }
> {
    state: { error: Error | null } = { error: null };

    static getDerivedStateFromError(error: Error) {
        return { error };
    }

    render() {
        if (this.state.error) {
            return (
                <ComponentErrorCard
                    componentId={this.props.componentId}
                    reason={this.state.error.message}
                />
            );
        }
        return this.props.children;
    }
}
