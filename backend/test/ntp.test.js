// SNTP offset math (RFC 4330). The network path is exercised manually / in
// deployment; what must never regress silently is the packet layout and the
// offset formula, since a sign or epoch error would page operators about drift
// that does not exist (or hide drift that does).
const assert = require('node:assert/strict');
const test = require('node:test');
const { buildSntpRequest, computeSntpOffsetMs } = require('../dist/common/ntp');

const NTP_EPOCH_OFFSET_MS = 2208988800000;

function writeNtpTimestamp(buffer, offset, unixMs) {
  const ntpMs = unixMs + NTP_EPOCH_OFFSET_MS;
  const seconds = Math.floor(ntpMs / 1000);
  const fraction = Math.round(((ntpMs % 1000) / 1000) * 0x100000000);
  buffer.writeUInt32BE(seconds, offset);
  buffer.writeUInt32BE(fraction, offset + 4);
}

function responseWith(serverReceiveMs, serverTransmitMs) {
  const packet = Buffer.alloc(48);
  writeNtpTimestamp(packet, 32, serverReceiveMs);
  writeNtpTimestamp(packet, 40, serverTransmitMs);
  return packet;
}

test('request packet is 48 bytes with LI=0 VN=3 Mode=3', () => {
  const packet = buildSntpRequest();
  assert.equal(packet.length, 48);
  assert.equal(packet[0], 0x1b);
});

test('offset is ~zero when clocks agree', () => {
  const t0 = 1_783_200_000_000;
  const response = responseWith(t0 + 50, t0 + 51); // 100ms round trip, symmetric
  const offset = computeSntpOffsetMs(response, t0, t0 + 100);
  assert.ok(Math.abs(offset) < 2, `expected ~0, got ${offset}`);
});

test('local clock 30s behind yields ~+30000ms offset regardless of round trip', () => {
  const localSend = 1_783_200_000_000;
  const trueSend = localSend + 30_000;
  const response = responseWith(trueSend + 40, trueSend + 41);
  const offset = computeSntpOffsetMs(response, localSend, localSend + 80);
  assert.ok(Math.abs(offset - 30_000) < 5, `expected ~30000, got ${offset}`);
});

test('local clock ahead yields a negative offset', () => {
  const localSend = 1_783_200_000_000;
  const trueSend = localSend - 12_000;
  const response = responseWith(trueSend + 10, trueSend + 11);
  const offset = computeSntpOffsetMs(response, localSend, localSend + 20);
  assert.ok(offset < -11_000 && offset > -13_000, `expected ~-12000, got ${offset}`);
});

test('short or empty responses are rejected', () => {
  assert.throws(() => computeSntpOffsetMs(Buffer.alloc(20), 0, 0), /too short/);
  assert.throws(() => computeSntpOffsetMs(Buffer.alloc(48), 0, 0), /no transmit timestamp/);
});
