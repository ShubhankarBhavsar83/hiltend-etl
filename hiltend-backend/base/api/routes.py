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
from base.core.security import azure_scheme
from base.core.config import settings
from base.database.session import get_db, engine
from typing import List, Dict, Any, Optional
from pydantic import BaseModel


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


# --- Dataset Management Endpoints ---
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

    # Wrap the user query to enforce a hard limit for browser/DB safety
    safe_sql = f"SELECT TOP {limit} * FROM ({sql}) AS SubQ"
    
    result = db.execute(text(safe_sql))
    
    columns = _deduplicate_columns(list(result.keys()))
    rows = [dict(zip(columns, row)) for row in result.fetchall()]

    return {
        "columns": columns,
        "data": rows,
        "sql": sql,
        "limit_applied": limit
    }

def _deduplicate_columns(raw_columns: list[str]) -> list[str]:
    """Ensures all column names are strictly unique to prevent dictionary key overwriting."""
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

def process_batch_sequentially(file_tasks: List[dict], dataset_name: str):
    for task in file_tasks:
        print(f"[Queue] Starting processing for {task['filename']}")
        process_pipeline_background(
            task["local_path"], 
            task["safe_name"], 
            dataset_name, 
            task["file_id"]
        )
        print(f"[Queue] Finished processing for {task['filename']}")

def process_pipeline_background(local_path: str, safe_name: str, dataset_name: str, file_id: str, username: str, batch_id: str):
    # 1. Initialize the baseline steps
    steps = [
        {"name": "Stage to ADLS Bronze Layer", "key": "staging", "status": "pending"},
        {"name": "Databricks Serverless Header Extract", "key": "extracting", "status": "pending"},
        {"name": "Azure AI Star Schema Design", "key": "ai_mapping", "status": "pending"},
        {"name": "PySpark ETL & Azure SQL Merge", "key": "etl_running", "status": "pending"}
    ]
    
    # 2. Robust State Machine for DB Updates
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

            with engine.begin() as conn:
                conn.execute(text("""
                    IF EXISTS (SELECT 1 FROM JobHistory WHERE id = :id)
                        UPDATE JobHistory SET overall_status = :status, steps_json = :steps WHERE id = :id
                    ELSE
                        INSERT INTO JobHistory (id, adls_file_id, username, dataset_name, overall_status, steps_json, batch_id)
                        VALUES (:id, :adls, :usr, :ds, :status, :steps, :batch_id)
                """), {
                    "id": file_id,
                    "adls": f"abfss://{settings.datalake_container_name}@{settings.datalake_account_url.replace('https://', '').split('.')[0]}.dfs.core.windows.net/{safe_name}",
                    "usr": username,
                    "ds": dataset_name,
                    "status": overall_status,
                    "steps": json.dumps(steps),
                    "batch_id": batch_id # Add the new parameter here
                })
        except Exception as e:
            print(f"[DB Log Error] {e}")

    # Track the exact point of failure for the except block
    active_step = "staging" 

    try:
        # --- STEP 1: ADLS STAGING ---
        active_step = "staging"
        PIPELINE_STATUS[file_id] = {"step": active_step, "message": "Uploading to ADLS Bronze Layer..."}
        _update_db("in_progress", active_step_key=active_step)
        
        target_path = upload_to_adls(local_path, safe_name)
        if not target_path: raise Exception("ADLS upload failed.")

        # --- STEP 2: DATABRICKS EXTRACTION ---
        active_step = "extracting"
        PIPELINE_STATUS[file_id] = {"step": active_step, "message": "Spinning up Databricks Serverless for Header Extraction..."}
        _update_db("in_progress", active_step_key=active_step)
        
        extract_headers_via_databricks(target_path)
        headers = download_headers_from_adls(safe_name)
        
        # Fetch existing schema context
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

        # --- STEP 3: AZURE AI SCHEMA DESIGN ---
        active_step = "ai_mapping"
        PIPELINE_STATUS[file_id] = {"step": active_step, "message": "Azure AI Foundry is mapping the data..."}
        _update_db("in_progress", active_step_key=active_step)
        
        schema_map = ai_service.generate_relational_mapping(dataset_name, headers, existing_schema_str)
        schema_map_json = schema_map.model_dump_json()

        # --- STEP 4: DATABRICKS ETL ---
        active_step = "etl_running"
        PIPELINE_STATUS[file_id] = {"step": active_step, "message": "Triggering Databricks ETL & Azure SQL Merge..."}
        _update_db("in_progress", active_step_key=active_step)
        
        run_id = trigger_spark_etl(target_path, dataset_name, schema_map_json)
        
        # --- PIPELINE SUCCESS ---
        PIPELINE_STATUS[file_id] = {"step": "completed", "message": f"Pipeline successful! Job ID: {run_id}"}
        _update_db("success", active_step_key=active_step)

    except Exception as e:
        # --- PIPELINE FAILURE ---
        PIPELINE_STATUS[file_id] = {"step": "error", "message": f"Pipeline failed: {str(e)}"}
        _update_db("failed", failed_step_key=active_step)

    finally:
        if os.path.exists(local_path):
            os.remove(local_path)

