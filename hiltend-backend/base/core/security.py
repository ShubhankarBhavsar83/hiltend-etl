from fastapi_azure_auth import SingleTenantAzureAuthorizationCodeBearer
from base.core.config import settings

azure_scheme = SingleTenantAzureAuthorizationCodeBearer(
    app_client_id=settings.azure_client_id,
    tenant_id=settings.azure_tenant_id,
    allow_guest_users=True,
    scopes={
        f"api://{settings.azure_client_id}/hiltend-auth-access": "Access API as User"
    }
)