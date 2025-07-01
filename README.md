Leave Management API with Step Functions and TypeScript

This project implements a serverless Leave Management API on AWS, leveraging API Gateway, AWS Lambda, DynamoDB, and AWS Step Functions to manage the leave request and approval workflow. It is built using TypeScript and deployed with the AWS Serverless Application Model (SAM).

Table of Contents
Features

Architecture

Prerequisites

Project Structure

Deployment

Configuration

Usage

Authentication

Apply for Leave

Approve/Reject Leave

Testing

Outputs

Contributing

License

1. Features
Leave Request Submission: API endpoint to submit new leave requests.

Custom Authorizer: Secure API endpoints using a custom Lambda authorizer.

Dynamic Workflow: Leverages AWS Step Functions for a robust and stateful approval process.

Email Notifications: Sends email notifications for leave approvals and rejections.

Manager Approval Links: Managers receive approval/rejection links via email that directly interact with the workflow.

DynamoDB Storage: Stores leave request details in a DynamoDB table.

TypeScript & ESBuild: Modern development with TypeScript and optimized bundling with Esbuild.

Tracing: Active AWS X-Ray tracing for better observability.

2. Architecture
The solution is built on a serverless architecture using AWS services:

AWS API Gateway: Exposes RESTful endpoints for leave submission and approval/rejection actions.

AWS Lambda:

CustomAuthorizerLambda: Handles authentication for API requests.

ApplyLeaveFunction: Processes new leave requests, stores them in DynamoDB, and initiates the Step Functions workflow.

SendNotificationFunction: Sends email notifications (e.g., approval requests to managers, status updates to users) via AWS SES.

ProcessApprovalFunction: Processes approval/rejection actions from the email links, updates DynamoDB, and sends success/failure signals back to Step Functions.

AWS Step Functions (LeaveApprovalStateMachine): Orchestrates the multi-step leave approval workflow, including waiting for human approval.

Amazon DynamoDB (LeaveRequestsTable): A NoSQL database storing leave request details (e.g., requestId, status, taskToken).

AWS SES (Simple Email Service): Used by SendNotificationFunction for sending emails.

AWS X-Ray: For distributed tracing and performance monitoring.

Code snippet

