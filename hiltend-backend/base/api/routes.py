import os
import re
import csv
import io
import uuid
import shutil
import json
from datetime import datetime
from fastapi import APIRouter, Depends, Query, Security, UploadFile, Form, File, Path, BackgroundTasks, HTTPException, Request
from sqlalchemy.orm import Session
from sqlalchemy.exc import OperationalError
from sqlalchemy import text
from typing import List, Dict, Any, Optional
from pydantic import BaseModel

from base.core.security import azure_scheme
from base.core.config import settings
from base.database.session import get_db, engine
from base.database.models import AppUser, Dataset, DatasetAccess, AccessRole, JobHistory, SavedView

# --- Services ---
from base.services.orchestrator import extract_headers_via_databricks, trigger_spark_etl
from base.services.storage import upload_to_adls, download_headers_from_adls
from base.services.llmService import LLMService

router = APIRouter()

RAW_DATA = "./data/bronze"
os.makedirs(RAW_DATA, exist_ok=True)

ai_service = LLMService()

# --- In-Memory Status for UI Progress Bar ---
PIPELINE_STATUS = {}


# --- Identity & Authorization Dependencies ---
async def get_current_user(request: Request, db: Session = Depends(get_db), _token=Security(azure_scheme)) -> AppUser:
    """Intercepts the Azure AD token, creates or updates the user in the database, and returns the AppUser ORM object."""
    if not hasattr(request.state, 'user'):
        raise HTTPException(status_code=401, detail="Invalid authentication token.")
    
    user_token = request.state.user
    oid = user_token.oid
    email = getattr(user_token, 'preferred_username', None) or getattr(user_token, 'upn', f"{oid}@unknown.com")
    name = getattr(user_token, 'name', 'Unknown User')

    user = db.query(AppUser).filter(AppUser.azure_oid == oid).first()
    
    if not user:
        user = AppUser(azure_oid=oid, email=email, name=name)
        db.add(user)
        db.commit()
        db.refresh(user)
    elif user.email != email or user.name != name:
        user.email = email
        user.name = name
        db.commit()
        db.refresh(user)
        
    return user


def require_dataset_access(min_role: AccessRole):
    """Dependency to check if the current user has the required minimum role for a given dataset."""
    def role_checker(
        dataset_name: str = Path(...), 
        current_user: AppUser = Depends(get_current_user), 
        db: Session = Depends(get_db)
    ) -> Dataset:
        dataset = db.query(Dataset).filter(Dataset.name == dataset_name).first()
        if not dataset:
            raise HTTPException(status_code=404, detail=f"Dataset '{dataset_name}' not found.")
        
        access = db.query(DatasetAccess).filter_by(user_id=current_user.id, dataset_id=dataset.id).first()
        if not access:
            raise HTTPException(status_code=403, detail="You do not have access to this dataset.")
        
        roles = [AccessRole.VIEWER, AccessRole.USER, AccessRole.ADMIN, AccessRole.OWNER]
        if roles.index(access.role) < roles.index(min_role):
            raise HTTPException(status_code=403, detail=f"Action requires {min_role.value} privileges.")
        
        return dataset
    return role_checker


# --- Schemas ---
class DatasetCreate(BaseModel):
    name: str
    
class CustomViewRequest(BaseModel):
    columns: list[str] 
    
class NLQRequest(BaseModel):
    prompt: str
    selected_columns: list[str] = []
    
class SummarizeRequest(BaseModel):
    data: List[Dict[str, Any]]
    user_context: Optional[str] = None
    
class ChartSummarizeRequest(BaseModel):
    data: List[Dict[str, Any]]
    user_context: Optional[str] = None
    
class QueryExecutionRequest(BaseModel):
    sql: str
    
class SaveViewRequest(BaseModel):
    name: str
    columns: list[str]
    
