import urllib
import time
from sqlalchemy.exc import OperationalError
from sqlalchemy import text
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
        

def init_db():
    """
    Wakes up the database (handles Serverless auto-pause) and creates tables.
    """
    from base.database.models import Base
    print("[Database] Initiating wakeup sequence...")
    
    max_retries = 30  
    delay = 5
    
    for attempt in range(1, max_retries + 1):
        try:
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            print("[Database] Connection established. Database is awake.")
            break
        except OperationalError:
            print(f"[Database] Asleep or unavailable (Attempt {attempt}/{max_retries}). Waiting {delay}s...")
            time.sleep(delay)
    else:
        print("[Database] CRITICAL: Database failed to wake up after multiple attempts.")
        
    print("[Database] Ensuring ORM tables exist...")
    try:
        Base.metadata.create_all(bind=engine)
        print("[Database] ORM tables provisioned successfully.")
    except Exception as e:
        print(f"[Database] Failed to create tables: {e}")