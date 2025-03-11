import config
import time
import sqlalchemy as sa
from sqlalchemy import create_engine, text

#### HELPER FUNCTIONS TO CHECK THE SYNTAX OF THE GENERATED SQL  ####        

def syntax_checker(query):
    
    query_config = {"OutputLocation": config.ATHENA_RESULTS_S3 }
    query_execution_context = {
        "Catalog": config.GLUE_CATALOG,
        "Database": config.GLUE_DB_NAME
    }
    
    try:
        response = config.athena_client.start_query_execution(
            QueryString=query,
            ResultConfiguration=query_config,
            QueryExecutionContext=query_execution_context,
            WorkGroup=config.ATHENA_WORKGROUP
        )
    
        execution_id = response["QueryExecutionId"]

        config.logger.info(f"Query execution ID: {execution_id}")
        
        # Wait for the query to complete
        while True:
            response_wait = config.athena_client.get_query_execution(QueryExecutionId=execution_id)
            state = response_wait['QueryExecution']['Status']['State']
            
            if state in ['QUEUED', 'RUNNING']:
                config.logger.info("Query is still running...")
                time.sleep(1)  # Add small delay
                continue
            break
            
        config.logger.info(f"Query finished with state: {state}")
    
        # Check if the query completed successfully
        if state == 'SUCCEEDED':
            return "PASSED"
        else:
            config.logger.error(f"Query failed syntax check")
            message = response_wait['QueryExecution']['Status']['StateChangeReason']
            return message
            
    except Exception as e:
        errorMessage = f"An error occurred checking the SQL query syntax: {str(e)}"
        config.logger.error(errorMessage)
        raise Exception(errorMessage)

    return message
    

    
######################## STEP 3 #########################
#### EXECUTE THE GENERATED SQL AGAINST YOUR DATABASE ####

def execute_sql(sql):
    try: 
        athena_connection_str = f'awsathena+rest://:@athena.{config.REGION}.amazonaws.com:443/{config.GLUE_DB_NAME}?s3_staging_dir={config.ATHENA_RESULTS_S3}&catalog_name={config.GLUE_CATALOG}'
        # Create Athena engine
        engine = create_engine(athena_connection_str) 
    
        # connect and execute the SQL
        with engine.connect() as connection:
            result = connection.execute(text(sql))
            rows = result.all()
            config.logger.info('SQL Execution Successful')
            return str(rows)
    
    except Exception as e:

        errorMessage = f"SQL Execution Failed: {str(e)}"
        config.logger.error(errorMessage)
        raise Exception(errorMessage)
