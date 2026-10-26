const assert = require('node:assert/strict');
const test = require('node:test');

delete process.env.LOG_FORMAT;
const { JsonLogger, jsonLogs, correlationMiddleware } = require('../dist/logging');

const env = {
  OTEL_SERVICE_NAME: 'ernest-backend',
  OTEL_RESOURCE_ATTRIBUTES: 'service.namespace=chestertown,deployment.environment.name=staging',
};

function capture() {
  const lines = [];
  const logger = new JsonLogger((line) => lines.push(line), env);
  return { logger, lines, parsed: () => lines.map((l) => JSON.parse(l)) };
}

test('JSON is the default in production, text elsewhere, unless LOG_FORMAT says', () => {
  assert.equal(jsonLogs({ NODE_ENV: 'production' }), true);
  assert.equal(jsonLogs({ NODE_ENV: 'development' }), false);
  assert.equal(jsonLogs({ NODE_ENV: 'production', LOG_FORMAT: 'text' }), false);
  assert.equal(jsonLogs({ LOG_FORMAT: 'json' }), true);
});

test('a Nest log line carries the suite fields and its context as component', () => {
  const { logger, lines, parsed } = capture();
  logger.log('Mapped {/api/stats, GET} route', 'RouterExplorer');
  assert.equal(lines.length, 1);
  assert.ok(lines[0].endsWith('\n') && lines[0].indexOf('\n') === lines[0].length - 1);
  const [line] = parsed();
  assert.match(line.timestamp, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  assert.equal(line.severity, 'INFO');
  assert.equal(line['service.name'], 'ernest-backend');
  assert.equal(line['deployment.environment.name'], 'staging');
  assert.ok(line['service.version']);
  assert.equal(line.message, 'Mapped {/api/stats, GET} route');
  assert.equal(line.component, 'RouterExplorer');
});

test('an error is its type and frames, never its message', () => {
  const { logger, parsed } = capture();
  const err = new TypeError('subject alice@example.com was refused');
  logger.error('evidence not recorded', err.stack, 'EvidenceService');
  const line = JSON.parse(logger.line('ERROR', ['failed:', err]));
  for (const l of [...parsed(), line]) {
    assert.ok(!JSON.stringify(l).includes('alice@example.com'), JSON.stringify(l));
    assert.match(l['exception.stacktrace'], /^at /);
  }
  assert.equal(line['error.type'], 'TypeError');
  assert.equal(parsed()[0].component, 'EvidenceService');
});

test('a request’s X-Correlation-Id is on its lines, when it is a plain token', () => {
  const { logger, parsed } = capture();
  correlationMiddleware({ headers: { 'x-correlation-id': 'task-7' } }, {}, () => logger.log('recorded'));
  correlationMiddleware({ headers: { 'x-correlation-id': 'not a token' } }, {}, () => logger.log('recorded'));
  logger.log('outside');
  const [inside, invalid, outside] = parsed();
  assert.equal(inside.correlation_id, 'task-7');
  assert.equal(invalid.correlation_id, undefined);
  assert.equal(outside.correlation_id, undefined);
});
