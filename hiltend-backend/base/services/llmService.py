import os
import json
import re
from openai import OpenAI
from pydantic import BaseModel, Field
from typing import List, Dict
from base.core.config import settings


# --- Pydantic Models for Output Validation ---
# These ensure FastAPI automatically validates the LLM's JSON output
class StarSchemaMap(BaseModel):
    fact_table: List[str] = Field(description="List of column names for the central fact table.")
    dimensions: Dict[str, List[str]] = Field(description="Dictionary where keys are dimension table names, and values are lists of columns.")

class LLMService:
    def __init__(self):
        endpoint = settings.azure_ai_endpoint
        api_key = settings.azure_ai_key
        self.deployment_name = settings.azure_ai_deployment_name

        if not endpoint or not api_key:
            raise ValueError("Missing Azure AI credentials in environment variables.")

        # OpenAI client -> Azure
        self.client = OpenAI(
            base_url=endpoint,
            api_key=api_key
        )

    def generate_relational_mapping(self, dataset_name: str, headers: List[str]) -> StarSchemaMap:
        """
        JOB 1: Takes CSV headers and returns a strict JSON Star Schema map.
        """
        system_prompt = f"""
        You are an expert Data Architect. The user is uploading a new CSV dataset named '{dataset_name}'.
        Group the provided column headers into a logical Star Schema.
        Identify the metrics/facts for the Fact Table, and group the descriptive attributes into Dimension Tables.
        You MUST respond in pure JSON.
        """
        
        user_prompt = f"CSV Headers: {', '.join(headers)}"

        try:
            response = self.client.chat.completions.create(
                model=self.deployment_name,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                # forces valid JSON output
                response_format={"type": "json_object"}, 
                temperature=0.1
            )
            
            raw_json = response.choices[0].message.content
            
            # Parse the JSON and validate it through Pydantic
            parsed_data = json.loads(raw_json)
            validated_schema = StarSchemaMap(**parsed_data)
            
            return validated_schema

        except Exception as e:
            print(f"Error generating relational mapping: {e}")
            raise e

    def generate_sql_query(self, user_question: str, db_schema_context: str) -> str:
        """
        JOB 3: Takes a natural language question and the DB Schema, returns T-SQL.
        """
        system_prompt = f"""
        You are an expert Azure SQL Database Architect. 
        Translate the user's question into purely valid T-SQL.
        Output ONLY the raw SQL query. Do not use markdown blocks (e.g., ```sql).
        
        Here is the current schema for the dataset:
        {db_schema_context}
        """

        try:
            response = self.client.chat.completions.create(
                model=self.deployment_name,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_question}
                ],
                temperature=0.0 # Absolute zero for strict coding
            )
            
            raw_sql = response.choices[0].message.content
            
            # Defensive cleaner to strip markdown if Llama disobeys instructions
            safe_sql = re.sub(r"```sql\n?", "", raw_sql, flags=re.IGNORECASE)
            safe_sql = re.sub(r"```\n?", "", safe_sql)
            
            return safe_sql.strip()

        except Exception as e:
            print(f"Error generating SQL query: {e}")
            raise e