# --- Database Helpers ---
def _execute_and_paginate(db: Session, sql: str, page: int, page_size: int):
    clean_sql_upper = sql.upper().strip()
    if not clean_sql_upper.startswith("SELECT"):
        raise HTTPException(status_code=400, detail="Only SELECT queries are permitted.")
        
    destructive_pattern = re.compile(r'\b(DROP|DELETE|UPDATE|INSERT|ALTER|TRUNCATE)\b')
    if destructive_pattern.search(clean_sql_upper):
        raise HTTPException(status_code=400, detail="Destructive execution patterns blocked.")

    count_query = text(f"SELECT COUNT(*) FROM ({sql}) AS SubQ")
    total_records = db.execute(count_query).scalar()

    offset = (page - 1) * page_size
    paginated_sql = f"""
        WITH BaseQuery AS ({sql})
        SELECT * FROM BaseQuery
        ORDER BY (SELECT NULL)
        OFFSET :offset ROWS FETCH NEXT :page_size ROWS ONLY
    """
    
    result = db.execute(text(paginated_sql), {"offset": offset, "page_size": page_size})
    
    columns = _deduplicate_columns(list(result.keys()))
    rows = [dict(zip(columns, row)) for row in result.fetchall()]

    return {
        "columns": columns,
        "data": rows,
        "sql": sql,
        "pagination": {
            "total_records": total_records,
            "current_page": page,
            "page_size": page_size,
            "total_pages": (total_records + page_size - 1) // page_size
        }
    }

def _execute_full(db: Session, sql: str, limit: int = 5000):
    clean_sql_upper = sql.upper().strip()
    if not clean_sql_upper.startswith("SELECT"):
        raise HTTPException(status_code=400, detail="Only SELECT queries are permitted.")
        
    destructive_pattern = re.compile(r'\b(DROP|DELETE|UPDATE|INSERT|ALTER|TRUNCATE)\b')
    if destructive_pattern.search(clean_sql_upper):
        raise HTTPException(status_code=400, detail="Destructive execution patterns blocked.")

    safe_sql = f"SELECT TOP {limit} * FROM ({sql}) AS SubQ"
    result = db.execute(text(safe_sql))
    
    columns = _deduplicate_columns(list(result.keys()))
    rows = [dict(zip(columns, row)) for row in result.fetchall()]

    return {"columns": columns, "data": rows, "sql": sql, "limit_applied": limit}

def _deduplicate_columns(raw_columns: list[str]) -> list[str]:
    columns = []
    seen = {}
    for col in raw_columns:
        if col in seen:
            seen[col] += 1
            columns.append(f"{col}_{seen[col]}")
        else:
            seen[col] = 0
            columns.append(col)
    return columns


