export interface LeaveRequest {
  requestId: string;
  userId: string;
  approverId: string;
  leaveType: 'Sick' | 'Casual' | 'Annual';
  startDate: string;
  endDate: string;   
  reason: string;
  status: 'Pending' | 'Approved' | 'Rejected';
  taskToken?: string;
  createdAt: string;
  updatedAt: string;
  userEmail: string; 
}

export interface ApprovalAction {
  requestId: string;
  action: 'approve' | 'reject';
  approverId: string;
  comments?: string;
  taskToken: string; 
}

export interface User {
  userId: string;
  email: string;
  name: string;
  role: 'User' | 'Approver';
}

export interface JWTClaims {
  userId: string;
  email: string;
  role: 'User' | 'Approver';
  iat: number;
  exp: number;
}