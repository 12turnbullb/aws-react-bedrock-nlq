import boto3
import os
import json

def lambda_handler(event, context):

    # Define CORS headers
    headers = {
        'Access-Control-Allow-Origin': '*',  # Allow requests from any origin
        'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
        'Access-Control-Allow-Methods': 'OPTIONS,POST,GET'
    }
    
    # Handle preflight OPTIONS request
    if event.get('httpMethod') == 'OPTIONS':
        return {
            'statusCode': 200,
            'headers': headers,
            'body': json.dumps({})
        }
    

    
    try:
        # Extract the body from the event if it exists (API Gateway integration)
        if 'body' in event and event['body']:
            if isinstance(event['body'], str):
                body = json.loads(event['body'])
            else:
                body = event['body']
            
            user_prompt = body.get('message')
            session_id = body.get('kb_session_id')
        else:
            # Direct Lambda invocation
            user_prompt = event.get('message')
            session_id = body.get('kb_session_id')

        
        if not user_prompt:
            return {
                'statusCode': 400,
                'headers': headers,
                'body': json.dumps({'error': 'Missing required parameter: user_prompt'})
            }
        
        # Invoke the model and get the response
        response_output, sql_query, response_session_id = invoke_model(user_prompt, session_id)
        
        # Return the response with CORS headers
        return {
            'statusCode': 200,
            'headers': headers,
            'body': json.dumps({
                'answer': response_output,
                'sql_query': sql_query,
                'kb_session_id': response_session_id
            })
        }
    
    except Exception as e:
        # Handle any errors with CORS headers
        return {
            'statusCode': 500,
            'headers': headers,
            'body': json.dumps({'error': str(e)})
        }

def invoke_model(user_prompt, session_id):
    """
    Invokes the Bedrock model with knowledge base integration.
    
    Parameters:
    - user_prompt: The user's input text
    - session_id: Optional session ID for continuing a conversation
    
    Returns:
    - Tuple containing (response_output, response_session_id)
    """
    # Initialize Bedrock clients
    bedrock = boto3.client(service_name='bedrock-runtime', region_name="us-east-1")
    agent_client = boto3.client(service_name='bedrock-agent-runtime', region_name="us-east-1")
    
    # Get the knowledge base ID from environment variables
    knowledge_base_id = os.environ.get('KNOWLEDGE_BASE_ID')
    modelArn = os.environ.get('MODEL_ID')

    retrieve_and_generate_args = {
        'input': {
            'text': user_prompt,
        },
        'retrieveAndGenerateConfiguration': {
            'type': 'KNOWLEDGE_BASE',
            'knowledgeBaseConfiguration': {
                'knowledgeBaseId': knowledge_base_id,
                'modelArn': modelArn,
            }
        }
    }

    # Include session_id in the arguments when the session_id has been retrieved after the first turn
    if session_id:
        retrieve_and_generate_args['sessionId'] = session_id

    # Pass our arguments to the bedrock knowledge bases retrieve and generate request
    response = agent_client.retrieve_and_generate(**retrieve_and_generate_args)

    response_output = response['output']['text']

    sql_sample = response["citations"][0]["retrievedReferences"][0]["location"]["sqlLocation"]["query"]

    response_session_id = response.get('sessionId')

    sql_query = "select * from sample"

    return response_output, sql_sample, response_session_id 