# --- Background Workers ---
def process_pipeline_background(local_path: str, safe_name: str, dataset_name: str, dataset_id: str, file_id: str, user_id: str, batch_id: str):
    steps = [
        {"name": "Stage to ADLS Bronze Layer", "key": "staging", "status": "pending"},
        {"name": "Databricks Serverless Header Extract", "key": "extracting", "status": "pending"},
        {"name": "Azure AI Star Schema Design", "key": "ai_mapping", "status": "pending"},
        {"name": "PySpark ETL & Azure SQL Merge", "key": "etl_running", "status": "pending"}
    ]
    
    def _update_db(overall_status: str, active_step_key: str = None, failed_step_key: str = None):
        try:
            target_key = failed_step_key or active_step_key
            current_idx = next((i for i, s in enumerate(steps) if s["key"] == target_key), -1)

            for i, s in enumerate(steps):
                if overall_status == "success":
                    s["status"] = "completed"
                elif failed_step_key and s["key"] == failed_step_key:
                    s["status"] = "error"
                elif i < current_idx:
                    s["status"] = "completed"
                elif i == current_idx:
                    s["status"] = "in_progress"
                elif i > current_idx and overall_status == "failed":
                    s["status"] = "pending"

            with Session(engine) as conn:
                job = conn.query(JobHistory).filter(JobHistory.id == file_id).first()
                if job:
                    job.overall_status = overall_status
                    job.steps_json = json.dumps(steps)
                else:
                    adls_path = f"abfss://{settings.datalake_container_name}@{settings.datalake_account_url.replace('https://', '').split('.')[0]}.dfs.core.windows.net/{safe_name}"
                    job = JobHistory(
                        id=file_id,
                        batch_id=batch_id,
                        adls_file_id=adls_path,
                        overall_status=overall_status,
                        steps_json=json.dumps(steps),
                        user_id=user_id,
                        dataset_id=dataset_id
                    )
                    conn.add(job)
                conn.commit()
        except Exception as e:
            print(f"[DB Log Error] {e}")

    active_step = "staging" 

    try:
        active_step = "staging"
        PIPELINE_STATUS[file_id] = {"step": active_step, "message": "Uploading to ADLS Bronze Layer..."}
        _update_db("in_progress", active_step_key=active_step)
        
        target_path = upload_to_adls(local_path, safe_name)
        if not target_path: raise Exception("ADLS upload failed.")

        active_step = "extracting"
        PIPELINE_STATUS[file_id] = {"step": active_step, "message": "Spinning up Databricks Serverless for Header Extraction..."}
        _update_db("in_progress", active_step_key=active_step)
        
        extract_headers_via_databricks(target_path)
        headers = download_headers_from_adls(safe_name)
        
        existing_schema_str = ""
        try:
            with engine.connect() as conn:
                query = text("SELECT TABLE_NAME, COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = :schema_name AND TABLE_NAME NOT LIKE 'stg_%'")
                result = conn.execute(query, {"schema_name": dataset_name}).fetchall()
                if result:
                    tables_dict = {}
                    for row in result:
                        if row[0] not in tables_dict: tables_dict[row[0]] = []
                        tables_dict[row[0]].append(row[1])
                    existing_schema_str = "CURRENT SCHEMA TABLES:\n" + "".join([f"- {t}: {', '.join(cols)}\n" for t, cols in tables_dict.items()])
        except Exception as e:
            print(f"[Warning] Failed to fetch existing schema context: {e}")

        active_step = "ai_mapping"
        PIPELINE_STATUS[file_id] = {"step": active_step, "message": "Azure AI Foundry is mapping the data..."}
        _update_db("in_progress", active_step_key=active_step)
        
        schema_map = ai_service.generate_relational_mapping(dataset_name, headers, existing_schema_str)
        schema_map_json = schema_map.model_dump_json()

        active_step = "etl_running"
        PIPELINE_STATUS[file_id] = {"step": active_step, "message": "Triggering Databricks ETL & Azure SQL Merge..."}
        _update_db("in_progress", active_step_key=active_step)
        
        run_id = trigger_spark_etl(target_path, dataset_name, schema_map_json)
        
        PIPELINE_STATUS[file_id] = {"step": "completed", "message": f"Pipeline successful! Job ID: {run_id}"}
        _update_db("success", active_step_key=active_step)

    except Exception as e:
        PIPELINE_STATUS[file_id] = {"step": "error", "message": f"Pipeline failed: {str(e)}"}
        _update_db("failed", failed_step_key=active_step)

    finally:
        if os.path.exists(local_path):
            os.remove(local_path)


# --- Dataset CRUD & Permissions ---
@router.post("/api/v1/datasets")
def create_dataset(payload: DatasetCreate, db: Session = Depends(get_db), current_user: AppUser = Depends(get_current_user)):
    schema_name = payload.name.strip().replace(" ", "_")
    
    if db.query(Dataset).filter(Dataset.name == schema_name).first():
        return {"status": "success", "dataset": schema_name, "message": "Dataset already exists"}
    
    try:
        db.execute(text(f"CREATE SCHEMA [{schema_name}]"))
        
        new_dataset = Dataset(name=schema_name, display_name=payload.name.strip(), created_by=current_user.id)
        db.add(new_dataset)
        db.flush() 
        
        access = DatasetAccess(user_id=current_user.id, dataset_id=new_dataset.id, role=AccessRole.OWNER)
        db.add(access)
        db.commit()
        
        return {"status": "success", "dataset": schema_name}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/v1/datasets")
def get_datasets(db: Session = Depends(get_db), current_user: AppUser = Depends(get_current_user)):
    """Returns only datasets the user has access to."""
    accesses = db.query(DatasetAccess).filter(DatasetAccess.user_id == current_user.id).all()
    dataset_names = [a.dataset.name for a in accesses]
    return {"datasets": dataset_names}

@router.delete("/api/v1/datasets/{dataset_name}")
def delete_dataset(
    dataset_name: str = Path(...), 
    db: Session = Depends(get_db), 
    dataset: Dataset = Depends(require_dataset_access(AccessRole.USER))
):
    try:
        table_query = text("SELECT table_name FROM information_schema.tables WHERE table_schema = :schema_name")
        tables = db.execute(table_query, {"schema_name": dataset.name}).fetchall()
        
        for (table_name,) in tables:
            db.execute(text(f"DROP TABLE [{dataset.name}].[{table_name}]"))
        db.execute(text(f"DROP SCHEMA [{dataset.name}]"))
        
        # Remove from ORM
        db.delete(dataset)
        db.commit()
        
        return {"status": "success", "message": f"Dataset '{dataset.name}' deleted."}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


