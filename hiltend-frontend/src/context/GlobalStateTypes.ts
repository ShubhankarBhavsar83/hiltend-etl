 // import type { ReactNode } from 'react';


export interface IngestState {

  isActive: boolean;
  fileIds: string[];
  activeIndex: number;
  datasetName: string | null;
  status: { step: string; message: string };

}


export interface ExplorerState {

  datasetName: string | null;
  tableName: string | null;
  currentPage: number;
  data: Record<string, unknown>[];
  columns: string[];

}


export interface ChatbotState {
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
}


export type Updater<T> = (prev: T) => T | Partial<T>;


export interface GlobalState {

  ingest: IngestState;
  explorer: ExplorerState;
  chatbot: ChatbotState;
  setIngestState: (updater: Updater<IngestState>) => void;
  setExplorerState: (updater: Updater<ExplorerState>) => void;
  setChatbotState: (updater: Updater<ChatbotState>) => void;

} 