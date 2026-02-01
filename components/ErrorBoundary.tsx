import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
    children: ReactNode;
    fallback?: ReactNode;
    componentName?: string;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
    public state: State = {
        hasError: false,
        error: null
    };

    public static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error(`Uncaught error in ${this.props.componentName || 'Component'}:`, error, errorInfo);
    }

    public render() {
        if (this.state.hasError) {
            if (this.props.fallback) {
                return this.props.fallback;
            }

            return (
                <div className="p-6 bg-red-50 border border-red-200 rounded-xl flex flex-col items-center justify-center text-center h-full min-h-[200px]">
                    <div className="w-12 h-12 bg-red-100 text-red-600 rounded-full flex items-center justify-center mb-4">
                        <AlertTriangle size={24} />
                    </div>
                    <h3 className="text-lg font-bold text-red-800 mb-2">
                        Algo salió mal en {this.props.componentName || 'este componente'}
                    </h3>
                    <p className="text-sm text-red-600 mb-4 max-w-md">
                        {this.state.error?.message || 'Ocurrió un error inesperado al renderizar esta sección.'}
                    </p>
                    <button
                        onClick={() => this.setState({ hasError: false, error: null })}
                        className="px-4 py-2 bg-white border border-red-200 text-red-700 rounded-lg font-bold text-sm hover:bg-red-50 flex items-center gap-2 shadow-sm"
                    >
                        <RefreshCw size={16} /> Intentar de nuevo
                    </button>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
