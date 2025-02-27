import json
import boto3
import json
import sys
import logging
import os
import time
import sample_prompts as Prompts
import io
import re
import urllib.parse
import sqlalchemy as sa
from sqlalchemy import create_engine, text
from botocore.exceptions import ClientError
from botocore.config import Config

### USER INPUTS ####

athena_results_s3 = os.environ.get('ATHENA_OUTPUT') # "s3://npo-all-hands-nlq-2024/athena_output" 
athena_catalog = os.environ.get('ATHENA_CATALOG') #"AwsDataCatalog" 
db_name = os.environ.get("ATHENA_DB") #"fifa"

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

dynamodb = boto3.resource('dynamodb')

table_name = os.environ.get('TABLE_NAME')
table = dynamodb.Table(table_name)

######################## STEP 1 #######################
#### GRAB RELEVANT SCHEMA DETAILS FROM VECTORSTORE ####

def get_relevant_metadata(user_query):
    # question_db = FAISS.load_local(db_faiss_path, bedrock_embeddings, allow_dangerous_deserialization=True)
    # results = question_db.similarity_search_with_score(user_query)
    # #print(results)
    # schema = {}
    
    # for doc, score in results:
    #     table_name = doc.metadata['tableName']
    #     table_schema = doc.metadata['tableSchema']
    #     #summary = doc.metadata['summary']
    #     schema[table_name] = {'schema': table_schema} #'summary': summary}
        
    #schema = {'students': {'schema': 'student_id|first_name|last_name|age|demographic|school_id'}, 'schools': {'schema': 'school_id|school_name|school_type|city|state'}}
    
    schema = Prompts.schemas
    
    return schema


##################### STEP 2 #######################
#### USE THE RETREIVED METADATA TO GENERATE SQL ####

def generate_sql(user_query, id) ->str:
    
    conversation_history = []
    conversation_history = read_history_from_dynamodb(table, id)

    vector_search_match=get_relevant_metadata(user_query)
    
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
    
    prompt = f"""\n\n{details}. <database_metadata> {vector_search_match} </database_metadata> <sample_queries> {Prompts.sample_queries} </sample_queries> <query> {user_query} </query>"""

    attempt = 0
    max_attempts = 4
    query = ''

    while attempt < max_attempts:
        # Generate a SQL query and test the quality against athena
        try: 
            logger.info(f'we are in Try block to generate the sql and count is :{attempt+1}')
                        
            # Pass user input to bedrock which generates sql 
            output_message, response = call_bedrock(prompt, conversation_history)
                        
            # Extract the query out of the model response
            query = response.split('<SQL>')[1].split('</SQL>')[0]
            query = ' '.join(query.split())
            
            logger.info(f"Generated Query {attempt +1}: {query}")
            
            # check the quality of the SQL query
            syntaxcheckmsg=syntax_checker(query)
            
            print(" ################## SYNTAX CHECKER: ", syntaxcheckmsg)
            
            if syntaxcheckmsg=='Passed':
                logger.info(f'syntax checked for query passed in attempt number :{attempt+1}')
                
                # If the query passes, add details to the conversation history
                # Append the output message to the list of messages.
                convo_holder = create_convo_message(conversation_history)
                write_history_to_dynamodb(convo_holder, table, id)
                
                conversation_history.append(output_message)
                
                convo_holder = create_convo_message(conversation_history)
                write_history_to_dynamodb(convo_holder, table, id)
                
                return query
            else: 
                # reset the value of prompt with a new prompt and the latest query
                prompt = f"""{prompt}
                This is the syntax error: {syntaxcheckmsg}. 
                To correct this, please generate an alternative SQL query which will correct the syntax error.
                The updated query should take care of all the syntax issues encountered.
                Follow the instructions mentioned above to remediate the error. 
                Update the below SQL query to resolve the issue:
                {query}
                Make sure the updated SQL query aligns with the requirements provided in the initial question."""
                
                attempt +=1 
                
        except Exception as e:
            logger.error(f'FAILED: {e}')
            attempt +=1 

            return "The query has failed. Please rephrase your question to attempt another query."
            
    return query