def ensure_saved_views_table(db: Session):
    db.execute(text("""
        IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'SavedViews')
        CREATE TABLE SavedViews (
            id INT IDENTITY(1,1) PRIMARY KEY,
            dataset_name NVARCHAR(255),
            view_name NVARCHAR(255),
            columns_json NVARCHAR(MAX)
        )
    """))
    db.commit()
    
def ensure_job_history_table(db: Session):
    db.execute(text("""
        IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'JobHistory')
        CREATE TABLE JobHistory (
            id NVARCHAR(50) PRIMARY KEY,
            adls_file_id NVARCHAR(MAX),
            timestamp DATETIME DEFAULT GETDATE(),
            username NVARCHAR(255),
            dataset_name NVARCHAR(255),
            overall_status NVARCHAR(50),
            steps_json NVARCHAR(MAX)
        )
    """))
    # Safe migration: Add batch_id if it doesn't exist
    db.execute(text("""
        IF NOT EXISTS (
            SELECT * FROM sys.columns 
            WHERE object_id = OBJECT_ID('JobHistory') AND name = 'batch_id'
        )
        BEGIN
            ALTER TABLE JobHistory ADD batch_id NVARCHAR(50);
        END
    """))
    db.commit()
    

@router.post("/api/v1/datasets/{dataset_name}/views", dependencies=[Security(azure_scheme)])
def save_view(dataset_name: str, payload: SaveViewRequest, db: Session = Depends(get_db)):
    ensure_saved_views_table(db)
    import json
    db.execute(text("""
        INSERT INTO SavedViews (dataset_name, view_name, columns_json) 
        VALUES (:d, :n, :c)
    """), {"d": dataset_name, "n": payload.name, "c": json.dumps(payload.columns)})
    db.commit()
    return {"status": "success"}

@router.get("/api/v1/datasets/{dataset_name}/views", dependencies=[Security(azure_scheme)])
def list_views(dataset_name: str, db: Session = Depends(get_db)):
    ensure_saved_views_table(db)
    import json
    result = db.execute(text("SELECT view_name, columns_json FROM SavedViews WHERE dataset_name = :d"), {"d": dataset_name}).fetchall()
    return {"views": [{"name": r[0], "columns": json.loads(r[1])} for r in result]}

# --- NEW ENDPOINT: Fetch full dataset for charts ---
@router.post("/api/v1/datasets/{dataset_name}/execute-full", dependencies=[Security(azure_scheme)])
def execute_full_query(
    dataset_name: str = Path(...),
    payload: QueryExecutionRequest = ...,
    db: Session = Depends(get_db)
):
    """Endpoint for the frontend to fetch up to 5000 rows for chart visualization."""
    try:
        return _execute_full(db, payload.sql)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Full execution failed: {str(e)}")


