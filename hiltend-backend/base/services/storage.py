import json
from azure.storage.filedatalake import DataLakeServiceClient
from azure.identity import DefaultAzureCredential, ClientSecretCredential
from base.core.config import settings

# --- Dynamically assign credentials based on environment ---
if settings.environment == "cloud":
    _credential = DefaultAzureCredential()
else:
    print("[Storage] Using ClientSecretCredential for local ADLS connection.")
    _credential = ClientSecretCredential(
        tenant_id=settings.azure_tenant_id,
        client_id=settings.azure_client_id,
        client_secret=settings.client_secret
    )

datalake_client = DataLakeServiceClient(
    account_url=settings.datalake_account_url,
    credential=_credential,
)


def upload_to_adls(local_path: str, remote_filename: str) -> str:
    """
    Upload a local file to the ADLS Gen2 bronze container.
    """
    container = datalake_client.get_file_system_client(
        file_system=settings.datalake_container_name
    )
    file_client = container.get_file_client(remote_filename)

    with open(local_path, "rb") as data:
        file_client.upload_data(data, overwrite=True)

    # Note: Databricks prefers the abfss:// protocol for ADLS
    account_name = settings.datalake_account_url.replace("https://", "").split(".")[0]
    
    adls_path = f"abfss://{settings.datalake_container_name}@{account_name}.dfs.core.windows.net/{remote_filename}"
    
    print(f"[Storage] Uploaded to ADLS: {adls_path}")
    return adls_path


def download_headers_from_adls(remote_filename: str) -> list:
    """
    Reaches into ADLS, downloads the dropped JSON file, 
    and returns the headers as a Python list.
    """
    # matching naming convention in databricks
    headers_filename = remote_filename.replace(".csv", "_headers.json")
    
    container = datalake_client.get_file_system_client(
        file_system=settings.datalake_container_name
    )
    file_client = container.get_file_client(headers_filename)
    
    downloaded_bytes = file_client.download_file().readall()
    headers_json_str = downloaded_bytes.decode('utf-8')
    
    print(f"[Storage] Successfully downloaded headers: {headers_filename}")
    
    return json.loads(headers_json_str)