################### STEP 2 (HELPER FUNCTIONS) #####################

#### HELPER FUNCTION TO CALL BEDROCK
def call_bedrock(prompt, conversation_history):
    
    # Define the system prompts to guide the model's behavior and role.
    system_prompts = [{"text": "You are a helpful assistant. Keep your answers short and succinct."}]

    # payload with model paramters
    message = {"role": "user", "content": [{"text": prompt}]}  
    
    conversation_history.append(message)
    
    # Set the temperature for the model inference, controlling the randomness of the responses.
    temperature = 0.5

    # Set the top_k parameter for the model inference, determining how many of the top predictions to consider.
    top_k = 200

    try:
        # Call the converse method of the Bedrock client object to get a response from the model.
        response = bedrock.converse(
            modelId="anthropic.claude-3-sonnet-20240229-v1:0",
            messages=conversation_history,
            system=system_prompts,
            inferenceConfig={"temperature": temperature},
            additionalModelRequestFields={"top_k": top_k}
        )
    
        # Extract the output message from the response.
        output_message = response['output']['message']
        
        answer = output_message['content'][0]['text']
        
        print("FINAL OUTPUT: ", answer)
    
    except Exception as e:
        print(f"An error occurred: {str(e)}")
        
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
        )
    
        execution_id = response["QueryExecutionId"]
        
        # Wait for the query to complete
        response_wait = athena_client.get_query_execution(QueryExecutionId=execution_id)
    
        while response_wait['QueryExecution']['Status']['State'] in ['QUEUED', 'RUNNING']:
            print("Query is still running...")
            response_wait = athena_client.get_query_execution(QueryExecutionId=execution_id)
    
        print(f'response_wait {response_wait}')
    
            # Check if the query completed successfully
        if response_wait['QueryExecution']['Status']['State'] == 'SUCCEEDED':
            return "Passed"
        else:
            print("Query failed!")
            code = response_wait['QueryExecution']['Status']['State']
            message = response_wait['QueryExecution']['Status']['StateChangeReason']
            return message
            
    except Exception as e:
        message = f'error {e}'
    
    return message
    
################ DYNAMO DB CONVO HISTORY ################

def write_history_to_dynamodb(history, table, id):
    """
    This function writes the conversation history to DynamoDB, you can use this function to store the history for
    future training or analysis.
    :param history: The conversation history to be written to DynamoDB.
    :return: None
    """
    timestamp = str(time.time())
    for item in history:
        item_id = id
        item['id'] = item_id
        item['timestamp'] = timestamp
        # write the item to the table
        table.put_item(Item=item)
        print(f"\n\nItem with ID {item_id} and timestamp {timestamp} written to table {table}\n\n")

def read_history_from_dynamodb(table, id):
    """
    This function reads the conversation history from DynamoDB, you can use this function to retrieve the history for
    future training or analysis.
    :param table: The DynamoDB table to read from.
    :param id: The ID of the item to read.
    :return: The conversation history read from DynamoDB.
    """
    history_message = {}
    return_items = []
    projection_expression = '#rl, content'
    expression_attribute_names = {'#rl': 'role'}
    response = table.query(
        KeyConditionExpression=boto3.dynamodb.conditions.Key('id').eq(id),
        ProjectionExpression=projection_expression,
        ExpressionAttributeNames=expression_attribute_names
    )
    items = response.get('Items', [])
    print(f"\n\nLength of items: {len(items)}\n\n")
    for item in items:
      if 'id' or 'timestamp' not in item:
        content = item.get('content', 'N/A')[0]['text']
        role = item.get('role', 'N/A')
        id = item.get('id', 'N/A') 
        print(f"\n\nMessage: {content} \nwith Role: {role} \nand ID: {id} \nfound in table {table}\n\n")
        history_message = {
                    "role": role,
                    "content": [
                        { "text": content } 
                    ],
                }
        return_items.append(history_message)
    return return_items

