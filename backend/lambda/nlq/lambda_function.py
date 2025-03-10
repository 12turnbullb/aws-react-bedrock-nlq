import json
import boto3
import logging
import os
import time
import sample_prompts as Prompts
import sqlalchemy as sa
from sqlalchemy import create_engine, text
from botocore.exceptions import ClientError
from botocore.config import Config

### ENV VARIABLES ####

athena_results_s3 = os.environ.get('ATHENA_OUTPUT')
athena_catalog = os.environ.get('ATHENA_CATALOG') 
db_name = os.environ.get("ATHENA_DB")
athena_workgroup = os.environ.get('ATHENA_WORKGROUP')
table_name = os.environ.get('TABLE_NAME')
model_id = os.environ.get('MODEL_ID')

### CONFIG ###

logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)
logger.addHandler(logging.StreamHandler())

bedrock_region = athena_region = boto3.session.Session().region_name
retry_config = Config(retries = {'max_attempts': 10})
session = boto3.Session(region_name=bedrock_region)
bedrock = session.client('bedrock-runtime', region_name=bedrock_region, config=retry_config)

athena_client = session.client('athena',config=retry_config)
s3_client = session.client('s3',config=retry_config)
glue_client = session.client('glue', config=retry_config)

dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table(table_name)

########################## STEP 1 ###############################
#### GRAB RELEVANT SCHEMA DETAILS FROM AWS GLUE DATA CATALOG ####

def get_relevant_metadata(user_query):

    try:
        # Get all tables in the database
        response = glue_client.get_tables(DatabaseName=db_name)
        tables = response.get("TableList", [])
        
        schema_details = {}

        for table in tables:
            table_name = table["Name"]
            columns = table.get("StorageDescriptor", {}).get("Columns", [])

            # Extract column details
            schema_details[table_name] = [
                {"Name": col["Name"], "Type": col["Type"]} for col in columns
            ]
 
        logger.info(f"Metadata retrieved: {schema_details}")
        
        return schema_details

    except Exception as e:

        errorMessage = f"Metadata retrieval Failed: {str(e)}"
        logger.error(errorMessage)
        raise Exception(errorMessage)

    return schema_details


##################### STEP 2 #######################
#### USE THE RETREIVED METADATA TO GENERATE SQL ####

def generate_sql(user_query, id):
    
    schema_details = get_relevant_metadata(user_query)
    
    details = f"""
    Read database metadata inside the <database_metadata></database_metadata> tags to do the following:
    1. Create a syntactically correct awsathena query to answer the question.
    2. Never query for all the columns from a specific table, only ask for a few relevant columns given the question.
    3. Pay attention to use only the column names that you can see in the schema description. 
    4. Be careful to not query for columns that do not exist.
    5. When using WHERE clauses, be careful not to search for values that do not exist in the column. 
    6. When using WHERE clauses, add the LOWER() function and search for all terms in lowercase. 
    7. If you are writing CTEs then include all the required columns. 
    8. While concatenating a non string column, make sure cast the column to string.
    9. For date columns comparing to string , please cast the string input.
    10. Return the sql query inside the <SQL></SQL> tab.
    
    Refer to the example queries in the <sample_queries></sample_queries> tags for example output.

    """
    
    prompt = f"""\n\n{details}. <database_metadata> {schema_details} </database_metadata> <sample_queries> {Prompts.sample_queries} </sample_queries> <query> {user_query} </query>"""

    attempt = 0
    max_attempts = 3
    query = ''

    while attempt < max_attempts:
        # Generate a SQL query and test the quality against athena
        try: 
            logger.info(f'Attempt {attempt+1}: Generating SQL')
                        
            # Pass user input to bedrock which generates sql 
            output_message, response = call_bedrock(prompt, id)
                        
            # Extract the query out of the model response
            query = response.split('<SQL>')[1].split('</SQL>')[0]
            query = ' '.join(query.split())
            
            logger.info(f"Generated Query #{attempt +1}: {query}")
            
            # check the quality of the SQL query
            syntaxcheckmsg=syntax_checker(query)
            
            logger.info(f"Syntax Checker: {syntaxcheckmsg}")
            
            if syntaxcheckmsg=='PASSED':
                logger.info(f'Syntax check passed on attempt {attempt+1}')
                return query
            else: 
                # reset the value of prompt with a new prompt and the latest query

                prompt += f"""
                This a syntax error from the originally generated SQL: {syntaxcheckmsg}. 
                To correct this, please generate an alternative SQL query which will correct the syntax error.
                The updated query should take care of all the syntax issues encountered.
                Follow the instructions mentioned above to remediate the error. 
                Update the below SQL query to resolve the issue:
                {query}
                Make sure the updated SQL query aligns with the requirements provided in the initial question."""
                
                attempt +=1 
                
        except Exception as e:
            logger.error(f"SQL Generation Failed: {str(e)}")
            attempt +=1 
    
    raise Exception("SQL query generation failed after maximum retries. Please try a different question.")

