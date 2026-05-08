from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field
from azure.identity import DefaultAzureCredential
from azure.keyvault.secrets import SecretClient

class Settings(BaseSettings):
    azure_tenant_id: str = Field(alias="AZURE-TENANT-ID")
    azure_client_id: str = Field(alias="AZURE-CLIENT-ID")
    azure_openapi_client_id: str = Field(alias="AZURE-OPENAPI-CLIENT-ID")
    datalake_account_url: str = Field(alias="DATALAKE-ACCOUNT-URL")
    datalake_container_name: str = Field(alias="DATALAKE-CONTAINER-NAME")
    
    azure_aswa_frontend_url: str = Field(alias="AZURE-ASWA-FRONTEND-URL", default="http://localhost:5173")

    azure_key_vault_url: str | None = Field(alias="AZURE-KEY-VAULT-URL", default=None)
    client_secret: str = Field(alias="AZURE-CLIENT-SECRET", default="")

    model_config = SettingsConfigDict(
        env_file=".env",
        extra="ignore",
        populate_by_name=True,
        env_ignore_empty=True
    )

settings = Settings()

if settings.azure_key_vault_url:
    print("Azure environment:..")
    try:
        credential = DefaultAzureCredential()
        secret_client = SecretClient(vault_url=settings.azure_key_vault_url, credential=credential)
        
        settings.client_secret = secret_client.get_secret("AZURE-CLIENT-SECRET").value
        print("Secrets loaded from Vault.")
    except Exception as e:
        print(f"Failed to load secrets from Vault: {e}")
else:
    print("Local environment:..")