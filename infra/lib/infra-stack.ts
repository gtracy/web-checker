import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subs from 'aws-cdk-lib/aws-sns-subscriptions';
import * as path from 'path';
import { Construct } from 'constructs';

export class PatagoniaScraperStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // 1. S3 Bucket for State
    const bucket = new s3.Bucket(this, 'PatagoniaStateBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // For easy cleanup during dev, use RETAIN for prod
      autoDeleteObjects: true, // For easy cleanup during dev
    });

    // 4. SNS Topic for Alerts
    const topic = new sns.Topic(this, 'NewItemsTopic', {
      displayName: 'Patagonia Worn Wear Alerts'
    });

    // 5. Email Subscription
    const emailAddress = process.env.ALERT_EMAIL;
    if (!emailAddress) {
      throw new Error('ALERT_EMAIL environment variable is required');
    }
    topic.addSubscription(new subs.EmailSubscription(emailAddress));

    // 2. Lambda Function
    const scraperLambda = new nodejs.NodejsFunction(this, 'ScraperFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../src/index.js'), // Point to the src/index.js
      timeout: cdk.Duration.minutes(3),
      memorySize: 2048, // Puppeteer needs generous memory
      environment: {
        STATE_BUCKET_NAME: bucket.bucketName,
        SNS_TOPIC_ARN: topic.topicArn,
        LOG_LEVEL: 'info',
        // Common Puppeteer env vars for better Lambda performance
        // 'HOME': '/tmp', // Sometimes needed for cache
      },
      bundling: {
        externalModules: [
          '@sparticuz/chromium', // Exclude if using layer, but here we bundle it since it's in node_modules
          'puppeteer-core' // Same, usually safer to bundle if not using layer
        ],
      },
    });

    // Grant Lambda permissions to S3
    bucket.grantReadWrite(scraperLambda);

    // Grant Lambda permissions to SNS
    topic.grantPublish(scraperLambda);

    // 3. EventBridge Rule (Hourly)
    const rule = new events.Rule(this, 'ScraperSchedule', {
      schedule: events.Schedule.rate(cdk.Duration.hours(1)),
    });

    rule.addTarget(new targets.LambdaFunction(scraperLambda));
  }
}
