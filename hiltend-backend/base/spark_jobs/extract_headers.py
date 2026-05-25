import sys
import json
from pyspark.sql import SparkSession

def extract_headers():
    if len(sys.argv) < 2:
        print("ERROR: No file path provided by orchestrator.")
        sys.exit(1)
        
    file_path = sys.argv[1]
    
    spark = SparkSession.builder.appName("HeaderExtractor").getOrCreate()
    
    # 1. Read the CSV header
    df = spark.read.option("header", "true").csv(file_path).limit(1)
    headers = df.columns
    headers_json = json.dumps(headers)
    
    # 2. Generate the output path (e.g., dataset.csv -> dataset_headers.json)
    output_path = file_path.replace(".csv", "_headers.json")
    
    # 3. Drop the file back into the Data Lake
    dbutils.fs.put(output_path, headers_json, overwrite=True)
    
    print(f"Successfully saved {len(headers)} headers to {output_path}")

if __name__ == "__main__":
    extract_headers()