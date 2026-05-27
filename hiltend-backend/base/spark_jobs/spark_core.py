import sys
import json
from pyspark.sql import SparkSession

def run_etl():
    if len(sys.argv) < 7:
        sys.exit("ERROR: Missing arguments.")

    file_path = sys.argv[1]
    dataset_name = sys.argv[2].strip().replace(" ", "_")
    ai_schema_map_str = sys.argv[3]
    jdbc_url = sys.argv[4]
    db_user = sys.argv[5]
    db_pass = sys.argv[6]

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
    
    for col_name in df.columns:
        clean_name = col_name.strip().replace("\r", "").replace("\n", "")
        if clean_name != col_name:
            df = df.withColumnRenamed(col_name, clean_name)
    
    schema_map = json.loads(ai_schema_map_str)
    dimensions = {}
    for dim_name, columns in schema_map.get("dimensions", {}).items():
        clean_cols = [c.replace("`", "").strip() for c in columns]
        valid_cols = [c for c in clean_cols if c in df.columns]
        
        if valid_cols:
            dimensions[dim_name] = valid_cols
            
    raw_fact_cols = [c.replace("`", "").strip() for c in schema_map.get("fact_table", [])]
    fact_columns = [c for c in raw_fact_cols if c in df.columns]

    # PHASE A: STAGE Dimensions (Overwrite)
    for dim_name, columns in dimensions.items():
        print(f"Staging Dimension: {dim_name}")
        dim_df = df.select(*columns).distinct().dropna(how="all")
        
        dim_df.write \
            .format("sqlserver") \
            .option("host", server_host) \
            .option("port", "1433") \
            .option("user", db_user) \
            .option("password", db_pass) \
            .option("database", database_name) \
            .option("dbtable", f"[{dataset_name}].[stg_{dim_name}]") \
            .mode("overwrite") \
            .save()

    # PHASE B: Process Facts (Append)
    print(f"Processing Fact Table...")
    fact_df = df.select(*fact_columns)
    
    fact_df.write \
        .format("sqlserver") \
        .option("host", server_host) \
        .option("port", "1433") \
        .option("user", db_user) \
        .option("password", db_pass) \
        .option("database", database_name) \
        .option("dbtable", f"[{dataset_name}].[Fact_Events]") \
        .mode("append") \
        .save()

    print("Databricks Staging Completed Successfully!")

if __name__ == "__main__":
    run_etl()