# --- NEW ENDPOINT: Summarize chart data via CSV ---
@router.post("/api/v1/datasets/{dataset_name}/summarize-chart", dependencies=[Security(azure_scheme)])
def summarize_chart_data(
    dataset_name: str = Path(...), 
    payload: ChartSummarizeRequest = ..., 
):
    if not payload or not payload.data:
        raise HTTPException(status_code=400, detail="No data provided to summarize.")
    
    # 1. Convert JSON array to CSV string
    output = io.StringIO()
    if len(payload.data) > 0:
        writer = csv.DictWriter(output, fieldnames=payload.data[0].keys())
        writer.writeheader()
        writer.writerows(payload.data)
    
    csv_string = output.getvalue()
    
    # 2. Llama 3.3 70B TPM Constraint Management (~45,000 chars = ~11k tokens)
    MAX_CHARS = 45000
    is_sampled = False
    
    if len(csv_string) > MAX_CHARS:
        is_sampled = True
        # Truncate to the nearest safe newline to avoid cutting a row in half
        truncated = csv_string[:MAX_CHARS]
        last_newline = truncated.rfind('\n')
        if last_newline != -1:
            csv_string = truncated[:last_newline]
        else:
            csv_string = truncated
    
    try:
        summary = ai_service.generate_chart_summary(dataset_name, csv_string, payload.user_context or "", is_sampled)
        return {"summary": summary}
        
    except Exception as e:
        import traceback
        print(f"\n[Chart Summarize Error] {str(e)}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"LLM Error: {str(e)}")

@router.post("/api/v1/datasets/{dataset_name}/execute-paginated", dependencies=[Security(azure_scheme)])
def execute_paginated_query(
    dataset_name: str = Path(...),
    payload: QueryExecutionRequest = ...,
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=20, le=100),
    db: Session = Depends(get_db)
):
    """Endpoint for the frontend to fetch page 2+ without re-triggering the LLM."""
    try:
        return _execute_and_paginate(db, payload.sql, page, page_size)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Execution failed: {str(e)}")




@router.post("/api/v1/datasets/{dataset_name}/explain-schema", dependencies=[Security(azure_scheme)])
def explain_dataset_schema(dataset_name: str = Path(...), db: Session = Depends(get_db)):
    try:
        schema_query = text("""
            SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_SCHEMA = :schema_name AND TABLE_NAME NOT LIKE 'stg_%'
        """)
        schema_rows = db.execute(schema_query, {"schema_name": dataset_name}).fetchall()
        
        if not schema_rows:
            raise HTTPException(status_code=404, detail="Schema not found or empty.")

        # Group columns by table
        tables_dict = {}
        for row in schema_rows:
            if row[0] not in tables_dict: tables_dict[row[0]] = []
            tables_dict[row[0]].append(f"{row[1]} ({row[2]})")
        
        # Build the context string
        schema_context = ""
        for t, cols in tables_dict.items():
            schema_context += f"Table: {t}\nColumns: {', '.join(cols)}\n\n"

        summary = ai_service.generate_dataset_dictionary(dataset_name, schema_context)
        return {"summary": summary}
    
    except Exception as e:
        import traceback
        print(f"\n[Schema Explain Error] {str(e)}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Failed to explain schema: {str(e)}")
    
@router.post("/api/v1/datasets/{dataset_name}/nlq", dependencies=[Security(azure_scheme)])
def execute_natural_language_query(
    dataset_name: str = Path(...), 
    payload: NLQRequest = ..., 
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=20, le=100),
    db: Session = Depends(get_db)
):
    try:
        schema_query = text("""
            SELECT TABLE_NAME, COLUMN_NAME 
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_SCHEMA = :schema_name AND TABLE_NAME NOT LIKE 'stg_%'
        """)
        schema_rows = db.execute(schema_query, {"schema_name": dataset_name}).fetchall()
        
        if not schema_rows:
            raise HTTPException(status_code=404, detail="Schema not found or empty.")

        tables_dict = {}
        for row in schema_rows:
            if row[0] not in tables_dict: tables_dict[row[0]] = []
            tables_dict[row[0]].append(row[1])
        
        schema_context = ""
        for t, cols in tables_dict.items():
            schema_context += f"Table: {t}\nColumns: {', '.join(cols)}\n\n"

        final_prompt = payload.prompt
        if payload.selected_columns:
            cols_str = ", ".join(payload.selected_columns)
            final_prompt = f"The user has specifically focused on these columns: {cols_str}. {payload.prompt}"

        generated_sql = ai_service.generate_sql_query(dataset_name, final_prompt, schema_context) 
        
        return _execute_and_paginate(db, generated_sql, page, page_size)

    except Exception as e:
        print(f"[NLQ Error] Execution failed: {e}")
        raise HTTPException(
            status_code=500, 
            detail="The AI generated an invalid query or encountered a data type mismatch. Please try rephrasing your question."
            )
            
