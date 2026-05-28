import os
import uuid
import shutil
from fastapi import APIRouter, Depends, Security, UploadFile, Form, File, Path, BackgroundTasks, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy.exc import OperationalError
from sqlalchemy import text
from base.core.security import azure_scheme
from base.core.config import settings
from base.database.session import get_db

# --- Services ---
from base.services.orchestrator import extract_headers_via_databricks, trigger_spark_etl
from base.services.storage import upload_to_adls, download_headers_from_adls
from base.services.llmService import LLMService

router = APIRouter()

RAW_DATA = "./data/bronze"
os.makedirs(RAW_DATA, exist_ok=True)

ai_service = LLMService()

# --- In-Memory Status DB for Testing the UI Progress Bar ---
PIPELINE_STATUS = {}

def process_pipeline_background(local_path: str, safe_name: str, dataset_name: str, file_id: str):
    """Executes the pipeline and updates the status dictionary for the UI."""
    try:
        PIPELINE_STATUS[file_id] = {"step": "staging", "message": "Uploading to ADLS Bronze Layer..."}
        
        target_path = upload_to_adls(local_path, safe_name)
        
        if not target_path:
            raise Exception("ADLS upload failed, returned empty path.")

        # STEP 2: Databricks Job 1 (Extract)
        PIPELINE_STATUS[file_id] = {"step": "extracting", "message": "Spinning up Databricks Serverless for Header Extraction..."}
        extract_headers_via_databricks(target_path)
        
        # STEP 2.5: Retrieve the dropped file from the Data Lake
        headers = download_headers_from_adls(safe_name)
        
        # STEP 3: Azure AI Mapping
        PIPELINE_STATUS[file_id] = {"step": "ai_mapping", "message": "Azure AI Foundry is designing the Star Schema..."}
        schema_map = ai_service.generate_relational_mapping(dataset_name, headers)
        schema_map_json = schema_map.model_dump_json()

        # STEP 4: Databricks Job 2 (ETL)
        PIPELINE_STATUS[file_id] = {"step": "etl_running", "message": "Triggering Databricks ETL & Azure SQL Merge..."}
        run_id = trigger_spark_etl(target_path, dataset_name, schema_map_json)
        
        # Final Success State
        PIPELINE_STATUS[file_id] = {"step": "completed", "message": f"Pipeline successful! Job ID: {run_id}"}

    except Exception as e:
        PIPELINE_STATUS[file_id] = {"step": "error", "message": f"Pipeline failed: {str(e)}"}

    finally:
        if os.path.exists(local_path):
            os.remove(local_path)

# --- Dataset Management Endpoints ---
from pydantic import BaseModel
class DatasetCreate(BaseModel):
    name: str

@router.get("/api/v1/datasets", dependencies=[Security(azure_scheme)])
def get_datasets(db: Session = Depends(get_db)):
    """Fetches all custom schemas from Azure SQL."""
    query = text("""
        SELECT schema_name FROM information_schema.schemata 
        WHERE schema_name NOT IN ('dbo', 'guest', 'sys', 'INFORMATION_SCHEMA', 'db_owner', 'db_accessadmin', 'db_securityadmin', 'db_ddladmin', 'db_backupoperator', 'db_datareader', 'db_datawriter', 'db_denydatareader', 'db_denydatawriter')
    """)
    result = db.execute(query).fetchall()
    return {"datasets": [row[0] for row in result]}



@router.post("/api/v1/ping", dependencies=[Security(azure_scheme)])
def ping_services(db: Session = Depends(get_db)):
    """Pings low-tier resources to wake them up from standby."""
    status = {"sql": "offline", "databricks": "offline"}
    
    # Ping Azure SQL Serverless
    try:
        db.execute(text("SELECT 1"))
        status["sql"] = "awake"
    except Exception as e:
        print(f"[Ping] SQL DB Error: {e}")
        
    # Ping Databricks Serverless/Compute
    try:
        from base.services.orchestrator import _get_workspace_client
        w = _get_workspace_client()
        list(w.clusters.list()) 
        status["databricks"] = "awake"
    except Exception as e:
        print(f"[Ping] Databricks Error: {e}")
        
    return {"status": "completed", "details": status}

