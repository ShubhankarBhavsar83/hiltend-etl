import sys
import json
from pyspark.sql import SparkSession

if len(sys.argv) > 1:
    file_path = sys.argv[1]
    
    spark = SparkSession.builder.getOrCreate()

    df = spark.read.option("header", "true").csv(file_path).limit(1)
    headers = df.columns
    
    dbutils.jobs.taskValues.set(key="csv_headers", value=json.dumps(headers))
    print("Headers successfully extracted and passed to orchestrator.")