@router.post("/api/v1/datasets/{dataset_name}/nlq-chart", dependencies=[Security(azure_scheme)])
def execute_natural_language_query_with_chart(
    dataset_name: str = Path(...), 
    payload: NLQRequest = ..., 
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=20, le=100),
    db: Session = Depends(get_db)
):
    try:
        schema_query = text("""
            SELECT TABLE_NAME, COLUMN_NAME 
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_SCHEMA = :schema_name AND TABLE_NAME NOT LIKE 'stg_%'
        """)
        schema_rows = db.execute(schema_query, {"schema_name": dataset_name}).fetchall()
        
        if not schema_rows:
            raise HTTPException(status_code=404, detail="Schema not found or empty.")

        tables_dict = {}
        for row in schema_rows:
            if row[0] not in tables_dict: tables_dict[row[0]] = []
            tables_dict[row[0]].append(row[1])
            
        schema_context = "".join([f"Table: {t}\nColumns: {', '.join(cols)}\n\n" for t, cols in tables_dict.items()])

        final_prompt = payload.prompt
        if payload.selected_columns:
            final_prompt = f"The user focused on these columns: {', '.join(payload.selected_columns)}. {payload.prompt}"

        ai_response = ai_service.generate_nlq_with_chart(dataset_name, final_prompt, schema_context) 
        
        result = _execute_and_paginate(db, ai_response.get("sql", ""), page, page_size)
        result["chart_config"] = {
            "chartType": ai_response.get("chart_type", "bar"),
            "xAxis": ai_response.get("x_axis", ""),
            "yAxis": ai_response.get("y_axis", [])
        }
        
        return result

    except Exception as e:
        print(f"[NLQ Chart Error] Execution failed: {e}")
        raise HTTPException(status_code=500, detail="The AI failed to generate a valid chart/query. Please rephrase.")
  
    
@router.post("/api/v1/datasets/{dataset_name}/summarize", dependencies=[Security(azure_scheme)])
def summarize_data_view(
    dataset_name: str = Path(...), 
    payload: SummarizeRequest = ..., 
):
    if not payload or not payload.data:
        raise HTTPException(status_code=400, detail="No data provided to summarize.")
    
    sample_data = payload.data[:100]
    
    try:
        summary = ai_service.generate_data_summary(dataset_name, str(sample_data), payload.user_context or "")
        return {"summary": summary}
        
    except Exception as e:
        import traceback
        print(f"\n[Summarize Error] {str(e)}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"LLM Error: {str(e)}")
    
    


@router.post("/api/v1/datasets/{dataset_name}/custom-view", dependencies=[Security(azure_scheme)])
def execute_custom_join_view(
    dataset_name: str = Path(...), 
    payload: CustomViewRequest = ..., 
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=20, le=100),
    db: Session = Depends(get_db)
):    
    if not payload.columns:
        raise HTTPException(status_code=400, detail="No columns selected.")
        
    try:
        schema_query = text("""
            SELECT TABLE_NAME, COLUMN_NAME 
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_SCHEMA = :schema_name AND TABLE_NAME NOT LIKE 'stg_%'
        """)
        schema_rows = db.execute(schema_query, {"schema_name": dataset_name}).fetchall()
        
        tables_dict = {}
        for row in schema_rows:
            if row[0] not in tables_dict: tables_dict[row[0]] = []
            tables_dict[row[0]].append(row[1])
        
        schema_context = ""
        for t, cols in tables_dict.items():
            schema_context += f"Table: {t}\nColumns: {', '.join(cols)}\n\n"

        generated_sql = ai_service.generate_join_query(dataset_name, payload.columns, schema_context)
        
        return _execute_and_paginate(db, generated_sql, page, page_size)
        
    except Exception as e:
        print(f"[Custom View Error] Execution failed: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to compile custom view: {str(e)}")    


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
    
    try:
        db.execute(text("SELECT 1"))
        status["sql"] = "awake"
    except Exception as e:
        print(f"[Ping] SQL DB Error: {e}")
        
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
    request: Request,
    background_tasks: BackgroundTasks,
    dataset_name: str = Form(...),
    files: List[UploadFile] = File(...),
    db: Session = Depends(get_db)
):
    ensure_job_history_table(db)
    username = getattr(request.state.user, 'preferred_username', 'System User') if hasattr(request, 'state') and hasattr(request.state, 'user') else 'System User'

    file_tasks = []
    file_ids = []
    
    # 1. Generate a Single Batch ID for this entire request
    batch_id = f"BATCH-{str(uuid.uuid4())[:8].upper()}"

    for file in files:
        if not file.filename.endswith(".csv"):
            continue

        file_id = f"JOB-{str(uuid.uuid4())[:8].upper()}"
        safe_name = f"{dataset_name.strip()}_{file_id}.csv"
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
            dataset_name.strip(), 
            task["file_id"],
            username,
            batch_id # 2. Pass batch_id to the background task
        )

    return {"status": "Accepted", "file_ids": file_ids}