def create_convo_message(history):
    the_convo_holder = []
    the_convo_holder.append(history[-1])
    return the_convo_holder

######################## STEP 3 #########################
#### EXECUTE THE GENERATED SQL AGAINST YOUR DATABASE ####

def execute_sql(sql):
    db_error=None
    final = ""
    try: 
        athena_connection_str = f'awsathena+rest://:@athena.{athena_region}.amazonaws.com:443/{db_name}?s3_staging_dir={athena_results_s3}&catalog_name={athena_catalog}'
        # Create Athena engine
        engine = create_engine(athena_connection_str) 
    
        # connect and execute the SQL
        with engine.connect() as connection:
            result = connection.execute(text(sql))
            rows = result.all()
            final = str(rows)
        print("SUCCESSFUL EXECUTION")
    
    except Exception as e:
        print("ERROR ON EXECUTION")
        logger.error({e})
    return final


###################### STEP 4 ########################
#### SHOWCASE THE SQL RESULTS IN NATURAL LANGUAGE ####

def final_output(input, id):
    
    # the query comes through the API as encoded. Decode it to view in plain text. 
    user_query = urllib.parse.unquote(input)

    conversation_history = []
    conversation_history = read_history_from_dynamodb(table, id)
    
    final_query = generate_sql(user_query, id)
    
    print("FINAL GENERATED QUERY: ", final_query)
    
    # if query_status == 0:
    #     output = """I'm sorry, I'm unable to generate a query to answer your question. 
    #     This could be due to an unclear question, or reference to information that doesn't exist in your dataset. 
    #     Please rephrase your question to attempt another query."""
    
        
    results = execute_sql(final_query)
    
    print(" SQL QUERY RESULTS: ", results)


    # You are a helpful assistant providing users with information based on database 
    # results. Your goal is to answer questions conversationally, summarizing the data
    # clearly and concisely. When appropriate, share your insights on the result trends
    # and offer high level analysis. When possible, display the results in a table using
    # markdown syntax, and provide a short summary first. Avoid mentioning that the 
    # data comes from a SQL query, and focus on giving direct, natural responses 
    # to the user's question. 
    
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
    
    output_message, output = call_bedrock(prompt, conversation_history)
    
    print("OUTPUT FROM BEDROCK: ", output)
    
    # Create a new output for our conversation history that combines 
    # the SQL query with the summarized results for context. 
    memory_output = {
    'role': 'assistant', 
    'content': [{'text': " SQL QUERY: " + final_query + ". RESULTS: "+ output_message['content'][0]['text']}]
    }
    
    # Append the output message to the list of messages.
    convo_holder = create_convo_message(conversation_history)
    write_history_to_dynamodb(convo_holder, table, id)
    conversation_history.append(memory_output)
    
    convo_holder = create_convo_message(conversation_history)
    write_history_to_dynamodb(convo_holder, table, id)
    
    resp_json = {"answer": output, "sql_query": final_query}
    
    return resp_json

def lambda_handler(event, context):
    
    body = event.get('body', {})
    
    # If body is a string (e.g., from API Gateway), parse it
    if isinstance(body, str):
        body = json.loads(body)
    
    # pull the user's message and the generated id from the front end event
    prompt = body.get('message')
    generated_uuid = body.get('id')
    
    # Extract path parameters from the API Gateway event
    #path_parameters = event.get('pathParameters', {})
    
    # Extract specific values from the path
    #encodedPrompt = path_parameters.get('input', '')
    #generated_uuid = path_parameters.get('id', '')
    
    #output = {"answer": "THIS IS A SAMPLE ANSWER", "sql_query": "THIS IS A SAMPLE SQL QUERY"}
    
    output = final_output(prompt, generated_uuid)
    
    try:
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
        # Log the error
        print(f"Error: {str(e)}")
        
        return {
            'statusCode': 500,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',  # Enable CORS
            },
            'body': json.dumps({'message': 'Internal Server Error', 'error': str(e)})
        }
    