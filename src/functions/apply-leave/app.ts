import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { PutCommand, DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { SFNClient, StartExecutionCommand } from "@aws-sdk/client-sfn";
import { v4 as uuidv4 } from 'uuid';
import { LeaveRequest } from '../../types/leave'; // Adjust path as needed

const ddbClient = new DynamoDBClient({});
const ddbDocClient = DynamoDBDocumentClient.from(ddbClient);
const sfnClient = new SFNClient({});

const LEAVE_REQUESTS_TABLE = process.env.LEAVE_REQUESTS_TABLE_NAME;
const STEP_FUNCTION_ARN = process.env.STEP_FUNCTION_ARN;

export const handler = async (event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> => {
  console.log("EVENT RECEIVED:", JSON.stringify(event, null, 2));

  if (!LEAVE_REQUESTS_TABLE || !STEP_FUNCTION_ARN) {
    console.error("Missing env vars");
    return {
      statusCode: 500,
      body: JSON.stringify({ message: "Configuration error." }),
    };
  }

  const authContext = event.requestContext?.authorizer?.lambda;

  if (!authContext || !authContext.userId) {
    console.error("Missing authorizer context:", event.requestContext?.authorizer);
    return {
      statusCode: 401,
      body: JSON.stringify({ message: "Unauthorized: User context missing." }),
    };
  }

  let requestBody: any;
  try {
    requestBody = JSON.parse(event.body || '{}');
  } catch (error) {
    return {
      statusCode: 400,
      body: JSON.stringify({ message: "Invalid JSON body." }),
    };
  }

  const { leaveType, startDate, endDate, reason, approverId } = requestBody;

  if (!leaveType || !startDate || !endDate || !reason || !approverId) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        message: "Missing required fields: leaveType, startDate, endDate, reason, approverId.",
      }),
    };
  }

  const requestId = uuidv4();
  const userId = authContext.userId;
  const createdAt = new Date().toISOString();

  const newLeaveRequest: LeaveRequest = {
    requestId,
    userId,
    approverId,
    leaveType,
    startDate,
    endDate,
    reason,
    status: 'Pending',
    createdAt,
    updatedAt: createdAt,
    userEmail: authContext.email,
  };

  try {
    // Save to DynamoDB
    const putCommand = new PutCommand({
      TableName: LEAVE_REQUESTS_TABLE,
      Item: newLeaveRequest,
    });
    await ddbDocClient.send(putCommand);
    console.log("Leave request saved:", newLeaveRequest);

    // Start Step Function
    const sfnInput = {
      requestId,
      userId,
      approverId,
      leaveDetails: {
        leaveType,
        startDate,
        endDate,
        reason,
      },
      userEmail: authContext.email,
    };

    const startExecutionCommand = new StartExecutionCommand({
      stateMachineArn: STEP_FUNCTION_ARN,
      input: JSON.stringify(sfnInput),
      name: `leave-request-${requestId}-${Date.now()}`,
    });

    const sfnResponse = await sfnClient.send(startExecutionCommand);
    console.log("Step Function started:", sfnResponse.executionArn);

    return {
      statusCode: 202,
      body: JSON.stringify({
        message: "Leave request submitted for approval.",
        requestId,
        status: newLeaveRequest.status,
      }),
    };
  } catch (error) {
    console.error("Processing error:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: "Failed to submit leave request.",
        error: (error as Error).message,
      }),
    };
  }
};
