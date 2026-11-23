import React from 'react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error?.message || 'An unexpected application error occurred.',
    };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('Application ErrorBoundary caught:', error, info);
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#0B0E14] text-[#E6EDF3] flex items-center justify-center p-6">
          <div className="max-w-md w-full border border-[#222A38] rounded-lg bg-[#121721] p-6 space-y-4">
            <h1 className="text-base font-semibold text-[#E6EDF3]">Something went wrong</h1>
            <p className="text-xs text-[#8B98A8] break-words">{this.state.message}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-4 py-2 text-xs font-semibold text-[#0B0E14] bg-amber-500 rounded-md hover:bg-amber-400 cursor-pointer"
            >
              Reload Xypher
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
