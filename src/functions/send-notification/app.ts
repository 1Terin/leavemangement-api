import { DynamoDBClient, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { SendEmailCommand, SESClient } from "@aws-sdk/client-ses";

const ddbClient = new DynamoDBClient({});
const sesClient = new SESClient({});
const LEAVE_REQUESTS_TABLE_NAME = process.env.LEAVE_REQUESTS_TABLE_NAME;
const SENDER_EMAIL = process.env.SENDER_EMAIL;

export const handler = async (event: any) => {
    console.log("SendNotificationFunction received event:", JSON.stringify(event, null, 2));

    const actionType = event.actionType ?? (event.taskToken ? "APPROVER_REQUEST" : "USER_REJECTION");

    if (actionType === "APPROVER_REQUEST") {
        const {
            requestId,
            userEmail,
            approverEmail,
            approverId,
            leaveType,
            startDate,
            endDate,
            reason,
            taskToken,
            apiGatewayUrl,
            leaveDetails
        } = event;

        if (!requestId || !taskToken || !apiGatewayUrl) {
            console.error("Missing required parameters for SendNotificationFunction:", { requestId, taskToken, apiGatewayUrl });
            throw new Error("Missing required parameters.");
        }

        await ddbClient.send(new UpdateItemCommand({
            TableName: LEAVE_REQUESTS_TABLE_NAME,
            Key: { requestId: { S: requestId } },
            UpdateExpression: "SET taskToken = :token",
            ExpressionAttributeValues: { ":token": { S: taskToken } }
        }));
        console.log("Task token stored in DynamoDB for requestId:", requestId);

        // Generate links
        const approveLink = `${apiGatewayUrl}/leaves/${requestId}/approve?token=${encodeURIComponent(taskToken)}`;
        const rejectLink = `${apiGatewayUrl}/leaves/${requestId}/reject?token=${encodeURIComponent(taskToken)}`;

        // Build email content
        const subject = "New Leave Request for Approval";
        const details = leaveDetails || { leaveType, startDate, endDate, reason }; // support both formats

        const bodyHtml = `
            <p>Dear Approver,</p>
            <p>A new leave request from ${userEmail} requires your approval:</p>
            <ul>
                <li>Leave Type: ${details.leaveType}</li>
                <li>Start Date: ${details.startDate}</li>
                <li>End Date: ${details.endDate}</li>
                <li>Reason: ${details.reason}</li>
            </ul>
            <p><a href="${approveLink}">Approve</a> | <a href="${rejectLink}">Reject</a></p>
        `;
        const bodyText = `New leave request from ${userEmail}. Approve: ${approveLink} | Reject: ${rejectLink}`;

        await sesClient.send(new SendEmailCommand({
            Source: SENDER_EMAIL,
            Destination: { ToAddresses: [approverEmail] },
            Message: {
                Subject: { Data: subject },
                Body: {
                    Html: { Data: bodyHtml },
                    Text: { Data: bodyText }
                }
            }
        }));

        console.log("Approval request email sent to:", approverEmail);
        return { success: true, message: "Approval email sent." };

    } else if (actionType === "USER_REJECTION") {
        const { recipientEmail, subject, bodyHtml, bodyText } = event;

        if (!recipientEmail || !subject || !bodyHtml || !bodyText) {
            throw new Error("Missing fields for USER_REJECTION.");
        }

        await sesClient.send(new SendEmailCommand({
            Source: SENDER_EMAIL,
            Destination: { ToAddresses: [recipientEmail] },
            Message: {
                Subject: { Data: subject },
                Body: {
                    Html: { Data: bodyHtml },
                    Text: { Data: bodyText }
                }
            }
        }));

        console.log("Rejection email sent to:", recipientEmail);
        return { success: true, message: "Rejection email sent." };

    } else {
        console.error("Unknown actionType:", actionType);
        throw new Error("Unknown actionType.");
    }
};
