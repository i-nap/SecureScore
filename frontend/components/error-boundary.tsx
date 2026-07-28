"use client";

import React, { Component, ErrorInfo } from "react";

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  context?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo });
    // In production, send to error monitoring (e.g., Sentry)
    console.error(`[ErrorBoundary:${this.props.context ?? "unknown"}]`, error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex flex-col items-center justify-center min-h-[300px] p-8 text-center">
          <div className="bg-red-50 border border-red-200 rounded-xl p-6 max-w-lg w-full">
            <div className="flex items-center justify-center w-12 h-12 mx-auto mb-4 bg-red-100 rounded-full">
              <svg className="w-6 h-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-red-800 mb-2">Something went wrong</h3>
            <p className="text-sm text-red-600 mb-4">
              {this.state.error?.message ?? "An unexpected error occurred."}
            </p>
            {this.props.context && (
              <p className="text-xs text-red-400 mb-4 font-mono">
                Context: {this.props.context}
              </p>
            )}
            <button
              onClick={this.handleRetry}
              className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors"
            >
              Try again
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * Lightweight functional wrapper for simpler use cases.
 */
export function withErrorBoundary<P extends object>(
  WrappedComponent: React.ComponentType<P>,
  context?: string
) {
  const ComponentWithBoundary = (props: P) => (
    <ErrorBoundary context={context}>
      <WrappedComponent {...props} />
    </ErrorBoundary>
  );
  ComponentWithBoundary.displayName = `WithErrorBoundary(${WrappedComponent.displayName ?? WrappedComponent.name})`;
  return ComponentWithBoundary;
}
