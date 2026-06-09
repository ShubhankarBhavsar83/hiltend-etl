import { createContext } from 'react';
import type { GlobalState } from './GlobalStateTypes.ts';

export const GlobalStateContext = createContext<GlobalState | undefined>(undefined);