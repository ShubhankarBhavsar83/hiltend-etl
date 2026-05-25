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
    datalake_connection_key: str = Field(alias="DATALAKE-CONNECTION-KEY")
    datalake_account_name: str = Field(alias="DATALAKE-ACCOUNT-NAME")

    azure_ai_endpoint: str = Field(alias="AZURE-AI-ENDPOINT")
    azure_ai_key: str = Field(alias="AZURE-AI-KEY")
    azure_ai_deployment_name: str = Field(alias="AZURE-AI-DEPLOYMENT-NAME", default="Llama-3.3-70B-Instruct")

    databricks_host: str = Field(alias="DATABRICKS-HOST")
    databricks_job_1_id: str = Field(alias="DATABRICKS-JOB-1-ID")
    databricks_job_2_id: str = Field(alias="DATABRICKS-JOB-2-ID")

    environment: str = Field(alias="ENVIRONMENT", default="local")
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

if settings.environment == "cloud":
    print("Azure environment:..")
else:
    print("Local environment:..")