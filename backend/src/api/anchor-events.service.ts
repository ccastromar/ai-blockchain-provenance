// src/anchor-events/anchor-events.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ethers } from 'ethers';
import abiJson from '../abis/ErnestMerkleAnchor.json'; // Usa el ABI generado por Hardhat
const abi = abiJson.abi;

@Injectable()
export class AnchorEventsService {
    private readonly logger = new Logger(AnchorEventsService.name);
    private provider: ethers.JsonRpcProvider;
    private contract: ethers.Contract;

    constructor() {
        const sepoliaUrl = process.env.INFURA_URL; // mete la url en tu secrets manager, .env o configVariable
        const contractAddress = process.env.CONTRACT_ADDRESS;         // pon la dirección del contrato desplegado

        this.provider = new ethers.JsonRpcProvider(sepoliaUrl);
        this.contract = new ethers.Contract(contractAddress, abi, this.provider);
    }

    async getAllAnchoredEvents(): Promise<any[]> {
        const filter = this.contract.filters.Anchored(); // No filtra por args, muestra todos los eventos
        const events = await this.contract.queryFilter(filter, 0, 'latest');
        return events.map(e => {
            // Type guard: solo si e tiene 'args' (EventLog)
            if ("args" in e && Array.isArray(e.args)) {
                this.logger.log(e.args);
                return {
                    technicalAddress: e.args[0],
                    merkleRoot: e.args[1],
                    organizationId: e.args[2]?.hash,
                    organizationName: e.args[3],
                    domain: e.args[4],
                    timestamp: Number(e.args[5])
                };
            }
            // Si no tiene 'args', devuelve log vacío (o los valores crudos del log si lo necesitas)
            return {
                technicalAddress: null,
                merkleRoot: null,
                organizationId: null,
                organizationName: null,
                domain: null,
                timestamp: null
            };
        });

    }

    // Puedes añadir filtros por dominio, orgId, rango de fechas, etc.
    async getAnchorsByAddress(address: string): Promise<any[]> {
        const filter = this.contract.filters.Anchored(address, null, null, null);
        const events = await this.contract.queryFilter(filter, 0, 'latest');
        return events.map(e => {
            // Type guard: solo si e tiene 'args' (EventLog)
            if ("args" in e && Array.isArray(e.args)) {
                return {
                    technicalAddress: e.args[0],
                    merkleRoot: e.args[1],
                    organizationId: e.args[2]?.hash,
                    organizationName: e.args[3],
                    domain: e.args[4],
                    timestamp: Number(e.args[5])
                };
            }
            // Si no tiene 'args', devuelve log vacío (o los valores crudos del log si lo necesitas)
            return {
                technicalAddress: null,
                merkleRoot: null,
                organizationId: null,
                organizationName: null,
                domain: null,
                timestamp: null
            };
        });

    }

    async getAnchorsByOrganizationId(orgId: string): Promise<any[]> {
        const orgIdHash = ethers.keccak256(ethers.toUtf8Bytes(orgId));
        this.logger.log(`Buscando eventos para orgId: ${orgId} (hash: ${orgIdHash})`);
        const filter = this.contract.filters.Anchored(null,null,orgIdHash, null, null);
        const events = await this.contract.queryFilter(filter, 0, 'latest');
        return events.map(e => {
            // Type guard: solo si e tiene 'args' (EventLog)
            if ("args" in e && Array.isArray(e.args)) {
                return {
                    technicalAddress: e.args[0],
                    merkleRoot: e.args[1],
                    organizationId: e.args[2]?.hash,
                    organizationName: e.args[3],
                    domain: e.args[4],
                    timestamp: Number(e.args[5])
                };
            }
            // Si no tiene 'args', devuelve log vacío (o los valores crudos del log si lo necesitas)
            return {
                technicalAddress: null,
                merkleRoot: null,
                organizationId: null,
                organizationName: null,
                domain: null,
                timestamp: null
            };
        });

    }
}
