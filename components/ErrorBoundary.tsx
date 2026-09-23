import React from 'react';

interface ErrorBoundaryState {
    hasError: boolean;
}

// Safety net: catches any unhandled render/lifecycle error and shows a
// recovery screen instead of leaving the user on a frozen blank screen.
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, ErrorBoundaryState> {
    state: ErrorBoundaryState = { hasError: false };
    private reloadButtonRef = React.createRef<HTMLButtonElement>();

    static getDerivedStateFromError(): ErrorBoundaryState {
        return { hasError: true };
    }

    componentDidCatch(error: Error, info: React.ErrorInfo) {
        console.error('Unhandled app error', error, info.componentStack);
    }

    componentDidUpdate(_: unknown, prevState: ErrorBoundaryState) {
        // Move focus to the button so screen readers land on the recovery action
        if (this.state.hasError && !prevState.hasError) {
            this.reloadButtonRef.current?.focus();
        }
    }

    render() {
        if (!this.state.hasError) return this.props.children;

        return (
            <main
                className="min-h-screen bg-[#001F3F] flex flex-col items-center justify-center gap-6 p-6 text-center text-white"
                style={{ height: '100dvh' }}
            >
                <div role="alert" className="space-y-3">
                    <h1 className="font-black text-2xl uppercase">Something went wrong</h1>
                    <p className="text-white/80 text-base">
                        The app hit an unexpected error. Your notes are safe — reload to continue.
                    </p>
                </div>
                <button
                    ref={this.reloadButtonRef}
                    type="button"
                    onClick={() => window.location.reload()}
                    className="px-8 py-5 bg-white text-[#001F3F] font-black rounded-2xl text-xl uppercase active:scale-95 transition-all"
                >
                    Reload App
                </button>
            </main>
        );
    }
}

export default ErrorBoundary;
