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
  if (!LEAVE_REQUESTS_TABLE) {
    console.error("Environment variable LEAVE_REQUESTS_TABLE_NAME not set.");
    return {
      statusCode: 500,
      body: JSON.stringify({ message: "Configuration error." }),
    };
  }

  const requestId = event.pathParameters?.requestId;
  const taskToken = event.queryStringParameters?.token;
  const action = event.path.includes('/approve') ? 'approve' : (event.path.includes('/reject') ? 'reject' : null);

  if (!requestId || !taskToken || !action) {
    console.warn("Missing requestId, taskToken, or action in request:", { requestId, taskToken, action });
    return {
      statusCode: 400,
      body: JSON.stringify({ message: "Invalid approval/rejection link." }),
    };
  }

  try {
    const getCommand = new GetCommand({
      TableName: LEAVE_REQUESTS_TABLE,
      Key: { requestId: requestId },
    });
    const { Item } = await ddbDocClient.send(getCommand);
    const leaveRequest = Item as LeaveRequest | undefined;

    if (!leaveRequest || leaveRequest.status !== 'Pending' || leaveRequest.taskToken !== taskToken) {
      console.warn("Invalid or expired leave request or task token:", { requestId, taskToken, status: leaveRequest?.status });
      return {
        statusCode: 403,
        body: JSON.stringify({ message: "This leave request is no longer pending or the approval link is invalid/expired." }),
      };
    }

    const newStatus = action === 'approve' ? 'Approved' : 'Rejected';
    const updateCommand = new UpdateCommand({
      TableName: LEAVE_REQUESTS_TABLE,
      Key: { requestId: requestId },
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
    console.log(`Leave request ${requestId} updated to ${newStatus}.`);

    const output = {
      status: newStatus,
      requestId: requestId,
      approverId: leaveRequest.approverId, 
      userId: leaveRequest.userId,
      userEmail: leaveRequest.userEmail, 
    };

    if (action === 'approve') {
      const successCommand = new SendTaskSuccessCommand({
        taskToken: taskToken,
        output: JSON.stringify(output),
      });
      await sfnClient.send(successCommand);
      console.log("Sent SendTaskSuccess to Step Function.");
    } else {
      const failureCommand = new SendTaskFailureCommand({
        taskToken: taskToken,
        error: "LeaveRejected",
        cause: "Leave request was rejected by the approver.",
      });
      await sfnClient.send(failureCommand);
      console.log("Sent SendTaskFailure to Step Function.");
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
    console.error("Error processing approval/rejection:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: "Failed to process approval/rejection.", error: (error as Error).message }),
    };
  }
};