import * as cdk from "aws-cdk-lib";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as athena from 'aws-cdk-lib/aws-athena';
import * as waf from "aws-cdk-lib/aws-wafv2";
import * as agw from "aws-cdk-lib/aws-apigateway";
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from "constructs";
import * as path from "path";


/**
 * API Stack
 * 
 * Purpose:
 * Creates a secure API infrastructure with AWS API Gateway, Lambda, WAF protection,
 * and Cognito authentication integration. Our Lambda includes Natural Language Query (NLQ) capabilities
 * using AWS Athena and Bedrock.
 * 
 * Resources Created:
 * 
 * 1. API Gateway:
 *    - REST API with CORS enabled
 *    - Protected by Cognito authorizer
 * 
 * 2. Lambda Function:
 *    - NLQ Function:
 *      - Custom layer for PyAthena and SQLAlchemy
 *      - Permissions for S3, Athena, Glue, Bedrock, and DynamoDB
 * 
 * 3. WAF (Web Application Firewall):
 *    - Restricts traffic that can access our API endpoint
 *    - IP-based allowlist (set in cdk.json)
 *    - AWS Managed Rules:
 *      - Common Rule Set
 *      - IP Rule Set for allowed ranges
 * 
 * 4. API Endpoints:
 *    - POST /nlq: Natural Language Query endpoint
 *    Endpoint requires Cognito authentication
 * 
 * Required Props:
 * - userPool: Cognito User Pool for authentication
 * - tableName: DynamoDB table name
 * - athenaQueryBucketName: S3 bucket for Athena queries
 * - glueDatabaseName: Glue database name for Athena
 *
 */
 
interface APIStackProps extends cdk.StackProps {
  userPool: cognito.UserPool;
  tableName: string;
  athenaQueryBucketName: string;
  glueDatabaseName: string;
  workgroupName: string;
}

export class APIStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: APIStackProps) {
    super(scope, id, props);

    const authorizer = new agw.CognitoUserPoolsAuthorizer(this, "Authorizer", {
      cognitoUserPools: [props.userPool], // pass in the user pool created in our Auth stack
    });
    
    // Create the Lambda layer
    const layer = new lambda.LayerVersion(this, 'MyLambdaLayer', {
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/layer')),
      compatibleRuntimes: [lambda.Runtime.PYTHON_3_12],
      description: 'PyAthena and SQLAlchemy layer to support Natural Language Query (NLQ) in Athena',
    });
    
    // Create the Lambda function
    const lambdaFn = new lambda.Function(this, 'MyLambdaFunction', {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'lambda_function.lambda_handler',  
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/nlq')), 
      layers: [layer],
      timeout: cdk.Duration.seconds(300),
      environment: {
        ATHENA_OUTPUT: `s3://${props.athenaQueryBucketName}`, // use the S3 bucket created for Athena query results in our data stack
        GLUE_CATALOG: 'AwsDataCatalog', // use the default glue catalog
        GLUE_DB: props.glueDatabaseName, // use the glue database created in our Data stack
        TABLE_NAME: props.tableName, //use the DynamoDB table name created in our Data stack
        ATHENA_WORKGROUP: props.workgroupName, // use the Athena workgroup created in our Data stack
        MODEL_ID: 'us.anthropic.claude-3-sonnet-20240229-v1:0'
      }
    });
    
    // Add S3 permissions
    lambdaFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        's3:GetObject',
        's3:PutObject',
        's3:ListBucket',
        's3:GetBucketLocation',
        's3:ListBucketMultipartUploads',
        's3:ListMultipartUploadParts',
        's3:AbortMultipartUpload',
        's3:CreateBucket',
        'athena:StartQueryExecution',
        'athena:GetQueryExecution',
        'athena:GetQueryResults',
        'athena:StopQueryExecution',
        'glue:GetTable',
        'glue:GetPartition',
        'glue:GetPartitions',
        'glue:GetDatabase',
        'glue:GetTables',
        'bedrock:*',
        'dynamodb:*'
      ],
      resources: ['*']
    }));

    // Create a Web Application Firewall (WAF) to restrict traffic to our API endpoint 
    
    // Retrieve IP ranges from the CDK context (cdk.json)
    const ipRanges: string[] = scope.node.tryGetContext(
      "allowedIpAddressRanges"
    );

    const wafIPSet = new waf.CfnIPSet(this, `IPSet`, {
      name: "BackendWebAclIpSet",
      ipAddressVersion: "IPV4",
      scope: "REGIONAL",
      addresses: ipRanges,
    });

    // Create Web Access Control List (ACL)
    const apiWaf = new waf.CfnWebACL(this, "waf", {
      defaultAction: { block: {} },
      scope: "REGIONAL",
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        sampledRequestsEnabled: true,
        metricName: "ApiGatewayWAF",
      },
      rules: [
        // AWSManagedRulesCommonRuleSet
        {
          priority: 1,
          overrideAction: { none: {} },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: "AWS-AWSManagedRulesCommonRuleSet",
          },
          name: "AWSManagedRulesCommonRuleSet",
          statement: {
            managedRuleGroupStatement: {
              vendorName: "AWS",
              name: "AWSManagedRulesCommonRuleSet",
            },
          },
        },
        // AWSManagedRulesKnownBadInputsRuleSet
        // Only allow traffic from the IPs defined in our IP ranges
        {
          priority: 2,
          name: "BackendWebAclIpRuleSet",
          action: { allow: {} },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: "BackendWebAclIpRuleSet",
          },
          statement: {
            ipSetReferenceStatement: {
              arn: wafIPSet.attrArn,
            },
          },
        },
      ],
    });

    // Definition of API Gateway
    const api = new agw.RestApi(this, "api", {
      deployOptions: {
        stageName: "api",
      },
      defaultCorsPreflightOptions: {
        allowOrigins: agw.Cors.ALL_ORIGINS,
        allowMethods: agw.Cors.ALL_METHODS,
      },
      endpointConfiguration: {
        types: [agw.EndpointType.REGIONAL], 
      },
    });

    // Associate WAF with API Gateway
    const region = cdk.Stack.of(this).region;
    const restApiId = api.restApiId;
    const stageName = api.deploymentStage.stageName;
    new waf.CfnWebACLAssociation(this, "apply-waf-apigw", {
      webAclArn: apiWaf.attrArn,
      resourceArn: `arn:aws:apigateway:${region}::/restapis/${restApiId}/stages/${stageName}`,
    });

    // POST: /nlq
    const userinfoNLQ = api.root.addResource("nlq");
    userinfoNLQ.addMethod("POST", new agw.LambdaIntegration(lambdaFn), {
      authorizer: authorizer,
      authorizationType: agw.AuthorizationType.COGNITO,
    });
  }
}
