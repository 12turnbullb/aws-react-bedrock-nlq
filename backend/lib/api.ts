import * as cdk from "aws-cdk-lib";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as waf from "aws-cdk-lib/aws-wafv2";
import * as agw from "aws-cdk-lib/aws-apigateway";
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from "constructs";
import * as path from "path";


interface APIStackProps extends cdk.StackProps {
  userPool: cognito.UserPool;
  tableName: string;
  athenaQueryBucketName: string;
  glueDatabaseName: string;
}


export class APIStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: APIStackProps) {
    super(scope, id, props);

    const authorizer = new agw.CognitoUserPoolsAuthorizer(this, "Authorizer", {
      cognitoUserPools: [props.userPool],
    });

    // Definition of lambda function
    const getTimeFunction = new lambdaNodejs.NodejsFunction(this, "getTime", {
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      entry: "./lambda/time/get.ts",
    });
    
    
    // Create the Lambda layer
    const layer = new lambda.LayerVersion(this, 'MyLambdaLayer', {
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/layer')),
      compatibleRuntimes: [lambda.Runtime.PYTHON_3_11],
      description: 'PyAthena and SQLAlchemy layer to support Natural Language Query (NLQ) in Athena',
    });
    
    // Create the Lambda function
    const lambdaFn = new lambda.Function(this, 'MyLambdaFunction', {
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: 'lambda_function.lambda_handler',  // Assumes your handler function is named 'lambda_handler'
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/nlq')), 
      layers: [layer],
      timeout: cdk.Duration.seconds(300),
      environment: {
        ATHENA_OUTPUT: props.athenaQueryBucketName,
        ATHENA_CATALOG: 'AwsDataCatalog',
        ATHENA_DB: props.glueDatabaseName,
        TABLE_NAME: props.tableName //use the DynamoDB table name created in a previous stack
      }
    });
    
    // Add S3 permissions
    lambdaFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        's3:GetObject',
        's3:PutObject',
        's3:ListBucket',
        'athena:StartQueryExecution',
        'athena:GetQueryExecution',
        'athena:GetQueryResults',
        'athena:StopQueryExecution',
        'glue:GetTable',
        'glue:GetPartition',
        'glue:GetPartitions',
        'glue:GetDatabase',
        'bedrock:*',
        'dynamodb:*'
      ],
      resources: ['*']
    }));

    // Definition of WAF
    const ipRanges: string[] = scope.node.tryGetContext(
      "allowedIpAddressRanges"
    );

    const wafIPSet = new waf.CfnIPSet(this, `IPSet`, {
      name: "BackendWebAclIpSet",
      ipAddressVersion: "IPV4",
      scope: "REGIONAL",
      addresses: ipRanges,
    });

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
    });

    // Associate WAF with API Gateway
    const region = cdk.Stack.of(this).region;
    const restApiId = api.restApiId;
    const stageName = api.deploymentStage.stageName;
    new waf.CfnWebACLAssociation(this, "apply-waf-apigw", {
      webAclArn: apiWaf.attrArn,
      resourceArn: `arn:aws:apigateway:${region}::/restapis/${restApiId}/stages/${stageName}`,
    });

    // GET: /time
    const userinfo = api.root.addResource("time");
    userinfo.addMethod("GET", new agw.LambdaIntegration(getTimeFunction), {
      authorizer: authorizer,
      authorizationType: agw.AuthorizationType.COGNITO,
    });
    
    // POST: /nlq
    const userinfoNLQ = api.root.addResource("nlq");
    userinfoNLQ.addMethod("POST", new agw.LambdaIntegration(lambdaFn), {
      authorizer: authorizer,
      authorizationType: agw.AuthorizationType.COGNITO,
    });
  }
}
