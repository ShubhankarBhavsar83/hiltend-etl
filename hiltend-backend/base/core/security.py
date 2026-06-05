from fastapi_azure_auth import MultiTenantAzureAuthorizationCodeBearer
from base.core.config import settings

azure_scheme = MultiTenantAzureAuthorizationCodeBearer (
    app_client_id=settings.azure_client_id,
    # tenant_id=settings.azure_tenant_id,
    validate_iss=False,
    allow_guest_users=True,
    scopes={
        f"api://{settings.azure_client_id}/hiltend-auth-access": "Access API as User"
    }
)