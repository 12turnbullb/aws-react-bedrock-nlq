# Natural Language Query with Amazon Bedrock (React SPA App)

## Overview

This sample shows how to make a React single-page application (SPA) with the AWS Cloud Development Kit (CDK) that hosts a chatbot for natural language query of structured data.

Screenshots of this demo are shown below.

![screen-cognito](imgs/screen-cognito.png)
![screen-home](imgs/app-preview.PNG)

---

## Architecture

There are four cdk stacks:

- AuthStack
  - Amazon Cognito
- DataStack
  - Amazon S3 bucket, Amazon DynamoDB, AWS Glue Crawlers, Amazon Athena
- APIStack
  - Amazon API Gateway, AWS WAF, AWS Lambda
- FrontendStack
  - Amazon CloudFront, AWS WAF, Amazon S3

![Architecture](imgs/nlq-architecture.PNG)

1. AWS Glue crawls the data stores and adds schema and table metadata to the Glue data catalog.

2. The user is authenticated via Amazon Cognito.

3. The client fetches the static, single page application (SPA) hosted in S3. Client IPs are validated by the WAF.

4. The user submits a question through the React user interface.

5. The Cognito session authorizes a POST call to API Gateway. The WAF uses the standard ruleset to evaluate the traffic.

6. AWS Lambda receives the API gateway event and orchestrates the backend.

7. The conversation history is pulled from DynamoDB as context.

8. Amazon Bedrock uses the metadata from the data store + the user’s question as context to generate a SQL query. The SQL query is tested. If an error occurs, the LLM generates a new query and tests again. This retry loop can occur up to 3 times.

9. The generated SQL query is executed with Amazon Athena against the original data store.

10. The SQL query result is returned to Amazon Bedrock and is used as context to generate a conversational response to the user’s query.

11. The response is submitted through the front-end to the user.

## Directory Structures

```sh
.
├── backend          # CDK scripts for backend resources
└── frontend
    ├── provisioning # CDK scripts for frontend resources
    └── web          # React scripts
```

## Main Libraries

- @aws-amplify/ui-components
- @aws-amplify/ui-react
- aws-amplify
- aws-cdk
- aws-lambda
- jest
- react
- react-scripts
- ts-node
- typescript

## Prerequisites

Ensure that the following tools are installed before proceeding:

- **AWS CLI**: version `2.15.41`
- **AWS CDK**: version `2.170.0`
- **AWS Profile**: aws credentials configured

```
npm install
sudo npm install -g aws-cdk
```

---

## Let's Get Started!

### 1. Enable Amazon Bedrock model access

- Navigate to the Amazon Bedrock console and select `Model Access` at the bottom of the left navigation pane.
- Select `Enable specific model access` or `Modify model access` if you've visited this setting before.
- Check the `Claude 3 Sonnet` model under the Anthropic header. We'll use this model to generate SQL queries and return results in natural language. You are welcome to swap in an Amazon Bedrock model of your choice in the environment variables of the API's Lambda function.
- Select `Next` and choose `Submit`.

---

### 2. Clone the repository

- Run `git clone` command to download the source code

```bash
git clone https://github.com/aws-samples/aws-react-api-nlq.git
```

---

### 3. Deploy backend resources

- Run `npm install` command in the [backend](backend) directory.

```bash
cd aws-react-spa-nlq/backend
npm install
```

- Run `cdk deploy --all` to deploy backend resouces.
  - You can deploy each stack individually like `cdk deploy AuthStack`.

```bash
cdk deploy --all
```

- When resouces are successfully deployed, outputs such as APIStack.CognitoUserPoolId will be shown in the terminal. These values will be used to deploy frontend resouces.

```sh
Outputs:
APIStack.CognitoUserPoolId = xxx
APIStack.CognitoUserPoolWebClientId = xxx
APIStack.ExportsOutputFnGetAttUserPoolxxx = xxx
...
Outputs:
AuthStack.apiEndpointxxx = xxx
```

---

### 4. Deploy frontend resources

#### 4.1 Build React app

- Run `npm install` command in the [frontend/web](frontend/web) directory.

```bash
cd aws-react-spa-nlq/frontend/web
npm install
```

