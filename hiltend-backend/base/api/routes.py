import os
import uuid
import shutil
from fastapi import APIRouter, Depends, Security, UploadFile, Form, File, BackgroundTasks, HTTPException
from sqlalchemy.orm import Session
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
        # STEP 1: ALWAYS Stage to ADLS (Databricks needs a cloud path)
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
        # Clean up the local ephemeral file to save space on your laptop/container
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