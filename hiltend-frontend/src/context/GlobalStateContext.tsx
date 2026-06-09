import { useState, type ReactNode } from 'react';
import { GlobalStateContext } from './GlobalStateContextDef';
import type { IngestState, ExplorerState, ChatbotState, Updater } from './GlobalStateTypes.ts';

export const GlobalStateProvider = ({ children }: { children: ReactNode }) => {
const [ingest, setIngest] = useState<IngestState>({
    isActive: false, 
    fileIds: [], 
    activeIndex: 0, 
    datasetName: null, 
    status: { step: 'idle', message: '' }
  });
  const [explorer, setExplorer] = useState<ExplorerState>({
    datasetName: null,
    tableName: null, 
    currentPage: 1, 
    data: [], 
    columns: []
  });
  const [chatbot, setChatbot] = useState<ChatbotState>({ history: [] });

  const handleUpdate = <T,>(prev: T, updater: Updater<T>): T => {
    const update = typeof updater === 'function' ? (updater as (p: T) => T | Partial<T>)(prev) : updater;
    return { ...prev, ...update };
  };

  return (
    <GlobalStateContext.Provider value={{
      ingest, explorer, chatbot,
      setIngestState: (u) => setIngest((prev) => handleUpdate(prev, u)),
      setExplorerState: (u) => setExplorer((prev) => handleUpdate(prev, u)),
      setChatbotState: (u) => setChatbot((prev) => handleUpdate(prev, u)),
    }}>
      {children}
    </GlobalStateContext.Provider>
  );
};