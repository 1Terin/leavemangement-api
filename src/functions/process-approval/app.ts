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
    console.log(`INFO: Request received for ${event.httpMethod} ${event.path}. RequestId: ${context.awsRequestId}`);

    if (!LEAVE_REQUESTS_TABLE) {
        console.error("ERROR: Environment variable LEAVE_REQUESTS_TABLE_NAME not set.");
        return {
            statusCode: 500,
            body: JSON.stringify({ message: "LEAVE_REQUESTS_TABLE_NAME is not configured." }),
        };
    }

    const requestId = event.queryStringParameters?.requestId;

    let tokenFromUrl: string;

    try {
        let rawTaskTokenFromUrl = event.queryStringParameters?.token || '';
        tokenFromUrl = tokenFromUrl = decodeURIComponent(rawTaskTokenFromUrl.replace(/\+/g, ' ')).replace(/\s/g, '+').trim();
    } catch (decodeErr) {
        console.warn("WARN: Malformed token during URL decode:", (decodeErr as Error).message);
        return {
            statusCode: 400,
            body: JSON.stringify({ message: "Malformed approval token." }),
        };
    }

    const path = event.path || '';
    let action: "approve" | "reject" | null = null;
    if (path.includes('/approve')) action = "approve";
    if (path.includes('/reject')) action = "reject";

    if (!requestId || !tokenFromUrl || !action) {
        console.warn(`WARN: Missing required parameters. requestId: ${requestId || 'N/A'}, action: ${action || 'N/A'}, tokenFromUrl length: ${tokenFromUrl.length}`);
        return {
            statusCode: 400,
            body: JSON.stringify({ message: "Invalid approval/rejection link. Missing parameters." }),
        };
    }

    let taskTokenFromDbForSfn: string;

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

        let rawStoredTokenFromDb = leaveRequest?.taskToken || '';
        taskTokenFromDbForSfn = rawStoredTokenFromDb.trim();

        console.log(`DEBUG: Comparing provided token (from URL, decoded): '${tokenFromUrl}' (length: ${tokenFromUrl.length})`);
        console.log(`DEBUG: Comparing stored token (from DB, raw):        '${taskTokenFromDbForSfn}' (length: ${taskTokenFromDbForSfn.length})`);

        if (taskTokenFromDbForSfn !== tokenFromUrl) {
            console.warn(`WARN: Token mismatch for request ${requestId}. This might indicate a stale link or tampered token.`);
            for (let i = 0; i < Math.max(tokenFromUrl.length, taskTokenFromDbForSfn.length); i++) {
                if (tokenFromUrl[i] !== taskTokenFromDbForSfn[i]) {
                    console.log(`DEBUG: Difference found at index ${i}:`);
                    console.log(`   Provided char: '${tokenFromUrl[i] || 'N/A'}' (CharCode: ${tokenFromUrl.charCodeAt(i) || 'N/A'})`);
                    console.log(`   Stored char:   '${taskTokenFromDbForSfn[i] || 'N/A'}' (CharCode: ${taskTokenFromDbForSfn.charCodeAt(i) || 'N/A'})`);
                    const contextLength = 10;
                    console.log(`   Provided context: ${tokenFromUrl.substring(Math.max(0, i - contextLength), Math.min(tokenFromUrl.length, i + contextLength))}`);
                    console.log(`   Stored context:   ${taskTokenFromDbForSfn.substring(Math.max(0, i - contextLength), Math.min(taskTokenFromDbForSfn.length, i + contextLength))}`);
                    break;
                }
            }
            return {
                statusCode: 403,
                body: JSON.stringify({ message: "Link expired or already used." }),
            };
        }

        if (!leaveRequest || leaveRequest.status !== 'Pending') {
            console.warn(`WARN: Invalid state for request ${requestId}. Current status: ${leaveRequest?.status || 'N/A'}.`);
            return {
                statusCode: 403,
                body: JSON.stringify({ message: "Leave request not found or not pending." }),
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

        try {
            if (action === 'approve') {
                console.log(`INFO: Sending SendTaskSuccess command for request ${requestId}.`);
                console.log(`DEBUG: Final taskToken sent to SFN (Success): '${taskTokenFromDbForSfn}' (length: ${taskTokenFromDbForSfn.length})`);
                await sfnClient.send(new SendTaskSuccessCommand({
                    taskToken: taskTokenFromDbForSfn,
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
                    taskToken: taskTokenFromDbForSfn,
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