################### STEP 2 (HELPER FUNCTIONS) #####################

#### HELPER FUNCTION TO CALL BEDROCK
def call_bedrock(prompt, id):
    
    # Get the latest conversation history from DynamoDB
    conversation_history = read_history_from_dynamodb(table, id)
    
    # Define the system prompts to guide the model's behavior and role.
    system_prompts = [{"text": "You are a helpful assistant. Keep your answers short and succinct."}]

    # payload with model paramters
    message = {"role": "user", "content": [{"text": prompt}]}  
    
    conversation_history.append(message)
    
    # Set the temperature for the model inference, controlling the randomness of the responses.
    temperature = 0.1

    # Set the top_k parameter for the model inference, determining how many of the top predictions to consider.
    top_k = 200

    try:
        # Call the converse method of the Bedrock client object to get a response from the model.
        response = bedrock.converse(
            modelId = model_id, # Amazon Bedrock model ID loaded in from the environment variables
            messages=conversation_history,
            system=system_prompts,
            inferenceConfig={"temperature": temperature},
            additionalModelRequestFields={"top_k": top_k}
        )
    
        # Extract the output message from the response.
        output_message = response['output']['message']
        
        answer = output_message['content'][0]['text']
        
        logger.info(f"BEDROCK OUTPUT: {answer}")
    
    except Exception as e:

        errorMessage = f"An error occurred calling Amazon Bedrock: {str(e)}"
        logger.error(errorMessage)
        raise Exception(errorMessage)
        
    return output_message, answer

#### HELPER FUNCTIONS TO CHECK THE SYNTAX OF THE GENERATED SQL  ####        

def syntax_checker(query):
    
    query_config = {"OutputLocation": athena_results_s3 }
    query_execution_context = {
        "Catalog": athena_catalog,
        "Database": db_name
    }
    
    try:
        response = athena_client.start_query_execution(
            QueryString=query,
            ResultConfiguration=query_config,
            QueryExecutionContext=query_execution_context,
            WorkGroup =athena_workgroup
        )
    
        execution_id = response["QueryExecutionId"]

        logger.info(f"Query execution ID: {execution_id}")
        
        # Wait for the query to complete
        while True:
            response_wait = athena_client.get_query_execution(QueryExecutionId=execution_id)
            state = response_wait['QueryExecution']['Status']['State']
            
            if state in ['QUEUED', 'RUNNING']:
                logger.info("Query is still running...")
                time.sleep(1)  # Add small delay
                continue
            break
            
        logger.info(f"Query finished with state: {state}")
    
        # Check if the query completed successfully
        if state == 'SUCCEEDED':
            return "PASSED"
        else:
            logger.error(f"Query failed syntax check")
            message = response_wait['QueryExecution']['Status']['StateChangeReason']
            return message
            
    except Exception as e:
        errorMessage = f"An error occurred checking the SQL query syntax: {str(e)}"
        logger.error(errorMessage)
        raise Exception(errorMessage)

    return message
    
################ DYNAMO DB CONVO HISTORY ################

def write_history_to_dynamodb(history, table, id):
    # Take in message from conversation history
    # Augment with session id and the timestamp
    # Write to DynamoDB
    
    timestamp = str(time.time())
    
    # Add an index to differentiate messages written at the same time (avoid overwrites)
    for idx, item in enumerate(history):
        item['id'] = id
        item['timestamp'] = f"{timestamp}_{idx}"
        table.put_item(Item=item)
        
        logger.info(f"\n\nItem with ID {id} and timestamp {timestamp} written to table {table}\n\n")

