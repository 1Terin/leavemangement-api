import { Context, APIGatewayAuthorizerResult } from 'aws-lambda';
import { verifyToken, generatePolicy, JWTClaims } from '../../util/jwt';

interface TokenAuthorizerEvent {
  type: 'TOKEN';
  authorizationToken: string;
  methodArn: string;
}

export const handler = async (event: TokenAuthorizerEvent, context: Context): Promise<APIGatewayAuthorizerResult> => {
  console.log("Incoming event:", JSON.stringify(event, null, 2));

  const token = event.authorizationToken?.split(' ')[1];
  console.log("Extracted token status:", token ? "Token present and extracted" : "Token missing or malformed");

  if (!token) {
    console.warn("Authorization token not provided or malformed in event.authorizationToken.");
    throw new Error('Unauthorized');
  }

  try {
    console.log("Attempting to verify token using verifyToken function...");
    const decoded = verifyToken(token); 
    console.log("Token verification result:", decoded ? "Token successfully decoded." : "Token verification failed (decoded is null/undefined).");

    if (!decoded) {
      console.warn("Invalid or expired token, or verification failed.");
      throw new Error('Unauthorized');
    }

    const claims = decoded as JWTClaims;
    console.log("Claims extracted:", JSON.stringify(claims));

    const principalId = claims.userId;
    const effect = 'Allow';
    const resource = event.methodArn.replace(/\/(GET|POST|PUT|DELETE|OPTIONS|HEAD)/, '/*');


    
    const normalizedRole = claims.role?.toLowerCase();
    const authContext = {
      userId: claims.userId,
      email: claims.email,
      role: normalizedRole
    };

    console.log("Attempting to generate policy using generatePolicy function...");
    const policy = generatePolicy(principalId, effect, resource, authContext);
    console.log("Generated policy:", JSON.stringify(policy));

    return policy;
  } catch (error: any) {
    console.error("Error during token processing or policy generation:", error.message, error.stack);
    throw new Error('Unauthorized');
  }
};