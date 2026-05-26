import json
from databricks.sdk import WorkspaceClient
from azure.identity import ClientSecretCredential, DefaultAzureCredential
from base.core.config import settings


def _get_workspace_client() -> WorkspaceClient:
    """Helper method to authenticate Databricks natively."""

    print("[Auth] Using ClientSecretCredential for local Databricks connection.")
    credential = ClientSecretCredential(
        tenant_id=settings.azure_tenant_id,
        client_id=settings.azure_client_id,
        client_secret=settings.client_secret
    )
        
    token = credential.get_token("2ff814a6-3304-4ab8-85cb-cd0e6f879c1d/.default").token
    
    return WorkspaceClient(
        host=settings.databricks_host,
        token=token
    )

def extract_headers_via_databricks(file_path: str) -> bool:
    """
    JOB 1: Triggers a lightweight Databricks job to read CSV headers,
    waits for it to complete.
    """
    print(f"[Orchestrator] Triggering Header Extraction (Job 1) for: {file_path}")
    w = _get_workspace_client()

    try:
        run_waiter = w.jobs.run_now(
            job_id=int(settings.databricks_job_1_id),
            job_parameters={"file_path": file_path}
        )
        
        print(f"[Orchestrator] Job 1 Started (Run ID: {run_waiter.bind()['run_id']}). process running..")
        
        run_info = run_waiter.result() 
        
        if run_info.state.life_cycle_state.value != "TERMINATED" or run_info.state.result_state.value != "SUCCESS":
            raise Exception(f"Databricks Job 1 failed. State: {run_info.state.result_state}")

        print(f"[Orchestrator] Job 1 Success. Headers dropped in ADLS.")
        return True

    except Exception as e:
        print(f"[Orchestrator] Job 1 Failed: {str(e)}")
        raise e

def trigger_spark_etl(file_path: str, dataset_name: str, ai_schema_map: str):
    """
    JOB 2: Triggers the heavy ETL and SQL Persistence job. 
    Does NOT wait for completion (Fire-and-Forget).
    """
    print(f"[Orchestrator] Triggering ETL (Job 2) for dataset: {dataset_name}")
    w = _get_workspace_client()

    try:
        response = w.jobs.run_now(
            job_id=int(settings.databricks_job_2_id),
            job_parameters={
                "file_path": file_path,
                "dataset_name": dataset_name,
                "ai_schema_map": ai_schema_map,
                "jdbc_url": f"jdbc:sqlserver://{settings.azure_sql_server_url}:1433;database={settings.azure_sql_server_db}",
                "db_user": settings.azure_sql_admin,
                "db_pass": settings.azure_sql_admin_password
            }
        )
        
        run_id = response.bind()['run_id']
        print(f"[Orchestrator] Job 2 Success! Background ETL running on Databricks with Run ID: {run_id}")
        return run_id

    except Exception as e:
        print(f"[Orchestrator] Job 2 Failed for Dataset: {dataset_name}. Error: {str(e)}")
        raise e