# --- Data Endpoints (Protected by require_dataset_access) ---
@router.get("/api/v1/datasets/{dataset_name}")
def get_dataset_details(dataset_name: str = Path(...), db: Session = Depends(get_db), dataset: Dataset = Depends(require_dataset_access(AccessRole.VIEWER))):
    try:
        query = text("""
            SELECT t.name, t.create_date
            FROM sys.tables t
            JOIN sys.schemas s ON t.schema_id = s.schema_id
            WHERE s.name = :schema_name
        """)
        result = db.execute(query, {"schema_name": dataset.name}).fetchall()
        tables = [{"name": row[0], "created_at": row[1]} for row in result]
        
        return {"name": dataset.name, "table_count": len(tables), "tables": tables}
    except Exception as e:
        raise HTTPException(status_code=500, detail="Failed to fetch dataset details.")

@router.get("/api/v1/datasets/{dataset_name}/explorer")
def get_dataset_explorer_schema(dataset_name: str = Path(...), db: Session = Depends(get_db), dataset: Dataset = Depends(require_dataset_access(AccessRole.VIEWER))):
    try:
        query = text("""
            SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = :schema_name AND TABLE_NAME NOT LIKE 'stg_%'
            ORDER BY TABLE_NAME, ORDINAL_POSITION
        """)
        result = db.execute(query, {"schema_name": dataset.name}).fetchall()
        
        tables_dict = {}
        for row in result:
            t_name, c_name, d_type = row
            if t_name not in tables_dict:
                tables_dict[t_name] = []
            tables_dict[t_name].append({"name": c_name, "type": d_type})
            
        formatted_tables = [{"name": t_name, "columns": cols} for t_name, cols in tables_dict.items()]
        return {"dataset": dataset.name, "tables": formatted_tables}
    except Exception as e:
        raise HTTPException(status_code=500, detail="Failed to fetch schema details.")

@router.get("/api/v1/datasets/{dataset_name}/tables/{table_name}/data")
def get_table_data(
    table_name: str = Path(...), 
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=20, le=100),
    db: Session = Depends(get_db),
    dataset: Dataset = Depends(require_dataset_access(AccessRole.VIEWER))
):
    try:
        col_query = text("""
            SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_SCHEMA = :schema AND TABLE_NAME = :table
            ORDER BY ORDINAL_POSITION
        """)
        valid_cols = [row[0] for row in db.execute(col_query, {"schema": dataset.name, "table": table_name}).fetchall()]
        
        if not valid_cols:
            raise HTTPException(status_code=404, detail="Table not found or has no columns.")

        primary_col = valid_cols[0]
        count_query = text(f"SELECT COUNT(*) FROM [{dataset.name}].[{table_name}]")
        total_records = db.execute(count_query).scalar()

        offset = (page - 1) * page_size
        query = text(f"""
            SELECT * FROM [{dataset.name}].[{table_name}]
            ORDER BY [{primary_col}]
            OFFSET :offset ROWS FETCH NEXT :page_size ROWS ONLY
        """)
        
        result = db.execute(query, {"offset": offset, "page_size": page_size})
        columns = _deduplicate_columns(list(result.keys()))
        rows = [dict(zip(columns, row)) for row in result.fetchall()]
        
        return {
            "dataset": dataset.name,
            "table": table_name,
            "columns": columns,
            "data": rows,
            "pagination": {
                "total_records": total_records,
                "current_page": page,
                "page_size": page_size,
                "total_pages": (total_records + page_size - 1) // page_size
            }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail="Internal Server Error retrieving data.")

@router.post("/api/v1/datasets/{dataset_name}/views")
def save_view(
    payload: SaveViewRequest, 
    db: Session = Depends(get_db), 
    dataset: Dataset = Depends(require_dataset_access(AccessRole.VIEWER)),
    current_user: AppUser = Depends(get_current_user)
):
    new_view = SavedView(
        dataset_id=dataset.id,
        created_by=current_user.id,
        view_name=payload.name,
        columns_json=json.dumps(payload.columns)
    )
    db.add(new_view)
    db.commit()
    return {"status": "success"}

