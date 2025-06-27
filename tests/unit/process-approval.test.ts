import { handler } from '../../src/functions/process-approval/app';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { SFNClient, SendTaskSuccessCommand, SendTaskFailureCommand } from "@aws-sdk/client-sfn";
import { mockClient } from 'aws-sdk-client-mock';
import { APIGatewayProxyEvent } from 'aws-lambda';
import { LeaveRequest } from '../../src/types/leave';

const ddbMock = mockClient(DynamoDBDocumentClient);
const sfnMock = mockClient(SFNClient);

// Mock environment variables
process.env.LEAVE_REQUESTS_TABLE_NAME = 'TestLeaveRequestsTable';

describe('ProcessApprovalFunction', () => {
  beforeEach(() => {
    ddbMock.reset();
    sfnMock.reset();
  });

  const mockRequestId = 'test-request-id-123';
  const mockTaskToken = 'mock-task-token-xyz';
  const mockLeaveRequest: LeaveRequest = {
    requestId: mockRequestId,
    userId: 'test-user',
    approverId: 'test-approver',
    leaveType: 'Sick',
    startDate: '2025-07-01',
    endDate: '2025-07-01',
    reason: 'Fever',
    status: 'Pending',
    taskToken: mockTaskToken,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  it('should successfully approve a leave request', async () => {
    ddbMock.on(GetCommand).resolves({ Item: mockLeaveRequest });
    ddbMock.on(UpdateCommand).resolves({});
    sfnMock.on(SendTaskSuccessCommand).resolves({});

    const event: APIGatewayProxyEvent = {
      pathParameters: { requestId: mockRequestId },
      queryStringParameters: { token: mockTaskToken },
      path: `/leaves/${mockRequestId}/approve`,
      httpMethod: 'GET',
      requestContext: {} as any,
      headers: {},
      isBase64Encoded: false,
      queryStringParameters: { token: mockTaskToken },
      multiValueQueryStringParameters: null,
      stageVariables: null,
      resource: '/leaves/{requestId}/approve'
    };

    const result = await handler(event, {} as any);

    expect(result.statusCode).toBe(200);
    expect(result.body).toContain('Leave Request Approved!');
    expect(ddbMock.commandCalls(GetCommand).length).toBe(1);
    expect(ddbMock.commandCalls(UpdateCommand).length).toBe(1);
    expect(ddbMock.commandCalls(UpdateCommand)[0].args[0].input.UpdateExpression).toContain('Approved');
    expect(sfnMock.commandCalls(SendTaskSuccessCommand).length).toBe(1);
    expect(sfnMock.commandCalls(SendTaskFailureCommand).length).toBe(0);
  });

  it('should successfully reject a leave request', async () => {
    ddbMock.on(GetCommand).resolves({ Item: mockLeaveRequest });
    ddbMock.on(UpdateCommand).resolves({});
    sfnMock.on(SendTaskFailureCommand).resolves({});

    const event: APIGatewayProxyEvent = {
      pathParameters: { requestId: mockRequestId },
      queryStringParameters: { token: mockTaskToken },
      path: `/leaves/${mockRequestId}/reject`,
      httpMethod: 'GET',
      requestContext: {} as any,
      headers: {},
      isBase64Encoded: false,
      queryStringParameters: { token: mockTaskToken },
      multiValueQueryStringParameters: null,
      stageVariables: null,
      resource: '/leaves/{requestId}/reject'
    };

    const result = await handler(event, {} as any);

    expect(result.statusCode).toBe(200);
    expect(result.body).toContain('Leave Request Rejected!');
    expect(ddbMock.commandCalls(GetCommand).length).toBe(1);
    expect(ddbMock.commandCalls(UpdateCommand).length).toBe(1);
    expect(ddbMock.commandCalls(UpdateCommand)[0].args[0].input.UpdateExpression).toContain('Rejected');
    expect(sfnMock.commandCalls(SendTaskFailureCommand).length).toBe(1);
    expect(sfnMock.commandCalls(SendTaskSuccessCommand).length).toBe(0);
  });

  it('should return 403 if leave request is not pending', async () => {
    const approvedLeaveRequest = { ...mockLeaveRequest, status: 'Approved' };
    ddbMock.on(GetCommand).resolves({ Item: approvedLeaveRequest });

    const event: APIGatewayProxyEvent = {
      pathParameters: { requestId: mockRequestId },
      queryStringParameters: { token: mockTaskToken },
      path: `/leaves/${mockRequestId}/approve`,
      httpMethod: 'GET',
      requestContext: {} as any,
      headers: {},
      isBase64Encoded: false,
      queryStringParameters: { token: mockTaskToken },
      multiValueQueryStringParameters: null,
      stageVariables: null,
      resource: '/leaves/{requestId}/approve'
    };

    const result = await handler(event, {} as any);

    expect(result.statusCode).toBe(403);
    expect(result.body).toContain('This leave request is no longer pending');
    expect(ddbMock.commandCalls(GetCommand).length).toBe(1);
    expect(ddbMock.commandCalls(UpdateCommand).length).toBe(0);
    expect(sfnMock.calls().length).toBe(0);
  });

  it('should return 403 if task token does not match', async () => {
    ddbMock.on(GetCommand).resolves({ Item: mockLeaveRequest });

    const event: APIGatewayProxyEvent = {
      pathParameters: { requestId: mockRequestId },
      queryStringParameters: { token: 'invalid-token' },
      path: `/leaves/${mockRequestId}/approve`,
      httpMethod: 'GET',
      requestContext: {} as any,
      headers: {},
      isBase64Encoded: false,
      queryStringParameters: { token: 'invalid-token' },
      multiValueQueryStringParameters: null,
      stageVariables: null,
      resource: '/leaves/{requestId}/approve'
    };

    const result = await handler(event, {} as any);

    expect(result.statusCode).toBe(403);
    expect(result.body).toContain('invalid/expired');
    expect(ddbMock.commandCalls(GetCommand).length).toBe(1);
    expect(ddbMock.commandCalls(UpdateCommand).length).toBe(0);
    expect(sfnMock.calls().length).toBe(0);
  });
});