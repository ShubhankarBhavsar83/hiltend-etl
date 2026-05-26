import sys
import json
import pyodbc
from pyspark.sql import SparkSession

def execute_tsql(server_host, database_name, db_user, db_pass, query):
    """
    Executes raw T-SQL using pure pyodbc. 
    This completely bypasses the Databricks Serverless JVM block!
    """

    conn_str = (
        f"DRIVER={{ODBC Driver 17 for SQL Server}};"
        f"SERVER=tcp:{server_host},1433;"
        f"DATABASE={database_name};"
        f"UID={db_user};"
        f"PWD={{{db_pass}}};" 
        f"Encrypt=yes;"
        f"TrustServerCertificate=no;"
        f"Connection Timeout=30;"
    )
    
    conn = pyodbc.connect(conn_str)
    cursor = conn.cursor()
    cursor.execute(query)
    conn.commit()
    cursor.close()
    conn.close()

def run_etl():
    if len(sys.argv) < 7:
        print("ERROR: Missing arguments. Expected: file_path, dataset_name, ai_schema_map, jdbc_url, db_user, db_pass")
        sys.exit(1)

    file_path = sys.argv[1]
    dataset_name = sys.argv[2].strip().replace(" ", "_")
    ai_schema_map_str = sys.argv[3]
    
    jdbc_url = sys.argv[4]
    db_user = sys.argv[5]
    db_pass = sys.argv[6]

    print(f"Starting ETL for Schema [{dataset_name}] on file: {file_path}")

    clean_str = jdbc_url.replace("jdbc:sqlserver://", "")
    parts = clean_str.split(";")
    
    server_host = parts[0].split(":")[0]
    database_name = ""
    for p in parts[1:]:
        if p.lower().startswith("database="):
            database_name = p.split("=")[1]
            break

    spark = SparkSession.builder.appName(f"ETL_{dataset_name}").getOrCreate()

    df = spark.read.option("header", "true").option("inferSchema", "true").csv(file_path)
    
    schema_map = json.loads(ai_schema_map_str)
    dimensions = schema_map.get("dimensions", {})
    fact_columns = schema_map.get("fact_table", [])

    # PHASE A: Process Dimensions (Safely MERGE)
    for dim_name, columns in dimensions.items():
        print(f"Processing Dimension: {dim_name}")
        
        dim_df = df.select(*columns).distinct().dropna(how="all")
        primary_key = columns[0]
        
        stg_table_name = f"[{dataset_name}].[stg_{dim_name}]"
        real_table_name = f"[{dataset_name}].[{dim_name}]"

        dim_df.write \
            .format("sqlserver") \
            .option("host", server_host) \
            .option("port", "1433") \
            .option("user", db_user) \
            .option("password", db_pass) \
            .option("database", database_name) \
            .option("dbtable", stg_table_name) \
            .mode("overwrite") \
            .save()

        update_set = ", ".join([f"target.[{col}] = source.[{col}]" for col in columns if col != primary_key])
        insert_cols = ", ".join([f"[{col}]" for col in columns])
        insert_vals = ", ".join([f"source.[{col}]" for col in columns])

        merge_query = f"""
        MERGE INTO {real_table_name} AS target
        USING {stg_table_name} AS source
        ON target.[{primary_key}] = source.[{primary_key}]
        """
        
        if update_set:
            merge_query += f" WHEN MATCHED THEN UPDATE SET {update_set}"
            
        merge_query += f" WHEN NOT MATCHED THEN INSERT ({insert_cols}) VALUES ({insert_vals});"

        execute_tsql(server_host, database_name, db_user, db_pass, merge_query)
        execute_tsql(server_host, database_name, db_user, db_pass, f"DROP TABLE {stg_table_name};")
        
        print(f"Successfully merged {dim_name}.")

    # PHASE B: Process Facts (Append)
    print(f"Processing Fact Table...")
    
    fact_df = df.select(*fact_columns)
    fact_table_name = f"[{dataset_name}].[Fact_Events]"
    
    fact_df.write \
        .format("sqlserver") \
        .option("host", server_host) \
        .option("port", "1433") \
        .option("user", db_user) \
        .option("password", db_pass) \
        .option("database", database_name) \
        .option("dbtable", fact_table_name) \
        .mode("append") \
        .save()

    print("ETL Pipeline Completed Successfully!")

if __name__ == "__main__":
    run_etl()