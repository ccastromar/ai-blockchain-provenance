import * as dgram from 'dgram';

// Minimal SNTP client (RFC 4330) — no dependencies. Used by the hourly integrity
// check to DETECT clock drift, in line with the threat model's N3: block timestamps
// are claims whose quality depends on the host clock, so Ernest alerts when that
// clock drifts instead of silently notarizing wrong wall-clock times. Opt-in via
// NTP_CHECK_SERVER; failures are soft (network hiccups must not fail an integrity
// check).

const NTP_EPOCH_OFFSET_MS = 2_208_988_800_000; // 1900-01-01 → 1970-01-01
const NTP_PACKET_SIZE = 48;

export function buildSntpRequest(): Buffer {
  const packet = Buffer.alloc(NTP_PACKET_SIZE);
  packet[0] = 0x1b; // LI=0, VN=3, Mode=3 (client)
  return packet;
}

function ntpTimestampToMs(buffer: Buffer, offset: number): number {
  const seconds = buffer.readUInt32BE(offset);
  const fraction = buffer.readUInt32BE(offset + 4);
  return seconds * 1000 + (fraction * 1000) / 0x100000000 - NTP_EPOCH_OFFSET_MS;
}

/**
 * Clock offset in ms per RFC 4330: ((t1 - t0) + (t2 - t3)) / 2, where t0/t3 are
 * local send/receive times and t1/t2 the server's receive/transmit timestamps.
 * Positive result means the local clock is BEHIND the server.
 */
export function computeSntpOffsetMs(response: Buffer, sentAtMs: number, receivedAtMs: number): number {
  if (response.length < NTP_PACKET_SIZE) {
    throw new Error(`SNTP response too short: ${response.length} bytes`);
  }
  const serverReceiveMs = ntpTimestampToMs(response, 32);
  const serverTransmitMs = ntpTimestampToMs(response, 40);
  if (serverTransmitMs <= 0) {
    throw new Error('SNTP response carries no transmit timestamp');
  }
  return (serverReceiveMs - sentAtMs + (serverTransmitMs - receivedAtMs)) / 2;
}

/** Queries an NTP server once. Resolves the local clock offset in ms. */
export function queryClockOffsetMs(server: string, timeoutMs = 3000): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error(`NTP query to ${server} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const sentAtMs = Date.now();
    socket.once('message', (response) => {
      const receivedAtMs = Date.now();
      clearTimeout(timer);
      socket.close();
      try {
        resolve(computeSntpOffsetMs(response, sentAtMs, receivedAtMs));
      } catch (e) {
        reject(e);
      }
    });
    socket.once('error', (e) => {
      clearTimeout(timer);
      socket.close();
      reject(e);
    });
    socket.send(buildSntpRequest(), 123, server, (e) => {
      if (e) {
        clearTimeout(timer);
        socket.close();
        reject(e);
      }
    });
  });
}
