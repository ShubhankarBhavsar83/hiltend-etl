import { useState } from 'react';
import { Send, Bot, User, Loader2 } from 'lucide-react';
import { useApiClient } from '../hooks/useApiClient';
import axios from 'axios';

interface NLQChatbotProps {
    datasetName: string;
    selectedColumns: string[];
    onDataResult: (data: Record<string, string | number | boolean | null>[], columns: string[]) => void;
}

interface Message {
    role: 'user' | 'assistant';
    text: string;
    sql?: string; // <-- Added a dedicated SQL field
}

export function NLQChatbot({ datasetName, selectedColumns, onDataResult }: NLQChatbotProps) {
    const apiClient = useApiClient();
    const [messages, setMessages] = useState<Message[]>([
        { role: 'assistant', text: 'Ask me a question about your data, or select columns on the left to focus the query.' }
    ]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [prevColsString, setPrevColsString] = useState('');

    const currentColsString = selectedColumns.join(', ');
    if (currentColsString !== prevColsString) {
        setPrevColsString(currentColsString);
        setInput(
            selectedColumns.length > 0
                ? `Show me data involving these columns: ${currentColsString}`
                : ''
        );
    }

    const handleSend = async () => {
        if (!input.trim() || !datasetName) return;

        const userMsg = input;
        setMessages(prev => [...prev, { role: 'user', text: userMsg }]);
        setInput('');
        setIsLoading(true);

        try {
            const response = await apiClient.post(`/api/v1/datasets/${datasetName}/nlq`, {
                prompt: userMsg,
                selected_columns: selectedColumns
            });

            const { data, columns, sql } = response.data;

            setMessages(prev => [...prev, {
                role: 'assistant',
                text: 'Here are the results! I ran the following query:',
                sql: sql
            }]);

            onDataResult(data, columns);

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

            <div className="flex-1 p-4 overflow-y-auto space-y-4">
                {messages.map((msg, idx) => (
                    <div key={idx} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        {msg.role === 'assistant' && (
                            <div className="w-8 h-8 shrink-0 rounded-full bg-blue-100 flex items-center justify-center text-blue-600">
                                <Bot size={16} />
                            </div>
                        )}

                        <div className={`p-3 rounded-lg text-sm shadow-sm ${msg.role === 'user'
                                ? 'bg-blue-600 text-white max-w-[85%]'
                                : 'bg-gray-100 text-gray-800 max-w-[95%]'
                            }`}>
                            <span className="whitespace-pre-wrap font-sans break-words">{msg.text}</span>

                            {/* <-- Dedicated UI Block for SQL Query Display --> */}
                            {msg.sql && (
                                <div className="mt-3 p-3 bg-slate-900 text-slate-50 font-mono text-xs rounded-md border border-slate-700 overflow-x-auto shadow-inner">
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