@router.post("/api/v1/datasets", dependencies=[Security(azure_scheme)])
def create_dataset(payload: DatasetCreate, db: Session = Depends(get_db)):
    """Creates a new SQL Schema to isolate the dataset."""
    schema_name = payload.name.strip().replace(" ", "_")
    try:
        db.execute(text(f"CREATE SCHEMA [{schema_name}]"))
        db.commit()
        return {"status": "success", "dataset": schema_name}
    except Exception:
        db.rollback()
        return {"status": "success", "dataset": schema_name, "message": "Dataset already exists"}


@router.get("/api/v1/datasets", dependencies=[Security(azure_scheme)])
def get_datasets(db: Session = Depends(get_db)):
    """Fetches all custom schemas from Azure SQL."""
    try:
        query = text("""
            SELECT schema_name FROM information_schema.schemata 
            WHERE schema_name NOT IN ('dbo', 'guest', 'sys', 'INFORMATION_SCHEMA', 'db_owner', 'db_accessadmin', 'db_securityadmin', 'db_ddladmin', 'db_backupoperator', 'db_datareader', 'db_datawriter', 'db_denydatareader', 'db_denydatawriter')
        """)
        result = db.execute(query).fetchall()
        return {"datasets": [row[0] for row in result]}
    except OperationalError as e:
        print(f"[Error] Database fetch failed (likely asleep): {e}")
        raise HTTPException(
            status_code=503, 
            detail="Database is waking up or temporarily unavailable. Please ping services and try again."
        )
    except Exception as e:
        print(f"[Error] Unexpected error during dataset fetch: {e}")
        raise HTTPException(status_code=500, detail="Internal Server Error")


# --- Ingestion & Status Endpoints ---
@router.post("/api/v1/ingest", dependencies=[Security(azure_scheme)])
async def ingest_file(
    background_tasks: BackgroundTasks,
    dataset_name: str = Form(...),
    file: UploadFile = File(...)
):
    if not file.filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only .csv files supported.")

    file_id = str(uuid.uuid4())[:8]
    safe_name = f"{dataset_name.strip()}_{file_id}.csv"
    local_path = os.path.join(RAW_DATA, safe_name)

    with open(local_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    PIPELINE_STATUS[file_id] = {"step": "queued", "message": "Pipeline queued..."}

    background_tasks.add_task(
        process_pipeline_background, local_path, safe_name, dataset_name.strip(), file_id
    )

    return {"status": "Accepted", "file_id": file_id}

@router.get("/api/v1/status/{file_id}", dependencies=[Security(azure_scheme)])
def get_status(file_id: str):
    return PIPELINE_STATUS.get(file_id, {"step": "unknown", "message": "Status not found."})

@router.get("/api/v1/datasets/{dataset_name}", dependencies=[Security(azure_scheme)])
def get_dataset_details(dataset_name: str = Path(...), db: Session = Depends(get_db)):
    """Fetches details and tables for a specific dataset schema."""
    try:
        query = text("""
            SELECT t.name, t.create_date
            FROM sys.tables t
            JOIN sys.schemas s ON t.schema_id = s.schema_id
            WHERE s.name = :schema_name
        """)
        result = db.execute(query, {"schema_name": dataset_name}).fetchall()
        
        tables = [{"name": row[0], "created_at": row[1]} for row in result]
        
        return {
            "name": dataset_name,
            "table_count": len(tables),
            "tables": tables
        }
    except Exception as e:
        print(f"[Error] Failed to fetch dataset details: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch dataset details.")

    
@router.delete("/api/v1/datasets/{dataset_name}", dependencies=[Security(azure_scheme)])
def delete_dataset(dataset_name: str = Path(...), db: Session = Depends(get_db)):
    """Cascade deletes a schema and all its associated tables."""
    if dataset_name.lower() in ['dbo', 'sys', 'guest', 'information_schema']:
        raise HTTPException(status_code=403, detail="Cannot delete system schemas.")

    try:
        table_query = text("SELECT table_name FROM information_schema.tables WHERE table_schema = :schema_name")
        tables = db.execute(table_query, {"schema_name": dataset_name}).fetchall()
        
        for (table_name,) in tables:
            db.execute(text(f"DROP TABLE [{dataset_name}].[{table_name}]"))
        
        db.execute(text(f"DROP SCHEMA [{dataset_name}]"))
        
        db.commit()
        return {"status": "success", "message": f"Dataset '{dataset_name}' deleted."}
    
    except Exception as e:
        db.rollback()
        print(f"[Error] Failed to delete dataset: {e}")
        raise HTTPException(status_code=500, detail=str(e))