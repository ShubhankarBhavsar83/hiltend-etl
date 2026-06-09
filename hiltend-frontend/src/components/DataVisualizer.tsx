import { useState, useEffect, useMemo } from "react";
import { useApiClient } from "@/hooks/useApiClient";
import { Button } from "@/components/ui/button";
import ReactMarkdown from 'react-markdown';
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import {
    BarChart, Bar, LineChart, Line, AreaChart, Area,
    PieChart, Pie, Cell, RadarChart, Radar, PolarGrid,
    PolarAngleAxis, PolarRadiusAxis, RadialBarChart, RadialBar,
    XAxis, YAxis, CartesianGrid, Tooltip, Legend
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

    // Chart Config State (Supports Multiple X and Y Axes)
    const [chartType, setChartType] = useState<ChartType>(initialConfig?.chartType || "bar");
    const [xAxisCols, setXAxisCols] = useState<string[]>(
        initialConfig?.xAxis ? [initialConfig.xAxis] : (availableColumns.length > 0 ? [availableColumns[0]] : [])
    );
    const [yAxisCols, setYAxisCols] = useState<string[]>(
        initialConfig?.yAxis && initialConfig.yAxis.length > 0
            ? initialConfig.yAxis
            : (availableColumns.length > 1 ? [availableColumns[1]] : [])
    );

    // Summary State
    const [summary, setSummary] = useState<string | null>(null);
    const [isSummarizing, setIsSummarizing] = useState(false);

    // Responsive Container State using Callback Ref to handle conditional mounting
    const [chartContainerNode, setChartContainerNode] = useState<HTMLDivElement | null>(null);
    const [chartDimensions, setChartDimensions] = useState({ width: 800, height: 400 });

    // Measure the exact container bounds to feed static pixels to Recharts
    useEffect(() => {
        if (!chartContainerNode) return;
        
        const observer = new ResizeObserver((entries) => {
            if (entries.length > 0) {
                const { width, height } = entries[0].contentRect;
                if (width > 0 && height > 0) {
                    setChartDimensions({ width, height });
                }
            }
        });
        
        observer.observe(chartContainerNode);
        return () => observer.disconnect();
    }, [chartContainerNode]);

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
        if (!data || data.length === 0 || xAxisCols.length === 0 || yAxisCols.length === 0) return data;

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
            const xVal = xAxisCols.map(col => String(row[col] ?? 'Unknown')).join(' | ');

            if (!grouped[xVal]) {
                grouped[xVal] = { display_label: xVal };
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
    }, [data, xAxisCols, yAxisCols]);

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

    // Decoupled wrappers to ensure text scales with zoom
    const ZoomableContainer = ({ children }: { children: React.ReactNode }) => (
        <TransformWrapper initialScale={1} minScale={0.5} maxScale={4} centerOnInit={true}>
            <TransformComponent 
                wrapperStyle={{ width: "100%", height: "100%", cursor: "grab" }}
                contentStyle={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}
            >
                {children}
            </TransformComponent>
        </TransformWrapper>
    );

    const ChartWrapper = ({ children }: { children: React.ReactNode }) => (
        <div style={{ width: chartDimensions.width, height: chartDimensions.height }}>
            {children}
        </div>
    );

    // Standardized solid background tooltip
    const renderTooltip = () => (
        <Tooltip 
            contentStyle={{ 
                borderRadius: '8px', 
                border: '1px solid var(--border)', 
                backgroundColor: 'var(--background)',
                color: 'var(--foreground)'
            }} 
            itemStyle={{ color: 'var(--foreground)' }}
        />
    );

    const renderChart = () => {
        if (xAxisCols.length === 0 || yAxisCols.length === 0) {
            return <div className="flex items-center justify-center h-full text-gray-400 text-sm">Please select X and Y axes.</div>;
        }

        const primaryMetric = yAxisCols[0];

        // --- PIE & DONUT ---
        if (chartType === "pie" || chartType === "donut") {
            return (
                <ZoomableContainer>
                    <ChartWrapper>
                        <PieChart width={chartDimensions.width} height={chartDimensions.height}>
                            {renderTooltip()}
                            <Legend wrapperStyle={{ paddingTop: '20px', fontSize: '12px' }} />
                            <Pie data={processedData} dataKey={primaryMetric} nameKey="display_label" cx="50%" cy="50%" outerRadius={Math.min(chartDimensions.width, chartDimensions.height) / 3} innerRadius={chartType === "donut" ? Math.min(chartDimensions.width, chartDimensions.height) / 5 : 0} fill="#8884d8" label>
                                {processedData.map((_, index) => (
                                    <Cell key={`cell-${index}`} fill={`var(--color-${colors[index % colors.length]})`} />
                                ))}
                            </Pie>
                        </PieChart>
                    </ChartWrapper>
                </ZoomableContainer>
            );
        }

        // --- RADAR ---
        if (chartType === "radar") {
            return (
                <ZoomableContainer>
                    <ChartWrapper>
                        <RadarChart width={chartDimensions.width} height={chartDimensions.height} cx="50%" cy="50%" outerRadius="80%" data={processedData}>
                            <PolarGrid stroke="var(--border)" />
                            <PolarAngleAxis dataKey="display_label" tick={{ fontSize: 12, fill: "var(--muted-foreground)" }} />
                            <PolarRadiusAxis angle={30} domain={['auto', 'auto']} />
                            {renderTooltip()}
                            <Legend wrapperStyle={{ paddingTop: '20px', fontSize: '12px' }} />
                            {yAxisCols.map((col, index) => (
                                <Radar key={col} name={col} dataKey={col} stroke={`var(--color-${colors[index % colors.length]})`} fill={`var(--color-${colors[index % colors.length]})`} fillOpacity={0.3} />
                            ))}
                        </RadarChart>
                    </ChartWrapper>
                </ZoomableContainer>
            );
        }

        // --- RADIAL ---
        if (chartType === "radial") {
            const radialData = processedData.map((item, index) => ({ ...item, fill: `var(--color-${colors[index % colors.length]})` }));
            return (
                <ZoomableContainer>
                    <ChartWrapper>
                        <RadialBarChart width={chartDimensions.width} height={chartDimensions.height} cx="50%" cy="50%" innerRadius="20%" outerRadius="90%" barSize={20} data={radialData}>
                            <RadialBar label={{ position: 'insideStart', fill: '#fff', fontSize: 11 }} background dataKey={primaryMetric} />
                            {renderTooltip()}
                            <Legend iconSize={10} layout="vertical" verticalAlign="middle" wrapperStyle={{ right: 20, fontSize: '12px' }} />
                        </RadialBarChart>
                    </ChartWrapper>
                </ZoomableContainer>
            );
        }

        // --- CARTESIAN ---
        const ChartProps = { data: processedData, width: chartDimensions.width, height: chartDimensions.height, margin: { top: 20, right: 30, left: 0, bottom: 20 } };
        const commonAxes = (
            <>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                <XAxis dataKey="display_label" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "var(--muted-foreground)" }} dy={10} />
                <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "var(--muted-foreground)" }} dx={-10} />
                {renderTooltip()}
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
                <ChartWrapper>
                    {chartType === "bar" ? <BarChart {...ChartProps}>{commonAxes}{dataSeries}</BarChart> :
                        chartType === "line" ? <LineChart {...ChartProps}>{commonAxes}{dataSeries}</LineChart> :
                            <AreaChart {...ChartProps}>{commonAxes}{dataSeries}</AreaChart>}
                </ChartWrapper>
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
                        <div className="relative group">
                            <Button variant="outline" size="sm" className="h-7 text-[12px] bg-white">Select X ({xAxisCols.length})</Button>
                            <div className="absolute top-8 left-0 flex flex-col bg-white border border-gray-200 rounded shadow-lg p-2 z-50 min-w-[150px] max-h-60 overflow-y-auto invisible opacity-0 group-hover:visible group-hover:opacity-100 transition-all duration-300 delay-[2000ms] group-hover:delay-0">
                                {availableColumns.map(col => (
                                    <label key={col} className="flex items-center gap-2 px-2 py-1.5 hover:bg-gray-50 rounded cursor-pointer">
                                        <input 
                                            type="checkbox" 
                                            className="rounded border-gray-300 text-blue-600" 
                                            checked={xAxisCols.includes(col)} 
                                            onChange={() => setXAxisCols(prev => prev.includes(col) ? prev.filter(c => c !== col) : [...prev, col])} 
                                        />
                                        <span className="text-[12px] truncate">{col}</span>
                                    </label>
                                ))}
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-2 text-[12px]">
                        <span className="font-semibold text-gray-600">Y-Axis (Metrics):</span>
                        <div className="relative group">
                            <Button variant="outline" size="sm" className="h-7 text-[12px] bg-white">Select Metrics ({yAxisCols.length})</Button>
                            <div className="absolute top-8 left-0 flex flex-col bg-white border border-gray-200 rounded shadow-lg p-2 z-50 min-w-[150px] max-h-60 overflow-y-auto invisible opacity-0 group-hover:visible group-hover:opacity-100 transition-all duration-300 delay-[2000ms] group-hover:delay-0">
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
                            <div ref={setChartContainerNode} className="flex-1 min-h-0 w-full bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] [background-size:16px_16px] rounded-lg border border-gray-100 relative">
                                {renderChart()}
                            </div>
                        </div>
                    )}
                </div>

                {summary && (
                    <div className="w-1/3 bg-indigo-50/30 border border-indigo-100 rounded-lg p-4 overflow-y-auto animate-in slide-in-from-right-4">
                        <h4 className="font-semibold text-indigo-900 text-[13px] flex items-center gap-2 mb-3"><Sparkles size={14} /> AI Analysis</h4>
                        <div className="prose prose-sm prose-indigo max-w-none text-[13px] text-gray-700 leading-relaxed font-sans">
                            <ReactMarkdown>
                                {summary ?? ""}
                            </ReactMarkdown>
                        </div>
                    </div>
                )}
            </div>
            {/* Resizer Handle Hint */}
            <div className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize bg-[linear-gradient(135deg,transparent_50%,rgba(0,0,0,0.1)_50%)]" />
        </div>
    );
}