import { APIGatewayRequestAuthorizerEvent } from 'aws-lambda';
import * as jwt from 'jsonwebtoken';

// In a real app, this would be retrieved from a secure source (e.g., AWS Secrets Manager)
// or be a public key from an IDP. For this example, we'll use a simple symmetric key.
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

  // Add custom context to be passed to the integrated Lambda
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