export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class ConversationHistoryLoadError extends Error {
  constructor(readonly reason: 'timeout' | 'limit') {
    super(`Conversation history load stopped: ${reason}`);
    this.name = 'ConversationHistoryLoadError';
  }
}
