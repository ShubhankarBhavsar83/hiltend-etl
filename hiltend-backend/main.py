from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from base.core.config import settings
from base.core.security import azure_scheme
from base.api.routes import router

@asynccontextmanager
async def lifespan(app: FastAPI):
    await azure_scheme.openid_config.load_config()
    yield

app = FastAPI(
    title="Hiltend - ETL API",
    swagger_ui_oauth2_redirect_url="/doc/oauth2-redirect",
    swagger_ui_init_oauth={
        "usePkceWithAuthorizationCodeGrant": True,
        "client_id": settings.azure_openapi_client_id,
    },
    lifespan=lifespan,
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", settings.azure_aswa_frontend_url],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)

# Attach the routes
app.include_router(router)