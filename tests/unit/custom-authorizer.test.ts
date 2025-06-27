import { handler } from '../../src/functions/custom-authorizer/app';
import { createTestToken } from '../../src/util/jwt';
import { APIGatewayRequestAuthorizerEvent } from 'aws-lambda';

// Mock JWT_SECRET for testing
process.env.JWT_SECRET = 'your-super-secret-jwt-key';

describe('CustomAuthorizerLambda', () => {
  it('should allow access with a valid token', async () => {
    const claims = { userId: 'testUser', email: 'test@example.com', role: 'User' };
    const token = createTestToken(claims);

    const event: APIGatewayRequestAuthorizerEvent = {
      type: 'TOKEN',
      methodArn: 'arn:aws:execute-api:ap-south-1:123456789012:/prod/leaves',
      headers: {
        Authorization: `Bearer ${token}`
      },
      authorizationToken: `Bearer ${token}` // Older style authorizer sometimes uses this
    } as APIGatewayRequestAuthorizerEvent;

    const result = await handler(event, {} as any);

    expect(result.principalId).toBe('testUser');
    expect(result.policyDocument.Statement[0].Effect).toBe('Allow');
    expect(result.context.userId).toBe('testUser');
    expect(result.context.email).toBe('test@example.com');
    expect(result.context.role).toBe('User');
  });

  it('should deny access without a token', async () => {
    const event: APIGatewayRequestAuthorizerEvent = {
      type: 'TOKEN',
      methodArn: 'arn:aws:execute-api:ap-south-1:123456789012:/prod/leaves',
      headers: {},
      authorizationToken: ''
    } as APIGatewayRequestAuthorizerEvent;

    await expect(handler(event, {} as any)).rejects.toThrow('Unauthorized');
  });

  it('should deny access with an invalid token', async () => {
    const event: APIGatewayRequestAuthorizerEvent = {
      type: 'TOKEN',
      methodArn: 'arn:aws:execute-api:ap-south-1:123456789012:/prod/leaves',
      headers: {
        Authorization: 'Bearer invalid.jwt.token'
      },
      authorizationToken: 'Bearer invalid.jwt.token'
    } as APIGatewayRequestAuthorizerEvent;

    await expect(handler(event, {} as any)).rejects.toThrow('Unauthorized');
  });

  it('should deny access with an expired token', async () => {
    const claims = { userId: 'testUser', email: 'test@example.com', role: 'User' };
    // Create an expired token (e.g., set expiry to 1 second ago)
    const expiredToken = require('jsonwebtoken').sign(claims, process.env.JWT_SECRET!, { expiresIn: '-1s' });

    const event: APIGatewayRequestAuthorizerEvent = {
      type: 'TOKEN',
      methodArn: 'arn:aws:execute-api:ap-south-1:123456789012:/prod/leaves',
      headers: {
        Authorization: `Bearer ${expiredToken}`
      },
      authorizationToken: `Bearer ${expiredToken}`
    } as APIGatewayRequestAuthorizerEvent;

    await expect(handler(event, {} as any)).rejects.toThrow('Unauthorized');
  });
});