@router.get("/api/v1/datasets/{dataset_name}/views")
def list_views(db: Session = Depends(get_db), dataset: Dataset = Depends(require_dataset_access(AccessRole.VIEWER))):
    views = db.query(SavedView).filter(SavedView.dataset_id == dataset.id).all()
    return {"views": [{"name": v.view_name, "columns": json.loads(v.columns_json)} for v in views]}


# --- Ingestion & History Endpoints ---
@router.post("/api/v1/ingest")
async def ingest_file(
    background_tasks: BackgroundTasks,
    dataset_name: str = Form(...),
    files: List[UploadFile] = File(...),
    db: Session = Depends(get_db),
    current_user: AppUser = Depends(get_current_user)
):
    # Manual RBAC check for Form data
    dataset = db.query(Dataset).filter(Dataset.name == dataset_name.strip()).first()
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found.")
        
    access = db.query(DatasetAccess).filter_by(user_id=current_user.id, dataset_id=dataset.id).first()
    roles = [AccessRole.VIEWER, AccessRole.USER, AccessRole.ADMIN, AccessRole.OWNER]
    if not access or roles.index(access.role) < roles.index(AccessRole.USER):
        raise HTTPException(status_code=403, detail="Requires User privileges to ingest data.")

    file_tasks = []
    file_ids = []
    batch_id = f"BATCH-{str(uuid.uuid4())[:8].upper()}"

    for file in files:
        if not file.filename.endswith(".csv"):
            continue

        file_id = f"JOB-{str(uuid.uuid4())[:8].upper()}"
        safe_name = f"{dataset.name}_{file_id}.csv"
        local_path = os.path.join(RAW_DATA, safe_name)

        with open(local_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        PIPELINE_STATUS[file_id] = {"step": "queued", "message": "Waiting in queue..."}
        
        file_tasks.append({
            "local_path": local_path,
            "safe_name": safe_name,
            "file_id": file_id,
            "filename": file.filename
        })
        file_ids.append(file_id)

    if not file_tasks:
        raise HTTPException(status_code=400, detail="No valid .csv files provided.")

    for task in file_tasks:
        background_tasks.add_task(
            process_pipeline_background, 
            task["local_path"], 
            task["safe_name"], 
            dataset.name,
            dataset.id,
            task["file_id"],
            current_user.id,
            batch_id 
        )

    return {"status": "Accepted", "file_ids": file_ids}


@router.get("/api/v1/ingest/history")
def get_ingest_history(db: Session = Depends(get_db), current_user: AppUser = Depends(get_current_user)):
    try:
        accessible_dataset_ids = [a.dataset_id for a in current_user.dataset_access]
        
        jobs = db.query(JobHistory).filter(JobHistory.dataset_id.in_(accessible_dataset_ids))\
                 .order_by(JobHistory.timestamp.desc()).all()
        
        batches_dict = {}
        for job in jobs:
            batch_id = job.batch_id or "BATCH-LEGACY"
            
            if batch_id not in batches_dict:
                batches_dict[batch_id] = {
                    "batchId": batch_id,
                    "timestamp": job.timestamp.strftime("%m/%d/%Y, %I:%M:%S %p") if job.timestamp else "",
                    "user": job.user.name or job.user.email,
                    "datasetName": job.dataset.name,
                    "overallStatus": "success", 
                    "jobs": []
                }
            
            batches_dict[batch_id]["jobs"].append({
                "id": job.id,
                "adlsFileId": job.adls_file_id,
                "overallStatus": job.overall_status,
                "steps": json.loads(job.steps_json) if job.steps_json else []
            })
            
        batches = list(batches_dict.values())
        for b in batches:
            statuses = [j["overallStatus"] for j in b["jobs"]]
            if "failed" in statuses or "error" in statuses:
                b["overallStatus"] = "failed"
            elif "in_progress" in statuses or "pending" in statuses:
                b["overallStatus"] = "in_progress"
            else:
                b["overallStatus"] = "success"
            
        return {"batches": batches}
    except Exception as e:
        print(f"[Error] Failed to fetch history: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch job history.")

@router.get("/api/v1/status/{file_id}")
def get_status(file_id: str, current_user: AppUser = Depends(get_current_user)):
    return PIPELINE_STATUS.get(file_id, {"step": "unknown", "message": "Status not found."})


# --- LLM AI Endpoints (Protected by require_dataset_access) ---

@router.post("/api/v1/datasets/{dataset_name}/execute-full")
def execute_full_query(
    payload: QueryExecutionRequest,
    db: Session = Depends(get_db),
    dataset: Dataset = Depends(require_dataset_access(AccessRole.VIEWER))
):
    try:
        return _execute_full(db, payload.sql)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Full execution failed: {str(e)}")

@router.post("/api/v1/datasets/{dataset_name}/summarize-chart")
def summarize_chart_data(
    payload: ChartSummarizeRequest,
    dataset: Dataset = Depends(require_dataset_access(AccessRole.VIEWER))
):
    if not payload or not payload.data:
        raise HTTPException(status_code=400, detail="No data provided to summarize.")
    
    output = io.StringIO()
    if len(payload.data) > 0:
        writer = csv.DictWriter(output, fieldnames=payload.data[0].keys())
        writer.writeheader()
        writer.writerows(payload.data)
    
    csv_string = output.getvalue()
    MAX_CHARS = 45000
    is_sampled = False
    
    if len(csv_string) > MAX_CHARS:
        is_sampled = True
        truncated = csv_string[:MAX_CHARS]
        last_newline = truncated.rfind('\n')
        if last_newline != -1:
            csv_string = truncated[:last_newline]
        else:
            csv_string = truncated
    
    try:
        summary = ai_service.generate_chart_summary(dataset.name, csv_string, payload.user_context or "", is_sampled)
        return {"summary": summary}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"LLM Error: {str(e)}")


