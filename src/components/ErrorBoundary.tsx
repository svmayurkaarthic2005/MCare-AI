import React from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error | null;
}

export class ErrorBoundary extends React.Component<React.PropsWithChildren<{}>, ErrorBoundaryState> {
  constructor(props: React.PropsWithChildren<{}>) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error } as ErrorBoundaryState;
  }

  componentDidCatch(error: Error, info: any) {
    // eslint-disable-next-line no-console
    console.error("Uncaught error in component tree:", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <Card className="p-6">
          <h3 className="text-lg font-semibold">Something went wrong</h3>
          <p className="text-sm text-muted-foreground mt-2">An error occurred while rendering this section.</p>
          <div className="mt-4">
            <Button onClick={() => this.setState({ hasError: false, error: null })}>Try again</Button>
          </div>
          {this.state.error && (
            <pre className="mt-4 text-xs text-muted-foreground">{String(this.state.error.message)}</pre>
          )}
        </Card>
      );
    }

    return this.props.children as React.ReactElement;
  }
}

export default ErrorBoundary;
