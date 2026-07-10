export class ApiError extends Error {
  constructor(
    public httpStatus: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export class ValidationError extends ApiError {
  constructor(message: string) {
    super(400, 'VALIDATION_ERROR', message);
  }
}

export class NotFoundError extends ApiError {
  constructor(message = 'Not found') {
    super(404, 'NOT_FOUND', message);
  }
}

export class ForbiddenError extends ApiError {
  constructor(message = 'Forbidden') {
    super(403, 'FORBIDDEN', message);
  }
}

export class DuplicateInvitationError extends ApiError {
  constructor(message = 'A pending invitation already exists for this contact in this community') {
    super(409, 'DUPLICATE_INVITATION', message);
  }
}

export class AlreadyMemberError extends ApiError {
  constructor(message = 'This contact is already an active member of this community') {
    super(409, 'ALREADY_MEMBER', message);
  }
}

export class InvitationNotPendingError extends ApiError {
  constructor(message = 'Invitation is no longer pending') {
    super(409, 'INVITATION_NOT_PENDING', message);
  }
}

export class MembershipNotActiveError extends ApiError {
  constructor(message = 'User has no active membership to revoke') {
    super(404, 'MEMBERSHIP_NOT_ACTIVE', message);
  }
}
