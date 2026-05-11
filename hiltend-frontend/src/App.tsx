import { useMsal, AuthenticatedTemplate, UnauthenticatedTemplate } from "@azure/msal-react";
import { loginRequest } from "./util/authConfig";
import LoginPage from "./components/LoginPage";
import Dashboard from "./components/Dashboard";


export default function App() {
  const { instance } = useMsal();

  const handleLogin = () => {
    instance.loginRedirect(loginRequest).catch(console.error);
  };

  const handleLogout = () => {
    instance.logoutRedirect().catch(console.error);
  };

  return (
    <>
      <UnauthenticatedTemplate>
        <LoginPage onLogin={handleLogin} />
      </UnauthenticatedTemplate>

      <AuthenticatedTemplate>
        <Dashboard onLogout={handleLogout} />
      </AuthenticatedTemplate>
    </>
  );
}