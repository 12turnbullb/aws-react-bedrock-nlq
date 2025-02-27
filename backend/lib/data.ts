import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as athena from 'aws-cdk-lib/aws-athena';
import * as glue from 'aws-cdk-lib/aws-glue';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import * as path from "path";

/**
 * Data Stack
 * 
 * Purpose:
 * Creates and manages the data infrastructure for Natural Language Querying (NLQ),
 * including data storage, query processing, and analytics capabilities.
 * 
 * Resources Created:
 * 
 * 1. DynamoDB Table:
 *    - Stores chat history
 * 
 * 2. S3 Buckets:
 *    - Sample Data Bucket: Stores sample donor data for analysis
 *    - Athena Query Bucket: Stores Athena query results
 * 
 * 3. AWS Glue Resources:
 *    - Database: Catalogs metadata for data sources
 *    - Crawler: Automatically catalogs the sample data in our sample data bucket
 *    - IAM Role: Permissions for Glue crawler operations
 * 
 * 4. Amazon Athena:
 *    - Workgroup: Manages and organizes query executions
 *    - Query result location configured to the Athena query bucket
 * 
 * 5. Lambda Functions:
 *    - Glue Crawler Trigger: Initiates the crawler during deployment
 *    - Athena Cleanup: Handles workgroup cleanup during stack deletion
 * 
 * Data Flow:
 * 1. Sample data uploaded to S3
 * 2. Glue crawler catalogs the data
 * 3. Athena enables SQL queries against the cataloged data
 * 4. Query results stored in dedicated S3 bucket
 * 
 * Cleanup Handling:
 * - Custom resources manage proper resource cleanup
 * - Athena workgroup cleaned up via dedicated Lambda
 * - S3 buckets configured for automatic object deletion
 * 
 * Exported Values (for use in API stack):
 * - DynamoDB table name
 * - Athena query bucket name
 * - Glue database name
 * 
 */


