import os
import json
import re
from openai import OpenAI
from pydantic import BaseModel, Field
from typing import List, Dict
from base.core.config import settings



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

    def generate_relational_mapping(self, dataset_name: str, headers: list[str]) -> StarSchemaMap:
        """
        JOB 1: Takes CSV headers and returns a strict JSON Star Schema map.
        """
        system_prompt = f"""
       You are an expert Data Architect. The user is uploading a new CSV dataset named '{dataset_name}'.
        Group the provided column headers into a logical Star Schema.

        CRITICAL DATABASE RULES:
        1. Identify the primary key column(s) (e.g., 'id', 'uuid', or the closest equivalent).
        2. The 'fact_table' array MUST contain these primary keys PLUS the numeric metrics/facts.
        3. EVERY dimension array MUST contain the primary key as its FIRST item, followed by the descriptive attributes. Do NOT create disconnected dimensions without the primary key!

        CRITICAL FORMATTING INSTRUCTION: 
        You MUST respond in pure JSON adhering EXACTLY to the following structure. Do not add nested objects. Do not add extra keys like 'name' or 'metrics'. 'fact_table' MUST be a flat array of strings. 'dimensions' MUST be a dictionary of arrays.

        {{
            "fact_table": ["id", "fact_column_1", "fact_column_2"],
            "dimensions": {{
                "Dim_Time": ["id", "time_column_1", "time_column_2"],
                "Dim_User": ["id", "user_column_1"]
            }}
        }}
        """
        
        user_prompt = f"CSV Headers: {', '.join(headers)}"

        try:
            response = self.client.chat.completions.create(
                model=self.deployment_name,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                response_format={"type": "json_object"}, 
                temperature=0.1
            )
            
            raw_content = response.choices[0].message.content
            
            clean_content = raw_content.replace("```json", "").replace("```", "").strip()
            
            raw_dict = json.loads(clean_content)
            
            if "star_schema" in raw_dict:
                raw_dict = raw_dict["star_schema"]
                
            if isinstance(raw_dict.get("fact_table"), dict):
                print("[AI Fix] Flattening hallucinated fact_table object...")
                for val in raw_dict["fact_table"].values():
                    if isinstance(val, list):
                        raw_dict["fact_table"] = val
                        break
                        
            validated_schema = StarSchemaMap(**raw_dict)
            
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
                temperature=0.0
            )
            
            raw_sql = response.choices[0].message.content
            
            safe_sql = re.sub(r"```sql\n?", "", raw_sql, flags=re.IGNORECASE)
            safe_sql = re.sub(r"```\n?", "", safe_sql)
            
            return safe_sql.strip()

        except Exception as e:
            print(f"Error generating SQL query: {e}")
            raise e