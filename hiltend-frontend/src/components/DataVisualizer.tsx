import { useState, useEffect } from "react";
import { useApiClient } from "@/hooks/useApiClient";
import { Button } from "@/components/ui/button";
import {
    BarChart, Bar, LineChart, Line, AreaChart, Area,
    XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from "recharts";
import { Loader2, Sparkles, BarChart2, TrendingUp, Activity, X } from "lucide-react";
import { cn } from "@/lib/utils";
import axios from "axios";

interface DataVisualizerProps {
    datasetName: string;
    sql: string;
    availableColumns: string[];
    onClose: () => void;
}

type ChartType = "bar" | "line" | "area";
type ChartRowData = Record<string, string | number | boolean | null>;

export default function DataVisualizer({ datasetName, sql, availableColumns, onClose }: DataVisualizerProps) {
    const apiClient = useApiClient();

    // Data State
    const [data, setData] = useState<ChartRowData[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Chart Config State
    const [chartType, setChartType] = useState<ChartType>("bar");
    const [xAxisCol, setXAxisCol] = useState<string>(availableColumns[0] || "");

    // Default to selecting the second column as Y-axis if available, else fallback
    const [yAxisCols, setYAxisCols] = useState<string[]>(
        availableColumns.length > 1 ? [availableColumns[1]] : []
    );

    // Summary State
    const [summary, setSummary] = useState<string | null>(null);
    const [isSummarizing, setIsSummarizing] = useState(false);

    // Fetch full dataset for the chart
    useEffect(() => {
        if (!sql) return;
        const fetchFullData = async () => {
            setIsLoading(true);
            setError(null);
            try {
                const res = await apiClient.post(`/api/v1/datasets/${datasetName}/execute-full`, { sql });
                setData(res.data.data);
            } catch (error: unknown) {
                if (axios.isAxiosError(error)) {
                    setError(error.response?.data?.detail || "Failed to fetch chart data.");
                }
            } finally {
                setIsLoading(false);
            }
        };
        fetchFullData();
    }, [sql, datasetName, apiClient]);

    const toggleYAxis = (col: string) => {
        setYAxisCols((prev) =>
            prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col]
        );
    };

    const handleSummarize = async () => {
        if (data.length === 0) return;
        setIsSummarizing(true);
        try {
            const res = await apiClient.post(`/api/v1/datasets/${datasetName}/summarize-chart`, { data });
            setSummary(res.data.summary);
        } catch (err: unknown) {
            if (axios.isAxiosError(err)) {
                setSummary(`Error generating summary: ${err.message}`);
            }
        } finally {
            setIsSummarizing(false);
        }
    };

    // Theme colors for Shadcn charts
    const colors = [
        "var(--color-chart-1)", "var(--color-chart-2)", "var(--color-chart-3)",
        "var(--color-chart-4)", "var(--color-chart-5)"
    ];

    const renderChart = () => {
        if (!xAxisCol || yAxisCols.length === 0) {
            return <div className="flex items-center justify-center h-full text-gray-400 text-sm">Please select an X and Y axis.</div>;
        }

        const ChartProps = {
            data,
            margin: { top: 20, right: 30, left: 0, bottom: 20 },
        };

        const commonAxes = (
            <>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                <XAxis
                    dataKey={xAxisCol}
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
                    dy={10}
                />
                <YAxis
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
                    dx={-10}
                />
                <Tooltip
                    contentStyle={{ borderRadius: '8px', border: '1px solid hsl(var(--border))', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                />
                <Legend wrapperStyle={{ paddingTop: '20px', fontSize: '12px' }} />
            </>
        );

        const dataSeries = yAxisCols.map((col, index) => {
            const color = colors[index % colors.length];
            if (chartType === "bar") {
                return <Bar key={col} dataKey={col} fill={color} radius={[4, 4, 0, 0]} />;
            }
            if (chartType === "line") {
                return <Line key={col} type="monotone" dataKey={col} stroke={color} strokeWidth={2} dot={false} />;
            }
            if (chartType === "area") {
                return (
                    <Area
                        key={col}
                        type="monotone"
                        dataKey={col}
                        stroke={color}
                        fill={color}
                        fillOpacity={0.3}
                    />
                );
            }
            return null;
        });

        return (
            <ResponsiveContainer width="100%" height="100%">
                {chartType === "bar" ? <BarChart {...ChartProps}>{commonAxes}{dataSeries}</BarChart> :
                    chartType === "line" ? <LineChart {...ChartProps}>{commonAxes}{dataSeries}</LineChart> :
                        <AreaChart {...ChartProps}>{commonAxes}{dataSeries}</AreaChart>}
            </ResponsiveContainer>
        );
    };

    return (
        <div className="absolute inset-0 z-30 bg-white/95 backdrop-blur-sm p-4 flex flex-col rounded-lg border border-gray-200 shadow-xl overflow-hidden"
            style={{ resize: 'both', minHeight: '400px', minWidth: '500px' }}>

            {/* Header Controls */}
            <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-gray-100 shrink-0">
                <div className="flex items-center gap-4">
                    <div className="flex bg-gray-100 p-1 rounded-md">
                        <Button variant={chartType === "bar" ? "secondary" : "ghost"} size="sm" className="h-7 px-2" onClick={() => setChartType("bar")}><BarChart2 size={14} /></Button>
                        <Button variant={chartType === "line" ? "secondary" : "ghost"} size="sm" className="h-7 px-2" onClick={() => setChartType("line")}><TrendingUp size={14} /></Button>
                        <Button variant={chartType === "area" ? "secondary" : "ghost"} size="sm" className="h-7 px-2" onClick={() => setChartType("area")}><Activity size={14} /></Button>
                    </div>

                    <div className="flex items-center gap-2 text-[12px]">
                        <span className="font-semibold text-gray-600">X-Axis:</span>
                        <select
                            className="border border-gray-200 rounded px-2 py-1 bg-white focus:ring-blue-500"
                            value={xAxisCol}
                            onChange={(e) => setXAxisCol(e.target.value)}
                        >
                            <option value="">Select...</option>
                            {availableColumns.map(col => <option key={col} value={col}>{col}</option>)}
                        </select>
                    </div>

                    <div className="flex items-center gap-2 text-[12px]">
                        <span className="font-semibold text-gray-600">Y-Axis (Metrics):</span>
                        <div className="relative group">
                            <Button variant="outline" size="sm" className="h-7 text-[12px] bg-white">Select Metrics ({yAxisCols.length})</Button>
                            <div className="absolute top-8 left-0 hidden group-hover:flex flex-col bg-white border border-gray-200 rounded shadow-lg p-2 z-50 min-w-[150px] max-h-60 overflow-y-auto">
                                {availableColumns.map(col => (
                                    <label key={col} className="flex items-center gap-2 px-2 py-1.5 hover:bg-gray-50 rounded cursor-pointer">
                                        <input
                                            type="checkbox"
                                            className="rounded border-gray-300 text-blue-600"
                                            checked={yAxisCols.includes(col)}
                                            onChange={() => toggleYAxis(col)}
                                        />
                                        <span className="text-[12px] truncate">{col}</span>
                                    </label>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <Button
                        onClick={handleSummarize}
                        disabled={isSummarizing || data.length === 0}
                        size="sm"
                        className="h-7 text-[12px] bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200"
                    >
                        {isSummarizing ? <Loader2 size={14} className="animate-spin mr-1.5" /> : <Sparkles size={14} className="mr-1.5" />}
                        Summarise Chart
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-gray-400 hover:text-gray-900" onClick={onClose}>
                        <X size={16} />
                    </Button>
                </div>
            </div>

            {/* Main Content Area */}
            <div className="flex-1 min-h-0 flex gap-4 pt-4">
                {/* Chart Canvas */}
                <div className={cn("relative flex-1 bg-white border border-gray-100 rounded-lg shadow-sm overflow-hidden", summary ? "w-2/3" : "w-full")}>
                    {isLoading ? (
                        <div className="absolute inset-0 flex items-center justify-center gap-2 text-gray-400">
                            <Loader2 size={16} className="animate-spin" /> Fetching unpaginated data...
                        </div>
                    ) : error ? (
                        <div className="absolute inset-0 flex items-center justify-center text-red-500 text-sm">{error}</div>
                    ) : data.length === 0 ? (
                        <div className="absolute inset-0 flex items-center justify-center text-gray-400 text-sm">No data available.</div>
                    ) : (
                        <div className="absolute inset-0 p-4">
                            <div className=" h-full w-full">
                                {renderChart()}
                            </div>
                        </div>
                    )}
                </div>

                {/* AI Summary Sidebar (Appears when summarized) */}
                {summary && (
                    <div className="w-1/3 bg-indigo-50/30 border border-indigo-100 rounded-lg p-4 overflow-y-auto animate-in slide-in-from-right-4">
                        <h4 className="font-semibold text-indigo-900 text-[13px] flex items-center gap-2 mb-3">
                            <Sparkles size={14} /> AI Analysis
                        </h4>
                        <div className="text-[13px] text-gray-700 leading-relaxed whitespace-pre-wrap">
                            {summary}
                        </div>
                    </div>
                )}
            </div>

            {/* Resizer Handle Hint */}
            <div className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize bg-[linear-gradient(135deg,transparent_50%,rgba(0,0,0,0.1)_50%)]" />
        </div>
    );
}