from azure.storage.filedatalake import DataLakeServiceClient
from azure.identity import DefaultAzureCredential
from base.core.config import settings

_credential = DefaultAzureCredential()

datalake_client = DataLakeServiceClient(
    account_url=settings.datalake_account_url,
    credential=_credential,
)


def upload_to_adls(local_path: str, remote_filename: str) -> str:
    """
    Upload a local file to the ADLS Gen2 bronze container.

    Args:
        local_path:       Absolute or relative path to the staged local file.
        remote_filename:  Desired filename inside the bronze container.

    Returns:
        The full ADLS path string (account_url/container/filename).

    Raises:
        Exception: Propagates any Azure SDK errors to the caller.
    """
    container = datalake_client.get_file_system_client(
        file_system=settings.datalake_container_name
    )
    file_client = container.get_file_client(remote_filename)

    with open(local_path, "rb") as data:
        file_client.upload_data(data, overwrite=True)

    adls_path = f"{settings.datalake_account_url}/{settings.datalake_container_name}/{remote_filename}"
    print(f"[Storage] Uploaded to ADLS: {adls_path}")
    return adls_path