def read_history_from_dynamodb(table, id):
    
    return_items = []

    # Retrieve all the conversation history for the current session ID
    response = table.query(
        KeyConditionExpression=boto3.dynamodb.conditions.Key('id').eq(id),
    )
    
    items = response.get('Items', []) # get the items from the response, or an empty list if none
    
    # parse the item response and store in a new message object that Bedrock accepts 
    for item in items:
        content = item.get('content', 'N/A')[0]['text']
        role = item.get('role', 'N/A')

        history_message = {
            "role": role,
            "content": [
                { "text": content } 
            ],
        }
                
        # Add message to our items list
        # The final list will contain the full session conversation history
        return_items.append(history_message)
        
    return return_items
    
######################## STEP 3 #########################
#### EXECUTE THE GENERATED SQL AGAINST YOUR DATABASE ####

def execute_sql(sql):
    try: 
        athena_connection_str = f'awsathena+rest://:@athena.{athena_region}.amazonaws.com:443/{db_name}?s3_staging_dir={athena_results_s3}&catalog_name={athena_catalog}'
        # Create Athena engine
        engine = create_engine(athena_connection_str) 
    
        # connect and execute the SQL
        with engine.connect() as connection:
            result = connection.execute(text(sql))
            rows = result.all()
            logger.info('SQL Execution Successful')
            return str(rows)
    
    except Exception as e:

        errorMessage = f"SQL Execution Failed: {str(e)}"
        logger.error(errorMessage)
        raise Exception(errorMessage)

###################### STEP 4 ########################
#### SHOWCASE THE SQL RESULTS IN NATURAL LANGUAGE ####

def final_output(user_query, id):
     
    final_query = generate_sql(user_query, id)

    logger.info(f"FINAL GENERATED QUERY: {final_query}")
    
    results = execute_sql(final_query)

    logger.info(f"SQL QUERY RESULTS: {results}")

    prompt = f"""
    You are a helpful assistant providing users with information based on database 
    results. Your goal is to answer questions conversationally, summarizing the data
    clearly and concisely. When possible, display the results in a table using
    markdown syntax, and provide a short summary first. Avoid mentioning that the 
    data comes from a SQL query, and focus on giving direct, natural responses 
    to the user's question. 
    
    Markdown Table Format:
    - Use "|" to separate columns.
    - The first row should contain column headers, followed by a separator line with dashes ("---").
    - Each subsequent row should contain the data, also separated by "|".
    
    For example:
    
    | Column 1 | Column 2 |
    | --- | --- |
    | Data 1 | Data 2 |
    
    If a table format is not possible, return the results as a bulleted list or structured text.
    
    Question: {user_query}
    
    Results: {results}
    """
    
    output_message, output = call_bedrock(prompt, id)
    
    logger.info(f"OUTPUT FROM BEDROCK: {output}")
    
    # Write our key conversation history to DynamoDB for future chats to read as context 
    messages = [
        {"role": "user", "content": [{"text": user_query}]},
        {"role": "assistant", "content": [{'text': f"SQL QUERY: {final_query}, RESULTS: {output}"}]}
    ]
    
    write_history_to_dynamodb(messages, table, id)

    resp_json = {"answer": output, "sql_query": final_query}
    
    return resp_json

def lambda_handler(event, context):
    
    body = event.get('body', {})
    
    # If body is a string (e.g., from API Gateway), parse it
    if isinstance(body, str):
        body = json.loads(body)
    
    # pull the user's message and the generated id from the frontend event
    prompt = body.get('message')
    generated_uuid = body.get('id')
    
    try:
        output = final_output(prompt, generated_uuid)

        # Return the response expected by API Gateway
        return {
            'statusCode': 200,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',  # Enable CORS
            },
            'body': json.dumps(output)
        }
    except Exception as e:

        logger.error(f"Error: {str(e)}")
        
        return {
            'statusCode': 500,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',  # Enable CORS
            },
            'body': json.dumps({"answer": str(e), "sql_query": ""})
        }
    