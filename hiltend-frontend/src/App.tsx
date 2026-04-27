import { useMsal, AuthenticatedTemplate, UnauthenticatedTemplate } from "@azure/msal-react";
import { loginRequest } from "../authConfig";
import { useState } from "react";

function App() {
    const { instance, accounts } = useMsal();
    const [apiResponse, setApiResponse] = useState<string>("");

    const handleLogin = () => {
        instance.loginRedirect(loginRequest).catch(e => console.error(e));
    };

    const handleLogout = () => {
        instance.logoutRedirect().catch(e => console.error(e));
    };

    const callSecureApi = async () => {
        console.log("1- Button Clicked...");
        try {
            const response = await instance.acquireTokenSilent({
                ...loginRequest,
                account: accounts[0]
            });
            console.log("2- Token Acquired...");

            const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/secure`, {
                headers: {
                    Authorization: `Bearer ${response.accessToken}`
                }
            });
            console.log("3- Fetch Done")

            const data = await res.json();
            setApiResponse(JSON.stringify(data, null, 2));
            
        } catch (error) {
            console.error("API Call Failed", error);
            setApiResponse("Error calling API. Check console.");
        }
    };

    return (
        <div style={{ padding: "2rem", fontFamily: "sans-serif" }}>
            <h1>Hiltend ETL Dashboard</h1>

            {/* Shown only to logged-in users */}
            <AuthenticatedTemplate>
                <div style={{ background: "#d4edda", padding: "1rem", borderRadius: "8px" }}>
                    <h2>Welcome, {accounts[0]?.name}!</h2>
                    <button onClick={handleLogout} style={{ marginRight: "1rem" }}>Logout</button>
                    <button onClick={callSecureApi}>Test Secure Backend</button>
                    
                    {apiResponse && (
                        <pre style={{ background: "#333", color: "white", padding: "1rem", marginTop: "1rem" }}>
                            {apiResponse}
                        </pre>
                    )}
                </div>
            </AuthenticatedTemplate>

            {/* Shown only to guests */}
            <UnauthenticatedTemplate>
                <div style={{ background: "#f8d7da", padding: "1rem", borderRadius: "8px" }}>
                    <p>You are locked out. Please authenticate.</p>
                    <button onClick={handleLogin}>Login with Microsoft</button>
                </div>
            </UnauthenticatedTemplate>
        </div>
    );
}

export default App;