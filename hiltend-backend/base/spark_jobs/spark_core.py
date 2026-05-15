import sys
import json
import subprocess
from pyspark.sql import SparkSession

# ==========================================
# SERVERLESS HOTFIX: Install pure Python SQL driver
# ==========================================
try:
    import pymssql
except ImportError:
    print("Installing pymssql for Serverless compatibility...")
    subprocess.check_call([sys.executable, "-m", "pip", "install", "pymssql"])
    import pymssql

def execute_tsql(jdbc_url, db_user, db_pass, query):
    """
    Executes raw T-SQL using pure Python (pymssql).
    This bypasses the JVM restriction on Databricks Serverless compute.
    """
    # Parse the JDBC URL to get the server and database for pymssql
    # Example: "jdbc:sqlserver://server.database.windows.net:1433;database=mydb"
    clean_str = jdbc_url.replace("jdbc:sqlserver://", "")
    parts = clean_str.split(";")
    
    server = parts[0].split(":")[0] # Extracts the domain
    database = ""
    for p in parts[1:]:
        if p.lower().startswith("database="):
            database = p.split("=")[1]
            break
            
    print(f"Executing raw T-SQL on server: {server}")
    conn = pymssql.connect(server=server, user=db_user, password=db_pass, database=database)
    cursor = conn.cursor()
    cursor.execute(query)
    conn.commit()
    conn.close()

def run_etl():
    if len(sys.argv) < 4:
        print("ERROR: Missing arguments. Expected: file_path, dataset_name, ai_schema_map")
        sys.exit(1)

    file_path = sys.argv[1]
    dataset_name = sys.argv[2]
    ai_schema_map_str = sys.argv[3]

    print(f"Starting ETL for {dataset_name} on file: {file_path}")

    # --- Configuration (Fetch these from Databricks Secrets in Production) ---
    # Example format: "jdbc:sqlserver://<db-con-string>"
    jdbc_url = dbutils.secrets.get(scope="azure-sql", key="jdbc-url") 
    db_user = dbutils.secrets.get(scope="azure-sql", key="db-user")
    db_pass = dbutils.secrets.get(scope="azure-sql", key="db-password")
    
    jdbc_props = {
        "user": db_user,
        "password": db_pass,
        "driver": "com.microsoft.sqlserver.jdbc.SQLServerDriver"
    }

    spark = SparkSession.builder.appName(f"ETL_{dataset_name}").getOrCreate()

    # 1. Read the Raw Data
    df = spark.read.option("header", "true").option("inferSchema", "true").csv(file_path)
    
    # 2. Parse the AI Schema Map
    schema_map = json.loads(ai_schema_map_str)
    dimensions = schema_map.get("dimensions", {})
    fact_columns = schema_map.get("fact_table", [])

    # ==========================================
    # PHASE A: Process Dimensions (Safely MERGE)
    # ==========================================
    for dim_name, columns in dimensions.items():
        print(f"Processing Dimension: {dim_name}")
        
        # Isolate the data and drop exact duplicates
        dim_df = df.select(*columns).distinct().dropna(how="all")
        
        # Assume the first column the AI provided is the Primary Key
        primary_key = columns[0]
        stg_table_name = f"stg_{dim_name}"
        real_table_name = f"dbo.{dim_name}"

        # 1. Write to temporary Staging Table
        dim_df.write.jdbc(url=jdbc_url, table=stg_table_name, mode="overwrite", properties=jdbc_props)

        # 2. Construct the safe UPSERT (MERGE) Query
        update_set = ", ".join([f"target.{col} = source.{col}" for col in columns if col != primary_key])
        insert_cols = ", ".join(columns)
        insert_vals = ", ".join([f"source.{col}" for col in columns])

        merge_query = f"""
        MERGE INTO {real_table_name} AS target
        USING {stg_table_name} AS source
        ON target.{primary_key} = source.{primary_key}
        """
        
        if update_set: # If there are columns to update
            merge_query += f" WHEN MATCHED THEN UPDATE SET {update_set}"
            
        merge_query += f" WHEN NOT MATCHED THEN INSERT ({insert_cols}) VALUES ({insert_vals});"

        # 3. Execute MERGE and clean up Staging
        execute_tsql(jdbc_url, db_user, db_pass, merge_query)
        execute_tsql(jdbc_url, db_user, db_pass, f"DROP TABLE {stg_table_name};")
        
        print(f"Successfully merged {dim_name}.")

    # ==========================================
    # PHASE B: Process Facts (Append)
    # ==========================================
    print(f"Processing Fact Table...")
    
    # Isolate fact columns
    fact_df = df.select(*fact_columns)
    
    # Because dimensions are already merged and primary keys exist, 
    # we can safely append the facts without violating Foreign Keys!
    fact_table_name = "dbo.Fact_Events"
    
    fact_df.write.jdbc(
        url=jdbc_url, 
        table=fact_table_name, 
        mode="append", # Always append facts
        properties=jdbc_props
    )

    print("ETL Pipeline Completed Successfully!")

if __name__ == "__main__":
    run_etl()