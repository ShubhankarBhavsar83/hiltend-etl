import sys
import json
from pyspark.sql import SparkSession

def extract_headers():
    if len(sys.argv) < 2:
        print("ERROR: No file path provided by orchestrator.")
        sys.exit(1)
        
    file_path = sys.argv[1]
    # print(f"Reading headers for: {file_path}")
    
    spark = SparkSession.builder.appName("HeaderExtractor").getOrCreate()
    
    df = spark.read.option("header", "true").csv(file_path).limit(1)
    headers = df.columns
    
    headers_json = json.dumps(headers)
    dbutils.jobs.taskValues.set(key="csv_headers", value=headers_json)
    
    print(f"Successfully extracted {len(headers)} headers: {headers_json}")

if __name__ == "__main__":
    extract_headers()