graph TD
    A[Client] -->|HTTP Request| B(API Gateway)
    B -->|Authorization| C(CustomAuthorizerLambda)
    C -->|Authorized| B
    B -->|POST /leaves| D(ApplyLeaveFunction)
    D --> E[DynamoDB: LeaveRequestsTable]
    D --> F[Step Functions: LeaveApprovalStateMachine]
    F --> G(SendNotificationFunction)
    G --> H[AWS SES]
    H --> I[Approver's Email]

    I --> J[Approval/Rejection Link Clicked]
    J --> B
    B -->|GET /leaves/approve or /reject| K(ProcessApprovalFunction)
    K --> E
    K --> F
    F --> L(SendNotificationFunction)
    L --> H
    H --> M[Requester's Email]
3. Prerequisites
To deploy and run this application, you need the following:

AWS CLI installed and configured with appropriate credentials.

AWS SAM CLI installed.

Node.js 20.x or later.

npm (comes with Node.js).

An AWS SES verified identity (email address or domain) configured in the region you are deploying to, as this is used by the SendNotificationFunction.

4. Project Structure
.
├── swagger.yaml                 # OpenAPI definition for API Gateway
├── template.yaml                # SAM template for infrastructure definition
├── package.json
├── tsconfig.json
├── src
│   ├── functions
│   │   ├── apply-leave          # Lambda for submitting new leave requests
│   │   │   └── app.ts
│   │   ├── custom-authorizer    # Lambda for API Gateway custom authorization
│   │   │   └── app.ts
│   │   ├── process-approval     # Lambda for processing leave approvals/rejections
│   │   │   └── app.ts
│   │   └── send-notification    # Lambda for sending email notifications
│   │       └── app.ts
│   └── types                    # Shared TypeScript types (e.g., LeaveRequest)
│       └── leave.ts
├── statemachine
│   └── leave_approval_workflow.asl.json # AWS Step Functions workflow definition
└── README.md
5. Deployment
Follow these steps to deploy the application to your AWS account:

Clone the repository:

Bash

git clone <your-repo-url>
cd <your-repo-name>
Install dependencies:

Bash

npm install
Build the project using SAM CLI:

Bash

sam build --use-container # Use --use-container if you have native dependencies or issues with local build environment
Deploy the application:
During deployment, SAM CLI will guide you through the process. You may be prompted for:

Stack Name: A unique name for your CloudFormation stack (e.g., LeaveManagementStack).

AWS Region: The AWS region to deploy to (e.g., ap-south-1).

LeaveRequestsTableNameParam: You can use the default (LeaveRequestsTableProd) or provide a custom name.

ExternalDependencies: Keep the default (@aws-sdk/*) unless you have specific reasons to change it.

Confirm changes before deploy: Type y to proceed.

Allow SAM CLI to create IAM roles: Type y (required for the Lambda execution roles).

Save arguments to samconfig.toml: Type y (recommended for easier redeployment).

Bash

sam deploy --guided
Important: After deployment, note the LeaveManagementApiUrl from the SAM CLI output or the CloudFormation stack outputs. This is your API Gateway base URL.

6. Configuration
The following environment variables are configured in template.yaml:

Global Variables (for all Lambda functions):

NODE_OPTIONS: --enable-source-maps: Enables source maps for better debugging in CloudWatch.

CustomAuthorizerLambda:

JWT_SECRET: your-super-secret-jwt-key - CHANGE THIS IN PRODUCTION! This secret is used to sign and verify JWTs for authentication.

ApplyLeaveFunction:

LEAVE_REQUESTS_TABLE_NAME: The DynamoDB table name for leave requests (e.g., LeaveRequestsTableProd).

STEP_FUNCTION_ARN: The ARN of your deployed LeaveApprovalStateMachine.

ProcessApprovalFunction:

LEAVE_REQUESTS_TABLE_NAME: The DynamoDB table name.

SendNotificationFunction:

SENDER_EMAIL: "terinchris2005@gmail.com" - Ensure this email address is verified in AWS SES.

API_GATEWAY_DOMAIN: The domain of your deployed API Gateway.

LEAVE_REQUESTS_TABLE_NAME: The DynamoDB table name.

7. Usage
Once deployed, you can interact with the API endpoints. Replace YOUR_API_GATEWAY_URL with the LeaveManagementApiUrl obtained after deployment.

Authentication
This API uses a custom authorizer. You will need to obtain a JWT token, likely by authenticating against a separate identity provider or an endpoint that issues these tokens. The CustomAuthorizerLambda uses JWT_SECRET for verification.

Example JWT payload (replace with your actual user data):

JSON

{
  "userId": "testuser",
  "email": "testuser@example.com",
  "roles": ["user"]
}
You would then sign this payload with the JWT_SECRET configured in your CustomAuthorizerLambda and pass it in the Authorization header as a Bearer token.

Apply for Leave
Submit a new leave request.

Endpoint: POST YOUR_API_GATEWAY_URL/leaves

Headers:

Content-Type: application/json

Authorization: Bearer <YOUR_JWT_TOKEN>

Request Body Example:

JSON

{
    "userId": "user123",
    "userEmail": "user123@example.com",
    "startDate": "2025-08-01",
    "endDate": "2025-08-05",
    "leaveType": "Vacation",
    "reason": "Family trip",
    "approverId": "manager456",
    "approverEmail": "manager456@example.com"
}
Response: A JSON object confirming the request, including the requestId.

Approve/Reject Leave
Managers will receive an email with approval/rejection links. These are GET requests to your API Gateway.

Approve Link Example:
YOUR_API_GATEWAY_URL/leaves/approve?requestId=<REQUEST_ID>&token=<TASK_TOKEN>

Reject Link Example:
YOUR_API_GATEWAY_URL/leaves/reject?requestId=<REQUEST_ID>&token=<TASK_TOKEN>

When these links are clicked (or opened in a browser), the ProcessApprovalFunction will:

Verify the requestId and token.

Update the leave request status in DynamoDB.

Notify the Step Functions workflow (SendTaskSuccess or SendTaskFailure).

Return an HTML page (for browsers) or JSON response (for programmatic calls) indicating the status update.

8. Testing
Local Testing: Use sam local start-api to run your API Gateway locally and test Lambda functions.

Unit/Integration Tests: Implement unit tests for individual Lambda functions and integration tests for the overall workflow.

Trace with X-Ray: Use AWS X-Ray to monitor the performance and identify bottlenecks in your workflow executions.

9. Outputs
After successful deployment, SAM CLI will output key resource ARNs and URLs:

LeaveManagementApiUrl: The base URL of your API Gateway.

LeaveApprovalStateMachineArn: The ARN of your Step Functions State Machine.

LeaveRequestsTableName: The name of your DynamoDB table.

10. Contributing
Feel free to contribute to this project by submitting issues or pull requests.

11. License
This project is licensed under the MIT License. See the LICENSE file for details.

