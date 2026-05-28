import urllib
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from base.core.config import settings

server = settings.azure_sql_server_url
database = settings.azure_sql_server_db
driver = '{ODBC Driver 18 for SQL Server}'

base_odbc = f'Driver={driver};Server=tcp:{server},1433;Database={database};Encrypt=yes;TrustServerCertificate=no;Connection Timeout=30;'

if settings.environment == "cloud":
    print("[Database] Using traditional SQL Authentication in Cloud.")
    odbc_str = base_odbc + f'Uid={settings.azure_sql_admin};Pwd={settings.azure_sql_admin_password};'
else:
    print("[Database] Using ActiveDirectoryServicePrincipal for local SQL Authentication.")
    odbc_str = base_odbc + f'Uid={settings.azure_client_id};Pwd={settings.client_secret};Authentication=ActiveDirectoryServicePrincipal;'

params = urllib.parse.quote_plus(odbc_str)
engine_url = f"mssql+pyodbc:///?odbc_connect={params}"

is_dev = settings.environment != "cloud"
engine = create_engine(
    engine_url, 
    echo=is_dev, 
    pool_pre_ping=True,
    pool_recycle=1800,
    pool_timeout=30,
    connect_args={"connect_timeout": 30}
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def get_db():
    """FastAPI Dependency to safely yield and close database sessions per request."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()