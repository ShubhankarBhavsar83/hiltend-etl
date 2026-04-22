import os
from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends, Security
from fastapi.middleware.cors import CORSMiddleware
from fastapi_azure_auth import SingleTenantAzureAuthorizationCodeBearer
from pydantic_settings import BaseSettings
from pydantic import Field
from azure.identity import DefaultAzureCredential
from azure.storage.filedatalake import DataLakeServiceClient





class Settings(BaseSettings):
    AZURE_TENANT_ID: str = Field(alias="AZURE-TENANT-ID")
    AZURE_CLIENT_ID: str = Field(alias="AZURE-CLIENT-ID")
    AZURE_OPENAPI_CLIENT_ID: str = Field(alias="AZURE-OPENAPI-CLIENT-ID")
    class Config:
        env_file = ".env"

settings = Settings()

azure_scheme = SingleTenantAzureAuthorizationCodeBearer(
    app_client_id=settings.AZURE_CLIENT_ID,
    tenant_id=settings.AZURE_TENANT_ID,
    allow_guest_users=True,
    scopes={
        f"api://{settings.AZURE_CLIENT_ID}/hiltend-auth-access": "Access API as User"
    }
)

# Container App System Identity
credential = DefaultAzureCredential() 

# Data Lake Connection /w the URL and Identity
service_client = DataLakeServiceClient(
    account_url=settings.Field(alias="DATALAKE-ACCOUNT-URL"), 
    credential=credential
)

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
    allow_headers=["*"],
)

# Routes
@app.get("/public")
async def public_route():
    return {"message": "unrestricted"}

@app.get("/secure", dependencies=[Security(azure_scheme)])
async def secure_route():
    return {"message": "valid id"}