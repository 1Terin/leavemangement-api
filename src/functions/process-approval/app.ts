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
  console.log(`INFO: Request received for ${event.httpMethod} ${event.path}`);

  if (!LEAVE_REQUESTS_TABLE) {
    console.error("Environment variable LEAVE_REQUESTS_TABLE_NAME not set.");
    return {
      statusCode: 500,
      body: JSON.stringify({ message: "LEAVE_REQUESTS_TABLE_NAME is not configured." }),
    };
  }

  const requestId = event.queryStringParameters?.requestId;
  let taskToken = '';
  try {
    taskToken = decodeURIComponent(event.queryStringParameters?.token || '');
  } catch (decodeErr) {
    console.warn("Malformed token during decode:", decodeErr);
    return {
      statusCode: 400,
      body: JSON.stringify({ message: "Malformed approval token." }),
    };
  }

  const path = event.path || '';
  let action: "approve" | "reject" | null = null;
  if (path.includes('/approve')) action = "approve";
  if (path.includes('/reject')) action = "reject";

  if (!requestId || !taskToken || !action) {
    console.warn("Missing requestId, taskToken, or action:", { requestId, taskToken, action });
    return {
      statusCode: 400,
      body: JSON.stringify({ message: "Invalid approval/rejection link." }),
    };
  }

  try {
    console.log(`INFO: Fetching leave request for ID: ${requestId}`);
    const { Item } = await ddbDocClient.send(new GetCommand({
      TableName: LEAVE_REQUESTS_TABLE,
      Key: { requestId },
    }));

    const leaveRequest = Item as LeaveRequest | undefined;
    if (leaveRequest) {
            console.log(`INFO: Retrieved leave request. Status: ${leaveRequest.status}, User: ${leaveRequest.userId}`);
        } else {
            console.log(`INFO: No leave request found for ID: ${requestId}`);
        }

    const storedToken = decodeURIComponent(leaveRequest?.taskToken || '');

    if (!leaveRequest || leaveRequest.status !== 'Pending' || storedToken !== taskToken) {
      console.warn(`WARN: Token mismatch or invalid state for request ${requestId}. 
                          Current status: ${leaveRequest?.status || 'N/A'}, 
                          Stored token length: ${storedToken.length}, 
                          Provided token length: ${taskToken.length}`);
      return {
        statusCode: 403,
        body: JSON.stringify({ message: "Link expired or already used." }),
      };
    }

    const newStatus = action === 'approve' ? 'Approved' : 'Rejected';

    console.log(`INFO: Updating leave request ${requestId} status to "${newStatus}" in DynamoDB.`);
    await ddbDocClient.send(new UpdateCommand({
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
    }));
    console.log(`INFO: DynamoDB status for ${requestId} updated successfully.`);

    // 🔁 Step Function response
    try {
      if (action === 'approve') {
        console.log("✅ Sending SendTaskSuccess");
        await sfnClient.send(new SendTaskSuccessCommand({
          taskToken,
          output: JSON.stringify({
            status: newStatus,
            requestId,
            userId: leaveRequest.userId,
            approverId: leaveRequest.approverId,
            userEmail: leaveRequest.userEmail,
          }),
        }));
      } else {
        console.log(`INFO: Sending SendTaskFailure for request ${requestId}.`);
        await sfnClient.send(new SendTaskFailureCommand({
          taskToken,
          error: "LeaveRejected",
          cause: "Leave request was rejected by the approver.",
        }));
      }
      console.log(`INFO: Step Functions task update for ${requestId} completed.`);
    } catch (stepError) {
      console.error("ERROR: Step Function call failed:", (stepError as Error).message);
      return {
        statusCode: 500,
        body: JSON.stringify({
          message: `Leave ${newStatus}, but workflow update failed.`,
          error: (stepError as Error).message,
        }),
      };
    }

    const userAgent = (event.headers?.['User-Agent'] || '').toLowerCase();
    const acceptHeader = (event.headers?.['Accept'] || '').toLowerCase();
    const isBrowser = userAgent.includes('mozilla') && !userAgent.includes('postman') && acceptHeader.includes('text/html');

    console.log(`INFO: Client type: ${isBrowser ? 'Browser' : 'Postman/curl'}. Successfully finished approval flow for ${requestId}.`);

    if (isBrowser) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'text/html' },
        body: `
          <html>
            <head><title>Leave ${newStatus}</title></head>
            <body>
              <h2>Leave ${newStatus}</h2>
              <p>Request ID <strong>${requestId}</strong> has been updated successfully.</p>
              <p>You may close this tab.</p>
            </body>
          </html>`,
      };
    } else {
      return {
        statusCode: 200,
        body: JSON.stringify({
          message: `Leave ${newStatus} for request ${requestId} was processed.`,
        }),
      };
    }

  } catch (error) {
    console.error("Unhandled Error:", (error as Error)?.message, (error as Error)?.stack);
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: "Internal server error",
        error: (error as Error).message,
        stack: (error as Error).stack,
      }),
    };
  }
};
