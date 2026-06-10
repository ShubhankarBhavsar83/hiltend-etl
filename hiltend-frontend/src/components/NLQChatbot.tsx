import { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Loader2, Copy, RefreshCw } from 'lucide-react';
import { useApiClient } from '../hooks/useApiClient';
import axios from 'axios';

export interface PaginationData {
    total_records: number;
    current_page: number;
    page_size: number;
    total_pages: number;
}

export interface ChartConfig {
    chartType: "bar" | "line" | "area" | "pie" | "donut" | "radar" | "radial";
    xAxis: string;
    yAxis: string[];
}

interface NLQChatbotProps {
    datasetName: string;
    selectedColumns: string[];
    enableCharts?: boolean;
    onDataResult: (
        data: Record<string, string | number | boolean | null>[],
        columns: string[],
        pagination: PaginationData,
        sql: string,
        chartConfig?: ChartConfig
    ) => void;

}

interface Message {
    role: 'user' | 'assistant';
    text: string;
    sql?: string;
}

export function NLQChatbot({ datasetName, selectedColumns, enableCharts, onDataResult }: NLQChatbotProps) {
    const apiClient = useApiClient();
    const [messages, setMessages] = useState<Message[]>([
        { role: 'assistant', text: 'Ask me a question about your data, or select columns on the left to focus the query.' }
    ]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, isLoading]);

    const handleCopy = (text: string) => {
        navigator.clipboard.writeText(text);
    };

    const handleSend = async (overrideText?: string | React.MouseEvent) => {
        const userMsg = typeof overrideText === 'string' ? overrideText : input;
        if (!userMsg.trim() || !datasetName) return;

        setMessages(prev => [...prev, { role: 'user', text: userMsg }]);
        if (typeof overrideText !== 'string') setInput('');
        setIsLoading(true);

        try {
            const endpoint = enableCharts
                ? `/api/v1/datasets/${datasetName}/nlq-chart`
                : `/api/v1/datasets/${datasetName}/nlq`;

            const res = await apiClient.post(endpoint, {
                prompt: input,
                selected_columns: selectedColumns
            });

        // Fixed 'response' typo and extracted chart_config
        const { data, columns, sql, pagination, chart_config } = res.data;

        setMessages(prev => [...prev, {
            role: 'assistant',
            text: 'Here are the results! I ran the following query:',
            sql: sql
        }]);

        // Pass sql and chart_config back to the parent
        onDataResult(data, columns, pagination, sql, chart_config);

        } catch (error: unknown) {
            if (axios.isAxiosError(error)) {
                const errorDetail = error.response?.data?.detail || error.message;
                setMessages(prev => [...prev, {
                    role: 'assistant',
                    text: `Failed to execute query: ${errorDetail}`
                }]);
            }

        } finally {
            setIsLoading(false);
        }
    };


    return (
        <div className="flex flex-col h-full bg-white border-l">
            <div className="p-4 border-b bg-gray-50 flex items-center gap-2">
                <Bot size={20} className="text-blue-600" />
                <h3 className="font-semibold text-gray-800">AI Query Assistant</h3>
            </div>

            <div className="flex-1 min-h-0 p-4 overflow-y-auto space-y-4">
                {messages.map((msg, idx) => (
                    <div key={idx} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        {msg.role === 'assistant' && (
                            <div className="w-8 h-8 shrink-0 rounded-full bg-blue-100 flex items-center justify-center text-blue-600">
                                <Bot size={16} />
                            </div>
                        )}

                        <div className={`relative group p-3 rounded-lg text-sm shadow-sm ${msg.role === 'user'
                            ? 'bg-blue-600 text-white max-w-[85%]'
                            : 'bg-gray-100 text-gray-800 max-w-[95%]'
                            }`}>

                            {/* Hover Actions (Copy / Re-run) */}
                            <div className={`absolute -top-3 ${msg.role === 'user' ? '-left-2' : '-right-2'} hidden group-hover:flex gap-1 bg-white border border-gray-200 shadow-sm rounded-md p-1 z-10 text-gray-500`}>
                                <button onClick={() => handleCopy(msg.text)} className="hover:text-blue-600 transition-colors" title="Copy message">
                                    <Copy size={13} />
                                </button>
                                {msg.role === 'user' && (
                                    <button onClick={() => handleSend(msg.text)} className="hover:text-blue-600 transition-colors" title="Re-run prompt">
                                        <RefreshCw size={13} />
                                    </button>
                                )}
                            </div>

                            <span className="whitespace-pre-wrap font-sans wrap-break-word">{msg.text}</span>

                            {msg.sql && (
                                <div className="mt-3 p-3 bg-slate-900 text-slate-50 font-mono text-xs rounded-md border border-slate-700 overflow-x-auto shadow-inner relative group/sql">
                                    <button onClick={() => handleCopy(msg.sql || '')} className="absolute top-2 right-2 hidden group-hover/sql:block p-1 bg-slate-700 hover:bg-slate-600 text-white rounded transition-colors" title="Copy SQL">
                                        <Copy size={12} />
                                    </button>
                                    <pre>{msg.sql}</pre>
                                </div>
                            )}
                        </div>

                        {msg.role === 'user' && (
                            <div className="w-8 h-8 shrink-0 rounded-full bg-gray-200 flex items-center justify-center text-gray-600">
                                <User size={16} />
                            </div>
                        )}
                    </div>
                ))}

                {isLoading && (
                    <div className="flex gap-3 justify-start">
                        <div className="w-8 h-8 shrink-0 rounded-full bg-blue-100 flex items-center justify-center text-blue-600">
                            <Loader2 size={16} className="animate-spin" />
                        </div>
                        <div className="p-3 rounded-lg text-sm bg-gray-100 text-gray-500 italic">
                            Writing T-SQL and querying database...
                        </div>
                    </div>
                )}

                <div ref={messagesEndRef} />
            </div>

            <div className="p-4 border-t bg-gray-50">
                <div className="flex gap-2">
                    <input
                        type="text"
                        className="flex-1 p-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm bg-white"
                        placeholder="e.g., Show me all cancelled bookings..."
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                        disabled={isLoading}
                    />
                    <button
                        onClick={handleSend}
                        disabled={isLoading || !input.trim()}
                        className="p-2 px-4 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center justify-center"
                    >
                        <Send size={16} />
                    </button>
                </div>
            </div>
        </div>
    );
}