@router.post("/api/v1/datasets/{dataset_name}/execute-paginated")
def execute_paginated_query(
    payload: QueryExecutionRequest,
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=20, le=100),
    db: Session = Depends(get_db),
    dataset: Dataset = Depends(require_dataset_access(AccessRole.VIEWER))
):
    try:
        return _execute_and_paginate(db, payload.sql, page, page_size)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Execution failed: {str(e)}")


@router.post("/api/v1/datasets/{dataset_name}/explain-schema")
def explain_dataset_schema(db: Session = Depends(get_db), dataset: Dataset = Depends(require_dataset_access(AccessRole.VIEWER))):
    try:
        schema_query = text("""
            SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_SCHEMA = :schema_name AND TABLE_NAME NOT LIKE 'stg_%'
        """)
        schema_rows = db.execute(schema_query, {"schema_name": dataset.name}).fetchall()
        
        if not schema_rows:
            raise HTTPException(status_code=404, detail="Schema not found or empty.")

        tables_dict = {}
        for row in schema_rows:
            if row[0] not in tables_dict: tables_dict[row[0]] = []
            tables_dict[row[0]].append(f"{row[1]} ({row[2]})")
        
        schema_context = "".join([f"Table: {t}\nColumns: {', '.join(cols)}\n\n" for t, cols in tables_dict.items()])

        summary = ai_service.generate_dataset_dictionary(dataset.name, schema_context)
        return {"summary": summary}
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to explain schema: {str(e)}")
    

@router.post("/api/v1/datasets/{dataset_name}/nlq")
def execute_natural_language_query(
    payload: NLQRequest, 
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=20, le=100),
    db: Session = Depends(get_db),
    dataset: Dataset = Depends(require_dataset_access(AccessRole.VIEWER))
):
    try:
        schema_query = text("SELECT TABLE_NAME, COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = :schema_name AND TABLE_NAME NOT LIKE 'stg_%'")
        schema_rows = db.execute(schema_query, {"schema_name": dataset.name}).fetchall()
        
        tables_dict = {}
        for row in schema_rows:
            if row[0] not in tables_dict: tables_dict[row[0]] = []
            tables_dict[row[0]].append(row[1])
        
        schema_context = "".join([f"Table: {t}\nColumns: {', '.join(cols)}\n\n" for t, cols in tables_dict.items()])

        final_prompt = payload.prompt
        if payload.selected_columns:
            cols_str = ", ".join(payload.selected_columns)
            final_prompt = f"The user has specifically focused on these columns: {cols_str}. {payload.prompt}"

        generated_sql = ai_service.generate_sql_query(dataset.name, final_prompt, schema_context) 
        return _execute_and_paginate(db, generated_sql, page, page_size)
    except Exception as e:
        raise HTTPException(status_code=500, detail="The AI generated an invalid query. Please try rephrasing your question.")
            

