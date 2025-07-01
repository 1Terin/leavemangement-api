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
    // This log should ideally appear only once per invocation.
    console.log(`INFO: Request received for ${event.httpMethod} ${event.path}. RequestId: ${context.awsRequestId}`);

    if (!LEAVE_REQUESTS_TABLE) {
        console.error("ERROR: Environment variable LEAVE_REQUESTS_TABLE_NAME not set.");
        return {
            statusCode: 500,
            body: JSON.stringify({ message: "LEAVE_REQUESTS_TABLE_NAME is not configured." }),
        };
    }

    const requestId = event.queryStringParameters?.requestId;
    let taskToken: string; // Declared here for broader scope

    try {
        // --- START essential change for '+' vs ' ' ---
        // Original token from URL
        let rawTaskTokenFromUrl = event.queryStringParameters?.token || '';
        // Replace '+' with space before decoding, as '+' is often used for spaces in query strings
        // This ensures consistency when comparing with the stored token
        taskToken = decodeURIComponent(rawTaskTokenFromUrl.replace(/\+/g, ' ')).trim();
        // --- END essential change ---
    } catch (decodeErr) {
        // Log the error message directly from the decodeErr object
        console.warn("WARN: Malformed token during decode:", (decodeErr as Error).message);
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
        console.warn(`WARN: Missing required parameters. requestId: ${requestId || 'N/A'}, action: ${action || 'N/A'}, taskToken length: ${taskToken.length}`);
        return {
            statusCode: 400,
            body: JSON.stringify({ message: "Invalid approval/rejection link. Missing parameters." }),
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

        // --- START essential change for '+' vs ' ' ---
        // Token stored in DynamoDB
        let rawStoredTokenFromDb = leaveRequest?.taskToken || '';
        // Apply the same replacement for '+' with space for consistency
        const storedToken = decodeURIComponent(rawStoredTokenFromDb.replace(/\+/g, ' ')).trim();
        // --- END essential change ---

        // --- START TEMPORARY DEBUG LOGS FOR TOKEN COMPARISON ---
        // These logs are crucial for diagnosing the 'Token mismatch' warning
        // REMOVE THESE AFTER YOU'VE FIXED THE ISSUE
        console.log(`DEBUG: Comparing provided token (from URL): '${taskToken}' (length: ${taskToken.length})`);
        console.log(`DEBUG: Comparing stored token (from DB):   '${storedToken}' (length: ${storedToken.length})`);

        if (storedToken !== taskToken) { // Only log differences if they don't match
            for (let i = 0; i < Math.max(taskToken.length, storedToken.length); i++) {
                if (taskToken[i] !== storedToken[i]) {
                    console.log(`DEBUG: Difference found at index ${i}:`);
                    console.log(`  Provided char: '${taskToken[i] || 'N/A'}' (CharCode: ${taskToken.charCodeAt(i) || 'N/A'})`);
                    console.log(`  Stored char:   '${storedToken[i] || 'N/A'}' (CharCode: ${storedToken.charCodeAt(i) || 'N/A'})`);
                    // Log a substring to see context around the difference
                    const contextLength = 10; // Number of chars before/after diff to show
                    console.log(`  Provided context: ${taskToken.substring(Math.max(0, i - contextLength), Math.min(taskToken.length, i + contextLength))}`);
                    console.log(`  Stored context:   ${storedToken.substring(Math.max(0, i - contextLength), Math.min(storedToken.length, i + contextLength))}`);
                    break; // Stop after first difference found to avoid excessive logs
                }
            }
        }
        // --- END TEMPORARY DEBUG LOGS ---

        if (!leaveRequest || leaveRequest.status !== 'Pending' || storedToken !== taskToken) {
            console.warn(`WARN: Token mismatch or invalid state for request ${requestId}. 
                          Current status: ${leaveRequest?.status || 'N/A'}, 
                          Stored token length: ${storedToken.length}, 
                          Provided token length: ${taskToken.length}. Link might be expired or already used.`);
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
                ":nullToken": null // Clear the task token after use
            },
        }));
        console.log(`INFO: DynamoDB status for ${requestId} updated successfully.`);

        // 🔁 Step Function response
        try {
            if (action === 'approve') {
                console.log(`INFO: Sending SendTaskSuccess command for request ${requestId}.`);
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
                console.log(`INFO: Sending SendTaskFailure command for request ${requestId}.`);
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
                    message: `Leave ${newStatus} for ${requestId}, but workflow update failed.`,
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
        console.error("ERROR: Unhandled error in ProcessApprovalFunction:", (error as Error)?.message, "Stack:", (error as Error)?.stack);
        return {
            statusCode: 500,
            body: JSON.stringify({
                message: "Internal server error during leave processing.",
                error: (error as Error).message,
                stack: (error as Error).stack,
            }),
        };
    }
};