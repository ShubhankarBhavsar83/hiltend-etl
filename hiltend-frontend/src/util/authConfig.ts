import type { Configuration, PopupRequest } from "@azure/msal-browser";
 
// In local dev, VITE_FRONTEND_URL = "http://localhost:5173"
// In Azure, VITE_FRONTEND_URL = the ASWA URL (set as GitHub Variable)
// This fixes the previous bug where redirectUri pointed to the backend URL.
 
export const msalConfig: Configuration = {
    auth: {
        clientId: import.meta.env.VITE_AZURE_CLIENT_ID,
        // authority: `https://login.microsoftonline.com/${import.meta.env.VITE_AZURE_TENANT_ID}`,
        authority: `https://login.microsoftonline.com/common`,
        redirectUri: import.meta.env.VITE_ASWA_FRONTEND_URL || window.location.origin,
    },
    cache: {
        cacheLocation: "sessionStorage",
    },
};
 
export const loginRequest: PopupRequest = {
    scopes: [`api://${import.meta.env.VITE_BACKEND_CLIENT_ID}/hiltend-auth-access`],
};
 
