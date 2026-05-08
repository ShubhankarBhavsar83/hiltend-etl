import os
import uuid
import shutil
from fastapi import APIRouter, Depends, Security, UploadFile, Form, File, BackgroundTasks, HTTPException
from base.core.security import azure_scheme
from base.core.config import settings
from base.services.orchestrator import trigger_spark_job
from base.services.storage import upload_to_adls

router = APIRouter()

# Local staging directory — used in both local dev and cloud.
# In cloud (ACA), this is ephemeral container storage; the file is immediately
# uploaded to ADLS, so persistence isn't required beyond the request lifecycle.
RAW_DATA = "./data/bronze"
os.makedirs(RAW_DATA, exist_ok=True)


@router.get("/")
async def public_route():
    return {"message": "home"}


@router.get("/public")
async def public_route_unrestricted():
    return {"message": "unrestricted"}


@router.get("/secure", dependencies=[Security(azure_scheme)])
async def secure_route():
    return {"message": "valid id"}


@router.post(
    "/api/v1/ingest",
    dependencies=[Security(azure_scheme)],
    summary="Ingest a CSV file into the bronze layer",
)
async def ingest_file(
    background_tasks: BackgroundTasks,
    dataset_name: str = Form(..., description="Logical name for this dataset"),
    file: UploadFile = File(..., description="The CSV file to ingest"),
):
    """
    Accepts a CSV upload, stages it locally, uploads it to ADLS Gen2 bronze
    container (when running in Azure), and triggers the PySpark cleaning job
    as a background task.

    Environment behaviour:
      - Local dev  (no AZURE_KEY_VAULT_URL): stages locally only, skips ADLS.
      - Azure ACA  (AZURE_KEY_VAULT_URL set): stages locally AND uploads to ADLS,
        then cleans up the local temp file.
    """
    if not file.filename or not file.filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only .csv files are supported.")

    if not dataset_name.strip():
        raise HTTPException(status_code=422, detail="dataset_name must not be empty.")

    # Build a safe, unique filename
    file_id = str(uuid.uuid4())[:8]
    safe_name = f"{dataset_name.strip()}_{file_id}.csv"
    local_path = os.path.join(RAW_DATA, safe_name)

    try:
        with open(local_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to stage file: {exc}") from exc

    adls_path: str | None = None
    if settings.azure_key_vault_url:
        # Running in Azure — push to ADLS Gen2 bronze container immediately.
        # upload_to_adls is synchronous but fast for typical CSV sizes.
        try:
            adls_path = upload_to_adls(local_path, safe_name)
        except Exception as exc:
            print(f"[Ingest] ADLS upload failed for {safe_name}: {exc}")
    else:
        print(f"[Ingest] Local env — skipping ADLS upload for {safe_name}.")

    job_input_path = adls_path or local_path
    background_tasks.add_task(trigger_spark_job, job_input_path, dataset_name.strip())

    return {
        "status": "Accepted",
        "message": "File staged. Transformation pipeline initiated.",
        "file_id": file_id,
        "path": job_input_path,
        "adls_uploaded": adls_path is not None,
    }