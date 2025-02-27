import * as cdk from "aws-cdk-lib";
import * as cognito from "aws-cdk-lib/aws-cognito";
import { Construct } from "constructs";

/**
 * Authentication Stack
 * 
 * Purpose:
 * Provides authentication infrastructure using Amazon Cognito for our react web application.
 * 
 * Resources Created:
 * - Cognito User Pool:
 *   - Collection of users permitted to access the web application
 *   - Set to be destroyed when stack is destroyed
 * 
 * - Cognito User Pool Client:
 *   - 24-hour validity for access and ID tokens
 * 
 * Outputs:
 * - CognitoUserPoolId: Required for frontend configuration
 * - CognitoUserPoolWebClientId: Required for frontend configuration
 */

export class AuthStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly client: cognito.UserPoolClient;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const userPool = new cognito.UserPool(this, "UserPool", {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      selfSignUpEnabled: false,
      accountRecovery: cognito.AccountRecovery.NONE, 
    });

    const client = userPool.addClient("WebClient", {
      userPoolClientName: "webClient",
      idTokenValidity: cdk.Duration.days(1),
      accessTokenValidity: cdk.Duration.days(1),
      authFlows: {
        userPassword: true,
        userSrp: true,
        custom: true,
      },
    });

    this.userPool = userPool;
    this.client = client;

    new cdk.CfnOutput(this, "CognitoUserPoolId", {
      value: userPool.userPoolId,
      description: "userPoolId required for frontend settings",
    });
    new cdk.CfnOutput(this, "CognitoUserPoolWebClientId", {
      value: client.userPoolClientId,
      description: "clientId required for frontend settings",
    });
  }
}
