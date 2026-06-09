import { useEffect } from 'react';
import { useGlobalState } from '../context/useGlobalState';
import { useApiClient } from './useApiClient';

export const useIngestPolling = () => {
  const { ingest, setIngestState } = useGlobalState();
  const apiClient = useApiClient();

  useEffect(() => {
    // Get the current file ID from the array using the activeIndex
    const currentFileId = ingest.fileIds[ingest.activeIndex];

    if (!ingest.isActive || !currentFileId) return;

    const interval = setInterval(async () => {
      try {
        const res = await apiClient.get(`/api/v1/status/${currentFileId}`);
        const data = res.data;

        // Update global status with the progress message
        setIngestState((prev) => ({
          ...prev,
          status: { step: data.step, message: data.message }
        }));

        // Handle completion of the current file
        if (data.step === 'completed' || data.step === 'error') {
          if (ingest.activeIndex < ingest.fileIds.length - 1) {
            // Move to the next file in the batch
            setIngestState((prev) => ({
              ...prev,
              activeIndex: prev.activeIndex + 1,
              status: { step: 'queued', message: 'Starting next file...' }
            }));
          } else {
            // Batch complete
            clearInterval(interval);
            setIngestState((prev) => ({ ...prev, isActive: false }));
          }
        }
      } catch (e) {
        console.error("Polling error:", e);
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [ingest.isActive, ingest.fileIds, ingest.activeIndex, setIngestState, apiClient]);
};