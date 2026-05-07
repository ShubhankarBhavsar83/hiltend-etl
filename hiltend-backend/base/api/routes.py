import os
import uuid
import shutil
from fastapi import APIRouter, Depends, Security, UploadFile, Form, File, BackgroundTasks, HTTPException
from base.core.security import azure_scheme
from base.services.orchestrator import trigger_spark_job

router = APIRouter()

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

@router.post("/api/v1/ingest")
async def ingest_file(
    background_tasks: BackgroundTasks,
    dataset_name: str = Form(...),
    file: UploadFile = File(...)
):
    if not file.filename.endswith('.csv'):
        raise HTTPException(status_code=400, detail="Only CSV supported.")
    
    file_id = str(uuid.uuid4())[:8]
    safe_filename = f"{dataset_name}_{file_id}.csv"
    file_location = os.path.join(RAW_DATA, safe_filename)

    try:
        with open(file_location, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"failed to save file: {str(e)}")
    
    background_tasks.add_task(trigger_spark_job, file_location, dataset_name)

    return {
        "status": "Accepted",
        "message": "File Staged Safely, Transformation Initiated",
        "file_id": file_id,
        "path": file_location # Removed quotes so it returns the actual path
    }