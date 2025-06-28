import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { Context } from 'aws-lambda';

const sesClient = new SESClient({});

const SENDER_EMAIL = process.env.SENDER_EMAIL;
const API_GATEWAY_DOMAIN = process.env.API_GATEWAY_DOMAIN; 

interface SendEmailInput {
  recipientEmail: string;
  subject: string;
  bodyHtml: string;
  bodyText: string;
  taskToken?: string; // Only for approver email
  requestId?: string; 
  actionType: 'APPROVER_REQUEST' | 'USER_APPROVAL' | 'USER_REJECTION';
}

export const handler = async (event: SendEmailInput, context: Context) => {
  console.log("Received event for sending email:", JSON.stringify(event, null, 2));

  if (!SENDER_EMAIL || !API_GATEWAY_DOMAIN) {
    console.error("Environment variables not set: SENDER_EMAIL or API_GATEWAY_DOMAIN");
    throw new Error("Configuration error: SES sender email or API Gateway domain not set.");
  }

  const { recipientEmail, subject, bodyHtml, bodyText, taskToken, requestId, actionType } = event;

  let finalBodyHtml = bodyHtml;
  let finalBodyText = bodyText;

  if (actionType === 'APPROVER_REQUEST' && taskToken && requestId) {
    const approveLink = `https://${API_GATEWAY_DOMAIN}/prod/leaves/${requestId}/approve?token=${encodeURIComponent(taskToken)}`;
    const rejectLink = `https://${API_GATEWAY_DOMAIN}/prod/leaves/${requestId}/reject?token=${encodeURIComponent(taskToken)}`;

    finalBodyHtml = `
      <p>${bodyHtml}</p>
      <p>Please review the leave request:</p>
      <p><a href="${approveLink}">Approve Leave</a></p>
      <p><a href="${rejectLink}">Reject Leave</a></p>
      <p>Request ID: ${requestId}</p>
    `;
    finalBodyText = `
      ${bodyText}
      Please review the leave request:
      Approve: ${approveLink}
      Reject: ${rejectLink}
      Request ID: ${requestId}
    `;
  }

  const command = new SendEmailCommand({
    Destination: {
      ToAddresses: [recipientEmail],
    },
    Message: {
      Body: {
        Html: {
          Charset: "UTF-8",
          Data: finalBodyHtml,
        },
        Text: {
          Charset: "UTF-8",
          Data: finalBodyText,
        },
      },
      Subject: {
        Charset: "UTF-8",
        Data: subject,
      },
    },
    Source: SENDER_EMAIL,
  });

  try {
    const response = await sesClient.send(command);
    console.log("Email sent successfully:", response.MessageId);
  } catch (error) {
    console.error("Error sending email:", error);
    throw error; 
  }
};