@router.post("/api/v1/datasets/{dataset_name}/nlq-chart")
def execute_natural_language_query_with_chart(
    payload: NLQRequest, 
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=20, le=100),
    db: Session = Depends(get_db),
    dataset: Dataset = Depends(require_dataset_access(AccessRole.VIEWER))
):
    try:
        schema_query = text("SELECT TABLE_NAME, COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = :schema_name AND TABLE_NAME NOT LIKE 'stg_%'")
        schema_rows = db.execute(schema_query, {"schema_name": dataset.name}).fetchall()
        
        tables_dict = {}
        for row in schema_rows:
            if row[0] not in tables_dict: tables_dict[row[0]] = []
            tables_dict[row[0]].append(row[1])
            
        schema_context = "".join([f"Table: {t}\nColumns: {', '.join(cols)}\n\n" for t, cols in tables_dict.items()])

        final_prompt = payload.prompt
        if payload.selected_columns:
            final_prompt = f"The user focused on these columns: {', '.join(payload.selected_columns)}. {payload.prompt}"

        ai_response = ai_service.generate_nlq_with_chart(dataset.name, final_prompt, schema_context) 
        
        result = _execute_and_paginate(db, ai_response.get("sql", ""), page, page_size)
        result["chart_config"] = {
            "chartType": ai_response.get("chart_type", "bar"),
            "xAxis": ai_response.get("x_axis", ""),
            "yAxis": ai_response.get("y_axis", [])
        }
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail="The AI failed to generate a valid chart/query. Please rephrase.")
  
    
@router.post("/api/v1/datasets/{dataset_name}/summarize")
def summarize_data_view(
    payload: SummarizeRequest, 
    dataset: Dataset = Depends(require_dataset_access(AccessRole.VIEWER))
):
    if not payload or not payload.data:
        raise HTTPException(status_code=400, detail="No data provided to summarize.")
    
    sample_data = payload.data[:100]
    try:
        summary = ai_service.generate_data_summary(dataset.name, str(sample_data), payload.user_context or "")
        return {"summary": summary}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"LLM Error: {str(e)}")
    

@router.post("/api/v1/datasets/{dataset_name}/custom-view")
def execute_custom_join_view(
    payload: CustomViewRequest, 
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=20, le=100),
    db: Session = Depends(get_db),
    dataset: Dataset = Depends(require_dataset_access(AccessRole.VIEWER))
):    
    if not payload.columns:
        raise HTTPException(status_code=400, detail="No columns selected.")
        
    try:
        schema_query = text("SELECT TABLE_NAME, COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = :schema_name AND TABLE_NAME NOT LIKE 'stg_%'")
        schema_rows = db.execute(schema_query, {"schema_name": dataset.name}).fetchall()
        
        tables_dict = {}
        for row in schema_rows:
            if row[0] not in tables_dict: tables_dict[row[0]] = []
            tables_dict[row[0]].append(row[1])
        
        schema_context = "".join([f"Table: {t}\nColumns: {', '.join(cols)}\n\n" for t, cols in tables_dict.items()])

        generated_sql = ai_service.generate_join_query(dataset.name, payload.columns, schema_context)
        return _execute_and_paginate(db, generated_sql, page, page_size)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to compile custom view: {str(e)}")    


@router.post("/api/v1/ping")
def ping_services(db: Session = Depends(get_db), current_user: AppUser = Depends(get_current_user)):
    """Pings low-tier resources to wake them up from standby."""
    status = {"sql": "offline", "databricks": "offline"}
    try:
        db.execute(text("SELECT 1"))
        status["sql"] = "awake"
    except Exception: pass
        
    try:
        from base.services.orchestrator import _get_workspace_client
        w = _get_workspace_client()
        list(w.clusters.list()) 
        status["databricks"] = "awake"
    except Exception: pass
        
    return {"status": "completed", "details": status}