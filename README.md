# Natural Language Query with Amazon Bedrock (React SPA App)

## Overview

This sample shows how to make a React SPA application with AWS Cloud Development Kit (CDK) that hosts a chatbot for natural language query. 

Screenshots of this demo are shown below.

![screen-cognito](imgs/screen-cognito.png)
![screen-home](imgs/app-preview.PNG)

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

- npm
- cdk
- configuration of aws profile

## Getting started

### 1. Enable Amazon Bedrock model access 

- Navigate to the Amazon Bedrock console and select `Model Access` at the bottom of the left navigation pane. 
- Select `Enable specific model access` or `Modify model access` if you've visited this setting before.
- Check the `Claude 3 Sonnet` model under the Anthropic header. We'll use this model to generate SQL queries and return results in natural language. You are welcome to swap this model out for a model of your choice to test performance. 
- Select `Next` and choose `Submit`. 
- 
### 2. Clone the repository

- Run `git clone` command to download the source code

### 3. Deploy backend resources

- Run `npm install` command in the [backend](backend) directory.
- Run `cdk deploy --all` to deploy backend resouces.
  - You can deploy each stack individually like `cdk deploy AuthStack`.
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

### 4. Deploy frontend resources

#### 4.1 Build React app

- Run `npm install` command in the [frontend/web](frontend/web) directory.
- This React app uses environment variables to manage configuration settings. Follow these steps to set up your environment file:

  - In the [frontend/web](frontend/web) directory, create a new file named `.env`.
  
  - Open the `.env` file in your text editor.
  
  - Add your environment variables in the following format:
   ```sh
   # .env
   VITE_CLIENT_ID={Insert Cognito client ID from your AuthStack output}
   VITE_USER_POOL_ID={Insert Cognito user pool ID from your AuthStack output}
   VITE_API_ENDPOINT = {Insert API endpoint from your APIStack output}
   ```

- Run `npm run build` in the same directory to build react scripts.

#### 4.2 Deploy frontend resources

- Move to [frontend/provisioning](frontend/provisioning) directory and run `npm install` command.
- Run `cdk deploy --all` to deploy frontend resouces.
- When resouces are successfully deployed, FrontendStack.endpoint will be displayed in the terminal. You will access the app hosted on cloudfront/s3 by this url.

```sh
Outputs:
FrontendStack.endpoint = xxx.cloudfront.net
```

### 5. Create Cognito user

- In order to sign in the app, you need to create a new cognito user. You can create a user by AWS Management Console or AWS CLI.


## 


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
