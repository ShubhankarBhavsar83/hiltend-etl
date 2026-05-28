import { useMemo } from 'react';
import axios from 'axios';
import { useMsal } from '@azure/msal-react';
import { loginRequest } from '../util/authConfig';

export function useApiClient() {
  const { instance, accounts } = useMsal();

  const apiClient = useMemo(() => {
    const axiosInstance = axios.create({
      baseURL: import.meta.env.VITE_API_BASE_URL,
    });

    // Automatically inject the MSAL bearer token into every request
    axiosInstance.interceptors.request.use(async (config) => {
      if (accounts.length > 0) {
        try {
          const response = await instance.acquireTokenSilent({
            ...loginRequest,
            account: accounts[0],
          });
          config.headers.Authorization = `Bearer ${response.accessToken}`;
        } catch (error) {
          console.error("[Axios Interceptor] Token acquisition failed:", error);
        }
      }
      return config;
    });

    return axiosInstance;
  }, [instance, accounts]);

  return apiClient;
}