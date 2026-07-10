interface LogFields {
  [key: string]: unknown;
}

function emit(level: 'info' | 'error', event: string, fields: LogFields = {}): void {
  const line = JSON.stringify({ level, event, timestamp: new Date().toISOString(), ...fields });
  // eslint-disable-next-line no-console
  (level === 'error' ? console.error : console.log)(line);
}

export const logger = {
  info: (event: string, fields?: LogFields) => emit('info', event, fields),
  error: (event: string, fields?: LogFields) => emit('error', event, fields),
};
