import { Construct } from "constructs";
import { App, Fn, TerraformStack, Token } from "cdktf";
import { resolve } from "path";
import { AwsProvider } from "@cdktf/provider-aws/lib/provider";
import { ArchiveProvider } from "@cdktf/provider-archive/lib/provider";
import { DataArchiveFile } from "@cdktf/provider-archive/lib/data-archive-file";
import { DataAwsIamPolicyDocument } from "@cdktf/provider-aws/lib/data-aws-iam-policy-document";
import { IamRole } from "@cdktf/provider-aws/lib/iam-role";
import { LambdaFunction } from "@cdktf/provider-aws/lib/lambda-function";
import { ApiGatewayRestApi } from "@cdktf/provider-aws/lib/api-gateway-rest-api";
import { ApiGatewayResource } from "@cdktf/provider-aws/lib/api-gateway-resource";
import { ApiGatewayMethod } from "@cdktf/provider-aws/lib/api-gateway-method";
import { LambdaPermission } from "@cdktf/provider-aws/lib/lambda-permission";
import { ApiGatewayIntegration } from "@cdktf/provider-aws/lib/api-gateway-integration";
import { ApiGatewayDeployment } from "@cdktf/provider-aws/lib/api-gateway-deployment";
import { ApiGatewayStage } from "@cdktf/provider-aws/lib/api-gateway-stage";

class MyStack extends TerraformStack {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    new AwsProvider(this, "aws", {
      region: "us-east-1"
    });

    new ArchiveProvider(this, "archive")

    const lambdaFile = new DataArchiveFile(this, "lambdaFile", {
      outputPath: "function.zip",
      sourceDir: resolve(__dirname, "./src"),
      // sourceFile: "index.js",
      type: "zip"
    })

    const assumeRole = new DataAwsIamPolicyDocument(this, "assumeRole", {
      statement: [
        {
          actions: ["sts:AssumeRole"],
          effect: "Allow",
          principals: [
            {
              identifiers: ["lambda.amazonaws.com"],
              type: "Service"
            }
          ]
        }
      ]
    })

    const role = new IamRole(this, "iamForLambda", {
      assumeRolePolicy: Token.asString(assumeRole.json),
      name: "iamForLambda"
    })

    const lambda = new LambdaFunction(this, "lambdaFunction", {
      functionName: "my-lambda-function",
      runtime: "nodejs18.x",
      handler: "index.handler",
      role: role.arn,
      sourceCodeHash: Token.asString(lambdaFile.outputBase64Sha256),
      filename: lambdaFile.outputPath
    })

    const api = new ApiGatewayRestApi(this, "api", {
      name: "myapi",
    });

    const resource = new ApiGatewayResource(this, "resource", {
      parentId: api.rootResourceId,
      pathPart: "resource",
      restApiId: api.id,
    });

    const method = new ApiGatewayMethod(this, "method", {
      authorization: "NONE",
      httpMethod: "POST",
      resourceId: resource.id,
      restApiId: api.id,
    });

    new LambdaPermission(this, "lambdaPermission", {
      action: "lambda:InvokeFunction",
      functionName: lambda.functionName,
      principal: "apigateway.amazonaws.com",
      sourceArn: `${api.executionArn}/*/${method.httpMethod}${resource.path}`,
      statementId: "AllowExecutionFromAPIGateway"
    })

    const integration = new ApiGatewayIntegration(this, "integration", {
      httpMethod: method.httpMethod,
      integrationHttpMethod: "POST", // só pode ser POST
      resourceId: resource.id,
      restApiId: api.id,
      type: "AWS_PROXY",
      uri: lambda.invokeArn
    })

    const deployment = new ApiGatewayDeployment(this, "deployment", {
      restApiId: api.id,
      lifecycle: {
        createBeforeDestroy: true,
      },
      triggers: {
        redeployment: Token.asString(
          Fn.sha1(
            Token.asString(
              Fn.jsonencode([
                resource.id,
                method.id,
                integration.id
              ])
            )
          )
        )
      }
    })

    new ApiGatewayStage(this, "stage", {
      restApiId: api.id,
      stageName: "prod",
      deploymentId: deployment.id,
    });
  }
}

const app = new App();
new MyStack(app, "cdktf-lambda-apigateway");
app.synth();
