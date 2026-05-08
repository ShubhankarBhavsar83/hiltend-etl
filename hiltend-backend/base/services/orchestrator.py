import subprocess

def trigger_spark_job(file_path: str, dataset_name: str):
    print(f"[Orch] Triggering Spark job for: {dataset_name}")
    print(f"[Orch] File location : {file_path}")

    try:
        subprocess.run(
            ["python", "spark_jobs/clean.py", "--filepath", file_path, "--dataset", dataset_name],
            check=True
        )
        print(f"[Orch] Job Success for dataset: {dataset_name}")
    except Exception as e:
        print(f"[Orch] Job Failed For Dataset: {dataset_name}. Error: {str(e)}")