export class DataStack extends cdk.Stack {
    public readonly tableName: string;
    public readonly athenaQueryBucketName: string;
    public readonly glueDatabaseName: string;
    public readonly sampleDataBucket: s3.Bucket;
    public readonly workgroupName: string;

    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);
        
        this.tableName = `NLQ-chat-history-${this.stackName}`;
        
        // Create the DynamoDB table
        const table = new dynamodb.Table(this, 'MyDynamoDBTable', {
          tableName: this.tableName, 
          partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
          sortKey: { name: 'timestamp', type: dynamodb.AttributeType.STRING },
          billingMode: dynamodb.BillingMode.PROVISIONED, 
          readCapacity: 5,  
          writeCapacity: 5, 
          removalPolicy: cdk.RemovalPolicy.DESTROY, // Destroy table when stack is deleted
        });
        
        // Create S3 bucket for sample data
        const sampleDataBucket = new s3.Bucket(this, 'SampleDataBucket', {
          removalPolicy: cdk.RemovalPolicy.DESTROY,
          autoDeleteObjects: true,
        });
        
        // Upload local CSV data to the sample S3 bucket
        const dataUpload = new s3deploy.BucketDeployment(this, 'UploadCSV', {
          sources: [s3deploy.Source.asset(path.join(__dirname, '../sample_data'))], // Folder containing the CSV files
          destinationBucket: sampleDataBucket,
        });
        
        this.athenaQueryBucketName = `athena-results-bucket-cdk-stack-${this.account}`
        
        // Create S3 bucket for Athena query results
        const athenaQueryBucket = new s3.Bucket(this, 'AthenaQueryBucket', {
          bucketName: this.athenaQueryBucketName,
          removalPolicy: cdk.RemovalPolicy.DESTROY,
          autoDeleteObjects: true,
        });
        
        // Create Glue database to catalog our sample data 
        this.glueDatabaseName = `glue_database_${this.stackName.toLowerCase()}`;
        
        const glueDatabase = new glue.CfnDatabase(this, 'GlueDatabase', {
          catalogId: this.account, // AWS Account ID as the Glue catalog ID
          databaseInput: {
            name: this.glueDatabaseName, 
            description: 'A Glue database created using AWS CDK',
          },
        });
        
        // Create an IAM Role for the Glue Crawler
        const glueCrawlerRole = new iam.Role(this, 'GlueCrawlerRole', {
          assumedBy: new iam.ServicePrincipal('glue.amazonaws.com'),
          managedPolicies: [
            iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSGlueServiceRole'),
          ],
        });
        
        // Attach inline policy for additional S3 permissions
        glueCrawlerRole.addToPolicy(new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            's3:GetObject',
            's3:ListBucket',
            's3:PutObject',
          ],
          resources: [
            sampleDataBucket.bucketArn,
            `${sampleDataBucket.bucketArn}/*`,
          ],
        }));
            
        // Create Glue crawler to crawl the sample data S3 bucket
        const glueCrawler = new glue.CfnCrawler(this, 'GlueCrawler', {
          name: `GlueCrawler-${this.stackName}`,
          role:  glueCrawlerRole.roleArn,
          databaseName: this.glueDatabaseName,
          targets: {
            s3Targets: [{ path: `s3://${sampleDataBucket.bucketName}/` }],
          },
          tablePrefix: 'sample_',
        });
        
        // Create an Athena workgroup to segregate our queries from existing teams
        const workgroup = new athena.CfnWorkGroup(this, 'AthenaWorkgroup', {
          name: `AthenaWorkgroup-${this.stackName}`,
          description: 'Workgroup for Athena queries',
          state: 'ENABLED',
          workGroupConfiguration: {
            resultConfiguration: {
              outputLocation: `s3://${this.athenaQueryBucketName}/`,
            },
          },
        });
        
        this.workgroupName = workgroup.ref
        
        // Prevent direct deletion of the workgroup until explicitly removed by the custom resource (recusively empties query history then deletes)
        workgroup.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);
        
        // Create an IAM Role for our Glue crawler Lambda
        const lambdaRoleCrawler = new iam.Role(this, 'LambdaGlueCrawlerRole', {
          assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
          managedPolicies: [
            iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
            iam.ManagedPolicy.fromAwsManagedPolicyName('AWSGlueConsoleFullAccess'),
          ],
        });
    
        // Create Lambda function to trigger Glue Crawler
        const glueCrawlerTriggerLambda = new lambda.Function(this, 'GlueCrawlerTriggerLambda', {
          runtime: lambda.Runtime.PYTHON_3_12,
          handler: 'index.lambda_handler',
          code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/glueCrawlerTrigger')),
          role: lambdaRoleCrawler,
          timeout: cdk.Duration.seconds(120),
          environment: {
            CRAWLER_NAME: glueCrawler.ref, // Pass the Glue Crawler name as an environment variable
          },
        });

        // Custom Resource to trigger the crawler during stack deployment
        const glueTriggerResource = new cdk.CustomResource(this, 'TriggerGlueCrawler', {
          serviceToken: glueCrawlerTriggerLambda.functionArn,
        });
        
        // Ensure the crawler runs after the data upload to avoid crawling an empty bucket
        glueTriggerResource.node.addDependency(dataUpload);
        
        // Custom Lambda to clean up Athena workgroup on stack DELETE
        const cleanupLambda = new lambda.Function(this, 'AthenaWorkgroupCleanupLambda', {
          runtime: lambda.Runtime.PYTHON_3_12,
          handler: 'index.lambda_handler',
          code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/cleanupAthena')),
          timeout: cdk.Duration.minutes(5),
          environment: {
            WORKGROUP_NAME: workgroup.name,
          },
        });
        
        // Attach IAM permissions to allow the Lambda to delete Athena workgroups
        cleanupLambda.addToRolePolicy(new iam.PolicyStatement({
          actions: [
            "athena:ListWorkGroups",      
            "athena:GetWorkGroup",         
            "athena:DeleteWorkGroup",      
            "athena:ListNamedQueries",     
            "athena:DeleteNamedQuery"      
          ],
          resources: [`arn:aws:athena:${this.region}:${this.account}:workgroup/${workgroup.name}`]  
        }));
        
        // Custom Resource to trigger cleanup before stack deletion
        const cleanupResource = new cdk.CustomResource(this, 'CleanupAthenaWorkgroup', {
          serviceToken: cleanupLambda.functionArn,
        });
        
        // Ensure the workgroup is deleted AFTER cleanupResource runs
        workgroup.node.addDependency(cleanupResource);

        // Output values
        new cdk.CfnOutput(this, 'TableNameOutput', {
          value: this.tableName,
          exportName: `DynamoDBTable-${this.stackName}`,
        });
        
        new cdk.CfnOutput(this, 'SampleDataBucketOutput', {
          value: sampleDataBucket.bucketName,
          exportName: `SampleDataBucket-${this.stackName}`,
        });
    
        new cdk.CfnOutput(this, 'AthenaQueryBucketOutput', {
          value: this.athenaQueryBucketName,
          exportName: `AthenaQueryBucket-${this.stackName}`,
        });
        
        new cdk.CfnOutput(this, 'GlueDatabaseOutput', {
          value: this.glueDatabaseName,
          exportName: `GlueDatabase-${this.stackName}`,
        });
    
  }
}
