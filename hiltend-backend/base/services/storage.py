from azure.storage.filedatalake import DataLakeServiceClient
from azure.identity import DefaultAzureCredential
from core.config import settings

credential = DefaultAzureCredential() 

datalake_client = DataLakeServiceClient(
    account_url=settings.datalake_account_url, 
    credential=credential
)