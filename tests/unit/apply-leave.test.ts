import { handler } from '../../src/functions/apply-leave/app';
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { SFNClient, StartExecutionCommand } from "@aws-sdk/client-sfn";
import { mockClient } from 'aws-sdk-client-mock';
import { APIGatewayProxyEvent } from 'aws-lambda';

const ddbMock = mockClient(DynamoDBDocumentClient);
const sfnMock = mockClient(SFNClient);

// Mock environment variables
process.env.LEAVE_REQUESTS_TABLE_NAME = 'TestLeaveRequestsTable';
process.env.STEP_FUNCTION_ARN = 'arn:aws:states:ap-south-1:123456789012:stateMachine:TestStateMachine';

describe('ApplyLeaveFunction', () => {
  beforeEach(() => {
    ddbMock.reset();
    sfnMock.reset();
  });

  it('should successfully submit a leave request and start step function', async () => {
    ddbMock.on(PutCommand).resolves({});
    sfnMock.on(StartExecutionCommand).resolves({ executionArn: 'test-execution-arn' });

    const event: APIGatewayProxyEvent = {
      body: JSON.stringify({
        leaveType: 'Casual',
        startDate: '2025-07-01',
        endDate: '2025-07-05',
        reason: 'Vacation',
        approverId: 'approver@example.com'
      }),
      requestContext: {
        authorizer: {
          lambda: {
            userId: 'user123',
            email: 'user@example.com',
            role: 'User'
          }
        }
      } as any,
      headers: { 'Content-Type': 'application/json' },
      httpMethod: 'POST',
      path: '/leaves',
      isBase64Encoded: false,
      queryStringParameters: null,
      multiValueQueryStringParameters: null,
      pathParameters: null,
      stageVariables: null,
      resource: '/leaves'
    };

    const result = await handler(event, {} as any);

    expect(result.statusCode).toBe(202);
    expect(JSON.parse(result.body).message).toBe('Leave request submitted for approval.');
    expect(ddbMock.calls().length).toBe(1);
    expect(sfnMock.calls().length).toBe(1);
  });

  it('should return 400 if required fields are missing', async () => {
    const event: APIGatewayProxyEvent = {
      body: JSON.stringify({
        leaveType: 'Casual',
        // missing startDate, endDate, reason, approverId
      }),
      requestContext: {
        authorizer: {
          lambda: {
            userId: 'user123',
            email: 'user@example.com',
            role: 'User'
          }
        }
      } as any,
      headers: { 'Content-Type': 'application/json' },
      httpMethod: 'POST',
      path: '/leaves',
      isBase64Encoded: false,
      queryStringParameters: null,
      multiValueQueryStringParameters: null,
      pathParameters: null,
      stageVariables: null,
      resource: '/leaves'
    };

    const result = await handler(event, {} as any);

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).message).toContain('Missing required fields');
    expect(ddbMock.calls().length).toBe(0);
    expect(sfnMock.calls().length).toBe(0);
  });
});