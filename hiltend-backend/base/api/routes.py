import os
import uuid
import shutil
from fastapi import APIRouter, Depends, Query, Security, UploadFile, Form, File, Path, BackgroundTasks, HTTPException
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

def process_pipeline_background(local_path: str, safe_name: str, dataset_name: str, file_id: str):
    try:
        PIPELINE_STATUS[file_id] = {"step": "staging", "message": "Uploading to ADLS Bronze Layer..."}
        target_path = upload_to_adls(local_path, safe_name)
        if not target_path: raise Exception("ADLS upload failed.")

        PIPELINE_STATUS[file_id] = {"step": "extracting", "message": "Spinning up Databricks Serverless for Header Extraction..."}
        extract_headers_via_databricks(target_path)
        headers = download_headers_from_adls(safe_name)
        
        existing_schema_str = ""
        try:
            with engine.connect() as conn:
                query = text("""
                    SELECT TABLE_NAME, COLUMN_NAME 
                    FROM INFORMATION_SCHEMA.COLUMNS 
                    WHERE TABLE_SCHEMA = :schema_name AND TABLE_NAME NOT LIKE 'stg_%'
                """)
                result = conn.execute(query, {"schema_name": dataset_name}).fetchall()
                if result:
                    tables_dict = {}
                    for row in result:
                        if row[0] not in tables_dict: tables_dict[row[0]] = []
                        tables_dict[row[0]].append(row[1])
                    
                    existing_schema_str = "CURRENT SCHEMA TABLES:\n"
                    for t, cols in tables_dict.items():
                        existing_schema_str += f"- {t}: {', '.join(cols)}\n"
        except Exception as e:
            print(f"[Warning] Failed to fetch existing schema context: {e}")

        PIPELINE_STATUS[file_id] = {"step": "ai_mapping", "message": "Azure AI Foundry is mapping the data..."}
        schema_map = ai_service.generate_relational_mapping(dataset_name, headers, existing_schema_str)
        schema_map_json = schema_map.model_dump_json()

        PIPELINE_STATUS[file_id] = {"step": "etl_running", "message": "Triggering Databricks ETL & Azure SQL Merge..."}
        run_id = trigger_spark_etl(target_path, dataset_name, schema_map_json)
        
        PIPELINE_STATUS[file_id] = {"step": "completed", "message": f"Pipeline successful! Job ID: {run_id}"}

    except Exception as e:
        PIPELINE_STATUS[file_id] = {"step": "error", "message": f"Pipeline failed: {str(e)}"}

    finally:
        if os.path.exists(local_path):
            os.remove(local_path)

    


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
           
        clean_sql_upper = generated_sql.upper().strip()
        if not clean_sql_upper.startswith("SELECT"):
            raise HTTPException(status_code=400, detail="Only SELECT queries are permitted.")
        if any(keyword in clean_sql_upper for keyword in ["DROP", "DELETE", "UPDATE", "INSERT", "ALTER", "TRUNCATE"]):
            raise HTTPException(status_code=400, detail="Destructive execution patterns blocked.")

        result = db.execute(text(generated_sql))
        
        columns = _deduplicate_columns(list(result.keys()))
        rows = [dict(zip(columns, row)) for row in result.fetchall()]

        return {
            "columns": columns,
            "data": rows,
            "sql": generated_sql
        }

    except Exception as e:
        print(f"[NLQ Error] Execution failed: {e}")
        raise HTTPException(
            status_code=500, 
            detail="The AI generated an invalid query or encountered a data type mismatch. Please try rephrasing your question."
            )
  

# @router.post("/api/v1/datasets/{dataset_name}/summarize", dependencies=[Security(azure_scheme)])
# def summarize_data_view(dataset_name: str = Path(...), payload: SummarizeRequest = None):
#     if not payload or not payload.data:
#         raise HTTPException(status_code=400, detail="No data provided to summarize.")
    
#     sample_data = payload.data[:15]
    
#     try:
#         summary = ai_service.generate_data_summary(str(sample_data), payload.user_context or "")
#         return {"summary": summary}
#     except Exception as e:
#         import traceback
#         print(f"\n[Summarize Error] {str(e)}")
#         traceback.print_exc()
#         raise HTTPException(status_code=500, detail=f"LLM Error: {str(e)}")
    
@router.post("/api/v1/datasets/{dataset_name}/summarize", dependencies=[Security(azure_scheme)])
def summarize_data_view(dataset_name: str = Path(...), payload: SummarizeRequest = None):
    if not payload or not payload.data:
        raise HTTPException(status_code=400, detail="No data provided to summarize.")
    
    sample_data = payload.data[:100]
    
    try:
        # --> Update this line to pass dataset_name as the first argument <--
        summary = ai_service.generate_data_summary(dataset_name, str(sample_data), payload.user_context or "")
        return {"summary": summary}
    except Exception as e:
        import traceback
        print(f"\n[Summarize Error] {str(e)}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"LLM Error: {str(e)}")
    
    


@router.post("/api/v1/datasets/{dataset_name}/custom-view", dependencies=[Security(azure_scheme)])
def execute_custom_join_view(dataset_name: str = Path(...), payload: CustomViewRequest = ..., db: Session = Depends(get_db)):
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
        
        clean_sql_upper = generated_sql.upper().strip()
        if not clean_sql_upper.startswith("SELECT"):
            raise HTTPException(status_code=400, detail="Generated query violated safety policies.")
        if any(keyword in clean_sql_upper for keyword in ["DROP", "DELETE", "UPDATE", "INSERT", "ALTER", "TRUNCATE"]):
            raise HTTPException(status_code=400, detail="Destructive execution patterns blocked.")

        result = db.execute(text(generated_sql))
        
        columns = _deduplicate_columns(list(result.keys()))
        rows = [dict(zip(columns, row)) for row in result.fetchall()]
        
        return {
            "columns": columns,
            "data": rows,
            "sql": generated_sql
        }
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
    background_tasks: BackgroundTasks,
    dataset_name: str = Form(...),
    files: List[UploadFile] = File(...)
):
    file_tasks = []
    file_ids = []

    for file in files:
        if not file.filename.endswith(".csv"):
            continue

        file_id = str(uuid.uuid4())[:8]
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

    background_tasks.add_task(
        process_batch_sequentially, file_tasks, dataset_name.strip()
    )

    return {"status": "Accepted", "file_ids": file_ids}

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
    page_size: int = Query(100, ge=1, le=1000),
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