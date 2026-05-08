import urllib
from sqlalchemy import create_engine
from core.config import settings

server = 'hiltend-server-sql.database.windows.net'
database = 'hiltend-db-sql'
driver = '{ODBC Driver 18 for SQL Server}'

base_odbc = f'Driver={driver};Server=tcp:{server},1433;Database={database};Encrypt=yes;TrustServerCertificate=no;'

if settings.azure_key_vault_url:
    print("Using ActiveDirectoryMsi for SQL Authentication.")
    odbc_str = base_odbc + 'Authentication=ActiveDirectoryMsi;'
else:
    print("Using ActiveDirectoryServicePrincipal for local SQL Authentication.")
    odbc_str = base_odbc + f'Uid={settings.azure_client_id};Pwd={settings.client_secret};Authentication=ActiveDirectoryServicePrincipal;'

params = urllib.parse.quote_plus(odbc_str)
engine_url = f"mssql+pyodbc:///?odbc_connect={params}"
engine = create_engine(engine_url, echo=True)