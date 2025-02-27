import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import * as customResources from "aws-cdk-lib/custom-resources";
import * as path from "path";
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';


export class FrontendStack extends cdk.Stack {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    const websiteBucket = new s3.Bucket(this, "WebsiteBucket", {
      websiteErrorDocument: "index.html",
      websiteIndexDocument: "index.html",
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
    });

    // const websiteIdentity = new cloudfront.OriginAccessIdentity(
    //   this,
    //   "WebsiteIdentity"
    // );
    // websiteBucket.grantRead(websiteIdentity);
    
    const webAclRef = new SsmParameterReader(this, "WebAclArnParameterReader", {
      parameterName: "WebAclArnParameter",
      region: "us-east-1",
    }).stringValue;

    const websiteDistribution = new cloudfront.Distribution(
      this,
      "WebsiteDistribution",
      {
        defaultRootObject: "index.html",
        errorResponses: [
          {
            httpStatus: 404,
            responseHttpStatus: 200,
            responsePagePath: "/index.html",
            ttl: cdk.Duration.seconds(300),
          },
        ],
        defaultBehavior: {
          origin: origins.S3BucketOrigin.withOriginAccessControl(websiteBucket) 
        }
      }
    );

    new s3deploy.BucketDeployment(this, "WebsiteDeploy", {
      sources: [
        //s3deploy.Source.asset(`${path.resolve(__dirname)}/../../web/build`),
        s3deploy.Source.asset(`${path.resolve(__dirname)}/../../my-react-app/dist`),
      ],
      destinationBucket: websiteBucket,
      distribution: websiteDistribution,
      distributionPaths: ["/*"],
      memoryLimit: 1024,
    });

    new cdk.CfnOutput(this, "endpoint", {
      description: "Frontend Endpoint",
      value: websiteDistribution.distributionDomainName,
    });
  }
}

interface SsmParameterReaderProps {
  parameterName: string;
  region: string;
}

class SsmParameterReader extends Construct {
  private reader: customResources.AwsCustomResource;

  get stringValue(): string {
    return this.getParameterValue();
  }

  constructor(scope: Construct, name: string, props: SsmParameterReaderProps) {
    super(scope, name);

    const { parameterName, region } = props;

    const customResource = new customResources.AwsCustomResource(
      this,
      `${name}CustomResource`,
      {
        policy: customResources.AwsCustomResourcePolicy.fromStatements([
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ["ssm:GetParameter*"],
            resources: [
              cdk.Stack.of(this).formatArn({
                service: "ssm",
                region,
                resource: "parameter",
                resourceName: parameterName.replace(/^\/+/g, ""),
              }),
            ],
          }),
        ]),
        onUpdate: {
          service: "SSM",
          action: "getParameter",
          parameters: {
            Name: parameterName,
          },
          region,
          physicalResourceId: customResources.PhysicalResourceId.of(
            Date.now().toString()
          ),
        },
      }
    );

    this.reader = customResource;
  }

  private getParameterValue(): string {
    return this.reader.getResponseField("Parameter.Value");
  }
}
