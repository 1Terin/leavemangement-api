import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { UpdateCommand, GetCommand, DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { SFNClient, SendTaskSuccessCommand, SendTaskFailureCommand } from "@aws-sdk/client-sfn";
import { LeaveRequest } from '../../types/leave';

const ddbClient = new DynamoDBClient({});
const ddbDocClient = DynamoDBDocumentClient.from(ddbClient);
const sfnClient = new SFNClient({});

const LEAVE_REQUESTS_TABLE = process.env.LEAVE_REQUESTS_TABLE_NAME;

export const handler = async (event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> => {
  console.log("🚀 Received request to ProcessApprovalFunction", JSON.stringify(event));
  console.log("🔍 Incoming event:", JSON.stringify(event, null, 2));

  if (!LEAVE_REQUESTS_TABLE) {
    console.error("Environment variable LEAVE_REQUESTS_TABLE_NAME not set.");
    return {
      statusCode: 500,
      body: JSON.stringify({ message: "Configuration error." }),
    };
  }

  const requestId = event.pathParameters?.requestId;
  const taskToken = decodeURIComponent(event.queryStringParameters?.token || "");

  const path = event.path || '';
  let action: "approve" | "reject" | null = null;

  if (path.endsWith('/approve')) {
    action = "approve";
  } else if (path.endsWith('/reject')) {
    action = "reject";
  }

  if (!requestId || !taskToken || !action) {
    console.warn("Missing requestId, taskToken, or action in request:", { requestId, taskToken, action, path });
    return {
      statusCode: 400,
      body: JSON.stringify({ message: "Invalid approval/rejection link." }),
    };
  }

  try {
    console.log("🧾 Table name:", LEAVE_REQUESTS_TABLE);
    console.log("🔑 requestId to fetch:", requestId);
    const getCommand = new GetCommand({
      TableName: LEAVE_REQUESTS_TABLE,
      Key: { requestId },
    });

    const { Item } = await ddbDocClient.send(getCommand);
    console.log("📦 Retrieved item from DynamoDB:", JSON.stringify(Item, null, 2));
    const leaveRequest = Item as LeaveRequest | undefined;

    const storedToken = decodeURIComponent(leaveRequest?.taskToken || '');

    if (!leaveRequest || leaveRequest.status !== 'Pending' || storedToken !== taskToken) {
      console.warn("❌ Invalid/expired leave request or mismatched token:", { requestId, taskToken, storedToken });
      return {
        statusCode: 403,
        body: JSON.stringify({ message: "This leave request is no longer pending or the approval link is invalid/expired." }),
      };
    }

    const newStatus = action === 'approve' ? 'Approved' : 'Rejected';
    const updateCommand = new UpdateCommand({
      TableName: LEAVE_REQUESTS_TABLE,
      Key: { requestId },
      UpdateExpression: "SET #status = :newStatus, updatedAt = :updatedAt, taskToken = :nullToken",
      ExpressionAttributeNames: {
        "#status": "status",
      },
      ExpressionAttributeValues: {
        ":newStatus": newStatus,
        ":updatedAt": new Date().toISOString(),
        ":nullToken": null
      },
      ReturnValues: "ALL_NEW",
    });

    await ddbDocClient.send(updateCommand);
    console.log(`✅ Leave request ${requestId} updated to ${newStatus}.`);

    const output = {
      status: newStatus,
      requestId,
      approverId: leaveRequest.approverId,
      userId: leaveRequest.userId,
      userEmail: leaveRequest.userEmail,
    };

    if (action === 'approve') {
      try {
        const successCommand = new SendTaskSuccessCommand({
          taskToken,
          output: JSON.stringify(output),
        });
        await sfnClient.send(successCommand);
        console.log("✅ Sent SendTaskSuccess to Step Function.");
      } catch (err) {
        console.error("💥 Failed to send task success to Step Function:", err);
        return {
          statusCode: 400,
          body: JSON.stringify({
            message: "Could not approve leave. Possibly expired or already processed.",
            error: (err as Error).message,
          }),
        };
      }
    } else {
      try {
        const failureCommand = new SendTaskFailureCommand({
          taskToken,
          error: "LeaveRejected",
          cause: "Leave request was rejected by the approver.",
        });
        await sfnClient.send(failureCommand);
        console.log("✅ Sent SendTaskFailure to Step Function.");
      } catch (err) {
        console.error("💥 Failed to send task failure to Step Function:", err);
        return {
          statusCode: 400,
          body: JSON.stringify({
            message: "Could not reject leave. Possibly expired or already processed.",
            error: (err as Error).message,
          }),
        };
      }
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/html',
      },
      body: `
        <html>
        <head><title>Leave Request ${newStatus}</title></head>
        <body>
          <h1>Leave Request ${newStatus}!</h1>
          <p>Your action for Request ID: <strong>${requestId}</strong> has been recorded.</p>
          <p>You can close this window.</p>
        </body>
        </html>
      `,
    };
  } catch (error) {
    console.error("💥 Error processing approval/rejection:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: "Failed to process approval/rejection.",
        error: (error as Error).message,
      }),
    };
  }
};
