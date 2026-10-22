/** Domain errors - thrown by services and mapped to user-safe responses by the action layer. */
export class DomainError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly fieldErrors?: Record<string, string>,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class UnauthenticatedError extends DomainError {
  constructor(message = "Please sign in to continue.") {
    super(message, "UNAUTHENTICATED");
  }
}

export class ForbiddenError extends DomainError {
  constructor(
    message = "You do not have permission to perform this action.",
    public readonly permission?: string,
  ) {
    super(message, "FORBIDDEN");
  }
}

/** Also used when a record exists but is outside the caller's scope, so existence is not leaked. */
export class NotFoundError extends DomainError {
  constructor(message = "Record not found.") {
    super(message, "NOT_FOUND");
  }
}

export class ValidationError extends DomainError {
  constructor(message: string, fieldErrors?: Record<string, string>) {
    super(message, "VALIDATION", fieldErrors);
  }
}

export class ConflictError extends DomainError {
  constructor(message: string, code = "CONFLICT") {
    super(message, code);
  }
}

export class InvalidTransitionError extends DomainError {
  constructor(from: string, to: string, entity = "record") {
    super(`Cannot move ${entity} from ${from} to ${to}.`, "INVALID_TRANSITION");
  }
}
