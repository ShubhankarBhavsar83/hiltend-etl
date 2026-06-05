import json
from databricks.sdk import WorkspaceClient
from azure.identity import ClientSecretCredential, DefaultAzureCredential
from base.core.config import settings
from sqlalchemy import text
import time
from base.database.session import engine
from databricks.sdk import WorkspaceClient
from base.core.config import settings


def _get_workspace_client() -> WorkspaceClient:

    print("[Auth] Using ClientSecretCredential for Databricks connection.")
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

    print(f"[Orchestrator] Triggering ETL for dataset: {dataset_name}")
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
        print(f"[Orchestrator] Databricks Job running (Run ID: {run_id}). Waiting for staging...")

        while True:
            run_info = w.jobs.get_run(run_id)
            
            state = run_info.state.life_cycle_state.value
            result_state = run_info.state.result_state.value if run_info.state.result_state else None
            
            if state in ['TERMINATED', 'SKIPPED', 'INTERNAL_ERROR']:
                if result_state == 'SUCCESS':
                    print("[Orchestrator] Databricks staging complete!")
                    break
                else:
                    raise Exception(f"Databricks Job Failed: {run_info.state.state_message}")
            
            time.sleep(10)


        print("[Orchestrator] Executing Atomic T-SQL MERGE via FastAPI...")
        schema_map = json.loads(ai_schema_map)
        dimensions = schema_map.get("dimensions", {})

        try:
            with engine.begin() as conn:
                conn.execute(text(f"IF NOT EXISTS (SELECT * FROM sys.schemas WHERE name = '{dataset_name}') EXEC('CREATE SCHEMA [{dataset_name}]');"))
                
                for dim_name in dimensions.keys():
                    real_table = f"[{dataset_name}].[{dim_name}]"
                    stg_table = f"[{dataset_name}].[stg_{dim_name}]"

                    col_query = f"""
                    SELECT COLUMN_NAME 
                    FROM INFORMATION_SCHEMA.COLUMNS 
                    WHERE TABLE_SCHEMA = '{dataset_name}' AND TABLE_NAME = 'stg_{dim_name}'
                    ORDER BY ORDINAL_POSITION
                    """
                    valid_columns = [row[0] for row in conn.execute(text(col_query)).fetchall()]
                    
                    if not valid_columns:
                        raise Exception(f"Missing staging table for {dim_name}. Aborting entire dataset load.")
                        
                    primary_key = valid_columns[0] 

                    init_query = f"""
                    IF NOT EXISTS (SELECT * FROM sys.tables t JOIN sys.schemas s ON t.schema_id = s.schema_id WHERE s.name = '{dataset_name}' AND t.name = '{dim_name}')
                    BEGIN
                        SELECT * INTO {real_table} FROM {stg_table} WHERE 1=0;
                    END
                    """
                    conn.execute(text(init_query))

                    target_col_query = f"""
                    SELECT COLUMN_NAME 
                    FROM INFORMATION_SCHEMA.COLUMNS 
                    WHERE TABLE_SCHEMA = '{dataset_name}' AND TABLE_NAME = '{dim_name}'
                    """
                    target_columns = [row[0] for row in conn.execute(text(target_col_query)).fetchall()]
                    
                    for col in valid_columns:
                        if col not in target_columns:
                            dt_query = f"SELECT DATA_TYPE, CHARACTER_MAXIMUM_LENGTH FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='{dataset_name}' AND TABLE_NAME='stg_{dim_name}' AND COLUMN_NAME='{col}'"
                            dt_row = conn.execute(text(dt_query)).fetchone()
                            if dt_row:
                                d_type = dt_row[0]
                                c_len = dt_row[1]
                                type_str = d_type
                                if d_type in ['varchar', 'nvarchar', 'char', 'nchar']:
                                    if c_len == -1:
                                        type_str += "(MAX)"
                                    elif c_len:
                                        type_str += f"({c_len})"
                                        
                                print(f"[Orchestrator] Schema Evolution: Adding column [{col}] {type_str} to {real_table}")
                                conn.execute(text(f"ALTER TABLE {real_table} ADD [{col}] {type_str};"))

                    update_set = ", ".join([f"target.[{col}] = source.[{col}]" for col in valid_columns if col != primary_key])
                    insert_cols = ", ".join([f"[{col}]" for col in valid_columns])
                    insert_vals = ", ".join([f"source.[{col}]" for col in valid_columns])

                    merge_query = f"""
                    MERGE INTO {real_table} AS target
                    USING {stg_table} AS source
                    ON target.[{primary_key}] = source.[{primary_key}]
                    """
                    if update_set:
                        merge_query += f" WHEN MATCHED THEN UPDATE SET {update_set}"
                    merge_query += f" WHEN NOT MATCHED THEN INSERT ({insert_cols}) VALUES ({insert_vals});"

                    conn.execute(text(merge_query))
                    print(f"[Orchestrator] Successfully staged MERGE for {dim_name}")

                print("[Orchestrator] All dimensions processed without error. Committing transaction to Azure SQL...")

        except Exception as e:
            print(f"\n[Orchestrator] FATAL ERROR: {str(e)}")
            print("[Orchestrator] Transaction ROLLED BACK. The database remains untouched.")
            raise e
            
        finally:
            print("\n[Orchestrator] Initiating post-run cleanup...")
            try:
                with engine.begin() as cleanup_conn:
                    for dim_name in dimensions.keys():
                        stg_table = f"[{dataset_name}].[stg_{dim_name}]"
                        cleanup_conn.execute(text(f"DROP TABLE IF EXISTS {stg_table};"))
                print("[Orchestrator] Databricks staging tables successfully dropped.")
            except Exception as cleanup_error:
                print(f"[Orchestrator] Warning: Staging cleanup failed: {str(cleanup_error)}")

        print("\n[Orchestrator] ETL Pipeline 100% Complete!")
        return run_id

    except Exception as e:
        print(f"[Orchestrator] ETL Failed: {str(e)}")
        raise e