@router.get("/api/v1/ingest/history", dependencies=[Security(azure_scheme)])
def get_ingest_history(db: Session = Depends(get_db)):
    ensure_job_history_table(db)
    try:
        # Fetch jobs ordered by newest first (batch_id is row[7])
        query = text("SELECT id, adls_file_id, timestamp, username, dataset_name, overall_status, steps_json, batch_id FROM JobHistory ORDER BY timestamp DESC")
        result = db.execute(query).fetchall()
        
        batches_dict = {}
        for row in result:
            batch_id = row[7] or "BATCH-LEGACY" # Fallback for old records
            
            if batch_id not in batches_dict:
                batches_dict[batch_id] = {
                    "batchId": batch_id,
                    "timestamp": row[2].strftime("%m/%d/%Y, %I:%M:%S %p") if row[2] else "",
                    "user": row[3],
                    "datasetName": row[4],
                    "overallStatus": "success", # We calculate this dynamically below
                    "jobs": []
                }
            
            job_status = row[5]
            batches_dict[batch_id]["jobs"].append({
                "id": row[0],
                "adlsFileId": row[1],
                "overallStatus": job_status,
                "steps": json.loads(row[6]) if row[6] else []
            })
            
        # Calculate overall batch status based on its children jobs
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
    

@router.get("/api/v1/datasets/{dataset_name}/explorer", dependencies=[Security(azure_scheme)])
def get_dataset_explorer_schema(dataset_name: str = Path(...), db: Session = Depends(get_db)):
    try:
        query = text("""
            SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = :schema_name AND TABLE_NAME NOT LIKE 'stg_%'
            ORDER BY TABLE_NAME, ORDINAL_POSITION
        """)
        result = db.execute(query, {"schema_name": dataset_name}).fetchall()
        
        tables_dict = {}
        for row in result:
            t_name, c_name, d_type = row
            if t_name not in tables_dict:
                tables_dict[t_name] = []
            tables_dict[t_name].append({"name": c_name, "type": d_type})
            
        formatted_tables = [
            {"name": t_name, "columns": cols} 
            for t_name, cols in tables_dict.items()
        ]
        
        return {"dataset": dataset_name, "tables": formatted_tables}
    except Exception as e:
        print(f"[Error] Failed to fetch explorer schema: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch schema details.")
    

@router.get("/api/v1/datasets/{dataset_name}/tables/{table_name}/data", dependencies=[Security(azure_scheme)])
def get_table_data(
    dataset_name: str = Path(...), 
    table_name: str = Path(...), 
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=20, le=100),
    db: Session = Depends(get_db)
):
    """Safely fetches paginated rows from a specific table."""
    try:
        col_query = text("""
            SELECT COLUMN_NAME 
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_SCHEMA = :schema AND TABLE_NAME = :table
            ORDER BY ORDINAL_POSITION
        """)
        valid_cols = [row[0] for row in db.execute(col_query, {"schema": dataset_name, "table": table_name}).fetchall()]
        
        if not valid_cols:
            raise HTTPException(status_code=404, detail="Table not found or has no columns.")

        primary_col = valid_cols[0]

        count_query = text(f"SELECT COUNT(*) FROM [{dataset_name}].[{table_name}]")
        total_records = db.execute(count_query).scalar()

        offset = (page - 1) * page_size
        query = text(f"""
            SELECT * FROM [{dataset_name}].[{table_name}]
            ORDER BY [{primary_col}]
            OFFSET :offset ROWS FETCH NEXT :page_size ROWS ONLY
        """)
        
        result = db.execute(query, {"offset": offset, "page_size": page_size})
        
        columns = _deduplicate_columns(list(result.keys()))
        rows = [dict(zip(columns, row)) for row in result.fetchall()]
        
        return {
            "dataset": dataset_name,
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
    except HTTPException:
        raise
    except Exception as e:
        print(f"[Error] Failed to fetch table data: {e}")
        raise HTTPException(status_code=500, detail="Internal Server Error retrieving data.")