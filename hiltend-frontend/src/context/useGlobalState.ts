import { useContext } from 'react';
import { GlobalStateContext } from './GlobalStateContextDef';

export const useGlobalState = () => {
  const context = useContext(GlobalStateContext);
  if (!context) {
    throw new Error('useGlobalState must be used within a GlobalStateProvider');
  }
  return context;
};