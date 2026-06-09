import { useState, useEffect, useCallback, useMemo } from "react";
import ReactMarkdown from 'react-markdown';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NLQChatbot, type ChartConfig } from './NLQChatbot';
import { useApiClient } from "../hooks/useApiClient";
import { cn } from "@/lib/utils";
import DataVisualizer from "./DataVisualizer";
import { BarChart2 } from "lucide-react";

interface DataExplorerProps {
    selectedDataset: string;
}

interface ColumnDef {
    name: string;
    type: string;
}

interface TableDef {
    name: string;
    columns: ColumnDef[];
}

type TableRowData = Record<string, string | number | boolean | null>;

export default function DataExplorer({ selectedDataset }: DataExplorerProps) {
    const apiClient = useApiClient();

    // Pane State
    const [isSchemaOpen, setIsSchemaOpen] = useState(true);
    const [isChatOpen, setIsChatOpen] = useState(false);
    const [isChatExpanded, setIsChatExpanded] = useState(false);

    // Schema State
    const [tables, setTables] = useState<TableDef[]>([]);
    const [expandedTables, setExpandedTables] = useState<Record<string, boolean>>({});
    const [isLoadingSchema, setIsLoadingSchema] = useState(false);

    // Table Data States
    const [activeTableName, setActiveTableName] = useState<string | null>(null);
    const [activeTableColumns, setActiveTableColumns] = useState<string[]>([]);
    const [activeTableData, setActiveTableData] = useState<TableRowData[]>([]);
    const [isLoadingData, setIsLoadingData] = useState(false);
    const [sortConfig, setSortConfig] = useState<{ key: string, direction: "asc" | "desc" } | null>(null);
    const [executedQueryText, setExecutedQueryText] = useState<string>("");
    const [pageSize, setPageSize] = useState(100);
    const [viewMode, setViewMode] = useState<"table" | "ai_query" | null>(null);
    const [suggestedChartConfig, setSuggestedChartConfig] = useState<ChartConfig | null>(null);

    // Cross-Table Custom Selection State (Stores keys formatted as "TableName.ColumnName")
    const [customSelectedColumns, setCustomSelectedColumns] = useState<string[]>([]);

    // Pagination States
    const [currentPage, setCurrentPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [totalRecords, setTotalRecords] = useState(0);

    // Summary States
    const [isSummarizeModalOpen, setIsSummarizeModalOpen] = useState(false);
    const [summaryContextInput, setSummaryContextInput] = useState("");
    const [isSummarizing, setIsSummarizing] = useState(false);
    const [summaryText, setSummaryText] = useState<string | null>(null);

    // Dataset Architect Summary States
    const [isDatasetSummaryModalOpen, setIsDatasetSummaryModalOpen] = useState(false);
    const [isDatasetSummarizing, setIsDatasetSummarizing] = useState(false);
    const [datasetSummaryText, setDatasetSummaryText] = useState<string | null>(null);

    // Single Table Column Visibility State
    const [visibleColumns, setVisibleColumns] = useState<string[]>([]);
    const [isColumnMenuOpen, setIsColumnMenuOpen] = useState(false);

    const [isVisualizerOpen, setIsVisualizerOpen] = useState(false);

    // Saved View States
    const [savedViews, setSavedViews] = useState<{ name: string, columns: string[] }[]>([]);
    const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
    const [newViewName, setNewViewName] = useState("");


    // Fetch views on mount
    useEffect(() => {
        const fetchViews = async () => {
            try {
                const res = await apiClient.get(`/api/v1/datasets/${selectedDataset}/views`);
                setSavedViews(res.data.views);
            } catch (e) { 
                console.error("Failed to load views", e); 
            }
        };
        if (selectedDataset) {
            fetchViews();
        }
    }, [apiClient, selectedDataset]);

    const handleSaveView = async () => {
        if (!newViewName) return;
        await apiClient.post(`/api/v1/datasets/${selectedDataset}/views`, {
            name: newViewName,
            columns: customSelectedColumns
        });
        setSavedViews(prev => [...prev, { name: newViewName, columns: customSelectedColumns }]);
        setIsSaveModalOpen(false);
        setNewViewName("");
    };

    const handleSummarizeDataset = async () => {
        setIsDatasetSummaryModalOpen(true);
        if (datasetSummaryText) return;

        setIsDatasetSummarizing(true);
        try {
            const res = await apiClient.post(`/api/v1/datasets/${selectedDataset}/explain-schema`);
            setDatasetSummaryText(res.data.summary);
        } catch (err) {
            console.error("Dataset summary failed", err);
            setDatasetSummaryText("Failed to generate dataset architecture summary.");
        } finally {
            setIsDatasetSummarizing(false);
        }
    };

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
    };

    const handleExecuteSummary = async () => {
        if (activeTableData.length === 0) return;
        setIsSummarizing(true);
        try {
            const res = await apiClient.post(`/api/v1/datasets/${selectedDataset}/summarize`, {
                data: activeTableData,
                user_context: summaryContextInput.trim()
            });
            setSummaryText(res.data.summary);
        } catch (err) {
            console.error("Summary failed", err);
            setSummaryText("Failed to generate summary. Please try again.");
        } finally {
            setIsSummarizing(false);
        }
    };

    const closeSummaryModal = () => {
        setIsSummarizeModalOpen(false);
        setSummaryText(null);
        setSummaryContextInput("");
    };

    const fetchSchema = useCallback(async () => {
        if (!selectedDataset) return;
        setIsLoadingSchema(true);
        try {
            const res = await apiClient.get(`/api/v1/datasets/${selectedDataset}/explorer`);
            setTables(res.data.tables);

            if (res.data.tables.length > 0) {
                setExpandedTables({ [res.data.tables[0].name]: true });
            }
        } catch (err) {
            console.error("Failed to fetch schema", err);
        } finally {
            setIsLoadingSchema(false);
        }
    }, [selectedDataset, apiClient]);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        fetchSchema();
    }, [fetchSchema]);

    const handleColumnCheckboxChange = (tableName: string, columnName: string) => {
        const uniqueKey = `${tableName}.${columnName}`;
        setCustomSelectedColumns(prev =>
            prev.includes(uniqueKey) ? prev.filter(k => k !== uniqueKey) : [...prev, uniqueKey]
        );
    };

    const fetchTableData = async (tableName: string, page: number = 1, currentSize: number = pageSize) => {
        setIsLoadingData(true);
        setActiveTableName(tableName);
        setCustomSelectedColumns([]);
        setSortConfig(null);
        setViewMode("table");

        try {
            const res = await apiClient.get(`/api/v1/datasets/${selectedDataset}/tables/${tableName}/data?page=${page}&page_size=${currentSize}`);

            const fetchedCols = res.data.columns;
            setActiveTableColumns(fetchedCols);
            setActiveTableData(res.data.data);

            setCurrentPage(res.data.pagination.current_page);
            setTotalPages(res.data.pagination.total_pages);
            setTotalRecords(res.data.pagination.total_records);
            setExecutedQueryText(`SELECT * FROM [${selectedDataset}].[${tableName}]`);

            if (tableName !== activeTableName) {
                setVisibleColumns(fetchedCols);
            }
        } catch (err) {
            console.error("Failed to fetch table data", err);
            setActiveTableColumns([]);
            setActiveTableData([]);
        } finally {
            setIsLoadingData(false);
        }
    };

    // Modified to optionally accept pre-defined columns (for Saved Views execution)
    const handleExecuteCustomView = async (columnsToExecute?: string[]) => {
        const cols = Array.isArray(columnsToExecute) ? columnsToExecute : customSelectedColumns;
        if (cols.length === 0) return;
        
        setIsLoadingData(true);
        setActiveTableName(null);
        setSortConfig(null);

        try {
            const res = await apiClient.post(`/api/v1/datasets/${selectedDataset}/custom-view`, {
                columns: cols
            });

            setActiveTableColumns(res.data.columns);
            setActiveTableData(res.data.data);
            setExecutedQueryText(res.data.sql);

            setVisibleColumns(res.data.columns);
            setCurrentPage(res.data.pagination.current_page);
            setTotalPages(res.data.pagination.total_pages);
            setTotalRecords(res.data.pagination.total_records);
            setViewMode("ai_query");
        } catch (err) {
            console.error("Custom selection view execution crashed", err);
            setActiveTableColumns([]);
            setActiveTableData([]);
        } finally {
            setIsLoadingData(false);
        }
    };

    const fetchPaginatedData = async (targetPage: number, size: number = pageSize) => {
        if (viewMode === "table" && activeTableName) {
            await fetchTableData(activeTableName, targetPage, size);
        } else if (viewMode === "ai_query" && executedQueryText) {
            setIsLoadingData(true);
            try {
                const res = await apiClient.post(`/api/v1/datasets/${selectedDataset}/execute-paginated?page=${targetPage}&page_size=${size}`, {
                    sql: executedQueryText
                });

                setActiveTableColumns(res.data.columns);
                setActiveTableData(res.data.data);
                setCurrentPage(res.data.pagination.current_page);
                setTotalPages(res.data.pagination.total_pages);
                setTotalRecords(res.data.pagination.total_records);
            } catch (err) {
                console.error("Pagination execution failed", err);
            } finally {
                setIsLoadingData(false);
            }
        }
    };

    const toggleColumnVisibility = (colName: string) => {
        setVisibleColumns(prev =>
            prev.includes(colName) ? prev.filter(c => c !== colName) : [...prev, colName]
        );
    };

    const toggleTable = (tableName: string) => {
        setExpandedTables(prev => ({ ...prev, [tableName]: !prev[tableName] }));
    };

    const handleSort = (key: string) => {
        let direction: "asc" | "desc" = "asc";
        if (sortConfig && sortConfig.key === key && sortConfig.direction === "asc") {
            direction = "desc";
        }
        setSortConfig({ key, direction });
    };

    const sortedData = useMemo(() => {
        if (!sortConfig) return activeTableData;
        const { key, direction } = sortConfig;

        return [...activeTableData].sort((a, b) => {
            const valA = a[key];
            const valB = b[key];

            if (valA === null || valA === undefined) return 1;
            if (valB === null || valB === undefined) return -1;

            if (valA < valB) return direction === "asc" ? -1 : 1;
            if (valA > valB) return direction === "asc" ? 1 : -1;

            return 0;
        });
    }, [activeTableData, sortConfig]);

    if (!selectedDataset) {
        return (
            <div className="flex items-center justify-center h-[calc(100vh-160px)] border-[1.5px] border-dashed border-gray-200 rounded-xl text-gray-400 text-sm font-mono bg-white shadow-sm">
                No dataset active. Please select one from the Ingestion tab.
            </div>
        );
    }

    return (
        <div className="flex h-[calc(100vh-140px)] w-full bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden text-sm relative">

            {/* LEFT PANE: Schema Explorer */}
            <div className={cn(
                "flex flex-col bg-gray-50 border-r border-gray-200 transition-all duration-300 ease-in-out shrink-0",
                isSchemaOpen ? "w-64" : "w-0 border-none opacity-0"
            )}>
                <div className="h-10 px-3 flex items-center justify-between border-b border-gray-200 bg-gray-100/50 shrink-0">
                    <span className="font-semibold text-gray-700 text-[13px] tracking-tight uppercase">Explorer</span>
                    <div className="flex items-center gap-1">
                        {customSelectedColumns.length > 0 && (
                            <Button variant="ghost" className="h-6 px-1.5 text-[11px] text-gray-500" onClick={() => setCustomSelectedColumns([])}>
                                Clear ({customSelectedColumns.length})
                            </Button>
                        )}
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-blue-600 hover:bg-blue-100"
                            onClick={handleSummarizeDataset}
                            title="Summarise Entire Dataset Architecture"
                        >
                            <SparklesIcon />
                        </Button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto py-2">
                    {isLoadingSchema ? (
                        <div className="px-4 py-3 text-gray-400 text-xs font-mono">Loading schema...</div>
                    ) : tables.length === 0 ? (
                        <div className="px-4 py-3 text-gray-400 text-xs font-mono">No tables found.</div>
                    ) : (
                        tables.map((table) => (
                            <div key={table.name} className="flex flex-col">
                                <div className={cn("flex items-center justify-between px-2 py-1 hover:bg-gray-200/50 group transition-colors", activeTableName === table.name && "bg-blue-50/80")}>
                                    <button onClick={() => toggleTable(table.name)} className="flex items-center gap-1.5 text-gray-800 flex-1 text-left py-0.5">
                                        <ChevronIcon isOpen={!!expandedTables[table.name]} />
                                        <TableIcon />
                                        <span className="font-medium truncate">{table.name}</span>
                                    </button>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => fetchTableData(table.name)}
                                        className={cn("h-6 w-6 text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity", activeTableName === table.name && "opacity-100")}
                                        title="View Full Table"
                                    >
                                        <EyeIcon />
                                    </Button>
                                </div>

                                {expandedTables[table.name] && (
                                    <div className="flex flex-col pb-1">
                                        {table.columns.map(col => {
                                            const isChecked = customSelectedColumns.includes(`${table.name}.${col.name}`);
                                            return (
                                                <label key={col.name} className="flex items-center gap-2 pl-6 pr-3 py-1 hover:bg-gray-200/30 text-gray-600 group cursor-pointer transition-colors">
                                                    <input
                                                        type="checkbox"
                                                        className="w-3.5 h-3.5 rounded border-gray-300 text-blue-600 focus:ring-0 focus:ring-offset-0"
                                                        checked={isChecked}
                                                        onChange={() => handleColumnCheckboxChange(table.name, col.name)}
                                                    />
                                                    <TypeIcon type={col.type} />
                                                    <span className={cn("truncate flex-1 text-[13px]", isChecked && "text-blue-700 font-medium")}>{col.name}</span>
                                                </label>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        ))
                    )}

                    {/* Saved Views Sidebar Section */}
                    {savedViews.length > 0 && (
                        <div className="mt-6 pt-4 border-t border-gray-200">
                            <span className="text-[11px] font-semibold text-gray-500 uppercase px-3">Saved Views</span>
                            <div className="mt-2 flex flex-col gap-1 px-2">
                                {savedViews.map(view => (
                                    <button
                                        key={view.name}
                                        onClick={() => {
                                            setCustomSelectedColumns(view.columns);
                                            handleExecuteCustomView(view.columns);
                                        }}
                                        className="text-[13px] text-left px-2 py-1.5 hover:bg-gray-100 rounded text-gray-700 transition-colors"
                                    >
                                        {view.name}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* CENTER PANE: Data Canvas */}
            <div className="flex-1 flex flex-col min-w-0 bg-white relative z-10">
                <div className="h-10 px-2 flex items-center justify-between border-b border-gray-200 bg-white shrink-0 relative z-20">
                    <div className="flex items-center gap-2">
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-gray-500 hover:bg-gray-200 rounded-sm cursor-pointer pointer-events-auto"
                            onClick={() => setIsSchemaOpen(!isSchemaOpen)}
                        >
                            <PanelLeftIcon />
                        </Button>
                        <span className="text-gray-400 mx-1">|</span>
                        <span className="font-medium text-gray-700 text-[13px]">
                            {activeTableName ? `Raw Table: [${activeTableName}]` : customSelectedColumns.length > 0 ? "Custom Joined Selection" : "Data Results"}
                        </span>
                    </div>

                    <div className="flex items-center gap-2">
                        {customSelectedColumns.length > 0 && (
                            <div className="flex gap-2">
                                <Button onClick={() => setIsSaveModalOpen(true)} variant="outline" size="sm" className="h-7 text-[12px]">
                                    Save View
                                </Button>
                                <Button
                                    onClick={() => handleExecuteCustomView()}
                                    disabled={isLoadingData}
                                    size="sm"
                                    className="h-7 text-[12px] bg-blue-600 hover:bg-blue-700 text-white font-medium flex gap-1.5 items-center shadow-sm animate-pulse"
                                >
                                    Show Custom Data ({customSelectedColumns.length} columns)
                                </Button>
                            </div>
                        )}

                        {activeTableColumns.length > 0 && (
                            <div className="relative">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-7 text-[12px] flex gap-2 items-center bg-gray-50"
                                    onClick={() => setIsColumnMenuOpen(!isColumnMenuOpen)}
                                >
                                    <SettingsIcon /> View
                                </Button>

                                {isColumnMenuOpen && (
                                    <div className="absolute right-0 top-8 w-56 bg-white border border-gray-200 rounded-md shadow-lg p-2 z-50 max-h-80 overflow-y-auto flex flex-col gap-1">
                                        <span className="text-[11px] font-semibold text-gray-500 uppercase px-2 py-1">Visible Columns</span>
                                        {activeTableColumns.map(col => (
                                            <label key={col} className="flex items-center gap-2 px-2 py-1.5 hover:bg-gray-50 rounded cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                                    checked={visibleColumns.includes(col)}
                                                    onChange={() => toggleColumnVisibility(col)}
                                                />
                                                <span className="text-[13px] text-gray-700 truncate">{col}</span>
                                            </label>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        {activeTableColumns.length > 0 && (
                            <Button
                                onClick={() => setIsSummarizeModalOpen(true)}
                                disabled={activeTableData.length === 0}
                                variant="outline"
                                size="sm"
                                className="h-7 text-[12px] flex gap-1.5 items-center bg-green-50/50 text-green-700 hover:bg-green-100 border-green-200 transition-colors"
                            >
                                Summarise Results
                            </Button>
                        )}
                        {executedQueryText && activeTableData.length > 0 && (
                            <Button
                                onClick={() => setIsVisualizerOpen(true)}
                                variant="outline"
                                size="sm"
                                className="h-7 text-[12px] flex gap-1.5 items-center bg-purple-50/50 text-purple-700 hover:bg-purple-100 border-purple-200 transition-colors"
                            >
                                <BarChart2 size={14} />
                                Visualise Data
                            </Button>
                        )}
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-blue-600 hover:bg-blue-50 rounded-sm" onClick={() => setIsChatOpen(!isChatOpen)}>
                            <SparklesIcon />
                        </Button>
                    </div>
                </div>

                {/* Dynamic Sortable Table Canvas */}
                <div className="flex-1 overflow-auto p-4 bg-gray-50/30 flex flex-col relative z-0" onClick={() => setIsColumnMenuOpen(false)}>

                    {/* AI Chart Suggestion Banner */}
                    {viewMode === "ai_query" && suggestedChartConfig && (
                        <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-3 mb-4 flex items-center justify-between shadow-sm">
                            <div className="flex items-center gap-2 text-sm text-indigo-800">
                                <BarChart2 size={16} />
                                <span>The AI generated a <b>{suggestedChartConfig.chartType} chart</b> visualizing <b>{suggestedChartConfig.xAxis}</b>.</span>
                            </div>
                            <Button
                                size="sm"
                                className="bg-indigo-600 hover:bg-indigo-700 text-white h-8"
                                onClick={() => setIsVisualizerOpen(true)}
                            >
                                View Suggested Chart
                            </Button>
                        </div>
                    )}

                    {isVisualizerOpen && executedQueryText && (
                        <DataVisualizer
                            datasetName={selectedDataset}
                            sql={executedQueryText}
                            availableColumns={activeTableColumns}
                            onClose={() => setIsVisualizerOpen(false)}
                            initialConfig={suggestedChartConfig ?? undefined}
                        />
                    )}

                    {isLoadingData ? (
                        <div className="flex-1 flex items-center justify-center text-gray-400 font-mono text-sm">Executing query...</div>
                    ) : activeTableColumns.length === 0 ? (
                        <div className="flex-1 flex items-center justify-center border-2 border-dashed border-gray-200 rounded-lg text-gray-400 font-mono text-sm bg-white p-6 text-center max-w-lg mx-auto my-auto h-40">
                            Select an individual table using the Eye icon, or check multiple separate column boxes and hit "Show Custom Data" to merge datasets.
                        </div>
                    ) : (
                        <div className="border border-gray-200 rounded-lg bg-white shadow-sm flex flex-col overflow-hidden h-full">
                            <div className="overflow-auto flex-1">
                                <table className="w-full text-sm text-left whitespace-nowrap">
                                    <thead className="bg-gray-50 text-gray-600 font-medium sticky top-0 shadow-sm z-10">
                                        <tr>
                                            {activeTableColumns.filter(col => visibleColumns.includes(col)).map(col => (
                                                <th
                                                    key={col}
                                                    className="px-4 py-2.5 border-b border-gray-200 cursor-pointer hover:bg-gray-100/80 transition-colors"
                                                    onClick={() => handleSort(col)}
                                                >
                                                    <div className="flex items-center gap-2">
                                                        {col}
                                                        <span className="text-blue-500 text-[11px] font-mono">
                                                            {sortConfig?.key === col ? (sortConfig.direction === "asc" ? "▲" : "▼") : ""}
                                                        </span>
                                                    </div>
                                                </th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100">
                                        {sortedData.length === 0 ? (
                                            <tr><td colSpan={visibleColumns.length} className="px-4 py-8 text-center text-gray-400 italic">No records found.</td></tr>
                                        ) : (
                                            sortedData.map((row: TableRowData, i: number) => (
                                                <tr key={i} className="hover:bg-blue-50/30 transition-colors">
                                                    {activeTableColumns.filter(col => visibleColumns.includes(col)).map(col => (
                                                        <td key={col} className="px-4 py-2 text-gray-700">
                                                            {row[col] !== null ? String(row[col]) : <span className="text-gray-300 italic text-[12px]">null</span>}
                                                        </td>
                                                    ))}
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                </table>
                            </div>

                            {/* Pagination & Query Footer */}
                            <div className="bg-gray-50 border-t border-gray-200 px-4 py-2 text-[11px] text-gray-500 flex justify-between items-center shrink-0 font-mono">

                                {/* Left side: Showing X-Y of Z records */}
                                <div className="flex items-center gap-4 text-gray-600">
                                    {(viewMode === "table" || viewMode === "ai_query") && (
                                        <div className="flex items-center gap-2 border-r border-gray-300 pr-4">
                                            <span className="text-[11px] text-gray-500">Rows per page:</span>
                                            <select
                                                value={pageSize}
                                                onChange={(e) => {
                                                    const newSize = Number(e.target.value);
                                                    setPageSize(newSize);
                                                    fetchPaginatedData(1, newSize);
                                                }}
                                                className="border border-gray-200 rounded px-1 py-0.5 text-[11px] bg-white focus:outline-none focus:border-blue-500 text-gray-700 cursor-pointer"
                                            >
                                                {[20, 40, 60, 80, 100].map(size => (
                                                    <option key={size} value={size}>{size}</option>
                                                ))}
                                            </select>
                                        </div>
                                    )}

                                    <span>
                                        Showing {(currentPage - 1) * pageSize + (totalRecords > 0 ? 1 : 0)}-{Math.min(currentPage * pageSize, totalRecords)} of {totalRecords} records
                                    </span>

                                    {/* SQL Query Display (Copyable) */}
                                    <div className="flex items-center gap-2 truncate max-w-[300px] group border-l border-gray-300 pl-4">
                                        <span className="truncate text-gray-400" title={executedQueryText}>{executedQueryText}</span>
                                        <button
                                            onClick={() => copyToClipboard(executedQueryText)}
                                            className="opacity-0 group-hover:opacity-100 hover:text-blue-600 transition-opacity"
                                            title="Copy SQL to clipboard"
                                        >
                                            <CopyIcon />
                                        </button>
                                    </div>
                                </div>

                                {/* Right side: Pagination or Match count */}
                                {(viewMode === "table" || viewMode === "ai_query") ? (
                                    <div className="flex items-center gap-3">
                                        <Button variant="outline" size="sm" className="h-6 px-2 text-[11px]"
                                            disabled={currentPage === 1}
                                            onClick={() => fetchPaginatedData(currentPage - 1)}>
                                            Prev
                                        </Button>
                                        <span className="font-semibold text-gray-700">Page {currentPage} / {totalPages}</span>
                                        <Button variant="outline" size="sm" className="h-6 px-2 text-[11px]"
                                            disabled={currentPage === totalPages}
                                            onClick={() => fetchPaginatedData(currentPage + 1)}>
                                            Next
                                        </Button>
                                    </div>
                                ) : (
                                    <span>{sortedData.length} total rows matched</span>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* RIGHT PANE: Chatbot (Collapsible Resizable Overlay) */}
            <div
                className={cn(
                    "absolute right-0 top-0 bottom-0 bg-gray-50 border-gray-200 transition-all duration-300 ease-in-out z-40 shadow-2xl flex flex-col overflow-hidden",
                    isChatOpen ? "border-l opacity-100" : "w-0 border-none opacity-0 pointer-events-none"
                )}
                style={isChatOpen ? {
                    width: isChatExpanded ? '600px' : '320px',
                    ...(isChatExpanded ? { resize: 'horizontal', direction: 'rtl', minWidth: '320px', maxWidth: '85vw' } : {})
                } : undefined}
            >
                <div style={{ direction: 'ltr' }} className="flex flex-col h-full w-full min-w-[320px] pointer-events-auto">
                    <div className="h-10 px-3 flex items-center justify-between border-b border-gray-200 bg-blue-50/50 shrink-0">
                        <div className="flex items-center gap-2 text-blue-700">
                            <SparklesIcon />
                            <span className="font-semibold text-[13px] tracking-tight">AI Assistant</span>
                        </div>
                        <div className="flex items-center gap-1">
                            <Button variant="ghost" size="icon" className="h-6 w-6 text-gray-400 hover:text-gray-600" onClick={() => setIsChatExpanded(!isChatExpanded)} title={isChatExpanded ? "Shrink Window" : "Expand & Resize"}>
                                {isChatExpanded ? <ShrinkIcon /> : <ExpandIcon />}
                            </Button>
                            <Button variant="ghost" size="icon" className="h-6 w-6 text-gray-400 hover:text-gray-600" onClick={() => setIsChatOpen(false)}>
                                <CloseIcon />
                            </Button>
                        </div>
                    </div>

                    <div className="flex-1 flex flex-col min-h-0 w-full">
                        <NLQChatbot
                            datasetName={selectedDataset}
                            selectedColumns={visibleColumns}
                            enableCharts={true}
                            onDataResult={(data, columns, pagination, sql, chartConfig) => {
                                setActiveTableData(data);
                                setActiveTableColumns(columns);
                                setActiveTableName(null);
                                setVisibleColumns(columns);
                                setCurrentPage(pagination.current_page);
                                setTotalPages(pagination.total_pages);
                                setTotalRecords(pagination.total_records);
                                setExecutedQueryText(sql);
                                setSuggestedChartConfig(chartConfig || null);
                                setViewMode("ai_query");
                            }}
                        />
                    </div>
                </div>
            </div>

            {/* Save View Modal */}
            {isSaveModalOpen && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm p-4">
                    <div className="bg-white p-5 rounded-xl shadow-2xl border border-gray-200 w-80">
                        <h4 className="text-sm font-semibold mb-3">Save Custom View</h4>
                        <Input 
                            value={newViewName} 
                            onChange={(e) => setNewViewName(e.target.value)} 
                            placeholder="e.g., Monthly Sales Report" 
                            className="mb-4"
                        />
                        <div className="flex justify-end gap-2">
                            <Button variant="ghost" size="sm" onClick={() => setIsSaveModalOpen(false)}>Cancel</Button>
                            <Button size="sm" onClick={handleSaveView} disabled={!newViewName}>Save</Button>
                        </div>
                    </div>
                </div>
            )}

            {/* Data Summarise Modal */}
            {isSummarizeModalOpen && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-gray-900/40 backdrop-blur-[2px] p-4">
                    <div className="bg-white rounded-xl shadow-2xl border border-gray-200 flex flex-col max-w-2xl w-full max-h-[85vh] overflow-hidden animate-in fade-in zoom-in-95 duration-200">

                        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 bg-gray-50/50 shrink-0">
                            <h3 className="font-semibold text-gray-800 flex items-center gap-2 text-[15px]">
                                <SparklesIcon /> Data Summary Configuration
                            </h3>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-gray-400 hover:text-gray-600" onClick={closeSummaryModal}>
                                <CloseIcon />
                            </Button>
                        </div>

                        <div className="p-5 flex flex-col gap-4 overflow-y-auto">
                            <div className="flex flex-col gap-2">
                                <label className="text-[13px] font-medium text-gray-700">
                                    Specific Instructions (Optional)
                                </label>
                                <textarea
                                    className="w-full h-20 p-3 border border-gray-200 rounded-md text-[13px] text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-50/50 resize-none"
                                    placeholder="e.g., 'Focus entirely on revenue drops in Q3', or 'Highlight anomalies in age distribution...'"
                                    value={summaryContextInput}
                                    onChange={(e) => setSummaryContextInput(e.target.value)}
                                    disabled={isSummarizing}
                                />
                            </div>

                            <Button
                                onClick={handleExecuteSummary}
                                disabled={isSummarizing}
                                className="w-full bg-blue-600 hover:bg-blue-700 text-white shadow-sm h-9 text-[13px]"
                            >
                                {isSummarizing ? "Analyzing Data..." : "Generate AI Summary"}
                            </Button>

                            {summaryText && (
                                <div className="mt-4 p-4 bg-blue-50/50 border border-blue-100 rounded-lg text-[13.5px] text-gray-700 leading-relaxed font-sans prose prose-sm prose-blue max-w-none">
                                    <ReactMarkdown>
                                        {summaryText ?? ""}
                                    </ReactMarkdown>
                                </div>
                            )}
                        </div>

                    </div>
                </div>
            )}

            {/* Dataset Summarise Modal */}
            {isDatasetSummaryModalOpen && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-gray-900/40 backdrop-blur-[2px] p-4">
                    <div className="bg-white rounded-xl shadow-2xl border border-gray-200 flex flex-col max-w-2xl w-full max-h-[85vh] overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 bg-gray-50/50 shrink-0">
                            <h3 className="font-semibold text-gray-800 flex items-center gap-2 text-[15px]">
                                <SparklesIcon /> Dataset Architecture Summary
                            </h3>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-gray-400 hover:text-gray-600" onClick={() => setIsDatasetSummaryModalOpen(false)}>
                                <CloseIcon />
                            </Button>
                        </div>
                        <div className="p-6 flex flex-col gap-4 overflow-y-auto min-h-[200px]">
                            {isDatasetSummarizing ? (
                                <div className="flex items-center justify-center h-full text-blue-600 text-[13px] font-medium gap-2 animate-pulse mt-10 mb-10">
                                    <SparklesIcon /> Analyzing table relationships and schema...
                                </div>
                            ) : (
                                <div className="text-[13.5px] text-gray-700 leading-relaxed font-sans prose prose-sm prose-gray max-w-none">
                                    <ReactMarkdown>
                                        {datasetSummaryText ?? ""}
                                    </ReactMarkdown>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
}

// --- SVG Icons ---
const ChevronIcon = ({ isOpen }: { isOpen: boolean }) => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={cn("text-gray-400 transition-transform shrink-0", isOpen && "rotate-90")}>
        <polyline points="9 18 15 12 9 6" />
    </svg>
);

const CopyIcon = () => (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
);

const TableIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-500 shrink-0">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
        <line x1="3" y1="9" x2="21" y2="9" />
        <line x1="9" y1="21" x2="9" y2="9" />
    </svg>
);

const TypeIcon = ({ type }: { type: string }) => {
    const isNum = ['int', 'float', 'decimal', 'numeric'].some(t => type.toLowerCase().includes(t));
    const isDate = ['date', 'time'].some(t => type.toLowerCase().includes(t));

    if (isNum) return <span className="text-blue-500 font-mono text-[11px] w-3 text-center shrink-0">#</span>;
    if (isDate) return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-green-500 shrink-0">
            <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
        </svg>
    );
    return <span className="text-amber-500 font-serif font-bold text-[11px] w-3 text-center shrink-0">A</span>;
};

const PanelLeftIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
        <line x1="9" y1="3" x2="9" y2="21" />
    </svg>
);

const SparklesIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
    </svg>
);

const ExpandIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="15 3 21 3 21 9" />
        <polyline points="9 21 3 21 3 15" />
        <line x1="21" y1="3" x2="14" y2="10" />
        <line x1="3" y1="21" x2="10" y2="14" />
    </svg>
);

const ShrinkIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="4 14 10 14 10 20" />
        <polyline points="20 10 14 10 14 4" />
        <line x1="14" y1="10" x2="21" y2="3" />
        <line x1="3" y1="21" x2="10" y2="14" />
    </svg>
);

const CloseIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
);

const EyeIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
        <circle cx="12" cy="12" r="3" />
    </svg>
);

const SettingsIcon = () => (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
        <circle cx="12" cy="12" r="3" />
    </svg>
);