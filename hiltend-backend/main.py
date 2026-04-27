import os
from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends, Security
from fastapi.middleware.cors import CORSMiddleware
from fastapi_azure_auth import SingleTenantAzureAuthorizationCodeBearer
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field
from azure.identity import DefaultAzureCredential
from azure.storage.filedatalake import DataLakeServiceClient



class Settings(BaseSettings):
    # Map the hyphenated .env names to Python-friendly underscore names
    AZURE_TENANT_ID: str = Field(alias="AZURE-TENANT-ID")
    AZURE_CLIENT_ID: str = Field(alias="AZURE-CLIENT-ID")
    AZURE_OPENAPI_CLIENT_ID: str = Field(alias="AZURE-OPENAPI-CLIENT-ID")
    DATALAKE_ACCOUNT_URL: str = Field(alias="DATALAKE-ACCOUNT-URL")
    DATALAKE_CONTAINER_NAME: str = Field(alias="DATALAKE-CONTAINER-NAME")

    # This tells Pydantic to ignore all the extra Windows/Cortex variables
    model_config = SettingsConfigDict(
        env_file=".env",
        extra="ignore",
        populate_by_name=True,
        env_ignore_empty=True
    )

settings = Settings()

# Azure Identity (Managed Identity in Cloud, ENV variables locally)
credential = DefaultAzureCredential() 

# Corrected DataLake Connection
datalake_client = DataLakeServiceClient(
    account_url=settings.DATALAKE_ACCOUNT_URL, 
    credential=credential
)


azure_scheme = SingleTenantAzureAuthorizationCodeBearer(
    app_client_id=settings.AZURE_CLIENT_ID,
    tenant_id=settings.AZURE_TENANT_ID,
    allow_guest_users=True,
    scopes={
        f"api://{settings.AZURE_CLIENT_ID}/hiltend-auth-access": "Access API as User"
    }
)

# Container App System Identity
# credential = DefaultAzureCredential() 

# # Data Lake Connection /w the URL and Identity
# datalake_client = DataLakeServiceClient(
#     account_url=settings.Field(alias="DATALAKE-ACCOUNT-URL"), 
#     credential=credential
# )

@asynccontextmanager
async def lifespan(app: FastAPI):
    await azure_scheme.openid_config.load_config()
    yield

app = FastAPI(
    title="Hiltend - ETL API",
    swagger_ui_oauth2_redirect_url="/doc/oauth2-redirect",
    swagger_ui_init_oauth={
        "usePkceWithAuthorizationCodeGrant": True,
        "client_id": settings.AZURE_OPENAPI_CLIENT_ID,
    },
    lifespan=lifespan,
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)

# Routes
@app.get("/public")
async def public_route():
    return {"message": "unrestricted"}

@app.get("/secure", dependencies=[Security(azure_scheme)])
async def secure_route():
    return {"message": "valid id"}


@app.get("/test-datalake", dependencies=[Security(azure_scheme)])
async def test_datalake():
    try:
        file_system_client = datalake_client.get_file_system_client(file_system=settings.DATALAKE_CONTAINER_NAME)
        
        paths = file_system_client.get_paths()
        return {"message": "Connected to Datalake", "files": [p.name for p in paths]}
    except Exception as e:
        return {"error": str(e)}