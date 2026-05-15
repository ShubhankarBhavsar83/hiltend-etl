import os
import uuid
import shutil
from fastapi import APIRouter, Depends, Security, UploadFile, Form, File, BackgroundTasks, HTTPException
from base.core.security import azure_scheme
from base.core.config import settings

# --- Services ---
from base.services.orchestrator import extract_headers_via_databricks, trigger_spark_etl
from base.services.storage import upload_to_adls
from base.services.llmService import LLMService

router = APIRouter()

RAW_DATA = "./data/bronze"
os.makedirs(RAW_DATA, exist_ok=True)

# Instantiate the AI Service once
ai_service = LLMService()

def process_pipeline_background(local_path: str, safe_name: str, dataset_name: str):
    """
    The Master Orchestrator (Strict Databricks Approach):
    1. Uploads to ADLS
    2. Triggers Databricks Job 1 (Extract Headers) & Waits for response
    3. Asks Azure AI Foundry for a Relational Map
    4. Triggers Databricks Job 2 (ETL, Validation, & SQL Persistence)
    """
    try:
        # STEP 1: Upload to ADLS
        if settings.environment == "cloud":
            adls_path = upload_to_adls(local_path, safe_name)
            if not adls_path:
                raise Exception("ADLS upload returned empty path.")
            target_path = adls_path
        else:
            print(f"[Ingest] Local env — skipping ADLS upload for {safe_name}.")
            target_path = local_path

        # STEP 2: Databricks Job 1 (Header Extraction)
        print("[Orchestrator] Triggering Databricks to extract headers...")
        # Note: This orchestrator method must wait for the job to complete and fetch the result
        headers = extract_headers_via_databricks(target_path)
        print(f"[Orchestrator] Received headers from Databricks: {headers}")
        
        # STEP 3: Azure AI Foundry Schema Mapping
        print("[Orchestrator] Requesting Star Schema mapping from Llama 3.3 70B...")
        schema_map = ai_service.generate_relational_mapping(
            dataset_name=dataset_name, 
            headers=headers
        )
        schema_map_json = schema_map.model_dump_json()
        print(f"[Orchestrator] AI Mapping Complete.")

        # STEP 4: Databricks Job 2 (Full ETL Pipeline)
        print("[Orchestrator] Triggering Databricks ETL Job (Write to Azure SQL)...")
        trigger_spark_etl(
            file_path=target_path, 
            dataset_name=dataset_name,
            ai_schema_map=schema_map_json
        )

    except Exception as e:
        print(f"[Orchestrator] Pipeline failed: {str(e)}")
        # Production TODO: Update database state to "Failed" so UI reflects the error

    finally:
        # STEP 5: Cleanup Ephemeral Storage
        if settings.environment == "cloud" and os.path.exists(local_path):
            os.remove(local_path)
            print(f"[Cleanup] Removed ephemeral file: {local_path}")


@router.post(
    "/api/v1/ingest",
    dependencies=[Security(azure_scheme)],
    summary="Ingest a CSV file, map schema via AI, and load to Azure SQL",
)
async def ingest_file(
    background_tasks: BackgroundTasks,
    dataset_name: str = Form(..., description="Logical name for this dataset"),
    file: UploadFile = File(..., description="The CSV file to ingest"),
):
    """
    Validates input, stages the file locally, and hands off to the background orchestrator.
    """
    if not file.filename or not file.filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only .csv files are supported.")

    if not dataset_name.strip():
        raise HTTPException(status_code=422, detail="dataset_name must not be empty.")

    file_id = str(uuid.uuid4())[:8]
    safe_name = f"{dataset_name.strip()}_{file_id}.csv"
    local_path = os.path.join(RAW_DATA, safe_name)

    try:
        with open(local_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to stage file: {exc}") from exc

    background_tasks.add_task(
        process_pipeline_background, 
        local_path=local_path, 
        safe_name=safe_name, 
        dataset_name=dataset_name.strip()
    )

    return {
        "status": "Accepted",
        "message": f"File received. Databricks ingestion and AI pipeline initiated for dataset: {dataset_name}",
        "file_id": file_id
    }