- This React app uses environment variables to manage configuration settings. Follow these steps to set up your environment file:

  - In the [frontend/web](frontend/web) directory, create a new file named `.env`.

  - Open the `.env` file in your text editor.

  - Add your environment variables in the following format:

  ```sh
  # .env
  VITE_CLIENT_ID= **Insert Cognito client ID from your AuthStack output**

  VITE_USER_POOL_ID= **Insert Cognito user pool ID from your AuthStack output**

  VITE_API_ENDPOINT =  **API endpoint from your APIStack output**
  ```

- Run `npm run build` in the same directory to build react scripts.

```bash
npm run build
```

---

#### 4.2 Deploy frontend resources

- Move to [frontend/provisioning](frontend/provisioning) directory and run `npm install` command.

```bash
cd aws-react-spa-nlq/frontend/provisioning
npm install
```

- Run `cdk deploy --all` to deploy frontend resouces.

```bash
cdk deploy --all
```

- When resouces are successfully deployed, FrontendStack.endpoint will be displayed in the terminal. You will access the app hosted on cloudfront/s3 by this url.

```sh
Outputs:
FrontendStack.endpoint = xxx.cloudfront.net
```

---

## Post-Deployment Instructions

### Create Cognito user

- In order to sign in the app, you need to create a new cognito user. You can create a user by AWS Management Console or AWS CLI.

## Experimenting with the Chatbot

### Sample Data

The sample dataset follows a dimensional model of synthetic donor data. Donation transactions are stored in a central fact table with auxillary information like donors, events, campaigns and payment method stored in dimension tables.

![donor-data-erd](imgs/donor-erd.PNG)

### Sample Questions

Try some of the following sample questions to test the chatbot in it's SQL generation and execution skills. Navigate to the Cloudwatch logs of the ApiStack Lambda function to review more detailed logging.

1. Which campaign had the highest total donation amount?
2. What payment method was used most frequently?

---

## Improving NLQ Performance

### Metadata retrieval

When running an NLQ pipeline, the most important contribution is metadata about your structured data so that the LLM has enough context to accurately structure SQL. There are multiple methods for retrieving data store metadata such as referencing flat file documentation, dynamically retrieving schema details, or leveraging RAG for vectorized metadata.

This project simply retrieves column name and data types from our crawled data in the AWS Glue Data Catalog via the AWS SDK. This works because the data is simple enough for the LLM to interpret by column name. However, if you want to add more data source context, consider structuring a text file with metadata that the LLM can reference instead. AS your dataset matures and evolves, consider a RAG pipeline for metadata retrieval.

### Sample queries

Another component of our NLQ pipeline is supplying sample queries so that the LLM can learn how to strucutre SQL based on examples. Our Lambda function includes a sample_prompts.py file that lists a single sample query. This is injected into our prompt that's sent to the LLM, an example of few-shot prompting.

You can add more sample queries and test the resulting performance of the chatbot. This is useful if you expect users to ask similar questions and you want to guide the LLM to use a specific SQL query, or if you have a nuanced edge case that the LLM is struggling to compile SQL for.

## Chat History

Collecting and storing chat history is important for 1) maintaing relevant context during the user chat and 2) reviewing chat logs to trend user questions and analyze performance.

In this sample project, we use DynamoDB to store chat history for each chat session, which is defined as the period between page refreshes. Each time the page is refreshed, a new session ID is created and the chats are stored according to that session ID.

We have two function in our Lambda script, one to write chat history to dynamoDB and one to read from it. At the end of our NLQ pipeline, we write relevant context to DyanmoDB for the subsequent chat to use. Before each Amazon Bedrock call, we pass in the latest conversation history from DynamoDB as context.  

## Security

### Restrict Access by IP

cdk.json lists the specific IPs to restrict API access to your API Gateway through the AWS Web Application Firewall (WAF). By default the WAF allows all IPv4 traffic. Updates these IPs if neccesary.

## Testing

We use the Jest framework to build test cases for this CDK.

To run backend tests, simply run `npm test` to execute the test scripts in the [backend/test](backend/test) directory. By default, the test script checks a simple synthesis for each CDK stack Update this test script if neccesary.

## Troubleshooting

### API Gateway timeouts

Given the retry loop design, some queries may take longer than the 29 second API Gateway timeout setting to return a result. You may wish to increase the API Gateway timeout by updating the service quota titled `Maximum integration timeout in milliseconds`.

See [CONTRIBUTING](CONTRIBUTING.md#security-issue-notifications) for more information.

## License

This library is licensed under the MIT-0 License. See the LICENSE file.
