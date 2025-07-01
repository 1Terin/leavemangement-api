# Leave Management API with Step Functions and TypeScript

A serverless Leave Management System built with AWS SAM, TypeScript, Lambda, API Gateway, DynamoDB, and Step Functions. It supports applying for leaves, sending approval/rejection emails, and handling approvals with JWT-based authorization.

## Table of Contents

1.  [Features](#features)
2.  [Architecture](#architecture)
3.  [Prerequisites](#prerequisites)
4.  [Project Structure](#project-structure)
5.  [Deployment](#deployment)
6.  [Configuration](#configuration)
7.  [Usage](#usage)
    * [Authentication](#authentication)
    * [Apply for Leave](#apply-for-leave)
    * [Approve/Reject Leave](#approve/reject-leave)
8.  [Contributing](#contributing)
9.  [License](#license)

## 1. Features

* **Leave Request Submission:** API endpoint to submit new leave requests.
* **Custom Authorizer:** Secure API endpoints using a custom Lambda authorizer.
* **Dynamic Workflow:** Leverages AWS Step Functions for a robust and stateful approval process.
* **Manager Approval Links:** Managers receive approval/rejection links via email that directly interact with the workflow.
* **DynamoDB Storage:** Stores leave request details in a DynamoDB table.
* **TypeScript & ESBuild:** Modern development with TypeScript and optimized bundling with Esbuild.


## 2. Architecture

The solution is built on a serverless architecture using AWS services:

* **AWS API Gateway:** Exposes RESTful endpoints for leave submission and approval/rejection actions.
* **AWS Lambda:**
    * `CustomAuthorizerLambda`: Handles authentication for API requests.
    * `ApplyLeaveFunction`: Processes new leave requests, stores them in DynamoDB, and initiates the Step Functions workflow.
    * `SendNotificationFunction`: Sends email notifications (e.g., approval requests to managers, status updates to users) via AWS SES.
    * `ProcessApprovalFunction`: Processes approval/rejection actions from the email links, updates DynamoDB, and sends success/failure signals back to Step Functions.
* **AWS Step Functions (`LeaveApprovalStateMachine`):** Orchestrates the multi-step leave approval workflow, including waiting for human approval.
* **Amazon DynamoDB (`LeaveRequestsTable`):** A NoSQL database storing leave request details (e.g., `requestId`, `status`, `taskToken`).
* **AWS SES (Simple Email Service):** Used by `SendNotificationFunction` for sending emails.
* **AWS X-Ray:** For distributed tracing and performance monitoring.



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

## 3. Prerequisites

- Node.js 20+
- AWS CLI and SAM CLI
- AWS account with SES verified email
- Postman for testing API
- Valid JWT secrets for auth setup

## 4. Project Structure

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
    │   |__ types                    # Shared TypeScript types (e.g., LeaveRequest)
    │   |    └── leave.ts
    |   |__ util
    |        |__ jwt.ts      
    ├── statemachine
    │   └── leave_approval_workflow.asl.json # AWS Step Functions workflow definition
    └── README.md

## 5. Deployment

```bash
# Build the application
sam build

# Deploy the stack
sam deploy --guided

```

## ⚙️ 6. Configuration

The following environment variables are configured in `template.yaml`:


### 🔐 CustomAuthorizerLambda

- **`JWT_SECRET`**: `your-super-secret-jwt-key`  
  This secret is used to sign and verify JWTs for authentication.

---

### 📥 ApplyLeaveFunction

- **`LEAVE_REQUESTS_TABLE_NAME`**:  
  The name of the DynamoDB table for leave requests (e.g., `LeaveRequestsTableProd`).

- **`STEP_FUNCTION_ARN`**:  
  The ARN of your deployed `LeaveApprovalStateMachine`.

---

### ✅ ProcessApprovalFunction

- **`LEAVE_REQUESTS_TABLE_NAME`**:  
  The name of the DynamoDB table for leave requests.

---

### ✉️ SendNotificationFunction

- **`SENDER_EMAIL`**: `"eg.terinchris2005@gmail.com"`  
  Make sure this email address is **verified in AWS SES**.

- **`API_GATEWAY_DOMAIN`**:  
  The domain of your deployed API Gateway (e.g., `xyz.execute-api.ap-south-1.amazonaws.com`).

- **`LEAVE_REQUESTS_TABLE_NAME`**:  
  The name of the DynamoDB table for leave requests.

## 📌 7. Usage

### 🔐 Authentication

This API uses a **custom JWT authorizer**.  
You need a valid JWT token signed with the `JWT_SECRET` used in `CustomAuthorizerLambda`.

You can obtain this token by authenticating against an identity provider or a custom login endpoint.

#### Example JWT Payload For User in js for jwt token

```
const jwt = require('jsonwebtoken');

const payload = {
  "userId": "user123",
  "email": "terinchris2005@gmail.com",
  "role": "user"
};

const secret = 'your-super-secret-jwt-key'; 

const token = jwt.sign(payload, secret, { algorithm: 'HS256' });

console.log(token);
```
#### Example JWT Payload For User in js for jwt token

```
const jwt = require('jsonwebtoken');

const payload = {
  "userId": "approver456",
  "email": "terinchris2005@gmail.com",
  "role": "approver"
};

const secret = 'your-super-secret-jwt-key'; 

const token = jwt.sign(payload, secret, { algorithm: 'HS256' });

console.log(token);
```

## 🔐 JWT Authorization

Sign the JWT payload using the same `JWT_SECRET` and pass it in the `Authorization` header as a Bearer token:

```http
Authorization: Bearer <YOUR_JWT_TOKEN>
```
## 📝 Apply for Leave

Submit a new leave request to the system.


### 🧾 Headers

```http
Content-Type: application/json
Authorization: Bearer <YOUR_JWT_TOKEN>

Body:
{
  "userId": "user123",
  "userEmail": "terinchris2005@gmail.com",
  "approverId": "approver456",
  "approverEmail": "terinchris2005@gmail.com",
  "leaveType": "Annual",
  "startDate": "2025-07-01",
  "endDate": "2025-07-05",
  "reason": "Family vacation"
}
```
🧾 Response


A JSON object confirming the request, including the generated requestId.

✅ Approve / ❌ Reject Leave


Approvers will receive an email with approval and rejection links after a leave request is submitted.
These links point to GET endpoints hosted on your API Gateway.

✅ Approve Link Example


```
YOUR_API_GATEWAY_URL/leaves/approve?requestId=<REQUEST_ID>&token=<TASK_TOKEN>
```

❌ Reject Link Example

```
YOUR_API_GATEWAY_URL/leaves/reject?requestId=<REQUEST_ID>&token=<TASK_TOKEN>
```

🧠 What Happens on Click


When a approver clicks the Approve or Reject link:

✅ Verifies the requestId and taskToken

🗃️ Updates the leave request status in DynamoDB

🔄 Notifies the Step Functions workflow:

SendTaskSuccess for approval

SendTaskFailure for rejection


## 🤝 8. Contributing

Feel free to contribute to this project by:

- Submitting issues for bugs or feature requests
- Forking the repository
- Creating a new branch
- Opening a pull request

Your contributions are welcome and appreciated!

---

## 📜 9. License

This project is licensed under the **MIT License**.  
See the [LICENSE](./LICENSE) file for more details.
