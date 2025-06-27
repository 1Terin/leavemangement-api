export interface LeaveRequest {
  requestId: string;
  userId: string;
  approverId: string;
  leaveType: 'Sick' | 'Casual' | 'Annual';
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
  reason: string;
  status: 'Pending' | 'Approved' | 'Rejected';
  taskToken?: string; // Stored when Step Function enters wait state
  createdAt: string;
  updatedAt: string;
  userEmail: string; // Email of the user making the request
}

export interface ApprovalAction {
  requestId: string;
  action: 'approve' | 'reject';
  approverId: string;
  comments?: string;
  taskToken: string; // From the email link
}

export interface User {
  userId: string;
  email: string;
  name: string;
  role: 'User' | 'Approver';
  // Add other user details as needed
}

export interface JWTClaims {
  userId: string;
  email: string;
  role: 'User' | 'Approver';
  iat: number;
  exp: number;
}