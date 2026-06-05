import os
import json
import re
from openai import OpenAI
from pydantic import BaseModel, Field
from typing import List, Dict
from base.core.config import settings



class StarSchemaMap(BaseModel):
    fact_table_name: str = Field(description="Name of the central fact table. Prefix with 'Fact_'.")
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

    def generate_relational_mapping(self, dataset_name: str, headers: list[str], existing_schema: str = "") -> StarSchemaMap:

        schema_instruction = f"""
        EXISTING SCHEMA CONTEXT:
        {existing_schema}
        CRITICAL: Map the new CSV headers to the EXISTING table names above if they represent the same entities (e.g., updating existing HR records, appending new sales). If the CSV introduces entirely new data concepts not present in the existing schema, invent NEW table names.
        """ if existing_schema else "No existing tables. Design a brand new Star Schema."

        system_prompt = f"""
        You are an expert Data Architect. The user is uploading a new CSV dataset into the SQL schema '{dataset_name}'.
        Group the provided column headers into a logical Star Schema.

        {schema_instruction}

        CRITICAL DATABASE RULES:
        1. Identify the primary key column(s) (e.g., 'id', 'uuid', or the closest equivalent).
        2. The 'fact_table' array MUST contain these primary keys PLUS the numeric metrics/facts.
        3. EVERY dimension array MUST contain the primary key as its FIRST item, followed by the descriptive attributes. Do NOT create disconnected dimensions without the primary key!
        4. ALL relevant tables MUST HAVE appropriate relational mapping to allow custom tables views using the primary/foreign.

        CRITICAL FORMATTING INSTRUCTION: 
        You MUST respond in pure JSON adhering EXACTLY to the following structure. Do not add nested objects. Do not add extra keys like 'name' or 'metrics'. 'fact_table' MUST be a flat array of strings. 'dimensions' MUST be a dictionary of arrays.
        {{
            "fact_table_name": "Fact_YourTableName",
            "fact_table": ["id", "fact_column_1", "fact_column_2"],
            "dimensions": {{
                "Dim_Time": ["id", "time_column_1"],
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
                temperature=0.0
            )
            
            raw_content = response.choices[0].message.content
            clean_content = raw_content.replace("```json", "").replace("```", "").strip()
            raw_dict = json.loads(clean_content)
            
            if "star_schema" in raw_dict:
                raw_dict = raw_dict["star_schema"]
                
            validated_schema = StarSchemaMap(**raw_dict)
            return validated_schema

        except Exception as e:
            print(f"Error generating relational mapping: {e}")
            raise e
      
      
    def generate_dataset_dictionary(self, dataset_name: str, schema_context: str) -> str:
        system_prompt = f"""
        You are an expert Data Architect. The user wants a high-level summary and explanation of the entire dataset named '{dataset_name}'.
        
        Based on the provided database schema (tables, columns, and data types):
        1. Explain the core entities/tables and what kind of data they hold.
        2. Identify the likely relationships between them (e.g., primary/foreign key links, star schema patterns).
        3. Suggest what kind of business insights or analytics this dataset supports.
        
        Format your response cleanly using markdown bullet points and short paragraphs. Do not write SQL.
        """
        try:
            response = self.client.chat.completions.create(
                model=self.deployment_name,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": f"Schema Definition:\n{schema_context}"}
                ],
                temperature=0.3
            )
            
            content = response.choices[0].message.content
            if not content:
                return "The AI returned an empty response. This is likely due to an Azure safety/content filter."
                
            return content.strip()
        except Exception as e:
            print(f"Error generating dataset summary: {e}")
            raise e
        
    def generate_data_summary(self, dataset_name: str, data_sample: str, user_context: str = "") -> str:
        
        system_prompt = f"""
        You are an expert Data Analyst analyzing a dataset named '{dataset_name}'. 
        The user has provided a JSON sample of their current data view.
        Provide a detailed summary of this data. 
        Identify key metrics, trends, anomalies, or interesting distributions.
        Format your response cleanly using bullet points or short paragraphs. Do not echo the raw data back.
        """
        
        if user_context:
            system_prompt += f"\n\nCRITICAL USER INSTRUCTIONS TO FOCUS ON:\n{user_context}"
        try:
            response = self.client.chat.completions.create(
                model=self.deployment_name,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": f"Data Sample:\n{data_sample}"}
                ],
                temperature=0.3
            )
            
            content = response.choices[0].message.content
            if not content:
                return "The AI returned an empty response. This is likely due to an Azure safety/content filter."
                
            return content.strip()
        except Exception as e:
            print(f"Error generating summary: {e}")
            raise e      
  
    def generate_sql_query(self, dataset_name: str, user_question: str, db_schema_context: str) -> str:

        system_prompt = f"""
        You are an expert Azure SQL Database Architect. 
        Translate the user's question into purely valid T-SQL.
        Output ONLY the raw SQL query. Do not use markdown blocks (e.g., ```sql).
        
        CRITICAL RULES:
        1. TABLE NAMES: You MUST fully qualify ALL table names using the schema '{dataset_name}'. 
           Format: [{dataset_name}].[TableName]
        2. DATES: Dates are often stored as string types (e.g., 'YYYY-MM-DD'). Use appropriate T-SQL conversion functions (like TRY_CAST(column AS DATE) or substring logic) when filtering or comparing dates.
        3. NO STANDALONE ORDER BY (CRITICAL): You MUST NOT include an ORDER BY clause unless you are also using the TOP keyword (e.g., SELECT TOP 10 ... ORDER BY ...). A standalone ORDER BY clause will crash the downstream pagination wrapper.
        
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
        
        
    def generate_join_query(self, dataset_name: str, selected_columns: list[str], schema_context: str) -> str:
        
        system_prompt = f"""
        You are an expert Data Engineer. Your goal is to generate a valid T-SQL SELECT query for a Star Schema in the schema '{dataset_name}'.
        
        SCHEMA STRUCTURE:
        {schema_context}
        
        YOUR RULES:
        1. ANCHOR: The query MUST identify the relevant FACT table (the table containing IDs from multiple dimensions).
        2. JOIN PATTERN: All DIMENSION tables must join directly to the FACT table. Do NOT join dimensions to other dimensions.
        3. SYNTAX: Use fully qualified names: [{dataset_name}].[TableName].[ColumnName].
        4. ALIAS DUPLICATES (CRITICAL): If the user selects columns with the exact same name from different tables (e.g., 'repo_id' from Dim_Time and 'repo_id' from Dim_Repository), you MUST alias them in the SELECT clause to guarantee unique column names (e.g., SELECT [Dim_Time].[repo_id] AS [Dim_Time_repo_id]). Un-aliased duplicates will crash the downstream pagination CTE.
        5. NO ORDER BY (CRITICAL): You MUST NOT include an ORDER BY clause. It will crash the downstream pagination wrapper.
        6. OUTPUT: Return ONLY the raw T-SQL. No markdown, no triple backticks, no conversational text.
        7. Do NOT include additional tables / columns which are not relevant to the request of the user.
        
        Example of correct join pattern with aliasing:
        SELECT [Dim_A].[ID] AS [Dim_A_ID], [Dim_B].[ID] AS [Dim_B_ID], [Fact_X].[Metric]
        FROM [Fact_X]
        INNER JOIN [Dim_A] ON [Fact_X].[ID] = [Dim_A].[ID]
        INNER JOIN [Dim_B] ON [Fact_X].[B_ID] = [Dim_B].[ID]
        """
        
        user_prompt = f"Requested Columns to Join:\n" + "\n".join(selected_columns)
        
        try:
            response = self.client.chat.completions.create(
                model=self.deployment_name,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                temperature=0.0
            )
            return response.choices[0].message.content.strip()
        except Exception as e:
            print(f"Error generating join query: {e}")
            raise e
        
        
    def generate_chart_summary(self, dataset_name: str, csv_data: str, user_context: str = "", is_sampled: bool = False) -> str:
            
            sampling_warning = ""
            if is_sampled:
                sampling_warning = "CRITICAL: Due to context window limits, the data provided is a SAMPLED SUBSET of the full chart dataset. Do not claim these are absolute totals; phrase your analysis as 'Based on the sampled data...' or identify trends rather than exact universal sums."

            system_prompt = f"""
            You are an expert Data Analyst analyzing a visualized chart dataset from the '{dataset_name}' schema. 
            The user has provided the underlying chart data in CSV format.
            
            {sampling_warning}
            
            Provide a detailed summary of this chart data. 
            Identify key metrics, trends, anomalies, or interesting distributions.
            Format your response cleanly using bullet points or short paragraphs. Do not echo the raw data back.
            """
            
            if user_context:
                system_prompt += f"\n\nCRITICAL USER INSTRUCTIONS TO FOCUS ON:\n{user_context}"
                
            try:
                response = self.client.chat.completions.create(
                    model=self.deployment_name,
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": f"Chart Data (CSV):\n{csv_data}"}
                    ],
                    temperature=0.3
                )
                
                content = response.choices[0].message.content
                if not content:
                    return "The AI returned an empty response. This is likely due to an Azure safety/content filter."
                    
                return content.strip()
            except Exception as e:
                print(f"Error generating chart summary: {e}")
                raise e