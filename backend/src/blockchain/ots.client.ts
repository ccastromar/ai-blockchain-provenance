import { Injectable, Logger } from '@nestjs/common';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const OpenTimestamps = require('opentimestamps');

/**
 * Thin wrapper around the official javascript-opentimestamps library.
 *
 * Why OTS as the default production anchoring: no wallet, no keys, no gas, no
 * crypto holdings on the organization's balance sheet — the calendar servers
 * aggregate stamps into Bitcoin transactions for free, and the resulting .ots
 * proof is verifiable forever with independent tooling (`ots verify`), which is
 * exactly Ernest's trust model: the auditor never has to believe the operator.
 *
 * Lifecycle: stamp() returns a PENDING proof immediately (calendar promises);
 * hours later, once calendars aggregate into a mined Bitcoin block, upgrade()
 * completes the proof with a BitcoinBlockHeaderAttestation.
 */
@Injectable()
export class OtsClient {
    private readonly logger = new Logger(OtsClient.name);

    /** Stamps a 32-byte hex digest. Returns the serialized pending proof (base64). */
    async stamp(rootHex: string): Promise<string> {
        const digest = Buffer.from(rootHex.replace(/^0x/, ''), 'hex');
        const detached = OpenTimestamps.DetachedTimestampFile.fromHash(
            new OpenTimestamps.Ops.OpSHA256(),
            digest,
        );
        await OpenTimestamps.stamp(detached);
        return Buffer.from(detached.serializeToBytes()).toString('base64');
    }

    /**
     * Attempts to upgrade a pending proof. Returns the (possibly unchanged) proof
     * and, when a Bitcoin attestation is present, the attested block height.
     */
    async upgrade(proofBase64: string): Promise<{ complete: boolean; proofBase64: string; bitcoinBlockHeight?: number }> {
        const detached = OpenTimestamps.DetachedTimestampFile.deserialize(
            Array.from(Buffer.from(proofBase64, 'base64')),
        );
        try {
            await OpenTimestamps.upgrade(detached);
        } catch (e: any) {
            // Calendar hiccups are routine; the proof stays pending and we retry later.
            this.logger.debug(`OTS upgrade attempt failed (will retry): ${e?.message ?? e}`);
        }

        const height = this.bitcoinAttestationHeight(detached);
        return {
            complete: height !== undefined,
            proofBase64: Buffer.from(detached.serializeToBytes()).toString('base64'),
            bitcoinBlockHeight: height,
        };
    }

    private bitcoinAttestationHeight(detached: any): number | undefined {
        const attestations = detached.timestamp.allAttestations() as Map<any, any>;
        for (const attestation of attestations.values()) {
            if (attestation instanceof OpenTimestamps.Notary.BitcoinBlockHeaderAttestation) {
                return attestation.height;
            }
        }
        return undefined;
    }
}
