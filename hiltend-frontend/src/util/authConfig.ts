import type { Configuration, PopupRequest } from "@azure/msal-browser";

export const msalConfig: Configuration ={
    auth: {
        clientId: import.meta.env.VITE_AZURE_CLIENT_ID,
        authority: `https://login.microsoftonline.com/${import.meta.env.VITE_AZURE_TENANT_ID}`,
        redirectUri: `${import.meta.env.VITE_API_BASE_URL}`,
    },
    cache: {
        cacheLocation: "sessionStorage",
    }
}

export const loginRequest: PopupRequest = {
    scopes: [`api://${import.meta.env.VITE_BACKEND_CLIENT_ID}/hiltend-auth-access`]
}