import { APIGatewayRequestAuthorizerEvent } from 'aws-lambda';
import * as jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key'; // CHANGE THIS IN PROD!

export function generatePolicy(principalId: string, effect: string, resource: string, context: any) {
  const authResponse: any = {};
  authResponse.principalId = principalId;

  if (effect && resource) {
    const policyDocument: any = {};
    policyDocument.Version = '2012-10-17';
    policyDocument.Statement = [];
    const statement: any = {};
    statement.Action = 'execute-api:Invoke';
    statement.Effect = effect;
    statement.Resource = resource;
    policyDocument.Statement.push(statement);
    authResponse.policyDocument = policyDocument;
  }

  authResponse.context = context;
  return authResponse;
}

export function verifyToken(token: string): jwt.JwtPayload | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as jwt.JwtPayload;
    return decoded;
  } catch (error) {
    console.error("JWT verification failed:", error);
    return null;
  }
}

export function createTestToken(claims: { userId: string, email: string, role: string }): string {
    return jwt.sign(claims, JWT_SECRET, { expiresIn: '1h' });
}

export interface JWTClaims {
  userId: string;
  email: string;
  role: string;
}