import { APIGatewayRequestAuthorizerEvent, Context, APIGatewayAuthorizerResult } from 'aws-lambda';
import { verifyToken, generatePolicy, JWTClaims } from '../../util/jwt'; // Adjust path as needed

export const handler = async (event: APIGatewayRequestAuthorizerEvent, context: Context): Promise<APIGatewayAuthorizerResult> => {
  const token = event.headers?.Authorization?.split(' ')[1]; // Expecting "Bearer <token>"

  if (!token) {
    console.warn("Authorization token not provided.");
    throw new Error('Unauthorized'); // Return 401 Unauthorized
  }

  const decoded = verifyToken(token);

  if (!decoded) {
    console.warn("Invalid or expired token.");
    throw new Error('Unauthorized'); // Return 401 Unauthorized
  }

  const claims = decoded as JWTClaims;

  const principalId = claims.userId;
  const effect = 'Allow'; // or 'Deny' based on claims
  const resource = event.methodArn; // The ARN of the resource being accessed

  const authContext = {
    userId: claims.userId,
    email: claims.email,
    role: claims.role
  };

  return generatePolicy(principalId, effect, resource, authContext);
};