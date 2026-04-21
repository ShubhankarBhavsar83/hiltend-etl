import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// import './index.css'
import App from './App.tsx'
import { PublicClientApplication } from '@azure/msal-browser'
import { MsalProvider } from '@azure/msal-react'
import {msalConfig} from "../authConfig"

const msalInstance= new PublicClientApplication(msalConfig);

msalInstance.initialize()
    .then(() => {
        return msalInstance.handleRedirectPromise();
    })
    .then(() => {
        createRoot(document.getElementById('root')!).render(
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