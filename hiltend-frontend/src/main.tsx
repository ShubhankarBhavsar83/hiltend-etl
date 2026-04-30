import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// import './index.css'
import App from './App.tsx'
import { PublicClientApplication } from '@azure/msal-browser'
import { MsalProvider } from '@azure/msal-react'
import {msalConfig} from "../authConfig"

const root = document.getElementById('root');
if (!root) throw new Error('No root element found');
const msalInstance= new PublicClientApplication(msalConfig);

msalInstance.initialize()
    .then(() => {
        return msalInstance.handleRedirectPromise();
    })
    .then(() => {
        createRoot(root).render(
            <StrictMode>
                <MsalProvider instance={msalInstance}>
                    <App />
                </MsalProvider>
            </StrictMode>,
        )
    })
    .catch(error => {
        console.error("MSAL Initialization Error:", error);
    });