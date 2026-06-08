import { useState, useEffect, useMemo } from "react";
import { useApiClient } from "@/hooks/useApiClient";
import { Button } from "@/components/ui/button";
import ReactMarkdown from 'react-markdown';
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import {
    BarChart, Bar, LineChart, Line, AreaChart, Area,
    PieChart, Pie, Cell, RadarChart, Radar, PolarGrid,
    PolarAngleAxis, PolarRadiusAxis, RadialBarChart, RadialBar,
    XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from "recharts";
import {
    Loader2, Sparkles, BarChart2, TrendingUp, Activity,
    X, PieChart as PieChartIcon, Target, CircleDashed
} from "lucide-react";
import { cn } from "@/lib/utils";
import axios from "axios";

interface DataVisualizerProps {
    datasetName: string;
    sql: string;
    availableColumns: string[];
    onClose: () => void;
    initialConfig?: { chartType: ChartType; xAxis: string; yAxis: string[] };
}

type ChartType = "bar" | "line" | "area" | "pie" | "donut" | "radar" | "radial";
type ChartRowData = Record<string, string | number | boolean | null>;

export default function DataVisualizer({ datasetName, sql, availableColumns, onClose, initialConfig }: DataVisualizerProps) {
    const apiClient = useApiClient();

    // Data State
    const [data, setData] = useState<ChartRowData[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Chart Config State
    const [chartType, setChartType] = useState<ChartType>(initialConfig?.chartType || "bar");
    const [xAxisCol, setXAxisCol] = useState<string>(initialConfig?.xAxis || availableColumns[0] || "");
    const [yAxisCols, setYAxisCols] = useState<string[]>(
        initialConfig?.yAxis && initialConfig.yAxis.length > 0
            ? initialConfig.yAxis
            : (availableColumns.length > 1 ? [availableColumns[1]] : [])
    );

    // Summary State
    const [summary, setSummary] = useState<string | null>(null);
    const [isSummarizing, setIsSummarizing] = useState(false);

    // Fetch full dataset
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

    // Aggregation Engine
    const processedData = useMemo(() => {
        if (!data || data.length === 0 || !xAxisCol || yAxisCols.length === 0) return data;

        const sampleRow = data.find(row => row !== null) || {};
        const isCategorical: Record<string, boolean> = {};

        yAxisCols.forEach(col => {
            if (col === "*Record Count*") {
                isCategorical[col] = false;
                return;
            }
            const val = sampleRow[col];
            isCategorical[col] = typeof val === 'string' || typeof val === 'boolean';
        });

        const grouped: Record<string, Record<string, string | number>> = {};

        data.forEach(row => {
            const xVal = String(row[xAxisCol] ?? 'Unknown');

            if (!grouped[xVal]) {
                grouped[xVal] = { [xAxisCol]: xVal };
                yAxisCols.forEach(col => { grouped[xVal][col] = 0; });
            }

            yAxisCols.forEach(col => {
                if (col === "*Record Count*") {
                    grouped[xVal][col] = (grouped[xVal][col] as number) + 1;
                    return;
                }
                const val = row[col];
                if (val !== null && val !== undefined) {
                    if (isCategorical[col]) {
                        grouped[xVal][col] = (grouped[xVal][col] as number) + 1;
                    } else {
                        grouped[xVal][col] = (grouped[xVal][col] as number) + (Number(val) || 0);
                    }
                }
            });
        });

        return Object.values(grouped);
    }, [data, xAxisCol, yAxisCols]);

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

    const colors = ["chart-1", "chart-2", "chart-3", "chart-4", "chart-5"];

    const ZoomableContainer = ({ children }: { children: React.ReactNode }) => (
        <TransformWrapper initialScale={1} minScale={0.5} maxScale={4} centerOnInit={true}>
            <TransformComponent 
                wrapperStyle={{ width: "100%", height: "100%", cursor: "grab" }}
                contentStyle={{ width: "100%", height: "100%" }}
            >
                {children}
            </TransformComponent>
        </TransformWrapper>
    );

    const renderChart = () => {
        if (!xAxisCol || yAxisCols.length === 0) {
            return <div className="flex items-center justify-center h-full text-gray-400 text-sm">Please select X and Y axes.</div>;
        }

        const primaryMetric = yAxisCols[0];

        // --- PIE & DONUT ---
        if (chartType === "pie" || chartType === "donut") {
            return (
                <ZoomableContainer>
                    <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                            <Tooltip contentStyle={{ borderRadius: '8px', border: '1px solid hsl(var(--border))', backgroundColor: 'hsl(var(--background))' }} />
                            <Legend wrapperStyle={{ paddingTop: '20px', fontSize: '12px' }} />
                            <Pie data={processedData} dataKey={primaryMetric} nameKey={xAxisCol} cx="50%" cy="50%" outerRadius={120} innerRadius={chartType === "donut" ? 70 : 0} fill="#8884d8" label>
                                {processedData.map((_, index) => (
                                    <Cell key={`cell-${index}`} fill={`var(--color-${colors[index % colors.length]})`} />
                                ))}
                            </Pie>
                        </PieChart>
                    </ResponsiveContainer>
                </ZoomableContainer>
            );
        }

        // --- RADAR ---
        if (chartType === "radar") {
            return (
                <ZoomableContainer>
                    <ResponsiveContainer width="100%" height="100%">
                        <RadarChart cx="50%" cy="50%" outerRadius="80%" data={processedData}>
                            <PolarGrid stroke="hsl(var(--border))" />
                            <PolarAngleAxis dataKey={xAxisCol} tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} />
                            <PolarRadiusAxis angle={30} domain={['auto', 'auto']} />
                            <Tooltip contentStyle={{ borderRadius: '8px', border: '1px solid hsl(var(--border))', backgroundColor: 'hsl(var(--background))' }} />
                            <Legend wrapperStyle={{ paddingTop: '20px', fontSize: '12px' }} />
                            {yAxisCols.map((col, index) => (
                                <Radar key={col} name={col} dataKey={col} stroke={`var(--color-${colors[index % colors.length]})`} fill={`var(--color-${colors[index % colors.length]})`} fillOpacity={0.3} />
                            ))}
                        </RadarChart>
                    </ResponsiveContainer>
                </ZoomableContainer>
            );
        }

        // --- RADIAL ---
        if (chartType === "radial") {
            const radialData = processedData.map((item, index) => ({ ...item, fill: `var(--color-${colors[index % colors.length]})` }));
            return (
                <ZoomableContainer>
                    <ResponsiveContainer width="100%" height="100%">
                        <RadialBarChart cx="50%" cy="50%" innerRadius="20%" outerRadius="90%" barSize={20} data={radialData}>
                            <RadialBar label={{ position: 'insideStart', fill: '#fff', fontSize: 11 }} background dataKey={primaryMetric} />
                            <Tooltip contentStyle={{ borderRadius: '8px', border: '1px solid hsl(var(--border))', backgroundColor: 'hsl(var(--background))' }} />
                            <Legend iconSize={10} layout="vertical" verticalAlign="middle" wrapperStyle={{ right: 20, fontSize: '12px' }} />
                        </RadialBarChart>
                    </ResponsiveContainer>
                </ZoomableContainer>
            );
        }

        // --- CARTESIAN ---
        const ChartProps = { data: processedData, margin: { top: 20, right: 30, left: 0, bottom: 20 } };
        const commonAxes = (
            <>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                <XAxis dataKey={xAxisCol} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} dy={10} />
                <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} dx={-10} />
                <Tooltip contentStyle={{ borderRadius: '8px', border: '1px solid hsl(var(--border))', backgroundColor: 'hsl(var(--background))' }} />
                <Legend wrapperStyle={{ paddingTop: '20px', fontSize: '12px' }} />
            </>
        );

        const dataSeries = yAxisCols.map((col, index) => {
            const color = `var(--color-${colors[index % colors.length]})`;
            if (chartType === "bar") return <Bar key={col} dataKey={col} fill={color} radius={[4, 4, 0, 0]} />;
            if (chartType === "line") return <Line key={col} type="monotone" dataKey={col} stroke={color} strokeWidth={2} dot={false} />;
            if (chartType === "area") return <Area key={col} type="monotone" dataKey={col} stroke={color} fill={color} fillOpacity={0.3} />;
            return null;
        });

        return (
            <ZoomableContainer>
                <ResponsiveContainer width="100%" height="100%">
                    {chartType === "bar" ? <BarChart {...ChartProps}>{commonAxes}{dataSeries}</BarChart> :
                        chartType === "line" ? <LineChart {...ChartProps}>{commonAxes}{dataSeries}</LineChart> :
                            <AreaChart {...ChartProps}>{commonAxes}{dataSeries}</AreaChart>}
                </ResponsiveContainer>
            </ZoomableContainer>
        );
    };

    return (
        <div className="absolute inset-0 z-30 bg-white/95 backdrop-blur-sm p-4 flex flex-col rounded-lg border border-gray-200 shadow-xl overflow-hidden"
            style={{ resize: 'both', minHeight: '400px', minWidth: '500px' }}>

            <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-gray-100 shrink-0">
                <div className="flex items-center gap-4">
                    <div className="flex bg-gray-100 p-1 rounded-md">
                        <Button title="Bar Chart" variant={chartType === "bar" ? "secondary" : "ghost"} size="sm" className="h-7 px-2" onClick={() => setChartType("bar")}><BarChart2 size={14} /></Button>
                        <Button title="Line Chart" variant={chartType === "line" ? "secondary" : "ghost"} size="sm" className="h-7 px-2" onClick={() => setChartType("line")}><TrendingUp size={14} /></Button>
                        <Button title="Area Chart" variant={chartType === "area" ? "secondary" : "ghost"} size="sm" className="h-7 px-2" onClick={() => setChartType("area")}><Activity size={14} /></Button>
                        <div className="w-px h-4 bg-gray-300 mx-1 self-center" />
                        <Button title="Pie Chart" variant={chartType === "pie" ? "secondary" : "ghost"} size="sm" className="h-7 px-2" onClick={() => setChartType("pie")}><PieChartIcon size={14} /></Button>
                        <Button title="Donut Chart" variant={chartType === "donut" ? "secondary" : "ghost"} size="sm" className="h-7 px-2" onClick={() => setChartType("donut")}><CircleDashed size={14} /></Button>
                        <Button title="Radar Chart" variant={chartType === "radar" ? "secondary" : "ghost"} size="sm" className="h-7 px-2" onClick={() => setChartType("radar")}><Target size={14} /></Button>
                        <Button title="Radial Chart" variant={chartType === "radial" ? "secondary" : "ghost"} size="sm" className="h-7 px-2" onClick={() => setChartType("radial")}><Activity size={14} className="rotate-90" /></Button>
                    </div>

                    <div className="flex items-center gap-2 text-[12px]">
                        <span className="font-semibold text-gray-600">X-Axis:</span>
                        <select className="border border-gray-200 rounded px-2 py-1 bg-white focus:ring-blue-500" value={xAxisCol} onChange={(e) => setXAxisCol(e.target.value)}>
                            <option value="">Select...</option>
                            {availableColumns.map(col => <option key={col} value={col}>{col}</option>)}
                        </select>
                    </div>

                    <div className="flex items-center gap-2 text-[12px]">
                        <span className="font-semibold text-gray-600">Y-Axis (Metrics):</span>
                        <div className="relative group">
                            <Button variant="outline" size="sm" className="h-7 text-[12px] bg-white">Select Metrics ({yAxisCols.length})</Button>
                            <div className="absolute top-8 left-0 hidden group-hover:flex flex-col bg-white border border-gray-200 rounded shadow-lg p-2 z-50 min-w-[150px] max-h-60 overflow-y-auto">
                                {["*Record Count*", ...availableColumns].map(col => (
                                    <label key={col} className="flex items-center gap-2 px-2 py-1.5 hover:bg-gray-50 rounded cursor-pointer">
                                        <input type="checkbox" className="rounded border-gray-300 text-blue-600" checked={yAxisCols.includes(col)} onChange={() => toggleYAxis(col)} />
                                        <span className="text-[12px] truncate">{col === "*Record Count*" ? <span className="font-semibold text-indigo-600">Count Records</span> : col}</span>
                                    </label>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <Button onClick={handleSummarize} disabled={isSummarizing || data.length === 0} size="sm" className="h-7 text-[12px] bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200">
                        {isSummarizing ? <Loader2 size={14} className="animate-spin mr-1.5" /> : <Sparkles size={14} className="mr-1.5" />} Summarise Chart
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-gray-400 hover:text-gray-900" onClick={onClose}><X size={16} /></Button>
                </div>
            </div>

            <div className="flex-1 min-h-0 flex gap-4 pt-4">
                <div className={cn("relative flex-1 bg-white border border-gray-100 rounded-lg shadow-sm overflow-hidden", summary ? "w-2/3" : "w-full")}>
                    {isLoading ? (
                        <div className="absolute inset-0 flex items-center justify-center gap-2 text-gray-400"><Loader2 size={16} className="animate-spin" /> Fetching data...</div>
                    ) : error ? (
                        <div className="absolute inset-0 flex items-center justify-center text-red-500 text-sm">{error}</div>
                    ) : data.length === 0 ? (
                        <div className="absolute inset-0 flex items-center justify-center text-gray-400 text-sm">No data.</div>
                    ) : (
                        <div className="absolute inset-0 p-4 flex flex-col">
                            <h3 className="text-[13px] font-semibold text-gray-700 mb-2 capitalize shrink-0 flex items-center gap-2">
                                <BarChart2 size={14} className="text-gray-400" /> {chartType} Chart
                            </h3>
                            <div className="flex-1 min-h-0 w-full">
                                {renderChart()}
                            </div>
                        </div>
                    )}
                </div>

                {summary && (
                    <div className="w-1/3 bg-indigo-50/30 border border-indigo-100 rounded-lg p-4 overflow-y-auto animate-in slide-in-from-right-4">
                        <h4 className="font-semibold text-indigo-900 text-[13px] flex items-center gap-2 mb-3"><Sparkles size={14} /> AI Analysis</h4>
                        <div className="prose prose-sm prose-indigo max-w-none">
                            <ReactMarkdown>
                                {summary ?? ""}
                            </ReactMarkdown>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}