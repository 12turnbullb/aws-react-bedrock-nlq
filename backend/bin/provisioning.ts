#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { APIStack } from "../lib/api";
import { AuthStack } from "../lib/auth";
import { DataStack } from "../lib/data";

const app = new cdk.App();
const env = {
  region: "us-east-1", //select the deployment region for resources
};

// Create the authentication stack
const auth = new AuthStack(app, "AuthStack", { env }); 

//Create the data stack
const data = new DataStack(app, "DataStack", { env });

//Create the API stack
//Pass in resource context from previous stacks
new APIStack(app, "APIStack", { 
  userPool: auth.userPool,
  tableName: data.tableName,
  athenaQueryBucketName: data.athenaQueryBucketName,
  glueDatabaseName: data.glueDatabaseName,
  env,
});