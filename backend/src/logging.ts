// Logs as the Chestertown observability conventions describe them (section 5): one JSON object
// per line on stdout, with `timestamp`, `severity`, `service.name`, `service.version`,
// `deployment.environment.name`, `message`, `component`, `trace_id` and `span_id` (from the
// active span) and `correlation_id` (the caller's X-Correlation-Id).
//
// LOG_FORMAT=json|text; JSON by default when NODE_ENV=production. Imported first by main.ts,
// so even what is printed before Nest starts is JSON. console.* is routed through it, so the
// few direct console calls are JSON too.
//
// An Error is written as its type and its frames, never its message: a message may carry what
// someone sent (section 7).
import { AsyncLocalStorage } from 'node:async_hooks';
import { format } from 'node:util';
import { trace } from '@opentelemetry/api';
import type { LoggerService } from '@nestjs/common';

type Severity = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';

const correlation = new AsyncLocalStorage<string>();
const CORRELATION_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const STACK = /^[\w$.]*(Error|Exception)\b[^\n]*\n\s+at /;

export function jsonLogs(env: NodeJS.ProcessEnv = process.env): boolean {
  const configured = (env.LOG_FORMAT || '').trim().toLowerCase();
  if (configured) return configured === 'json';
  return env.NODE_ENV === 'production';
}

function deploymentEnvironment(env: NodeJS.ProcessEnv): string {
  for (const pair of (env.OTEL_RESOURCE_ATTRIBUTES || '').split(',')) {
    const [key, value] = pair.trim().split('=');
    if (key === 'deployment.environment.name' && value) return value;
  }
  return env.NODE_ENV || 'development';
}

function serviceVersion(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('../package.json').version || 'dev';
  } catch {
    return 'dev';
  }
}

/** The frames of a stack, without the first line (the error's message). */
function frames(stack: string): string {
  return stack
    .split('\n')
    .filter((line) => /^\s+at /.test(line))
    .map((line) => line.trim())
    .join('\n');
}

export class JsonLogger implements LoggerService {
  private readonly base: Record<string, string>;

  constructor(
    private readonly write: (line: string) => void = (line) => process.stdout.write(line),
    env: NodeJS.ProcessEnv = process.env,
  ) {
    this.base = {
      'service.name': env.OTEL_SERVICE_NAME || 'ernest-backend',
      'service.version': serviceVersion(),
      'deployment.environment.name': deploymentEnvironment(env),
    };
  }

  log(message: any, ...rest: any[]) {
    this.emit('INFO', message, rest);
  }
  error(message: any, ...rest: any[]) {
    this.emit('ERROR', message, rest);
  }
  warn(message: any, ...rest: any[]) {
    this.emit('WARN', message, rest);
  }
  debug(message: any, ...rest: any[]) {
    this.emit('DEBUG', message, rest);
  }
  verbose(message: any, ...rest: any[]) {
    this.emit('DEBUG', message, rest);
  }
  fatal(message: any, ...rest: any[]) {
    this.emit('FATAL', message, rest);
  }

  /** Nest calls (message, ...optional, context): the last string is the context. */
  private emit(severity: Severity, message: any, rest: any[]) {
    const args = [...rest];
    const component = args.length && typeof args[args.length - 1] === 'string' && !STACK.test(args[args.length - 1])
      ? args.pop()
      : undefined;
    this.write(this.line(severity, [message, ...args], component));
  }

  /** One line: the arguments formatted as console.* would, errors reduced to type and frames. */
  line(severity: Severity, args: any[], component?: string, extra: Record<string, unknown> = {}): string {
    const fields: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      severity,
      ...this.base,
    };
    let stack: string | undefined;
    let errorType: string | undefined;
    const parts = args.map((arg) => {
      if (arg instanceof Error) {
        errorType ??= arg.name || arg.constructor?.name || 'Error';
        stack ??= frames(arg.stack || '');
        return arg.name;
      }
      if (typeof arg === 'string' && STACK.test(arg)) {
        stack ??= frames(arg);
        return '';
      }
      return arg;
    });
    fields.message = format(...parts).trim();
    if (component) fields.component = component;
    const span = trace.getActiveSpan()?.spanContext();
    if (span && trace.isSpanContextValid(span)) {
      fields.trace_id = span.traceId;
      fields.span_id = span.spanId;
    }
    const correlationId = correlation.getStore();
    if (correlationId) fields.correlation_id = correlationId;
    if (errorType) fields['error.type'] = errorType;
    if (stack) fields['exception.stacktrace'] = stack;
    Object.assign(fields, extra);
    return JSON.stringify(fields) + '\n';
  }
}

/** Express middleware: the request's X-Correlation-Id, when it is a plain token, for its logs. */
export function correlationMiddleware(req: any, _res: any, next: () => void) {
  const id = req.headers?.['x-correlation-id'];
  if (typeof id === 'string' && CORRELATION_ID.test(id)) {
    correlation.run(id, next);
  } else {
    next();
  }
}

export const logger = new JsonLogger();

/** Routes console.* through the JSON logger. */
function installConsole(target: JsonLogger) {
  const write = (severity: Severity) => (...args: any[]) =>
    process.stdout.write(target.line(severity, args));
  console.log = write('INFO');
  console.info = write('INFO');
  console.warn = write('WARN');
  console.error = write('ERROR');
  console.debug = write('DEBUG');
}

if (jsonLogs()) installConsole(logger);
