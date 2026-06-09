import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import "./index.css";
import App from './App.tsx'
import { PublicClientApplication } from '@azure/msal-browser'
import { MsalProvider } from '@azure/msal-react'
import { msalConfig } from "./util/authConfig.ts"
import { GlobalStateProvider } from './context/GlobalStateContext.tsx';



const root = document.getElementById('root');
if (!root) throw new Error('No root element found');
const msalInstance = new PublicClientApplication(msalConfig);

msalInstance.initialize()
    .then(() => {
        return msalInstance.handleRedirectPromise();
    })
    .then(() => {
        createRoot(root).render(
            <StrictMode>
                <MsalProvider instance={msalInstance}>
                    <GlobalStateProvider>
                        <App />
                    </GlobalStateProvider>
                </MsalProvider>
            </StrictMode>,
        )
    })
    .catch(error => {
        console.error("MSAL Initialization Error:", error);
    });



//  Refactor Ingestion & Polling (UploadPanel.tsx):

//     Move the polling logic (or the status dependency) to the global context so background tasks don't die or lose visual reference when the user clicks away.

// Implement Global Nav Tracker (Sidebar.tsx):

//     Consume the global ingest state.

//     Use the current route location to conditionally render a miniaturized progress bar if the user is not on the upload/ingest page.

// Refactor Page Components (DataExplorer.tsx, NLQChatbot.tsx, etc.):

//     Swap useState hooks for our new global context getters/setters to retain table pagination, selected views, and chat history upon remounting.